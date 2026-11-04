'use strict';

const fs = require('node:fs');
const path = require('node:path');
const fastRedact = require('fast-redact');
const { Cause } = require('./work-guard');

const VALID_STAGES = new Set(['writer', 'reviewer', 'repair', 'fallback', 'review']);
const VALID_RETRY_LAYERS = new Set(['pipeline', 'cli', 'gateway']);
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const SECRET_KEY =
  /^(api[-_]?key|secret|token|password|passwd|auth|authorization|credential|cookie)$/i;
const URL_KEY = /^(endpoint|url|uri|route|routeIdentity)$/i;

function isForbiddenId(id) {
  if (id === null || id === undefined) return false;
  let s;
  try {
    s = String(id);
  } catch (_) {
    return true;
  }
  return FORBIDDEN_IDS.has(s) || s in Object.prototype;
}

function assertValidId(id, name) {
  if (isForbiddenId(id)) throw new Error(`RUN_LEDGER_REFUSED: invalid ${name} ${id}`);
}

function maskUrl(v) {
  if (typeof v !== 'string') return v;
  try {
    const u = new URL(v);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    for (const [k] of [...u.searchParams.entries()]) {
      if (SECRET_KEY.test(k)) u.searchParams.set(k, '[REDACTED]');
    }
    return u.toString();
  } catch (_) {
    return v.replace(/([a-z][a-z0-9+.-]*:\/\/)[^@/\s]*@/i, '$1');
  }
}

function redactPaths(v, prefix, out) {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const item of v) redactPaths(item, prefix + '[*]', out);
    return;
  }
  for (const [k, val] of Object.entries(v)) {
    const p = prefix ? prefix + '.' + k : k;
    if (SECRET_KEY.test(k)) out.secrets.push(p);
    else if (URL_KEY.test(k)) out.urls.push(p);
    if (val && typeof val === 'object') redactPaths(val, p, out);
  }
}

function maskCredentials(v) {
  if (typeof v === 'string') return maskUrl(v);
  if (!v || typeof v !== 'object') return v;
  const out = JSON.parse(JSON.stringify(v));
  const paths = { secrets: [], urls: [] };
  redactPaths(out, '', paths);
  if (paths.urls.length) {
    fastRedact({ paths: paths.urls, censor: maskUrl, serialize: false })(out);
  }
  if (paths.secrets.length) {
    fastRedact({ paths: paths.secrets, censor: '[REDACTED]', serialize: false })(out);
  }
  return out;
}

function writeJson(file, value) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function overLimit(spent, lim, now) {
  if (!lim) return null;
  if (Number.isFinite(lim.attempts) && (spent.attempts || 0) >= lim.attempts) return 'attempts';
  if (Number.isFinite(lim.ms) && (spent.ms || 0) >= lim.ms) return 'ms';
  if (
    Number.isFinite(lim.tokens) &&
    (spent.tokens || 0) + (spent.unknownTokens || 0) >= lim.tokens
  ) {
    return 'tokens';
  }
  return null;
}

function limitCause(k) {
  return k === 'ms'
    ? Cause.TIME_EXHAUSTED
    : k === 'tokens'
      ? Cause.TOKENS_EXHAUSTED
      : Cause.ATTEMPTS_EXHAUSTED;
}

function computeGoals(runs) {
  const goals = Object.create(null);
  const seen = new Map();
  for (const r of runs || []) {
    if (!r || !r.goalId || isForbiddenId(r.goalId)) continue;
    const g = (goals[r.goalId] = goals[r.goalId] || {
      attempts: 0,
      ms: 0,
      tokens: 0,
      tokensUnknown: 0,
      unknownTokens: 0,
    });
    const ids = seen.get(r.goalId) || new Set();
    if (r.attemptId && !ids.has(r.attemptId)) {
      ids.add(r.attemptId);
      g.attempts += 1;
    }
    seen.set(r.goalId, ids);
    if (Number.isFinite(r.ms)) g.ms += r.ms;
    if (Number.isFinite(r.tokens)) g.tokens += r.tokens;
    else if (r.tokens === 'UNKNOWN') g.tokensUnknown += 1;
  }
  return goals;
}

function normalizeAdmit(arg1, arg2, arg3, arg4) {
  if (typeof arg1 === 'object' && arg1 !== null) return Object.assign({ stage: arg1.stage }, arg1);
  if (typeof arg2 === 'object' && arg2 !== null) return Object.assign({ stage: arg1 }, arg2);
  if (typeof arg3 === 'string') return Object.assign({ itemId: arg1, stage: arg2, fp: arg3 }, arg4);
  return { stage: arg1, opts: arg2 };
}

function normalizeRecord(arg1, arg2, arg3) {
  let stage, opts;
  if (typeof arg1 === 'object' && arg1 !== null) {
    opts = arg1;
    stage = opts.stage;
  } else if (typeof arg2 === 'object' && arg2 !== null && !arg3) {
    stage = arg1;
    opts = arg2;
  } else if (typeof arg1 === 'string' && typeof arg2 === 'string') {
    stage = arg2;
    opts = Object.assign({ itemId: arg1 }, typeof arg3 === 'object' ? arg3 : {});
  } else {
    stage = arg1;
    opts = arg2 || {};
  }
  const st = String(stage || '').toLowerCase();
  if (!VALID_STAGES.has(st)) throw new Error('RUN_LEDGER_REFUSED: invalid stage ' + stage);
  if (opts.retryLayer && !VALID_RETRY_LAYERS.has(opts.retryLayer)) {
    throw new Error('RUN_LEDGER_REFUSED: invalid retryLayer ' + opts.retryLayer);
  }
  if (!opts.attemptId && !opts.jobId) {
    throw new Error('RUN_LEDGER_REFUSED: missing jobId or attemptId');
  }
  if (
    opts.ms !== undefined &&
    (typeof opts.ms !== 'number' || !Number.isFinite(opts.ms) || opts.ms < 0)
  ) {
    throw new Error('RUN_LEDGER_REFUSED: invalid ms');
  }
  if (
    opts.tokens !== undefined &&
    (typeof opts.tokens !== 'number' || !Number.isFinite(opts.tokens) || opts.tokens < 0)
  ) {
    throw new Error('RUN_LEDGER_REFUSED: invalid tokens');
  }
  const attemptKey = String(opts.attemptId || opts.jobId);
  assertValidId(opts.itemId, 'itemId');
  assertValidId(opts.goalId, 'goalId');
  assertValidId(opts.fp || opts.fingerprint, 'fingerprint');
  return { stage: st, opts, attemptKey };
}

module.exports = {
  VALID_STAGES,
  VALID_RETRY_LAYERS,
  FORBIDDEN_IDS,
  SECRET_KEY,
  URL_KEY,
  isForbiddenId,
  assertValidId,
  maskUrl,
  redactPaths,
  maskCredentials,
  writeJson,
  overLimit,
  limitCause,
  computeGoals,
  normalizeAdmit,
  normalizeRecord,
};
