'use strict';

/**
 * Ship Dễ — Model Rotation Data Aggregator
 * TASK-AI-47: AI-47-R01..R08
 *
 * Reads real measurements from disk to build the radial dispatch topology.
 * Where a number cannot be measured, returns 'UNKNOWN' — never 0 or null.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CODEX_TOKENS_RE = new RegExp('tokens used\s*[\r\n]+([\d,]+)', 'g');
const STALE_AFTER_MS = 5 * 60 * 1000;
const SPLIT_RE = new RegExp('\r?\n');
const HOME_DIR = path.join(os.homedir(), '.shipde');

const SOURCE_DEFS = [
  { id: '9router', label: '9Router' },
  { id: 'xkiro', label: 'xKiro' },
  { id: 'agy-local', label: 'agy (local)' },
  { id: 'agy-docker', label: 'agy (docker)' },
  { id: 'cline', label: 'Cline' },
  { id: 'autoclaw', label: 'AutoClaw' },
  { id: 'ao', label: 'AO' },
  { id: 'codex', label: 'Codex' },
];

function parseLogLines(logDir) {
  // Dispatcher lines written by .worktrees/logs/dispatch.sh:
  //   === trying <lane> <model> HH:MM:SS ===
  //   --- <lane> <model> exhausted, falling back ---
  //   --- skip <lane> <model>: <reason> ---
  //   === finished on <lane> <model> ===
  const entries = [];
  if (!fs.existsSync(logDir)) return entries;
  let files;
  try {
    files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log') && !f.endsWith('-run.log'));
  } catch {
    return entries;
  }
  const TRY = /^=== trying (\S+) (\S+) (\d\d:\d\d:\d\d) ===/;
  const EXHAUSTED = /^--- (\S+) (\S+) exhausted/;
  const SKIP = /^--- skip (\S+) (\S+): (.+?) ---/;
  const DONE = /^=== finished on (\S+) (\S+) ===/;
  const laneToSource = (lane) => (lane === 'agy' ? 'agy-local' : lane);
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(path.join(logDir, file), 'utf8');
    } catch {
      continue;
    }
    const runId = file.replace(/\.log$/, '');
    // An attempt only counts as live while its log is still being written to.
    let freshMs = Infinity;
    try {
      freshMs = Date.now() - fs.statSync(path.join(logDir, file)).mtimeMs;
    } catch {
      freshMs = Infinity;
    }
    const stale = freshMs > STALE_AFTER_MS;
    let open = null;
    for (const raw of content.split(SPLIT_RE)) {
      const line = raw.trim();
      let m;
      if ((m = TRY.exec(line))) {
        open = { at: m[3], sourceId: laneToSource(m[1]), modelId: m[2], runId, outcome: stale ? 'ended' : 'live', tokens: 'UNKNOWN' };
        entries.push(open);
      } else if ((m = EXHAUSTED.exec(line))) {
        if (open) { open.outcome = 'quota-refused'; open = null; }
        else entries.push({ at: null, sourceId: laneToSource(m[1]), modelId: m[2], runId, outcome: 'quota-refused', tokens: 'UNKNOWN' });
      } else if ((m = SKIP.exec(line))) {
        entries.push({ at: null, sourceId: laneToSource(m[1]), modelId: m[2], runId, outcome: 'quota-refused', tokens: 'UNKNOWN', reason: m[3] });
      } else if ((m = DONE.exec(line))) {
        if (open) { open.outcome = 'done'; open = null; }
        else entries.push({ at: null, sourceId: laneToSource(m[1]), modelId: m[2], runId, outcome: 'done', tokens: 'UNKNOWN' });
      }
    }
    // tokens for the still-open attempt, when the harness reported any
    if (open) {
      const runLog = path.join(logDir, runId + '-run.log');
      try {
        const text = fs.readFileSync(runLog, 'utf8');
        let total = 0;
        let seen = false;
        for (const mm of text.matchAll(/"(?:inputTokens|outputTokens)":(\d+)/g)) { total += Number(mm[1]); seen = true; }
        const codex = [...text.matchAll(CODEX_TOKENS_RE)].pop();
        if (codex) { total += Number(codex[1].replace(/,/g, '')); seen = true; }
        if (seen) open.tokens = total;
      } catch {
        // no run log yet; tokens stay UNKNOWN
      }
    }
  }
  return entries;
}

const probeCache = new Map();

function probeXkiro(now, ttlMs) {
  // Measured remaining quota from the provider. The probe runs in the background and
  // the page reads the last measurement, so rendering never blocks on the network and
  // the provider is queried at most once per TTL.
  var key = 'xkiro-usage';
  var cached = probeCache.get(key);
  var ttl = ttlMs || 60000;
  var stale = !cached || now - cached.at >= ttl;
  var token = process.env.XKIRO_API_KEY;

  if (stale && token && !probeCache.get(key + ':inflight')) {
    probeCache.set(key + ':inflight', true);
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 8000);
    fetch('https://api.xkiro.com/v1/usage', {
      headers: { Authorization: 'Bearer ' + token },
      signal: controller.signal,
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        const free = j && j.free_tokens;
        if (free && typeof free.used_today === 'number') {
          probeCache.set(key, {
            at: Date.now(),
            value: {
              declaredLimit: typeof free.limit_per_day === 'number' ? free.limit_per_day : 'UNKNOWN',
              consumption: free.used_today,
              headroom: typeof free.remaining === 'number' ? free.remaining : 'UNKNOWN',
            },
          });
        }
      })
      .catch(function () { /* provider unreachable; the last measurement stands */ })
      .finally(function () {
        clearTimeout(timer);
        probeCache.delete(key + ':inflight');
      });
  }

  return cached ? cached.value : { declaredLimit: 'UNKNOWN', consumption: 'UNKNOWN', headroom: 'UNKNOWN' };
}

