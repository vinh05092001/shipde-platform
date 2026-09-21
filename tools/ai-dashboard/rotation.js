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
const { execFileSync } = require('child_process');

const ceiling = require('../ai-brain/ceiling');
const quotaStore = require('../ai-brain/quota-store');

const CODEX_TOKENS_RE = /tokens used\s*[\r\n]+([\d,]+)/g;
const STALE_AFTER_MS = 5 * 60 * 1000;
const SPLIT_RE = /\r?\n/;
const HOME_DIR = path.join(os.homedir(), '.shipde');
const GIT_TIMEOUT_MS = 4000;

/**
 * Where the dispatcher log actually lives.
 *
 * `.worktrees/logs/dispatch.sh` always writes into the main checkout
 * (`L=$REPO/.worktrees/logs` there), and a Work Item run happens in a linked
 * worktree below it. Joining this process's own rootDir with `.worktrees/logs`
 * therefore points at a folder that does not exist, and `parseLogLines`
 * honestly returns nothing — which the panel showed as "0 lượt chạy" while the
 * dispatcher's own records sat one level up. The location is resolved from git
 * instead of assumed, and a folder that cannot be read is reported as
 * unreadable rather than as zero.
 */
const cachedMainRoots = new Map(); // resolved rootDir -> main checkout root, or null

function commonDirToRoot(commonDir) {
  if (!commonDir) return null;
  const nested = path.sep + '.git' + path.sep + 'worktrees';
  const at = commonDir.indexOf(nested);
  if (at > 0) return commonDir.slice(0, at);
  return path.dirname(commonDir);
}

