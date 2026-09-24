/**
 * Ship Dễ — Token Usage & Quota Adapter
 * TASK-AI-15: AI15-R01, AI15-R05, AI15-R06
 *
 * Reports measured token consumption from the two records that exist on this
 * machine, and reports nothing at all when neither can be read. No figure in
 * this adapter is estimated from a constant.
 *
 *  - 9router keeps a SQLite ledger of every request it proxied.
 *  - Claude Code appends per-turn token counts to JSONL transcripts under
 *    ~/.claude/projects. These cover work that never passed through the
 *    gateway, which is most of it, so the two sources are complementary
 *    rather than redundant and are reported separately.
 *
 * Only counters, model names and timestamps are read. Transcript content and
 * prompt text are never opened, so no conversation can leak into the cockpit.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { redactPath } = require('./redaction');

const ROUTER_DB = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  '9router',
  'db',
  'data.sqlite'
);
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');

// AI15-R06: bounded reads. A transcript far larger than any real session is
// skipped rather than streamed into memory.
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
const MAX_TRANSCRIPT_FILES = 2000;

/**
 * Published list prices in USD per million tokens. Used only to express a
 * clearly-labelled estimate; a model absent from this table is counted in
 * tokens and excluded from cost rather than silently priced at zero.
 */
const PRICING = {
  'claude-opus-5': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-4-5': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-sonnet-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

function priceFor(model) {
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  return key ? PRICING[key] : null;
}

function emptyBucket() {
  return { messages: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 };
}

function addInto(bucket, rec) {
  bucket.messages += 1;
  bucket.input += rec.input;
  bucket.output += rec.output;
  bucket.cacheWrite += rec.cacheWrite;
  bucket.cacheRead += rec.cacheRead;
  bucket.cost += rec.cost;
}

function loadSqlite() {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch (e) {
    return null;
  }
}

/** Aggregates the 9router request ledger. */
function collectRouterUsage(dbPath) {
  const file = dbPath || ROUTER_DB;
  const Sqlite = loadSqlite();

  if (!Sqlite) {
    return { available: false, reason: 'Node runtime does not expose node:sqlite' };
  }
  if (!fs.existsSync(file)) {
    return { available: false, reason: '9router ledger not found at ' + redactPath(file) };
  }

  let db = null;
  try {
    db = new Sqlite(file, { readOnly: true });
    const providers = db
      .prepare(
        'SELECT provider, COUNT(*) AS requests, ' +
          'SUM(COALESCE(promptTokens,0)) AS promptTokens, ' +
          'SUM(COALESCE(completionTokens,0)) AS completionTokens, ' +
          'SUM(COALESCE(cost,0)) AS cost, ' +
          'MAX(timestamp) AS lastAt, ' +
          "SUM(CASE WHEN status='ok' THEN 0 ELSE 1 END) AS failures " +
          'FROM usageHistory GROUP BY provider'
      )
      .all();

    const connections = db
      .prepare('SELECT provider, name, isActive, priority FROM providerConnections')
      .all();

    const totals = { requests: 0, tokens: 0, cost: 0, failures: 0 };
    const shaped = providers.map((p) => {
      const tokens = (p.promptTokens || 0) + (p.completionTokens || 0);
      totals.requests += p.requests || 0;
      totals.tokens += tokens;
      totals.cost += p.cost || 0;
      totals.failures += p.failures || 0;
      return {
        provider: p.provider,
        requests: p.requests || 0,
        tokens,
        promptTokens: p.promptTokens || 0,
        completionTokens: p.completionTokens || 0,
        cost: p.cost || 0,
        failures: p.failures || 0,
        lastAt: p.lastAt || null,
      };
    });
    shaped.sort((a, b) => b.tokens - a.tokens);

    return {
      available: true,
      providers: shaped,
      totals,
      connections: connections.map((c) => ({
        provider: c.provider,
        // A connection may be declared but switched off. Reporting it as
        // running would misstate which models are actually in play.
        active: c.isActive === 1,
        priority: c.priority,
      })),
      observedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      available: false,
      reason: 'Ledger unreadable: ' + String(e && e.message ? e.message : e),
    };
  } finally {
    try {
      if (db) db.close();
    } catch (e) {
      /* closing a read-only handle cannot lose data */
    }
  }
}

function listTranscripts(dir, acc) {
  const out = acc || [];
  if (out.length >= MAX_TRANSCRIPT_FILES) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_TRANSCRIPT_FILES) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTranscripts(full, out);
    else if (entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

// Transcripts are append-only and the dashboard re-reads them every poll, so a
// full parse of every file each time dominated the poll cost. Keying the parsed
// result on {mtimeMs, size} means only the session being written to is re-read.
const transcriptCache = new Map();

/** Extracts the billable turns of one transcript, reusing the last parse when the file is unchanged. */
function parseTranscript(file, stat) {
  const hit = transcriptCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.entries;

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return [];
  }

  const entries = [];
  for (const line of content.split('\n')) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (e) {
      continue;
    }
    const message = row && row.message;
    const usage = message && message.usage;
    if (!usage) continue;

    const model = message.model || 'unknown';
    // Synthetic turns are locally generated, carry zeroed counters, and
    // were never billed.
    if (model === '<synthetic>') continue;

    entries.push({
      id: message.id || null,
      model,
      day: typeof row.timestamp === 'string' ? row.timestamp.slice(0, 10) : null,
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
    });
  }

  transcriptCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, entries });
  return entries;
}

