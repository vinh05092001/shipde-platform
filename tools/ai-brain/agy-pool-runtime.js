'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawnSync } = require('child_process');
const {
  mapFamily,
  mapWindow,
  parseNumberValue,
  parseTsvRows,
  parseFixtureGroups,
  parseQuota,
} = require('./agy-quota');

function isValidAccountId(accountId) {
  return typeof accountId === 'string' && /^agy\d{2}$/.test(accountId);
}

function runsDir(options) {
  const opts = options || {};
  if (opts.fakeRunsDir) return opts.fakeRunsDir;
  if (opts.runsDir) return opts.runsDir;
  if (process.env.AGY_POOL_RUNS_DIR) return process.env.AGY_POOL_RUNS_DIR;
  if (process.env.AGY_RUNS_DIR) return process.env.AGY_RUNS_DIR;

  const platform = opts.platform || process.platform;
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') {
    return 'C:\\Tools\\agy-runs';
  }
  const home =
    opts.home ||
    process.env.HOME ||
    (platform === 'win32' ? process.env.USERPROFILE : null) ||
    os.homedir();
  const base = process.env.XDG_DATA_HOME || p.join(home, '.local', 'share');
  return p.join(base, 'agy-runs');
}

function accountDir(accountId, options) {
  if (!isValidAccountId(accountId)) {
    throw new Error(
      `INVALID_ACCOUNT_ID: account must match /^agy\\d{2}$/, got ${JSON.stringify(accountId)}`
    );
  }
  return path.join(exp.runsDir(options), accountId);
}