function detectConfigured(homeDir) {
  // A source is listed only when this machine actually carries its configuration.
  const home = homeDir || os.homedir();
  const exists = (...p) => fs.existsSync(path.join(home, ...p));
  const found = new Set();
  if (process.env.XKIRO_API_KEY || exists('.cline-xkiro')) found.add('xkiro');
  if (exists('.cline')) found.add('cline');
  if (exists('.agy') || exists('AppData', 'Local', 'agy')) found.add('agy-local');
  if (exists('.codex')) found.add('codex');
  if (exists('.ao')) { found.add('ao'); found.add('agy-docker'); }
  if (exists('.claude-9router')) found.add('9router');
  if (exists('.openclaw-autoclaw')) found.add('autoclaw');
  return found;
}

function readCooldowns(ledgerFile) {
  const cooldowns = {};
  const file = ledgerFile || path.join(HOME_DIR, 'quota.observations.json');
  let observations;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    observations = Array.isArray(raw.observations) ? raw.observations : [];
  } catch {
    return cooldowns;
  }
  const now = Date.now();
  const refusals = observations.filter(
    (o) => o && o.outcome === 'refused' && o.accountId
  );
  for (const ref of refusals) {
    const id = String(ref.accountId).toLowerCase();
    const refTime = ref.at ? new Date(ref.at).getTime() : 0;
    if (!refTime || Number.isNaN(refTime)) continue;
    const untilMs = refTime + 5 * 60 * 1000;
    if (untilMs > now) {
      const existing = cooldowns[id];
      if (!existing || new Date(existing.until).getTime() < untilMs) {
        cooldowns[id] = {
          reason: ref.reason || 'quota refusal',
          until: new Date(untilMs).toISOString(),
        };
      }
    }
  }
  return cooldowns;
}

function readQuotaStore(storeFile) {
  const file = storeFile || path.join(HOME_DIR, 'agy-quota.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.accounts ? parsed.accounts : {};
  } catch {
    return {};
  }
}