function mainCheckoutRoot(rootDir) {
  const key = path.resolve(rootDir);
  if (cachedMainRoots.has(key)) return cachedMainRoots.get(key);
  const forms = [
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    ['rev-parse', '--git-common-dir'],
  ];
  let resolved = null;
  for (const args of forms) {
    try {
      const out = execFileSync('git', args, {
        cwd: key,
        timeout: GIT_TIMEOUT_MS,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out) {
        resolved = commonDirToRoot(path.resolve(key, out));
        break;
      }
    } catch {
      // git missing or not a repository: fall through to the walk-up search
    }
  }
  cachedMainRoots.set(key, resolved);
  return resolved;
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// Ordered, de-duplicated places the dispatcher log can legitimately be.
function candidateLogDirs(rootDir) {
  const dirs = [];
  const seen = new Set();
  const add = (dir) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    dirs.push(resolved);
  };
  add(path.join(rootDir, '.worktrees', 'logs'));
  const main = mainCheckoutRoot(rootDir);
  if (main) add(path.join(main, '.worktrees', 'logs'));
  let current = path.resolve(rootDir);
  for (let guard = 0; guard < 12; guard++) {
    add(path.join(current, '.worktrees', 'logs'));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

function resolveLogDir(rootDir) {
  const candidates = candidateLogDirs(rootDir);
  for (const dir of candidates) {
    if (isDirectory(dir)) return { dir, candidates, exists: true };
  }
  return { dir: candidates[0], candidates, exists: false };
}

function countDispatcherLogs(dir) {
  if (!dir) return 0;
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.log') && !f.endsWith('-run.log')).length;
  } catch {
    return 0;
  }
}

const SOURCE_DEFS = [
  { id: '9router', label: '9Router' },
  { id: 'xkiro', label: 'xKiro' },
  { id: 'bai', label: 'B.AI' },
  { id: 'agy-local', label: 'agy (local)' },
  { id: 'agy-docker', label: 'agy (docker)' },
  { id: 'cline', label: 'Cline' },
  { id: 'autoclaw', label: 'AutoClaw' },
  { id: 'ao', label: 'AO' },
  // Added 2026-09-20 after each answered a live coding prompt from its own account.
  { id: 'tencent', label: 'Tencent' },
  { id: 'rqsty', label: 'Requesty' },
  { id: 'thb', label: 'TokenHarbor' },
];

// dispatch.sh names its author lanes after the key directory holding them
// (bai1..bai7 are B.AI keys, merged into single source id 'bai' with label 'B.AI'),
// so a lane id read from the log is a real source even when it is not one of the built-in defs.
function labelForLaneId(id) {
  if (/^bai\d*$/i.test(String(id))) return 'B.AI';
  return String(id);
}

/**
 * The built-in sources plus every lane the dispatcher log actually recorded.
 * Without this, attempts on an unlisted lane stay in the totals while no card
 * accounts for them, so the breakdown never adds up to the headline.
 */
function sourceDefinitions(configuredIds, observedLaneIds) {
  const defs = SOURCE_DEFS.slice();
  const known = new Set(SOURCE_DEFS.map((d) => d.id));
  for (const id of observedLaneIds) {
    if (!id || known.has(id) || !configuredIds.has(id)) continue;
    known.add(id);
    defs.push({ id, label: labelForLaneId(id) });
  }
  return defs;
}

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
  const laneToSource = (lane) => {
    if (lane === 'agy') return 'agy-local';
    if (/^bai\d*$/i.test(lane)) return 'bai';
    // dispatch.sh calls the 9Router lane `nine`; SOURCE_DEFS calls the provider `9router`.
    // Left unmapped the panel drew the same provider twice, once per spelling.
    if (lane === 'nine') return '9router';
    return lane;
  };
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
    // The dispatcher only appends to <id>.log when it switches lane, while the agent's
    // own transcript goes to <id>-run.log. Measuring freshness on <id>.log alone made a
    // job that had been working for an hour on one lane look stale after five minutes, so
    // nothing ever showed as live. Take whichever of the two was written most recently.
    try {
      const runMs = fs.statSync(path.join(logDir, `${runId}-run.log`)).mtimeMs;
      freshMs = Math.min(freshMs, Date.now() - runMs);
    } catch {
      /* a lane that never started has no run log; the marker log's own age stands */
    }
    const stale = freshMs > STALE_AFTER_MS;
    const fileDay = (function () {
      try {
        return new Date(fs.statSync(path.join(logDir, file)).mtimeMs);
      } catch {
        return null;
      }
    })();
    const isoAt = function (hhmmss) {
      if (!hhmmss || !fileDay) return null;
      const parts = hhmmss.split(':').map(Number);
      const d = new Date(fileDay);
      d.setHours(parts[0], parts[1], parts[2], 0);
      return d.toISOString();
    };
    let open = null;
    for (const raw of content.split(SPLIT_RE)) {
      const line = raw.trim();
      let m;
      if ((m = TRY.exec(line))) {
        if (open) open.outcome = 'failed';
        open = {
          at: isoAt(m[3]),
          sourceId: laneToSource(m[1]),
          lane: m[1],
          modelId: m[2],
          runId,
          outcome: stale ? 'ended' : 'live',
          tokens: 'UNKNOWN',
          started: true,
        };
        entries.push(open);
      } else if ((m = EXHAUSTED.exec(line))) {
        if (open) {
          open.outcome = 'quota-refused';
          open = null;
        } else
          entries.push({
            at: null,
            sourceId: laneToSource(m[1]),
            lane: m[1],
            modelId: m[2],
            runId,
            outcome: 'quota-refused',
            tokens: 'UNKNOWN',
            started: true,
          });
      } else if ((m = SKIP.exec(line))) {
        // dispatch.sh checked the quota before launching and stayed away, so a
        // skip is a refused lane, never a run that happened.
        entries.push({
          at: null,
          sourceId: laneToSource(m[1]),
          lane: m[1],
          modelId: m[2],
          runId,
          outcome: 'quota-refused',
          tokens: 'UNKNOWN',
          started: false,
          reason: m[3],
        });
      } else if ((m = DONE.exec(line))) {
        if (open) {
          open.outcome = 'done';
          open = null;
        } else
          entries.push({
            at: null,
            sourceId: laneToSource(m[1]),
            lane: m[1],
            modelId: m[2],
            runId,
            outcome: 'done',
            tokens: 'UNKNOWN',
            started: true,
          });
      }
    }
    // Tokens for the attempts this file produced, whether or not one is still open.
    {
      const runLog = path.join(logDir, runId + '-run.log');
      try {
        const text = fs.readFileSync(runLog, 'utf8');
        let total = 0;
        let seen = false;
        // Only a machine-readable result line is a measurement. A run log also
        // carries the agent's own transcript, and a snippet that merely
        // mentions "inputTokens" (code the agent was editing, for example) is
        // not this run's usage — counting it once inflated the token figure by
        // 450 against the transcripts' own totals.
        for (const raw of text.split(SPLIT_RE)) {
          const line = raw.trim();
          if (!line.startsWith('{')) continue;
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          const usage = parsed && parsed.usage;
          if (!usage) continue;
          const counted =
            typeof usage.totalTokens === 'number'
              ? usage.totalTokens
              : typeof usage.inputTokens === 'number' || typeof usage.outputTokens === 'number'
                ? (usage.inputTokens || 0) + (usage.outputTokens || 0)
                : null;
          if (counted !== null) {
            total += counted;
            seen = true;
          }
        }
        const codex = [...text.matchAll(CODEX_TOKENS_RE)].pop();
        if (codex) {
          total += Number(codex[1].replace(/,/g, ''));
          seen = true;
        }
        if (seen) {
          const mine = entries.filter((e) => e.runId === runId);
          const target = mine.filter((e) => e.outcome === 'live')[0] || mine[mine.length - 1];
          if (target) target.tokens = total;
        }
      } catch {
        // no run log yet; tokens stay UNKNOWN
      }
    }
  }
  return entries;
}