function discoverAccounts(options) {
  const dir = exp.runsDir(options);
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isValidAccountId(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function readResult(accountId, options) {
  if (!isValidAccountId(accountId)) return { state: 'error', reason: 'INVALID_ACCOUNT_ID' };
  const file = path.join(exp.accountDir(accountId, options), 'result.json');
  try {
    return readJson(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return { state: 'error', reason: 'CORRUPT_RESULT' };
  }
}

function readOutText(accountId, options) {
  if (!isValidAccountId(accountId)) return '';
  const file = path.join(exp.accountDir(accountId, options), 'out.txt');
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
}

function readLastRunElapsedMs(accountId, options) {
  if (!isValidAccountId(accountId)) return undefined;
  const file = path.join(exp.accountDir(accountId, options), 'runs.jsonl');
  try {
    const content = fs.readFileSync(file, 'utf8').trim();
    if (!content) return undefined;
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      const entry = JSON.parse(line);
      if (entry.state === 'ok' && entry.startedAt && entry.finishedAt) {
        const start = Date.parse(entry.startedAt);
        const end = Date.parse(entry.finishedAt);
        const elapsed = end - start;
        if (Number.isFinite(elapsed) && elapsed > 0) return elapsed;
      }
    }
  } catch {}
  return undefined;
}

// The tightest finite bound wins; an unbounded caller timeout (Infinity) never
// widens the configured pool bound, and the fallback is configuration, not code.
function poolTimeoutMs(opts) {
  const configured = require('./sources').getDispatchConfig(opts.registry, opts).agyPoolTimeoutMs;
  return Math.min(
    ...[opts.timeoutMs, opts.dispatch?.agyPoolTimeoutMs, configured]
      .filter((v) => v !== null && v !== undefined && v !== '')
      .map(Number)
      .filter((v) => Number.isFinite(v) && v >= 0)
  );
}

function waitForResult(accountId, sinceMs, options) {
  if (!isValidAccountId(accountId)) return { state: 'error', reason: 'INVALID_ACCOUNT_ID' };
  const opts = options || {};
  const timeoutMs = poolTimeoutMs(opts);
  if (!Number.isFinite(timeoutMs)) return { state: 'error', reason: 'POOL_TIMEOUT_UNBOUNDED' };
  const file = path.join(exp.accountDir(accountId, opts), 'result.json');
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    try {
      const stat = fs.statSync(file);
      if (!sinceMs || stat.mtimeMs >= sinceMs - 1000) {
        const result = exp.readResult(accountId, opts);
        // A result that names another job (a late prior adapter) is never this
        // job's output; keep waiting for the submitted job's own result.
        if (!opts.expectedJobId || result?.jobId === opts.expectedJobId) return result;
      }
    } catch {}
    if (timeoutMs === 0) break;
    Atomics.wait(
      new Int32Array(new SharedArrayBuffer(4)),
      0,
      0,
      Math.min(100, Math.max(1, timeoutMs))
    );
  }
  return { state: 'error', reason: 'POOL_TIMEOUT' };
}

function runAdapter(accountId, options) {
  if (!isValidAccountId(accountId)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'INVALID_ACCOUNT_ID: account must match /^agy\\d{2}$/',
    };
  }
  const opts = options || {};
  const script = opts.adapterScript || process.env.AGY_POOL_ADAPTER_SCRIPT;
  if (script) {
    const res = spawnSync(process.execPath, [script, exp.accountDir(accountId, opts), accountId], {
      encoding: 'utf8',
      timeout: Number(opts.adapterTimeoutMs) > 0 ? Number(opts.adapterTimeoutMs) : 120000,
      windowsHide: true,
      shell: false,
    });
    const isTimeout = Boolean(res.error && res.error.code === 'ETIMEDOUT');
    const stderrText = (res.stderr || '').trim();
    let defaultStderr = '';
    if (isTimeout) {
      defaultStderr = 'ADAPTER_TIMEOUT';
    } else if (res.error) {
      defaultStderr = res.error.message || String(res.error);
    } else if (res.signal) {
      defaultStderr = `ADAPTER_SIGNAL_${res.signal}`;
    }
    return {
      exitCode: res.status === null ? -1 : res.status,
      signal: res.signal || null,
      stdout: res.stdout || '',
      stderr: stderrText || defaultStderr,
    };
  }

  const platform = opts.platform || process.platform;
  if (platform !== 'win32') {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'UNSUPPORTED_PLATFORM: agy-pool requires Windows schtasks',
    };
  }

  const taskName = `ShipDe\\ShipDe-${accountId}`;
  const res = spawnSync('schtasks', ['/run', '/tn', taskName], {
    encoding: 'utf8',
    timeout: Number(opts.adapterTimeoutMs) > 0 ? Number(opts.adapterTimeoutMs) : 30000,
    windowsHide: true,
    shell: false,
  });
  const isTimeout = Boolean(res.error && res.error.code === 'ETIMEDOUT');
  const stderrText = (res.stderr || '').trim();
  let defaultStderr = '';
  if (isTimeout) {
    defaultStderr = 'ADAPTER_TIMEOUT';
  } else if (res.error) {
    defaultStderr = res.error.message || String(res.error);
  } else if (res.signal) {
    defaultStderr = `ADAPTER_SIGNAL_${res.signal}`;
  }
  return {
    exitCode: res.status === null ? -1 : res.status,
    signal: res.signal || null,
    stdout: res.stdout || '',
    stderr: stderrText || defaultStderr,
  };
}

function pidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

/** Atomic cross-process claim of one account. Returns a release fn, or null when held. */
function acquireAccountLock(dir) {
  const lockFile = path.join(dir, 'job.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      fs.closeSync(fd);
      return () => {
        try {
          fs.unlinkSync(lockFile);
        } catch {}
      };
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      let holder = null;
      try {
        holder = readJson(lockFile);
      } catch {}
      if (holder && pidAlive(holder.pid)) return null;
      try {
        fs.unlinkSync(lockFile); // stale: holder is dead or the file is unreadable
      } catch {}
    }
  }
  return null;
}