/** Aggregates Claude Code's own per-turn token records. */
function collectClaudeUsage(projectsDir) {
  const dir = projectsDir || CLAUDE_PROJECTS;
  if (!fs.existsSync(dir)) {
    return { available: false, reason: 'Claude Code transcripts not found at ' + redactPath(dir) };
  }

  const files = listTranscripts(dir);
  if (files.length === 0) {
    return { available: false, reason: 'No Claude Code transcripts recorded yet' };
  }

  const byModel = {};
  const byDay = {};
  const totals = emptyBucket();
  // A resumed or forked session repeats earlier turns verbatim, so the same
  // message id can appear in several transcripts. Counting it once is what
  // keeps these totals from drifting upward on every resume.
  const seen = new Set();
  let unpriced = 0;

  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch (e) {
      continue;
    }
    if (stat.size > MAX_TRANSCRIPT_BYTES) continue;

    for (const entry of parseTranscript(file, stat)) {
      if (entry.id) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
      }

      const rec = {
        input: entry.input,
        output: entry.output,
        cacheWrite: entry.cacheWrite,
        cacheRead: entry.cacheRead,
        cost: 0,
      };

      const price = priceFor(entry.model);
      if (price) {
        rec.cost =
          (rec.input * price.input +
            rec.output * price.output +
            rec.cacheWrite * price.cacheWrite +
            rec.cacheRead * price.cacheRead) /
          1000000;
      } else {
        unpriced += 1;
      }

      if (!byModel[entry.model]) byModel[entry.model] = emptyBucket();
      addInto(byModel[entry.model], rec);
      addInto(totals, rec);

      if (entry.day) {
        if (!byDay[entry.day]) byDay[entry.day] = emptyBucket();
        addInto(byDay[entry.day], rec);
      }
    }
  }

  if (totals.messages === 0) {
    return { available: false, reason: 'Transcripts carry no token counters' };
  }

  const promptTotal = totals.cacheRead + totals.input;
  return {
    available: true,
    sessions: files.length,
    totals,
    models: Object.keys(byModel)
      .map((name) => Object.assign({ model: name, priced: priceFor(name) !== null }, byModel[name]))
      .sort((a, b) => b.input + b.cacheRead - (a.input + a.cacheRead)),
    days: Object.keys(byDay)
      .sort()
      .map((day) => Object.assign({ day }, byDay[day])),
    // Share of prompt tokens served from cache. Cache reads cost about a tenth
    // of fresh input, so a high rate means the headline token count overstates
    // spend considerably.
    cacheHitRate: promptTotal > 0 ? totals.cacheRead / promptTotal : 0,
    unpricedMessages: unpriced,
    costIsEstimate: true,
    observedAt: new Date().toISOString(),
  };
}

/**
 * Adapter entry point, shaped like the other collectors: a health record plus
 * data. The source is only "live" when at least one ledger could be read;
 * neither readable means unavailable, never an empty success.
 */
const USAGE_PROVENANCE = 'sổ 9Router (usageHistory) + transcript ~/.claude/projects';

async function collectUsageState(options) {
  const startedAt = Date.now();
  const opts = options || {};
  const router = collectRouterUsage(opts.routerDbPath);
  const claude = collectClaudeUsage(opts.claudeProjectsDir);

  const readable = [router.available, claude.available].filter(Boolean).length;
  const observedAt = new Date().toISOString();

  if (readable === 0) {
    return {
      health: {
        name: 'usage',
        provenance: USAGE_PROVENANCE,
        latencyMs: Date.now() - startedAt,
        status: 'unavailable',
        observedAt,
        impact:
          'No token ledger readable: ' +
          [router.reason, claude.reason].filter(Boolean).join('; ') +
          '. Quota figures are withheld rather than estimated.',
      },
      data: { router, claude, combined: null },
    };
  }

  // Reported side by side, never summed: the gateway ledger prices actual
  // billed spend, while the transcript figure is a list-price estimate. Adding
  // them would invent a total that no invoice would match.
  const combined = {
    routerTokens: router.available ? router.totals.tokens : null,
    routerCost: router.available ? router.totals.cost : null,
    claudeTokens: claude.available
      ? claude.totals.input +
        claude.totals.output +
        claude.totals.cacheWrite +
        claude.totals.cacheRead
      : null,
    claudeCostEstimate: claude.available ? claude.totals.cost : null,
    activeSources: router.available
      ? router.connections.filter((c) => c.active).map((c) => c.provider)
      : [],
    // No provider publishes a plan ceiling to this machine, so remaining quota
    // cannot be derived. Saying so is the honest answer; a percentage here
    // would be invented.
    quotaCeilingKnown: false,
  };

  return {
    health: {
      name: 'usage',
      provenance: USAGE_PROVENANCE,
      latencyMs: Date.now() - startedAt,
      status: readable === 2 ? 'live' : 'degraded',
      observedAt,
      impact:
        readable === 2
          ? 'Bình thường — đọc được cả sổ 9Router và transcript Claude Code'
          : 'Only one of two token ledgers readable: ' +
            [router.available ? null : router.reason, claude.available ? null : claude.reason]
              .filter(Boolean)
              .join('; '),
    },
    data: { router, claude, combined },
  };
}

module.exports = {
  collectUsageState,
  collectRouterUsage,
  collectClaudeUsage,
  PRICING,
  ROUTER_DB,
  CLAUDE_PROJECTS,
};
