'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function isValidAccountId(accountId) {
  return typeof accountId === 'string' && /^agy\d{2}$/.test(accountId);
}

function runsDir(options) {
  const opts = options || {};
  if (opts.fakeRunsDir) return opts.fakeRunsDir;
  if (opts.runsDir) return opts.runsDir;
  if (process.env.AGY_POOL_RUNS_DIR) return process.env.AGY_POOL_RUNS_DIR;
  if (process.env.AGY_RUNS_DIR) return process.env.AGY_RUNS_DIR;

  const platform = opts.platform || process.env.AGY_POOL_PLATFORM || process.platform;
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
  return path.join(runsDir(options), accountId);
}

function discoverAccounts(options) {
  const dir = runsDir(options);
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
  const file = path.join(accountDir(accountId, options), 'result.json');
  try {
    return readJson(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return { state: 'error', reason: 'CORRUPT_RESULT' };
  }
}

function readOutText(accountId, options) {
  if (!isValidAccountId(accountId)) return '';
  const file = path.join(accountDir(accountId, options), 'out.txt');
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
}

function waitForResult(accountId, sinceMs, options) {
  if (!isValidAccountId(accountId)) return { state: 'error', reason: 'INVALID_ACCOUNT_ID' };
  const opts = options || {};
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 120000;
  const file = path.join(accountDir(accountId, opts), 'result.json');
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    try {
      const stat = fs.statSync(file);
      if (!sinceMs || stat.mtimeMs >= sinceMs) return readResult(accountId, opts);
    } catch {}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
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
    const res = spawnSync(process.execPath, [script, accountDir(accountId, opts), accountId], {
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

  const platform = opts.platform || process.env.AGY_POOL_PLATFORM || process.platform;
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

function submitJob(accountId, job, options) {
  if (!isValidAccountId(accountId)) {
    return { state: 'error', exitCode: 1, reason: 'INVALID_ACCOUNT_ID' };
  }
  const opts = options || {};
  const dir = accountDir(accountId, opts);
  fs.mkdirSync(dir, { recursive: true });
  const resultFile = path.join(dir, 'result.json');
  const startedAt = Date.now();
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job, null, 2), 'utf8');
  const launch = runAdapter(accountId, opts);
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
    return errorResult;
  }
  return waitForResult(accountId, startedAt, opts);
}

function parseNumberValue(val) {
  if (val === null || val === undefined || val === '' || typeof val === 'boolean') {
    return NaN;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    const stripped = trimmed.endsWith('%') ? trimmed.slice(0, -1).trim() : trimmed;
    const n = Number(stripped);
    return Number.isFinite(n) ? n : NaN;
  }
  const n = Number(val);
  return Number.isFinite(n) ? n : NaN;
}

function parseQuotaJson(value) {
  const rows = [];
  const models = new Set();
  const doc = value && typeof value === 'object' ? value : {};
  const groups = Array.isArray(doc.groups) ? doc.groups : Array.isArray(doc) ? doc : [];
  for (const group of groups) {
    const family = group.id || group.family || group.name;
    if (!family) continue;
    for (const model of group.models || []) {
      if (model) models.add(String(model));
    }
    for (const key of ['fiveHour', 'weekly', 'daily', 'session']) {
      const windowValue = group[key];
      if (!windowValue || typeof windowValue !== 'object') continue;
      const hasRemaining =
        windowValue.remainingPercent !== undefined ||
        windowValue.remaining !== undefined ||
        windowValue.disabled !== undefined;
      if (!hasRemaining) continue;

      const rawPercent = parseNumberValue(windowValue.remainingPercent);
      const rawFraction = parseNumberValue(windowValue.remaining);
      const parsed = Number.isFinite(rawPercent)
        ? rawPercent
        : Number.isFinite(rawFraction)
          ? Math.round(rawFraction * 100)
          : NaN;

      const isFinite = Number.isFinite(parsed);
      const remainingPercent = isFinite ? parsed : windowValue.disabled ? 0 : null;
      const known = isFinite || Boolean(windowValue.disabled);

      rows.push({
        family,
        window: key === 'fiveHour' ? 'fiveHour' : key,
        remainingPercent,
        known,
        disabled: Boolean(windowValue.disabled),
        resetsAt: windowValue.resetAt || windowValue.resetsAt || null,
      });
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

  const agyQuota = require('./agy-quota');
  const parsedText = agyQuota.parseQuota(body);
  return Object.assign({}, parsedText, { models: [] });
}

function quotaReading(accountId, options) {
  const opts = options || {};
  const result = opts.result || readResult(accountId, opts);
  if (!result) return { available: false, reason: 'không có result.json', rows: [] };
  if (result.state === 'login-required') {
    return { available: false, reason: 'AUTH_FAILED', rows: [] };
  }
  if (result.state !== 'ok' && result.state !== 'quota') {
    return { available: false, reason: result.reason || result.state || 'FAILED', rows: [] };
  }
  const parsed = parseQuotaOutput(readOutText(accountId, opts));
  if (!parsed.available) return parsed;
  return Object.assign({}, parsed, {
    account: { known: true, email: accountId, source: 'pool' },
    observedAt: new Date((opts && opts.now) || Date.now()).toISOString(),
  });
}

function modelIdsFromRuntime(options) {
  const opts = options || {};
  const out = new Set();
  for (const accountId of discoverAccounts(opts)) {
    const parsed = parseQuotaOutput(readOutText(accountId, opts));
    for (const model of parsed.models || []) out.add(model);
  }
  return [...out].sort();
}

module.exports = {
  runsDir,
  accountDir,
  discoverAccounts,
  readResult,
  readOutText,
  waitForResult,
  runAdapter,
  submitJob,
  parseQuotaOutput,
  quotaReading,
  modelIdsFromRuntime,
  isValidAccountId,
};