function submitJob(accountId, job, options) {
  if (!isValidAccountId(accountId)) {
    return { state: 'error', exitCode: 1, reason: 'INVALID_ACCOUNT_ID' };
  }
  const opts = options || {};
  const dir = exp.accountDir(accountId, opts);
  fs.mkdirSync(dir, { recursive: true });
  const release = acquireAccountLock(dir);
  if (!release) return { state: 'busy', exitCode: 1, reason: 'POOL_ACCOUNT_BUSY' };
  try {
    return submitLocked(accountId, job, opts, dir);
  } finally {
    release();
  }
}

function submitLocked(accountId, job, opts, dir) {
  const resultFile = path.join(dir, 'result.json');
  const startedAt = Date.now();
  // Allocate the pool job identity at submission, persist it before execution,
  // and retain its receipt after the account mailbox is reused by another job.
  const jobId = accountId + '/' + randomUUID();
  // The producer bounds each agy call by the same configured pool wait, so a run
  // never outlives the controller waiting for it.
  const boundMs = poolTimeoutMs(opts);
  const printTimeoutSec = Number.isFinite(boundMs) ? Math.max(1, Math.floor(boundMs / 1000)) : null;
  const submitted = { ...job, accountId, jobId, printTimeoutSec };
  const receiptDir = path.join(dir, 'jobs');
  fs.mkdirSync(receiptDir, { recursive: true });
  const receiptFile = path.join(receiptDir, jobId.split('/')[1] + '.json');
  const receipt = { jobId, accountId, candidateKey: job.candidateKey || null };
  fs.writeFileSync(receiptFile, JSON.stringify({ ...receipt, state: 'submitted' }), 'utf8');
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(submitted, null, 2), 'utf8');
  const finish = (result) => {
    const bound = { ...result, jobId, accountId };
    fs.writeFileSync(
      receiptFile,
      JSON.stringify({
        ...receipt,
        state: result?.state || 'error',
        exitCode: result?.exitCode ?? null,
      }),
      'utf8'
    );
    return bound;
  };
  // A stale result that cannot be removed could be read back as this job's
  // output; only an already-absent file is safe to ignore.
  try {
    fs.unlinkSync(resultFile);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      return finish({
        state: 'error',
        exitCode: 1,
        reason: 'POOL_STALE_RESULT_UNREMOVABLE: ' + String((err && err.code) || err),
      });
    }
  }
  const launch = exp.runAdapter(accountId, opts);
  if (launch.exitCode !== 0) {
    const isTimeout = Boolean(launch.stderr && launch.stderr.includes('ADAPTER_TIMEOUT'));
    const reason =
      launch.stderr ||
      launch.stdout ||
      (isTimeout
        ? 'ADAPTER_TIMEOUT'
        : launch.signal
          ? `ADAPTER_SIGNAL_${launch.signal}`
          : `ADAPTER_EXIT_${launch.exitCode}`);
    const errorResult = {
      state: 'error',
      exitCode: launch.exitCode,
      reason,
    };
    try {
      fs.writeFileSync(resultFile, JSON.stringify(errorResult, null, 2), 'utf8');
    } catch {}
    return finish(errorResult);
  }
  return finish(exp.waitForResult(accountId, startedAt, { ...opts, expectedJobId: jobId }));
}

function parseQuotaJson(value) {
  const rows = [];
  const models = new Set();
  const doc = value && typeof value === 'object' ? value : {};

  // 1. Real format: JSON wrapper with "response" field holding TSV lines
  if (typeof doc.response === 'string' && doc.response.trim().length > 0) {
    for (const r of parseTsvRows(doc.response)) {
      rows.push(r);
    }
  }

  // 2. Keep the existing fixture format working if any production path emits it
  if (rows.length === 0) {
    for (const r of parseFixtureGroups(doc)) {
      rows.push(r);
    }
  }

  for (const m of doc.models || []) if (m) models.add(String(m));
  for (const g of doc.groups || []) {
    for (const m of g.models || []) if (m) models.add(String(m));
  }
  if (doc.command && doc.command.data && Array.isArray(doc.command.data.groups)) {
    for (const g of doc.command.data.groups) {
      for (const m of g.models || []) if (m) models.add(String(m));
    }
  }

  return { rows, models: [...models] };
}

