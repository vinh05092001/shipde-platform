'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function runsDir(options) {
  const opts = options || {};
  return (
    opts.fakeRunsDir ||
    opts.runsDir ||
    process.env.AGY_POOL_RUNS_DIR ||
    process.env.AGY_RUNS_DIR ||
    'C:\\Tools\\agy-runs'
  );
}

function accountDir(accountId, options) {
  return path.join(runsDir(options), String(accountId || ''));
}

function discoverAccounts(options) {
  const dir = runsDir(options);
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^agy\d{2}$/.test(entry.name))
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
  const file = path.join(accountDir(accountId, options), 'result.json');
  try {
    return readJson(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return { state: 'error', reason: 'CORRUPT_RESULT' };
  }
}

function readOutText(accountId, options) {
  const file = path.join(accountDir(accountId, options), 'out.txt');
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
}

function waitForResult(accountId, sinceMs, options) {
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
  const opts = options || {};
  const script = opts.adapterScript || process.env.AGY_POOL_ADAPTER_SCRIPT;
  if (script) {
    const res = spawnSync(process.execPath, [script, accountDir(accountId, opts), accountId], {
      encoding: 'utf8',
      timeout: Number(opts.adapterTimeoutMs) > 0 ? Number(opts.adapterTimeoutMs) : 120000,
      windowsHide: true,
      shell: false,
    });
    return {
      exitCode: res.status === null ? -1 : res.status,
      stdout: res.stdout || '',
      stderr: res.stderr || '',
    };
  }

  const taskName = `ShipDe\\ShipDe-${accountId}`;
  const res = spawnSync('schtasks', ['/run', '/tn', taskName], {
    encoding: 'utf8',
    timeout: Number(opts.adapterTimeoutMs) > 0 ? Number(opts.adapterTimeoutMs) : 30000,
    windowsHide: true,
    shell: false,
  });
  return {
    exitCode: res.status === null ? -1 : res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function submitJob(accountId, job, options) {
  const opts = options || {};
  const dir = accountDir(accountId, opts);
  fs.mkdirSync(dir, { recursive: true });
  const resultFile = path.join(dir, 'result.json');
  const startedAt = Date.now();
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job, null, 2), 'utf8');
  const launch = runAdapter(accountId, opts);
  const result = waitForResult(accountId, startedAt, opts);
  if (!result && launch.exitCode !== 0) {
    fs.writeFileSync(
      resultFile,
      JSON.stringify({ state: 'error', exitCode: launch.exitCode, reason: launch.stderr }, null, 2),
      'utf8'
    );
    return readResult(accountId, opts);
  }
  return result;
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
      if (!windowValue) continue;
      const remaining =
        windowValue.remainingPercent !== undefined
          ? Number(windowValue.remainingPercent)
          : windowValue.remaining !== undefined
            ? Math.round(Number(windowValue.remaining) * 100)
            : 0;
      rows.push({
        family,
        window: key === 'fiveHour' ? 'fiveHour' : key,
        remainingPercent: Number.isFinite(remaining) ? remaining : 0,
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
  const out = new Set();
  for (const accountId of discoverAccounts(options)) {
    const parsed = parseQuotaOutput(readOutText(accountId, options));
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
  submitJob,
  parseQuotaOutput,
  quotaReading,
  modelIdsFromRuntime,
};
