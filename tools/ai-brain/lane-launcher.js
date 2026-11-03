'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { acquireLock, releaseLock, acceptResult, runWithCleanup } = require('./work-guard');

function toLaneDir(lane) {
  return typeof lane === 'string' ? lane : (lane && (lane.dir || lane.path)) || '.';
}

function getLockPath(lane) {
  return path.join(toLaneDir(lane), 'lock');
}

function redactStderr(text) {
  if (!text) return '';
  return String(text)
    .replace(/(Bearer\s+)[^\s'"]+/gi, '$1[REDACTED]')
    .replace(/((?:[\w.-]*(?:key|token)[\w.-]*)\s*[:=]\s*)['"]?[^'"\s]+['"]?/gi, '$1[REDACTED]');
}

function launch(lane, job, options = {}) {
  const dir = toLaneDir(lane);
  fs.mkdirSync(dir, { recursive: true });
  const jobFile = path.join(dir, 'job.json');
  if (fs.existsSync(jobFile)) {
    let prev;
    try {
      prev = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
    } catch (_) {}
    if (prev && prev.jobId && !readResult(lane, prev)) {
      return { ok: false, cause: 'LANE_BUSY', error: 'Active job without matching result' };
    }
  }
  const jobId = (job && job.jobId) || `job-${crypto.randomUUID()}`;
  const attemptId = (job && job.attemptId) || `att-${crypto.randomUUID()}`;
  const pid = options.pid !== undefined ? options.pid : ((job && job.pid) || process.pid);
  if (!options.skipLock) {
    const locked = acquireLaneLock(lane, { jobId, pid }, options);
    if (!locked.ok) return locked;
  }
  const jobData = Object.assign({}, job, { jobId, attemptId, pid, launchedAt: Date.now() });
  fs.writeFileSync(jobFile, JSON.stringify(jobData, null, 2));
  return { ok: true, job: jobData };
}

function acquireLaneLock(lane, owner, options) {
  const pid = owner && owner.pid !== undefined ? owner.pid : process.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('LANE_LAUNCHER_REFUSED: positive pid required');
  }
  return acquireLock(getLockPath(lane), Object.assign({}, owner, { pid }), options);
}

function releaseLaneLock(lane, owner) {
  return releaseLock(getLockPath(lane), owner);
}

function readResult(lane, job) {
  const file = path.join(toLaneDir(lane), 'result.json');
  if (!fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
  const check = acceptResult(job, parsed);
  return check.ok ? parsed : null;
}

function saveResult(lane, job, outcome = {}) {
  const dir = toLaneDir(lane);
  fs.mkdirSync(dir, { recursive: true });
  const jobId = (job && job.jobId) || outcome.jobId;
  const result = Object.assign({}, outcome, {
    jobId,
    exitCode: outcome.exitCode !== undefined ? outcome.exitCode : 0,
    stderr: redactStderr(outcome.stderr || ''),
    durationMs: outcome.durationMs !== undefined ? outcome.durationMs : 0,
    logPath: outcome.logPath || '',
  });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

function cleanup(lane, job, options = {}) {
  const killFn = options.kill || ((pid) => { try { process.kill(pid); } catch (_) {} });
  const target = job || (() => {
    try { return JSON.parse(fs.readFileSync(path.join(toLaneDir(lane), 'job.json'), 'utf8')); }
    catch (_) { return null; }
  })();
  if (!target) return { ok: true, killed: [] };
  const list = target.pidTree || target.pids || (target.pid ? [target.pid] : []);
  const pids = Array.isArray(list) ? list : [list];
  const killed = [];
  for (const p of pids) {
    if (Number.isInteger(p) && p > 0) {
      killFn(p);
      killed.push(p);
    }
  }
  return { ok: true, killed };
}

module.exports = {
  launch,
  acquireLaneLock,
  lockLane: acquireLaneLock,
  releaseLaneLock,
  releaseLane: releaseLaneLock,
  readResult,
  saveResult,
  recordResult: saveResult,
  redactStderr,
  cleanup,
  runWithCleanup,
};