function parseQuotaOutput(text) {
  const body = String(text || '').trim();
  if (!body) return { available: false, reason: 'không có out.txt', rows: [], models: [] };
  try {
    const parsed = JSON.parse(body);
    const quota = parseQuotaJson(parsed);
    if (quota.rows.length > 0) {
      return { available: true, rows: quota.rows, models: quota.models };
    }
    return {
      available: false,
      reason: 'không có số liệu quota hợp lệ trong out.txt',
      rows: [],
      models: quota.models,
    };
  } catch {}

  const parsedText = parseQuota(body);
  return Object.assign({}, parsedText, { models: [] });
}

function quotaReading(accountId, options) {
  const opts = options || {};
  const result = opts.result || exp.readResult(accountId, opts);
  if (!result) return { available: false, reason: 'không có result.json', rows: [] };
  if (result.state === 'login-required') {
    return { available: false, reason: 'AUTH_FAILED', rows: [] };
  }
  if (result.state !== 'ok' && result.state !== 'quota') {
    return { available: false, reason: result.reason || result.state || 'FAILED', rows: [] };
  }
  const parsed = parseQuotaOutput(exp.readOutText(accountId, opts));
  if (!parsed.available) return parsed;
  return Object.assign({}, parsed, {
    account: { known: true, email: accountId, source: 'pool' },
    observedAt: new Date((opts && opts.now) || Date.now()).toISOString(),
  });
}

function modelIdsFromRuntime(options) {
  const opts = options || {};
  const out = new Set();
  for (const accountId of exp.discoverAccounts(opts)) {
    const parsed = parseQuotaOutput(exp.readOutText(accountId, opts));
    for (const model of parsed.models || []) out.add(model);
  }
  return [...out].sort();
}

let lastGoodModels = null;
let lastDiscoveryWarning = null;

function resetPoolDiscoveryCache() {
  lastGoodModels = null;
  lastDiscoveryWarning = null;
}

function getLastDiscoveryWarning() {
  return lastDiscoveryWarning;
}

function parseCliModels(stdout) {
  const models = new Set();
  const lines = String(stdout || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^fetching/i.test(line)) continue;
    if (line.toLowerCase() === 'ok') continue;
    if (line.startsWith('#')) continue;
    const parts = line.split(/\t/);
    const token = (parts[0] || '').trim();
    if (!token || token.includes(' ')) continue;
    if (!/^[a-zA-Z0-9][-a-zA-Z0-9._/]*$/.test(token)) continue;
    if (token.startsWith('---') || token.startsWith('===') || token.startsWith('___')) continue;
    models.add(token);
  }
  return [...models].sort();
}

