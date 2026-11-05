'use strict';

const fs = require('node:fs');
const path = require('node:path');
const fastRedact = require('fast-redact');
const { Cause } = require('./work-guard');

const VALID_STAGES = new Set(['writer', 'reviewer', 'repair', 'fallback', 'review']);
const VALID_RETRY_LAYERS = new Set(['pipeline', 'cli', 'gateway']);
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);

const SENSITIVE_KEYS = [
  'key',
  'apiKey',
  'token',
  'authorization',
  'Authorization',
  'Apikey',
  'ApiKey',
  'secret',
  'password',
  'credential',
];
const SENSITIVE_SPECIAL = ['["x-api-key"]', '["X-Api-Key"]', '["X-API-KEY"]'];

const SENSITIVE_PATHS = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((k) => '*.' + k),
  ...SENSITIVE_KEYS.map((k) => '*.*.' + k),
  ...SENSITIVE_KEYS.map((k) => 'providers[*].' + k),
  ...SENSITIVE_KEYS.map((k) => '*[*].' + k),
  ...SENSITIVE_SPECIAL,
  ...SENSITIVE_SPECIAL.map((k) => '*' + k),
  ...SENSITIVE_SPECIAL.map((k) => '*.*' + k),
  ...SENSITIVE_SPECIAL.map((k) => 'providers[*]' + k),
  ...SENSITIVE_SPECIAL.map((k) => 'providers[*].headers' + k),
  ...SENSITIVE_SPECIAL.map((k) => '*[*]' + k),
];

const redactor = fastRedact({
  paths: SENSITIVE_PATHS,
  censor: '[REDACTED]',
  serialize: false,
});

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
      if (/^(key|api[-_]?key|secret|token|password|auth|authorization)$/i.test(k)) {
        u.searchParams.set(k, '[REDACTED]');
      }
    }
    return u.toString();
  } catch (_) {
    return v.replace(/([a-z][a-z0-9+.-]*:\/\/)[^@/\s]*@/i, '$1');
  }
}

function walkUrls(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const k of Object.keys(obj)) {
    const val = obj[k];
    if (typeof val === 'string' && val.includes('://')) {
      obj[k] = maskUrl(val);
    } else if (typeof val === 'object' && val !== null) {
      walkUrls(val);
    }
  }
  return obj;
}

// Key names that carry credentials, matched case-insensitively with "-" or "_" separators, at any depth.
const SENSITIVE_KEY_RE =
  /^(x[-_]?)?(api[-_]?key|apikey|key|auth|authorization|bearer|cookie|set[-_]?cookie|password|passwd|secret|client[-_]?secret|credentials?|private[-_]?key|(access|refresh|id|session)[-_]?token|token)$/i;
const BEARER_RE = /^\s*(bearer|basic|token)\s+\S+/i;

function maskKeys(obj, seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return obj;
  seen.add(obj);
  for (const k of Object.keys(obj)) {
    const val = obj[k];
    if (SENSITIVE_KEY_RE.test(k)) obj[k] = '[REDACTED]';
    else if (typeof val === 'string' && BEARER_RE.test(val)) obj[k] = '[REDACTED]';
    else if (val && typeof val === 'object') maskKeys(val, seen);
  }
  return obj;
}

function maskCredentials(v) {
  if (typeof v === 'string') return maskUrl(v);
  if (!v || typeof v !== 'object') return v;
  const copy = JSON.parse(JSON.stringify(v));
  walkUrls(copy);
  maskKeys(copy);
  redactor(copy);
  return copy;
}

function writeJson(file, value) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function checkGoalBudget(goal, limits) {
  if (!limits || !limits.goal) return null;
  const g = limits.goal;
  if (Number.isFinite(g.ms) && (goal.ms || 0) >= g.ms) return Cause.TIME_EXHAUSTED;
  if (Number.isFinite(g.attempts) && (goal.attempts || 0) >= g.attempts) {
    return Cause.ATTEMPTS_EXHAUSTED;
  }
  if (Number.isFinite(g.tokens) && (goal.tokens || 0) + (goal.unknownTokens || 0) >= g.tokens) {
    return Cause.TOKENS_EXHAUSTED;
  }
  return null;
}

function findReservation(stages, attemptKey) {
  for (const [stg, stageObj] of Object.entries(stages || {})) {
    if (!stageObj || !stageObj.fps) continue;
    for (const [f, entry] of Object.entries(stageObj.fps)) {
      if (entry && entry.outcome === 'IN_FLIGHT' && entry.attemptId === attemptKey) {
        return { stage: stg, fp: f, entry };
      }
    }
  }
  return null;
}

function computeGoals(runs, items) {
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
  for (const it of Object.values(items || {})) {
    if (!it || !it.stages) continue;
    for (const st of Object.values(it.stages)) {
      if (!st || !st.fps) continue;
      for (const entry of Object.values(st.fps)) {
        if (
          entry &&
          entry.outcome === 'IN_FLIGHT' &&
          entry.goalId &&
          !isForbiddenId(entry.goalId)
        ) {
          const g = (goals[entry.goalId] = goals[entry.goalId] || {
            attempts: 0,
            ms: 0,
            tokens: 0,
            tokensUnknown: 0,
            unknownTokens: 0,
          });
          const ids = seen.get(entry.goalId) || new Set();
          const attemptKey = entry.attemptId || 'res-' + entry.goalId;
          if (!ids.has(attemptKey)) {
            ids.add(attemptKey);
            g.attempts += 1;
          }
          seen.set(entry.goalId, ids);
        }
      }
    }
  }
  return goals;
}

function normalizeAdmit(arg1, arg2, arg3, arg4) {
  if (typeof arg1 === 'object' && arg1 !== null) return Object.assign({ stage: arg1.stage }, arg1);
  if (typeof arg2 === 'object' && arg2 !== null && typeof arg3 !== 'string') {
    return Object.assign({ stage: arg1 }, arg2);
  }
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
  Cause,
  isForbiddenId,
  assertValidId,
  maskUrl,
  maskCredentials,
  writeJson,
  checkGoalBudget,
  findReservation,
  computeGoals,
  normalizeAdmit,
  normalizeRecord,
};
