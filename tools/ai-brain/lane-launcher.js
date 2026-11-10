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

// Serializes the check-then-publish steps of `launch` and `saveResult` across
// processes, so a paused validation can never publish across a replacement launch.
function withLaneOpLock(dir, fn) {
  const lockPath = path.join(dir, 'lane.op');
  const owner = { jobId: `op-${crypto.randomUUID()}`, pid: process.pid };
  const until = Date.now() + 10000;
  for (;;) {
    if (acquireLock(lockPath, owner).ok) break;
    if (Date.now() > until) throw new Error('LANE_OP_LOCK_TIMEOUT');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  try {
    return fn();
  } finally {
    releaseLock(lockPath, owner);
  }
}

function readStoredJob(dir) {
  const jobFile = path.join(dir, 'job.json');
  if (!fs.existsSync(jobFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  } catch (_) {
    return null;
  }
}

function activeJobWithoutResult(dir) {
  const stored = readStoredJob(dir);
  if (stored && stored.jobId && !readResult(dir, stored)) return stored;
  return null;
}

const CREDENTIAL_LINE_RE = /(?:api[-_]?key|apikey|key|token|secret|password|authorization|bearer)/i;

const CREDENTIAL_GLOBAL_RE = new RegExp(CREDENTIAL_LINE_RE.source, 'gi');
const REDACTED_LINE = '[REDACTED LINE: credential]';

// Net count of JSON-style openers minus closers, ignoring brackets inside quoted strings.
function bracketDelta(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
  }
  return depth;
}

// What a credential-bearing line leaves for the lines after it: nothing, a pending
// value (key without its value, e.g. `"api_key":` or `"api_key"`) or an open
// container (`"secret": {`) whose lines must stay masked until it closes.
function trailingState(trimmed) {
  const matches = [...trimmed.matchAll(CREDENTIAL_GLOBAL_RE)];
  if (matches.length === 0) return { pending: false, depth: 0 };
  // The first credential keyword whose value opens a container keeps every line
  // of that container masked until it closes, even when the opening line carries
  // further credential keywords after the opener (e.g. `"secret": { "token": …`).
  let lastEnd = -1;
  for (const m of matches) {
    const rest = trimmed.slice(m.index + m[0].length);
    const opener = /^[\w-]*["'`]?\s*[:=]\s*([[{].*)$/.exec(rest);
    if (opener) {
      const depth = bracketDelta(opener[1]);
      if (depth > 0) return { pending: false, depth };
    }
    lastEnd = m.index + m[0].length;
  }
  const rest = trimmed.slice(lastEnd);
  const pending =
    /[:=]$/.test(trimmed) ||
    /^--?[\w-]+$/.test(trimmed) ||
    /^[\w-]*["'`]\s*$/.test(rest) ||
    /\bbearer$/i.test(trimmed);
  return { pending, depth: 0 };
}

// State after the first non-blank line that follows a pending credential key.
function valueState(trimmed) {
  if (/^[:=]+$/.test(trimmed)) return { pending: true, depth: 0 };
  const opener = /^[:=]?\s*([[{].*)$/.exec(trimmed);
  if (opener) {
    const depth = bracketDelta(opener[1]);
    if (depth > 0) return { pending: false, depth };
  }
  return trailingState(trimmed);
}

function redactStderr(text) {
  if (!text) return '';
  const lines = String(text).split('\n');
  let pending = false;
  let depth = 0;
  return lines
    .map((line) => {
      const hasCR = line.endsWith('\r');
      const cleanLine = hasCR ? line.slice(0, -1) : line;
      const trimmed = cleanLine.trim();
      const masked = hasCR ? `${REDACTED_LINE}\r` : REDACTED_LINE;

      if (depth > 0) {
        let currentDepth = depth;
        let inString = false;
        let escaped = false;
        let closeIndex = -1;
        for (let i = 0; i < trimmed.length; i++) {
          const ch = trimmed[i];
          if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
          }
          if (ch === '"') {
            inString = true;
          } else if (ch === '{' || ch === '[') {
            currentDepth += 1;
          } else if (ch === '}' || ch === ']') {
            currentDepth -= 1;
            if (currentDepth === 0) {
              closeIndex = i;
              break;
            }
          }
        }
        if (closeIndex !== -1) {
          const rest = trimmed.slice(closeIndex + 1).trim();
          ({ pending, depth } = trailingState(rest));
        } else {
          depth = currentDepth;
        }
        return masked;
      }

      if (pending) {
        if (!trimmed) {
          return line;
        }
        ({ pending, depth } = valueState(trimmed));
        return masked;
      }

      if (CREDENTIAL_LINE_RE.test(cleanLine)) {
        ({ pending, depth } = trailingState(trimmed));
        return masked;
      }
      return line;
    })
    .join('\n');
}

function launch(lane, job, options = {}) {
  const dir = toLaneDir(lane);
  fs.mkdirSync(dir, { recursive: true });
  const jobFile = path.join(dir, 'job.json');
  if (activeJobWithoutResult(dir)) {
    return { ok: false, cause: 'LANE_BUSY', error: 'Active job without matching result' };
  }
  const jobId = `job-${crypto.randomUUID()}`;
  const attemptId = `att-${crypto.randomUUID()}`;
  const pid =
    options.pid !== undefined ? options.pid : job && job.pid !== undefined ? job.pid : process.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('LANE_LAUNCHER_REFUSED: positive pid required');
  }
  if (typeof options.beforeLockAcquire === 'function') options.beforeLockAcquire();
  return withLaneOpLock(dir, () => {
    const locked = acquireLaneLock(lane, { jobId, pid }, options);
    if (!locked.ok) return locked;
    // Revalidate lane occupancy with the lock acquired: while this process was
    // contending, a replacement launch may have installed an active job whose
    // result does not exist yet.
    if (activeJobWithoutResult(dir)) {
      releaseLaneLock(lane, { jobId, pid });
      return { ok: false, cause: 'LANE_BUSY', error: 'Active job without matching result' };
    }
    const jobData = Object.assign({}, job, { jobId, attemptId, pid, launchedAt: Date.now() });
    fs.writeFileSync(jobFile, JSON.stringify(jobData, null, 2));
    return { ok: true, job: jobData };
  });
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

function saveResult(lane, job, outcome = {}, options = {}) {
  const dir = toLaneDir(lane);
  fs.mkdirSync(dir, { recursive: true });
  const jobId = (job && job.jobId) || outcome.jobId;
  // A result not bound to the active job (stale or missing jobId) is discarded so it
  // cannot overwrite the active job's completion.
  const isStale = (active) => Boolean(active && active.jobId && active.jobId !== jobId);
  if (isStale(readStoredJob(dir))) return null;
  if (typeof options.beforePublish === 'function') options.beforePublish();
  return withLaneOpLock(dir, () => {
    // Validate again immediately before publication with `launch`'s replacement
    // serialized: while this process was paused, the lane may have moved on.
    if (isStale(readStoredJob(dir))) return null;
    const result = Object.assign({}, outcome, {
      jobId,
      exitCode: outcome.exitCode !== undefined ? outcome.exitCode : 0,
      stderr: redactStderr(outcome.stderr || ''),
      durationMs: outcome.durationMs !== undefined ? outcome.durationMs : 0,
      logPath: outcome.logPath || '',
    });
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    return result;
  });
}

function cleanup(lane, job, options = {}) {
  const killFn =
    options.kill ||
    ((pid) => {
      try {
        process.kill(pid);
      } catch (_) {}
    });
  const suppliedId = typeof job === 'string' ? job : job && job.jobId;
  if (!suppliedId || typeof suppliedId !== 'string') {
    return { ok: false, cause: 'JOB_MISMATCH', killed: [] };
  }
  const dir = toLaneDir(lane);
  let stored = null;
  try {
    stored = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
  } catch (_) {
    stored = null;
  }
  if (!stored || !stored.jobId) return { ok: true, killed: [] };
  if (suppliedId !== stored.jobId) {
    return { ok: false, cause: 'JOB_MISMATCH', killed: [] };
  }
  const list = stored.pidTree || stored.pids || (stored.pid ? [stored.pid] : []);
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
  activeJobWithoutResult,
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