function parseCatalogueModels(catalogue) {
  const models = new Set();
  if (Array.isArray(catalogue)) {
    for (const item of catalogue) {
      if (!item) continue;
      const modelId = typeof item === 'string' ? item : item.modelId || item.model || item.id || '';
      const upstream = typeof item === 'object' ? item.upstream || item.gateway || '' : '';
      if (modelId.startsWith('ag/')) {
        models.add(modelId.slice(3));
      } else if (upstream === 'ag' && modelId) {
        models.add(modelId.replace(/^ag\//, ''));
      } else if (modelId.startsWith('antigravity/')) {
        models.add(modelId.slice('antigravity/'.length));
      } else if (upstream === 'antigravity' && modelId) {
        models.add(modelId.replace(/^antigravity\//, ''));
      }
    }
  }
  return [...models].sort();
}

function discoverPoolModels(options) {
  const opts = options || {};
  if (opts.discoverPool === false) {
    return [];
  }
  if (Array.isArray(opts.models) && opts.models.length > 0) {
    return [...opts.models];
  }

  const dataDir = opts.dataDir || path.join(__dirname, 'data', 'discovery');
  const cacheFile =
    opts.cacheFile !== undefined ? opts.cacheFile : path.join(dataDir, 'agy-pool-cache.tmp');

  if (!opts.refresh && lastGoodModels && lastGoodModels.length > 0) {
    return [...lastGoodModels];
  }

  if (!opts.refresh && !opts.spawnSync && !opts.agyBin && !opts.bin && cacheFile) {
    try {
      if (fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (Array.isArray(cached) && cached.length > 0) {
          lastGoodModels = cached;
          return [...cached];
        }
      }
    } catch {}
  }

  // 1. Try agy CLI models listing
  const bin = opts.agyBin || opts.bin || 'agy';
  const spawnFn = opts.spawnSync || spawnSync;
  let cliModels = [];
  try {
    const res = spawnFn(bin, ['models'], {
      encoding: 'utf8',
      timeout: Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 15000,
      windowsHide: true,
      shell: false,
    });
    if (res && !res.error && res.status === 0 && res.stdout) {
      cliModels = parseCliModels(res.stdout);
    }
  } catch {}

  if (cliModels.length > 0) {
    lastGoodModels = cliModels;
    lastDiscoveryWarning = null;
    if (cacheFile) {
      try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(cliModels, null, 2), 'utf8');
      } catch {}
    }
    return [...cliModels];
  }

  // 2. Try catalogue import of Antigravity backend ("ag/" offerings)
  let catModels = [];
  if (Array.isArray(opts.catalogue) && opts.catalogue.length > 0) {
    catModels = parseCatalogueModels(opts.catalogue);
  } else {
    const catFile = opts.catalogueFile || path.join(dataDir, 'catalogue.jsonl');
    try {
      if (fs.existsSync(catFile)) {
        const content = fs.readFileSync(catFile, 'utf8');
        const lines = content.split(/\r?\n/).filter(Boolean);
        const parsedCatalogue = [];
        for (const line of lines) {
          try {
            parsedCatalogue.push(JSON.parse(line));
          } catch {}
        }
        catModels = parseCatalogueModels(parsedCatalogue);
      }
    } catch {}
  }

  if (catModels.length > 0) {
    lastGoodModels = catModels;
    lastDiscoveryWarning = 'agy CLI unavailable; models imported from catalogue';
    if (cacheFile) {
      try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(catModels, null, 2), 'utf8');
      } catch {}
    }
    return [...catModels];
  }

  // 3. Keep last good list with a warning
  if (lastGoodModels && lastGoodModels.length > 0) {
    lastDiscoveryWarning = 'agy discovery failed; keeping last good model list';
    return [...lastGoodModels];
  }

  if (cacheFile) {
    try {
      if (fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (Array.isArray(cached) && cached.length > 0) {
          lastGoodModels = cached;
          lastDiscoveryWarning = 'agy discovery failed; keeping last good model list';
          return [...cached];
        }
      }
    } catch {}
  }

  // 4. Failed discovery: never fall back to a hard-coded model id
  lastDiscoveryWarning = 'agy discovery failed; no models available';
  return [];
}

function readAccountModels(accountId, options) {
  if (!isValidAccountId(accountId)) return [];
  const mFile = path.join(exp.accountDir(accountId, options), 'models-out.txt');
  try {
    if (fs.existsSync(mFile)) {
      return exp.parseCliModels(fs.readFileSync(mFile, 'utf8'));
    }
  } catch {}
  return [];
}

const exp = {
  runsDir,
  accountDir,
  discoverAccounts,
  readAccountModels,
  readResult,
  readOutText,
  waitForResult,
  runAdapter,
  submitJob,
  parseQuotaOutput,
  quotaReading,
  modelIdsFromRuntime,
  discoverPoolModels,
  resetPoolDiscoveryCache,
  getLastDiscoveryWarning,
  isValidAccountId,
  parseCliModels,
  readLastRunElapsedMs,
  poolTimeoutMs,
};

module.exports = exp;
