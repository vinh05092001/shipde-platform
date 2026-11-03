'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ProgressLedger, Cause, fingerprint } = require('./work-guard');

const VALID_STAGES = new Set(['writer', 'reviewer', 'repair', 'fallback', 'review']);
const VALID_RETRY_LAYERS = new Set(['pipeline', 'cli', 'gateway']);

function maskCredentials(v) {
  if (!v) return v;
  if (typeof v === 'string') {
    return v.replace(/(https?:\/\/)([^:@]+):([^@]+)@/g, '$1$2:***@').replace(/(sk-[a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]+/g, '$1***');
  }
  if (Array.isArray(v)) {
    return v.map((item) => maskCredentials(item));
  }
  if (typeof v !== 'object') return v;
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (/key|secret|token|password|auth|credential/i.test(k)) out[k] = '[REDACTED]';
    else if (val && typeof val === 'object') out[k] = maskCredentials(val);
    else if (typeof val === 'string') out[k] = maskCredentials(val);
    else out[k] = val;
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

function exceeded(spent, lim, opts = {}) {
  if (!lim) return null;
  for (const k of ['attempts', 'ms', 'tokens']) {
    if (opts.ignoreAttempts && k === 'attempts') continue;
    if (Number.isFinite(lim[k]) && (spent[k] || 0) >= lim[k]) return k;
  }
  return null;
}

function limitCause(k) {
  return k === 'ms' ? Cause.TIME_EXHAUSTED : k === 'tokens' ? Cause.TOKENS_EXHAUSTED : Cause.ATTEMPTS_EXHAUSTED;
}

class RunLedger {
  constructor(o = {}) {
    if (typeof o === 'string') o = { file: o };
    this.progressLedger = o instanceof ProgressLedger ? o : (o.progressLedger || new ProgressLedger(o));
    this.file = this.progressLedger.file;
    this.limits = o.limits || this.progressLedger.limits || {};
    this.now = o.now || this.progressLedger.now || (() => Date.now());
    if (this.file) {
      const d = path.dirname(this.file);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
  }

  load() { return this.progressLedger.load(); }

  admit(arg1, arg2, arg3, arg4) {
    let itemId, stage, fp, opts;
    if (typeof arg1 === 'string' && typeof arg2 === 'string' && typeof arg3 === 'string') {
      itemId = arg1; stage = arg2; fp = arg3; opts = arg4 || {};
    } else if (typeof arg1 === 'object' && arg1 !== null) {
      opts = arg1; stage = opts.stage; itemId = opts.itemId; fp = opts.fp || opts.fingerprint;
    } else if (typeof arg2 === 'object' && arg2 !== null) {
      stage = arg1; opts = arg2; itemId = opts.itemId; fp = opts.fp || opts.fingerprint;
    } else {
      stage = arg1; opts = {};
    }
    if (opts.reserve) {
      const actualFp = fp || opts.fp || opts.fingerprint || (opts.headSha ? fingerprint({ headSha: opts.headSha, baseSha: opts.baseSha, inputs: opts.inputs }) : null);
      if (itemId && stage && actualFp) {
        return this.progressLedger.admit(itemId, stage, actualFp, opts);
      }
    }
    const s = this.progressLedger.load();
    const it = (itemId && s.items && s.items[itemId]) || {};
    if (it.blocked) return { ok: false, cause: Cause.ITEM_BLOCKED, reason: it.blocked };
    const over = exceeded(s.goal, this.limits.goal);
    if (over) return { ok: false, cause: Cause.GOAL_EXHAUSTED, limit: over };
    const own = exceeded(it.spent || {}, this.limits.item);
    if (own) return { ok: false, cause: limitCause(own), limit: own };
    return { ok: true };
  }

  record(arg1, arg2, arg3) {
    let stage, opts;
    if (typeof arg1 === 'object' && arg1 !== null) { opts = arg1; stage = opts.stage; }
    else if (typeof arg2 === 'object' && arg2 !== null && !arg3) { stage = arg1; opts = arg2; }
    else if (typeof arg1 === 'string' && typeof arg2 === 'string') {
      stage = arg2; opts = Object.assign({ itemId: arg1 }, typeof arg3 === 'object' ? arg3 : {});
    } else { stage = arg1; opts = arg2 || {}; }
    const st = String(stage || '').toLowerCase();
    if (!VALID_STAGES.has(st)) throw new Error('RUN_LEDGER_REFUSED: invalid stage ' + stage);
    if (opts.retryLayer && !VALID_RETRY_LAYERS.has(opts.retryLayer)) {
      throw new Error('RUN_LEDGER_REFUSED: invalid retryLayer ' + opts.retryLayer);
    }
    if (!opts.attemptId && !opts.jobId) {
      throw new Error('RUN_LEDGER_REFUSED: missing jobId or attemptId');
    }
    return this.progressLedger.locked(() => {
      const s = this.progressLedger.load();
      const itemId = opts.itemId;
      const it = (itemId && s.items[itemId]) || { spent: { attempts: 0, ms: 0, tokens: 0 }, stages: {} };
      it.spent = it.spent || { attempts: 0, ms: 0, tokens: 0 };
      it.stages = it.stages || {};
      it.seenAttempts = it.seenAttempts || {};

      const attemptKey = opts.attemptId || opts.jobId;
      const isNew = !it.seenAttempts[attemptKey];

      const runReviewSha = opts.reviewSha || opts.headSha || null;
      const fp = opts.fp || opts.fingerprint || (runReviewSha ? fingerprint({ headSha: runReviewSha, baseSha: opts.baseSha, inputs: opts.inputs }) : ('fp-' + ((s.runs && s.runs.length) || 0)));
      const prev = ((it.stages[st] || {}).fps || {})[fp];
      const reserved = Boolean(prev && prev.outcome === 'IN_FLIGHT');

      const consumesAttempt = isNew && !reserved;

      if (!opts.force) {
        if (it.blocked) return { ok: false, cause: Cause.ITEM_BLOCKED, reason: it.blocked };
        const over = exceeded(s.goal, this.limits.goal, { ignoreAttempts: !consumesAttempt });
        if (over) return { ok: false, cause: Cause.GOAL_EXHAUSTED, limit: over };
        const own = exceeded(it.spent, this.limits.item, { ignoreAttempts: !consumesAttempt });
        if (own) return { ok: false, cause: limitCause(own), limit: own };
      }

      it.seenAttempts[attemptKey] = true;
      const ms = Number(opts.ms) || 0;
      const hasTokens = Number.isFinite(opts.tokens);
      const tokens = hasTokens ? opts.tokens : 'UNKNOWN';
      const tokenEnforcement = hasTokens ? (opts.tokenEnforcement || 'ENFORCED') : 'UNENFORCED';
      for (const acc of [it.spent, s.goal]) {
        if (consumesAttempt) acc.attempts += 1;
        acc.ms += ms;
        if (hasTokens) acc.tokens += tokens;
        else acc.tokensUnknown = (acc.tokensUnknown || 0) + 1;
      }
      if (opts.goalId) {
        s.goals = s.goals || {};
        const gAcc = s.goals[opts.goalId] || { attempts: 0, ms: 0, tokens: 0 };
        if (consumesAttempt) gAcc.attempts += 1;
        gAcc.ms += ms;
        if (hasTokens) gAcc.tokens += tokens;
        else gAcc.tokensUnknown = (gAcc.tokensUnknown || 0) + 1;
        s.goals[opts.goalId] = gAcc;
      }
      const run = {
        decisionId: opts.decisionId || null, jobId: opts.jobId || null, attemptId: opts.attemptId || opts.jobId || null,
        launch: opts.launch !== undefined ? opts.launch : null, exit: opts.exit !== undefined ? opts.exit : null,
        reviewSha: runReviewSha, verdict: opts.verdict || opts.outcome || null,
        stage: st, itemId: itemId || null, goalId: opts.goalId || null, retryLayer: opts.retryLayer || null,
        ms, tokens, tokenEnforcement, route: maskCredentials(opts.route || opts.routeIdentity || null), at: this.now(),
      };
      s.runs = s.runs || []; s.runs.push(run);
      it.runs = it.runs || []; it.runs.push(run);
      it.stages[st] = it.stages[st] || { fps: {} };
      it.stages[st].fps = it.stages[st].fps || {};
      it.stages[st].fps[fp] = { outcome: String(run.verdict || 'DONE'), at: this.now() };
      if (itemId) s.items[itemId] = it;
      writeJson(this.file, s);
      return { ok: true, run };
    });
  }

  getRuns(itemId) {
    const s = this.progressLedger.load();
    return (itemId ? (s.items[itemId] && s.items[itemId].runs) : s.runs) || [];
  }
  getChain(itemId) { return this.getRuns(itemId); }
  getSummary(itemId) {
    const s = this.progressLedger.load();
    return itemId ? ((s.items[itemId] && s.items[itemId].spent) || { attempts: 0, ms: 0, tokens: 0 }) : s.goal;
  }
  block(itemId, reason) { return this.progressLedger.block(itemId, reason); }
  unblock(itemId) { return this.progressLedger.unblock(itemId); }
}

module.exports = { RunLedger, maskCredentials, VALID_STAGES, VALID_RETRY_LAYERS, Cause };