const probeCache = new Map();
const BAI_PROBE_TIMEOUT_MS = 8000;
const BAI_PROBE_CACHE_KEY = 'bai-balance';

function probeXkiro(now, ttlMs, opts = {}) {
  // Measured remaining quota from the provider. The probe runs in the background and
  // the page reads the last measurement, so rendering never blocks on the network and
  // the provider is queried at most once per TTL.
  var key = 'xkiro-usage';
  var cached = probeCache.get(key);
  var ttl = ttlMs || 60000;
  var stale = !cached || now - cached.at >= ttl;
  var env = opts.env || process.env;
  var token = env.XKIRO_API_KEY;
  var fetchFn = opts.fetch || globalThis.fetch;

  if (stale && token && !probeCache.get(key + ':inflight')) {
    probeCache.set(key + ':inflight', true);
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, 8000);
    const promise = fetchFn('https://api.xkiro.com/v1/usage', {
      headers: { Authorization: 'Bearer ' + token },
      signal: controller.signal,
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        const free = j && j.free_tokens;
        if (free && typeof free.used_today === 'number') {
          const val = {
            declaredLimit: typeof free.limit_per_day === 'number' ? free.limit_per_day : 'UNKNOWN',
            consumption: free.used_today,
            headroom: typeof free.remaining === 'number' ? free.remaining : 'UNKNOWN',
          };
          probeCache.set(key, {
            at: Date.now(),
            value: val,
          });
          return val;
        }
        return null;
      })
      .catch(function () {
        /* provider unreachable; the last measurement stands */
      })
      .finally(function () {
        clearTimeout(timer);
        probeCache.delete(key + ':inflight');
        probeCache.delete(key + ':promise');
      });

    probeCache.set(key + ':promise', promise);

    if (opts.async) {
      return promise;
    }
  }

  if (opts.async) {
    if (probeCache.get(key + ':inflight') && probeCache.get(key + ':promise')) {
      return probeCache.get(key + ':promise').then(function () {
        const c = probeCache.get(key);
        return c
          ? c.value
          : { declaredLimit: 'UNKNOWN', consumption: 'UNKNOWN', headroom: 'UNKNOWN' };
      });
    }
    if (cached) {
      return Promise.resolve(cached.value);
    }
  }

  return cached
    ? cached.value
    : { declaredLimit: 'UNKNOWN', consumption: 'UNKNOWN', headroom: 'UNKNOWN' };
}