function buildRotationState(options) {
  const opts = options || {};
  const rootDir = opts.rootDir || path.resolve(__dirname, '../..');
  // In a git worktree the dispatcher still writes into the main checkout, so the
  // location is overridable rather than assumed from this process's rootDir.
  const logDir = opts.logDir || process.env.ROTATION_LOG_DIR || path.join(rootDir, '.worktrees', 'logs');
  const ledgerFile = opts.ledgerFile || path.join(HOME_DIR, 'quota.observations.json');
  const quotaFile = opts.quotaFile || path.join(HOME_DIR, 'agy-quota.json');
  const now = opts.now || Date.now();

  const logEntries = parseLogLines(logDir);
  const cooldowns = readCooldowns(ledgerFile);
  const quotaAccounts = readQuotaStore(quotaFile);

  const configuredIds = detectConfigured(opts.homeDir);
  for (const e of logEntries) configuredIds.add(e.sourceId);
  const xkiroUsage = configuredIds.has('xkiro') ? probeXkiro(now, opts.probeTtlMs) : null;
  for (const id of Object.keys(cooldowns)) configuredIds.add(id);
  for (const id of Object.keys(quotaAccounts)) configuredIds.add(id.toLowerCase());

  const hasAnyData = configuredIds.size > 0;
  const sources = [];

  for (const def of SOURCE_DEFS) {
    const isConfigured = hasAnyData ? configuredIds.has(def.id) : false;
    if (hasAnyData && !isConfigured) continue;

    const sourceLogs = logEntries.filter((e) => e.sourceId === def.id);
    const recentRuns = sourceLogs
      .filter((e) => e.outcome !== 'live')
      .slice(-10)
      .map((e) => ({ outcome: e.outcome, at: e.at }));

    const liveEntries = sourceLogs.filter((e) => e.outcome === 'live');
    const activeRun = liveEntries.length > 0
      ? {
          modelId: liveEntries[liveEntries.length - 1].modelId,
          tokensSoFar: liveEntries[liveEntries.length - 1].tokens,
          startedAt: liveEntries[liveEntries.length - 1].at,
        }
      : { modelId: null, tokensSoFar: 'UNKNOWN', startedAt: null };

    const cooldown = Object.assign({ reason: null, until: null }, cooldowns[def.id] || {});
    const isOnCooldown = cooldown.until && new Date(cooldown.until).getTime() > now;

    let consumption = 'UNKNOWN';
    const knownTokens = sourceLogs
      .filter((e) => e.tokens !== 'UNKNOWN')
      .map((e) => e.tokens);
    if (knownTokens.length > 0) {
      consumption = knownTokens.reduce((a, b) => a + b, 0);
    }

    let declaredLimit = 'UNKNOWN';
    let headroom = 'UNKNOWN';
    if (def.id === 'xkiro' && xkiroUsage) {
      declaredLimit = xkiroUsage.declaredLimit;
      consumption = xkiroUsage.consumption;
      headroom = xkiroUsage.headroom;
    }
    try {
      const { resolveLimits } = require('../ai-brain/limits');
      const account = { id: def.id, limits: {} };
      const resolved = resolveLimits(account, { skipLedger: true });
      const w = resolved.windows.tokensPerDay;
      if (w && !w.unknownBudget && w.ceiling > 0) {
        declaredLimit = w.ceiling;
        if (consumption !== 'UNKNOWN') {
          headroom = Math.max(0, declaredLimit - consumption);
        }
      }
    } catch {
      // limits.js not reachable; keep UNKNOWN
    }

    let status = 'idle';
    if (activeRun.modelId) status = 'live';
    if (isOnCooldown) status = 'cooldown';
    // A source whose measured headroom is zero is exhausted, regardless of the ledger.
    if (headroom === 0) {
      status = 'exhausted';
      cooldown.reason = cooldown.reason || 'daily free quota exhausted (measured)';
    }

    sources.push({
      id: def.id,
      label: def.label,
      configured: isConfigured || !hasAnyData,
      status,
      activeRun,
      cooldown: isOnCooldown || status === 'exhausted' ? cooldown : { reason: null, until: null },
      limits: { declaredLimit, consumption, headroom },
      recentRuns,
    });
  }

  // Flat, newest-first view of every attempt, so the page can list activity
  // the way an operator reads it: which run, which model, how it ended.
  const runs = logEntries
    .slice()
    .reverse()
    .slice(0, 40)
    .map((e) => ({
      runId: e.runId,
      sourceId: e.sourceId,
      modelId: e.modelId,
      outcome: e.outcome,
      at: e.at || null,
      tokens: e.tokens,
      reason: e.reason || null,
    }));

  const totals = {
    attempts: logEntries.length,
    live: logEntries.filter((e) => e.outcome === 'live').length,
    quotaRefused: logEntries.filter((e) => e.outcome === 'quota-refused').length,
    exhausted: sources.filter((x) => x.status === 'exhausted' || x.status === 'cooldown').length,
    sourcesConfigured: sources.length,
    tokens: (function () {
      const known = logEntries.filter((e) => e.tokens !== 'UNKNOWN');
      return known.length ? known.reduce((a, e) => a + e.tokens, 0) : 'UNKNOWN';
    })(),
  };

  return {
    observedAt: new Date(now).toISOString(),
    hub: { label: '9Router / dispatch lanes' },
    sources,
    runs,
    totals,
  };
}

module.exports = {
  SOURCE_DEFS,
  detectConfigured,
  probeXkiro,
  parseLogLines,
  readCooldowns,
  readQuotaStore,
  buildRotationState,
};