function getBaiKeyDefinitions(opts = {}) {
  const env = opts.env || process.env;
  if (Array.isArray(opts.baiKeys)) {
    return opts.baiKeys
      .map((k, idx) => ({
        id: `bai${idx + 1}`,
        name: `BAI_API_KEY_${idx + 1}`,
        key: typeof k === 'object' && k ? k.key : k,
      }))
      .filter((d) => typeof d.key === 'string' && d.key.trim().length > 0);
  }
  const keys = [];
  const k1 = env.BAI_API_KEY || env.BAI_API_KEY_1;
  if (typeof k1 === 'string' && k1.trim().length > 0) {
    keys.push({ id: 'bai1', name: 'BAI_API_KEY', key: k1.trim() });
  }
  for (let i = 2; i <= 7; i++) {
    const k = env[`BAI_API_KEY_${i}`];
    if (typeof k === 'string' && k.trim().length > 0) {
      keys.push({ id: `bai${i}`, name: `BAI_API_KEY_${i}`, key: k.trim() });
    }
  }
  return keys;
}

async function probeSingleBaiKey(keyDef, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, BAI_PROBE_TIMEOUT_MS);

  try {
    const res = await fetchFn('https://api.b.ai/v1/balance', {
      method: 'GET',
      headers: { Authorization: `Bearer ${keyDef.key}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { id: keyDef.id, balance: 'UNKNOWN', error: `HTTP ${res.status}` };
    }
    const json = await res.json();
    const bal =
      json && json.data && typeof json.data.personal_balance === 'number'
        ? json.data.personal_balance
        : null;
    if (bal === null) {
      return { id: keyDef.id, balance: 'UNKNOWN', error: 'Invalid response shape' };
    }
    const warning = bal < 10000 ? `Số dư dưới 10.000 (${bal})` : null;
    return { id: keyDef.id, balance: bal, warning };
  } catch (err) {
    const isTimeout =
      err && (err.name === 'AbortError' || String(err.message || err).includes('aborted'));
    return {
      id: keyDef.id,
      balance: 'UNKNOWN',
      error: isTimeout ? 'Timeout' : 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeAllBaiBalances(keys, opts = {}) {
  const fetchFn = opts.fetch || globalThis.fetch;
  if (!keys || keys.length === 0) {
    return {
      headroom: 'UNKNOWN',
      keys: [],
      warnings: [],
    };
  }
  const results = await Promise.all(keys.map((k) => probeSingleBaiKey(k, fetchFn)));

  let hasUnknown = false;
  let total = 0;
  const warnings = [];

  for (const r of results) {
    if (r.balance === 'UNKNOWN') {
      hasUnknown = true;
    } else {
      total += r.balance;
      if (r.warning) {
        warnings.push(`${r.id}: ${r.warning}`);
      }
    }
  }

  // If any key fails or timeouts, its part is UNKNOWN and total must also be UNKNOWN (never 0)
  const headroom = hasUnknown ? 'UNKNOWN' : total;

  return {
    headroom,
    keys: results.map((r) => ({
      id: r.id,
      balance: r.balance,
      warning: r.warning || null,
      error: r.error || null,
    })),
    warnings,
  };
}

function probeBai(now, ttlMs, opts = {}) {
  const key = BAI_PROBE_CACHE_KEY;
  const cached = probeCache.get(key);
  const ttl = ttlMs || 60000;
  const stale = !cached || now - cached.at >= ttl;
  const keys = getBaiKeyDefinitions(opts);

  if (stale && keys.length > 0 && !probeCache.get(key + ':inflight')) {
    probeCache.set(key + ':inflight', true);
    const promise = probeAllBaiBalances(keys, opts)
      .then((data) => {
        probeCache.set(key, {
          at: Date.now(),
          value: data,
        });
        return data;
      })
      .catch(() => {
        /* provider unreachable; keep last measurement */
      })
      .finally(() => {
        probeCache.delete(key + ':inflight');
        probeCache.delete(key + ':promise');
      });

    probeCache.set(key + ':promise', promise);

    if (opts.async) {
      return promise;
    }
  }

  if (opts.async) {
    if (probeCache.get(key + ':inflight') && probeCache.get(key + ':promise')) {
      return probeCache.get(key + ':promise').then(() => {
        const c = probeCache.get(key);
        return c ? c.value : { headroom: 'UNKNOWN', keys: [], warnings: [] };
      });
    }
    if (cached) {
      return Promise.resolve(cached.value);
    }
  }

  return cached ? cached.value : { headroom: 'UNKNOWN', keys: [], warnings: [] };
}

function clearProbeCache() {
  probeCache.clear();
}

function detectConfigured(homeDir, explicit, env) {
  // A source is listed only when this machine actually carries its configuration.
  const home = homeDir || os.homedir();
  const environment = env || process.env;
  // With an explicit home (tests), that directory alone decides: no environment fallback,
  // so a developer's own key cannot make a test see a source that is not in the fixture.
  const useEnv = !explicit;
  const exists = (...p) => fs.existsSync(path.join(home, ...p));
  const found = new Set();
  if ((useEnv && environment.XKIRO_API_KEY) || exists('.cline-xkiro')) found.add('xkiro');
  if (
    (useEnv &&
      (environment.BAI_API_KEY ||
        environment.BAI_API_KEY_1 ||
        environment.BAI_API_KEY_2 ||
        environment.BAI_API_KEY_3 ||
        environment.BAI_API_KEY_4 ||
        environment.BAI_API_KEY_5 ||
        environment.BAI_API_KEY_6 ||
        environment.BAI_API_KEY_7)) ||
    exists('.cline-bai')
  ) {
    found.add('bai');
  }
  if (exists('.cline')) found.add('cline');
  if (exists('.agy') || exists('AppData', 'Local', 'agy')) found.add('agy-local');
  if (exists('.ao')) {
    found.add('ao');
    found.add('agy-docker');
  }
  if (exists('.claude-9router')) found.add('9router');
  if (exists('.openclaw-autoclaw')) found.add('autoclaw');
  return found;
}

/**
 * Reads cooldown states from the canonical ceiling ledger (AI-47-R06).
 * Only genuine quota refusals trigger cooldowns; transient errors (500, socket) do not.
 * Cooldown duration is derived from ceiling.cooldownFor(window, refTime) rather than
 * a hardcoded timer.
 */
function readCooldowns(ledgerFile, nowMs) {
  const cooldowns = {};
  const observations = ceiling.readLedger(ledgerFile || undefined);
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const refusals = observations.filter((o) => {
    if (!o || o.outcome !== 'refused' || !o.accountId) return false;
    const errorText = o.error || o.reason || '';
    return ceiling.isQuotaRefusal(errorText);
  });
  for (const ref of refusals) {
    const id = String(ref.accountId).toLowerCase();
    const refTime = ref.at ? new Date(ref.at).getTime() : 0;
    if (!refTime || Number.isNaN(refTime)) continue;
    const window = ref.window || 'requestsPerMinute';
    const until = ceiling.cooldownFor(window, refTime);
    const untilMs = new Date(until).getTime();
    if (untilMs > now) {
      const existing = cooldowns[id];
      if (!existing || new Date(existing.until).getTime() < untilMs) {
        cooldowns[id] = {
          reason: (ref.reason || ref.error || 'quota refusal').slice(0, 120),
          until,
        };
      }
    }
  }
  return cooldowns;
}

/**
 * Reads the vendor quota cache through the canonical quota-store module
 * (AI-47-R06), which applies freshness and identity checks.
 */
function readQuotaStore(storeFile) {
  try {
    const store = quotaStore.loadStore(storeFile ? { path: storeFile } : undefined);
    return store && typeof store === 'object' && store.accounts ? store.accounts : {};
  } catch {
    return {};
  }
}

async function buildRotationStateAsync(options) {
  const opts = options || {};
  const allowProbe = opts.probe !== false;
  const configuredIds = detectConfigured(opts.homeDir, Boolean(opts.homeDir), opts.env);
  if (Array.isArray(opts.baiKeys) && opts.baiKeys.length > 0) {
    configuredIds.add('bai');
  }
  const now = opts.now || Date.now();
  const probePromises = [];
  if (allowProbe && configuredIds.has('xkiro')) {
    const p = probeXkiro(now, opts.probeTtlMs, { ...opts, async: true });
    if (p && typeof p.then === 'function') probePromises.push(p);
  }
  if (allowProbe && configuredIds.has('bai')) {
    const p = probeBai(now, opts.probeTtlMs, { ...opts, async: true });
    if (p && typeof p.then === 'function') probePromises.push(p);
  }
  if (probePromises.length > 0) {
    await Promise.allSettled(probePromises);
  }
  return buildRotationStateSync({ ...opts, async: false });
}

function buildRotationState(options) {
  const opts = options || {};
  if (opts.async) {
    return buildRotationStateAsync(opts);
  }
  return buildRotationStateSync(opts);
}

function buildRotationStateSync(options) {
  const opts = options || {};
  const rootDir = opts.rootDir || path.resolve(__dirname, '../..');
  // The dispatcher log lives in the main checkout's .worktrees/logs even when
  // this process runs from a linked worktree, so the location is resolved from
  // git rather than assumed from rootDir. ROTATION_LOG_DIR still wins.
  const explicitLogDir = opts.logDir || process.env.ROTATION_LOG_DIR || null;
  const logSource = explicitLogDir
    ? { dir: path.resolve(explicitLogDir), exists: isDirectory(explicitLogDir), candidates: null }
    : resolveLogDir(rootDir);
  const logDir = logSource.dir;
  const ledgerFile = opts.ledgerFile || path.join(HOME_DIR, 'quota.observations.json');
  const quotaFile = opts.quotaFile || path.join(HOME_DIR, 'agy-quota.json');
  const now = opts.now || Date.now();

  const logEntries = parseLogLines(logDir);
  const logReadable = logSource.exists;
  const cooldowns = readCooldowns(ledgerFile, now);
  const quotaAccounts = readQuotaStore(quotaFile);

  const configuredIds = detectConfigured(opts.homeDir, Boolean(opts.homeDir), opts.env);
  if (Array.isArray(opts.baiKeys) && opts.baiKeys.length > 0) {
    configuredIds.add('bai');
  }
  for (const e of logEntries) configuredIds.add(e.sourceId);
  const allowProbe = opts.probe !== false;
  const xkiroUsage =
    allowProbe && configuredIds.has('xkiro') ? probeXkiro(now, opts.probeTtlMs, opts) : null;
  const baiUsage =
    allowProbe && configuredIds.has('bai') ? probeBai(now, opts.probeTtlMs, opts) : null;
  for (const id of Object.keys(cooldowns)) configuredIds.add(id);
  for (const id of Object.keys(quotaAccounts)) configuredIds.add(id.toLowerCase());

  const hasAnyData = configuredIds.size > 0;
  const sources = [];

  for (const def of sourceDefinitions(
    configuredIds,
    logEntries.map((e) => e.sourceId)
  )) {
    const isConfigured = hasAnyData ? configuredIds.has(def.id) : false;
    if (hasAnyData && !isConfigured) continue;

    const sourceLogs = logEntries.filter((e) => e.sourceId === def.id);
    const recentRuns = sourceLogs
      .filter((e) => e.outcome !== 'live')
      .slice(-10)
      .map((e) => ({ outcome: e.outcome, at: e.at, lane: e.lane }));

    const liveEntries = sourceLogs.filter((e) => e.outcome === 'live');
    const activeRun =
      liveEntries.length > 0
        ? {
            modelId: liveEntries[liveEntries.length - 1].modelId,
            tokensSoFar: liveEntries[liveEntries.length - 1].tokens,
            startedAt: liveEntries[liveEntries.length - 1].at,
          }
        : { modelId: null, tokensSoFar: 'UNKNOWN', startedAt: null };

    const cooldown = Object.assign({ reason: null, until: null }, cooldowns[def.id] || {});
    const isOnCooldown = cooldown.until && new Date(cooldown.until).getTime() > now;

    let consumption = 'UNKNOWN';
    const knownTokens = sourceLogs.filter((e) => e.tokens !== 'UNKNOWN').map((e) => e.tokens);
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

    let baiKeysInfo = null;
    let nodeLabel = def.label;
    let warnings = [];

    if (def.id === 'bai') {
      const configuredKeyList = getBaiKeyDefinitions(opts);
      let totalConfigured = configuredKeyList.length;
      if (totalConfigured === 0) {
        if (typeof opts.totalKeys === 'number') {
          totalConfigured = opts.totalKeys;
        } else {
          const observedBaiLanes = new Set(
            logEntries.filter((e) => /^bai\d+$/i.test(e.lane || '')).map((e) => e.lane)
          );
          totalConfigured = observedBaiLanes.size > 0 ? Math.max(observedBaiLanes.size, 7) : 7;
        }
      }

      const liveLanes = new Set(liveEntries.map((e) => e.lane || 'bai1'));
      const runningCount = liveLanes.size;
      baiKeysInfo = { running: runningCount, total: totalConfigured };
      nodeLabel = 'B.AI ' + runningCount + '/' + totalConfigured + ' key';

      if (baiUsage) {
        headroom = baiUsage.headroom;
        warnings = baiUsage.warnings || [];
      }
    }

    let status = 'idle';
    if (def.id === 'bai') {
      if (activeRun.modelId || (baiKeysInfo && baiKeysInfo.running > 0)) {
        status = 'live';
      } else {
        // 'quota-exhausted' ONLY when ALL keys are exhausted
        let allExhausted = false;
        if (headroom === 0) {
          allExhausted = true;
        } else {
          const configuredKeyList = getBaiKeyDefinitions(opts);
          const keyIds =
            configuredKeyList.length > 0
              ? configuredKeyList.map((k) => k.id)
              : ['bai1', 'bai2', 'bai3', 'bai4', 'bai5', 'bai6', 'bai7'];

          if (cooldowns['bai'] && new Date(cooldowns['bai'].until).getTime() > now) {
            allExhausted = true;
          } else {
            const allInCooldown =
              keyIds.length > 0 &&
              keyIds.every((id) => {
                const c = cooldowns[id];
                return c && c.until && new Date(c.until).getTime() > now;
              });
            if (allInCooldown) {
              allExhausted = true;
            }
          }
        }

        if (allExhausted) {
          status = 'quota-exhausted';
          cooldown.reason = cooldown.reason || 'all B.AI keys quota exhausted';
        } else {
          status = 'idle';
        }
      }
    } else {
      if (activeRun.modelId) status = 'live';
      if (isOnCooldown) status = 'cooldown';
      // A source whose measured headroom is zero is exhausted, regardless of the ledger.
      if (headroom === 0) {
        status = 'quota-exhausted';
        cooldown.reason = cooldown.reason || 'daily free quota exhausted (measured)';
      }
    }

    const sourceObj = {
      id: def.id,
      label: def.label,
      configured: isConfigured || !hasAnyData,
      status,
      activeRun,
      cooldown:
        isOnCooldown || status === 'quota-exhausted' ? cooldown : { reason: null, until: null },
      limits: { declaredLimit, consumption, headroom },
      recentRuns,
      attempts: sourceLogs.filter((e) => e.started).length,
      skipped: sourceLogs.filter((e) => !e.started).length,
      quotaRefused: sourceLogs.filter((e) => e.outcome === 'quota-refused').length,
      tokens: consumption,
    };

    if (def.id === 'bai') {
      sourceObj.keys = baiKeysInfo;
      sourceObj.nodeLabel = nodeLabel;
      sourceObj.warnings = warnings;
      if (baiUsage && baiUsage.keys) {
        sourceObj.keyDetails = baiUsage.keys;
      }
    }

    sources.push(sourceObj);
  }

  // Flat, newest-first view of every attempt, so the page can list activity
  // the way an operator reads it: which run, which model, how it ended.
  // Entries arrive in directory order, which is alphabetical, so reversing them gave
  // z-to-a rather than newest-first and the 40-item cut dropped whatever was running
  // under an earlier letter. Order by the attempt's own timestamp, and never let a live
  // attempt fall off the end: what is running now is the whole point of the panel.
  const runs = logEntries
    .slice()
    .sort((a, b) => {
      if ((a.outcome === 'live') !== (b.outcome === 'live')) return a.outcome === 'live' ? -1 : 1;
      return new Date(b.at || 0) - new Date(a.at || 0);
    })
    .slice(0, 40)
    .map((e) => ({
      runId: e.runId,
      sourceId: e.sourceId,
      lane: e.lane || e.sourceId,
      modelId: e.modelId,
      outcome: e.outcome,
      at: e.at || null,
      tokens: e.tokens,
      reason: e.reason || null,
    }));

  const totals = {
    // A run only counts when dispatch.sh actually launched it. Pre-flight skips
    // are refused lanes, not runs, so they stay out of this number.
    attempts: logReadable ? logEntries.filter((e) => e.started).length : 'UNKNOWN',
    skipped: logReadable ? logEntries.filter((e) => !e.started).length : 'UNKNOWN',
    live: logReadable ? logEntries.filter((e) => e.outcome === 'live').length : 'UNKNOWN',
    quotaRefused: logReadable
      ? logEntries.filter((e) => e.outcome === 'quota-refused').length
      : 'UNKNOWN',
    exhausted: sources.filter((x) => x.status === 'quota-exhausted' || x.status === 'cooldown')
      .length,
    sourcesConfigured: sources.length,
    tokens: (function () {
      if (!logReadable) return 'UNKNOWN';
      const known = logEntries.filter((e) => e.tokens !== 'UNKNOWN');
      return known.length ? known.reduce((a, e) => a + e.tokens, 0) : 'UNKNOWN';
    })(),
  };

  return {
    observedAt: new Date(now).toISOString(),
    hub: { label: '9Router / dispatch lanes' },
    // Where the dispatcher numbers came from, so a folder that could not be
    // read is visible on the panel instead of hiding behind a zero.
    log: {
      dir: logDir,
      exists: logReadable,
      explicit: Boolean(explicitLogDir),
      files: countDispatcherLogs(logDir),
      candidates: logSource.candidates,
      reason: logReadable
        ? null
        : 'Không đọc được log dispatcher: các chỉ số lượt chạy là UNKNOWN, không phải 0',
    },
    sources,
    runs,
    totals,
  };
}

module.exports = {
  SOURCE_DEFS,
  detectConfigured,
  probeXkiro,
  probeBai,
  probeAllBaiBalances,
  clearProbeCache,
  getBaiKeyDefinitions,
  parseLogLines,
  readCooldowns,
  readQuotaStore,
  buildRotationState,
  // Exported because "where the dispatcher log is" is the part that broke when
  // the dashboard ran from a worktree, and it needs to stay provable.
  resolveLogDir,
  candidateLogDirs,
  mainCheckoutRoot,
};
