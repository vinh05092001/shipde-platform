'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ProgressLedger, Cause, fingerprint } = require('./work-guard');

const VALID_STAGES = new Set(['writer', 'reviewer', 'repair', 'fallback', 'review']);
const VALID_RETRY_LAYERS = new Set(['pipeline', 'cli', 'gateway']);
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);

function maskCredentials(v) {
  if (!v) return v;
  if (typeof v === 'string') {
    let s = v.replace(/(sk-[a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]+/g, '$1***');
    const sm = s.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)/);
    try {
      const u = new URL(s);
      if (u.username || u.password) {
        u.username = '';
        u.password = '';
      }
      let res = u.toString();
      if (!s.endsWith('/') && res.endsWith('/')) res = res.slice(0, -1);
      if (sm) res = res.replace(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//, sm[1]);
      return res;
    } catch (_) {
      return s.replace(/([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)[^@/\s]*@/gi, '$1');
    }
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
  return k === 'ms'
    ? Cause.TIME_EXHAUSTED
    : k === 'tokens'
      ? Cause.TOKENS_EXHAUSTED
      : Cause.ATTEMPTS_EXHAUSTED;
}

class RunLedger {
  constructor(o = {}) {
    if (typeof o === 'string') o = { file: o };
    this.progressLedger =
      o instanceof ProgressLedger ? o : o.progressLedger || new ProgressLedger(o);
    this.file = this.progressLedger.file;
    this.limits = o.limits || this.progressLedger.limits || {};
    this.progressLedger.limits = this.limits;
    this.now = o.now || this.progressLedger.now || (() => Date.now());
    this.progressLedger.now = this.now;
    if (this.file) {
      const d = path.dirname(this.file);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
  }

  load() {
    return this.progressLedger.load();
  }

  admit(arg1, arg2, arg3, arg4) {
    let itemId, stage, fp, opts;
    if (typeof arg1 === 'string' && typeof arg2 === 'string' && typeof arg3 === 'string') {
      itemId = arg1;
      stage = arg2;
      fp = arg3;
      opts = arg4 || {};
    } else if (typeof arg1 === 'object' && arg1 !== null) {
      opts = arg1;
      stage = opts.stage;
      itemId = opts.itemId;
      fp = opts.fp || opts.fingerprint;
    } else if (typeof arg2 === 'object' && arg2 !== null) {
      stage = arg1;
      opts = arg2;
      itemId = opts.itemId;
      fp = opts.fp || opts.fingerprint;
    } else {
      stage = arg1;
      opts = {};
    }
    if (itemId && FORBIDDEN_IDS.has(itemId)) {
      throw new Error('RUN_LEDGER_REFUSED: invalid itemId ' + itemId);
    }
    this.progressLedger.limits = this.limits;
    const actualFp =
      fp ||
      (opts.headSha
        ? fingerprint({ headSha: opts.headSha, baseSha: opts.baseSha, inputs: opts.inputs })
        : '__probe__' + (opts.attemptId || ''));

    if (itemId && stage) {
      const res = this.progressLedger.admit(itemId, stage, actualFp, opts);
      if (res && res.ok && opts.reserve && opts.goalId) {
        this.progressLedger.locked(() => {
          const s = this.progressLedger.load();
          const it = s.items && s.items[itemId];
          const stObj = it && it.stages && it.stages[stage];
          const cur = stObj && stObj.fps && stObj.fps[actualFp];
          if (cur && cur.goalId === opts.goalId) return;
          const alreadyChargedInRuns =
            s.goals &&
            s.goals[opts.goalId] &&
            (s.runs || []).some((r) => r.goalId === opts.goalId && r.itemId === itemId);
          if (alreadyChargedInRuns) return;
          if (cur) cur.goalId = opts.goalId;
          s.goals = s.goals || Object.create(null);
          const gAcc = s.goals[opts.goalId] || {
            attempts: 0,
            ms: 0,
            tokens: 0,
            tokensUnknown: 0,
            unknownTokens: 0,
          };
          gAcc.attempts = (gAcc.attempts || 0) + 1;
          s.goals[opts.goalId] = gAcc;
          writeJson(this.file, s);
        });
      }
      return res;
    }
    const s = this.progressLedger.load();
    const over = exceeded(s.goal, this.limits.goal);
    if (over) return { ok: false, cause: Cause.GOAL_EXHAUSTED, limit: over };
    return { ok: true };
  }

  record(arg1, arg2, arg3) {
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
      (typeof opts.tokens === 'number'
        ? !Number.isFinite(opts.tokens) || opts.tokens < 0
        : opts.tokens < 0)
    ) {
      throw new Error('RUN_LEDGER_REFUSED: invalid tokens');
    }

    const attemptKey = String(opts.attemptId || opts.jobId);
    let itemId = opts.itemId;
    if (itemId && FORBIDDEN_IDS.has(itemId)) {
      throw new Error('RUN_LEDGER_REFUSED: invalid itemId ' + itemId);
    }

    return this.progressLedger.locked(() => {
      this.progressLedger.limits = this.limits;
      const s = this.progressLedger.load();

      if (!itemId && attemptKey && s.runs) {
        const priorRun = s.runs.find((r) => r.attemptId === attemptKey && r.itemId);
        if (priorRun) itemId = priorRun.itemId;
      }

      const targetItemId = itemId || attemptKey;
      if (FORBIDDEN_IDS.has(targetItemId)) {
        throw new Error('RUN_LEDGER_REFUSED: invalid itemId ' + targetItemId);
      }

      if (itemId && s.runs) {
        const otherOwner = s.runs.find(
          (r) => r.attemptId === attemptKey && r.itemId && r.itemId !== itemId
        );
        if (otherOwner) {
          return { ok: false, cause: Cause.NO_PROGRESS, reason: 'attempt-owned-by-other-item' };
        }
      }

      const runReviewSha = opts.reviewSha || opts.headSha || null;
      const fp =
        opts.fp ||
        opts.fingerprint ||
        (runReviewSha
          ? fingerprint({ headSha: runReviewSha, baseSha: opts.baseSha, inputs: opts.inputs })
          : 'att-' + attemptKey);

      const it = s.items[targetItemId] || null;
      const prev = it && it.stages && it.stages[st] && it.stages[st].fps && it.stages[st].fps[fp];
      const reserved = Boolean(
        prev &&
        prev.outcome === 'IN_FLIGHT' &&
        Number.isInteger(prev.pid) &&
        (!prev.attemptId || prev.attemptId === attemptKey)
      );

      const isExistingAttempt =
        !reserved &&
        (s.runs || []).some((r) => r.attemptId === attemptKey && (!itemId || r.itemId === itemId));

      const consumesAttempt = !isExistingAttempt && !reserved;

      if (it && it.blocked) return { ok: false, cause: Cause.ITEM_BLOCKED, reason: it.blocked };
      const over = exceeded(s.goal, this.limits.goal, { ignoreAttempts: !consumesAttempt });
      if (over) return { ok: false, cause: Cause.GOAL_EXHAUSTED, limit: over };
      const own = exceeded((it && it.spent) || {}, this.limits.item, {
        ignoreAttempts: !consumesAttempt,
      });
      if (own) return { ok: false, cause: limitCause(own), limit: own };

      const ms = Number(opts.ms) || 0;
      const hasTokens = Number.isFinite(opts.tokens);
      const tokens = hasTokens ? opts.tokens : 'UNKNOWN';
      const tokenEnforcement = hasTokens ? opts.tokenEnforcement || 'ENFORCED' : 'UNENFORCED';
      const runVerdict = String(opts.verdict || opts.outcome || 'DONE');

      if (!isExistingAttempt) {
        if (runVerdict === 'IN_FLIGHT') {
          const perAttemptTokens =
            this.limits.item && this.limits.item.tokens ? this.limits.item.tokens : 0;
          const curState = this.progressLedger.load();
          const curIt = curState.items[targetItemId] || {
            spent: { attempts: 0, ms: 0, tokens: 0, tokensUnknown: 0, unknownTokens: 0 },
            stages: {},
          };
          curIt.spent = curIt.spent || {
            attempts: 0,
            ms: 0,
            tokens: 0,
            tokensUnknown: 0,
            unknownTokens: 0,
          };
          curIt.stages = curIt.stages || {};
          curState.items[targetItemId] = curIt;
          for (const acc of [curIt.spent, curState.goal]) {
            acc.attempts = (acc.attempts || 0) + 1;
            acc.ms = (acc.ms || 0) + ms;
            if (hasTokens) {
              acc.tokens = (acc.tokens || 0) + tokens;
            } else {
              acc.tokensUnknown = (acc.tokensUnknown || 0) + 1;
              acc.unknownTokens = (acc.unknownTokens || 0) + perAttemptTokens;
            }
          }
          const curSt = curIt.stages[st] || { fps: {} };
          curSt.fps = curSt.fps || {};
          curSt.fps[fp] = {
            outcome: 'IN_FLIGHT',
            pid: Number.isInteger(opts.pid) && opts.pid > 0 ? opts.pid : process.pid,
            at: this.now(),
            imputedTokens: hasTokens ? 0 : perAttemptTokens,
            attemptId: attemptKey,
            hasTokens,
          };
          if (opts.goalId) curSt.fps[fp].goalId = opts.goalId;
          curIt.stages[st] = curSt;
          writeJson(this.file, curState);
        } else {
          this.progressLedger.recordUnlocked(targetItemId, st, fp, runVerdict, {
            ms,
            tokens: hasTokens ? opts.tokens : undefined,
          });
          const curState = this.progressLedger.load();
          const curIt = curState.items[targetItemId];
          const curFp = curIt && curIt.stages[st] && curIt.stages[st].fps[fp];
          if (curFp) {
            curFp.attemptId = attemptKey;
            if (opts.goalId) curFp.goalId = opts.goalId;
            if (
              reserved &&
              (s.runs || []).some((r) => r.attemptId === attemptKey && Number.isFinite(r.tokens)) &&
              !hasTokens
            ) {
              curIt.spent.tokensUnknown = (curIt.spent.tokensUnknown || 0) + 1;
              curState.goal.tokensUnknown = (curState.goal.tokensUnknown || 0) + 1;
            }
            writeJson(this.file, curState);
          }
        }
      } else {
        const curState = this.progressLedger.load();
        const curIt = curState.items[targetItemId];
        if (curIt) {
          curIt.spent.ms += ms;
          curState.goal.ms += ms;
          if (hasTokens) {
            curIt.spent.tokens += tokens;
            curState.goal.tokens += tokens;
          }
          if (curIt.stages) {
            for (const [sName, stageObj] of Object.entries(curIt.stages)) {
              if (stageObj && stageObj.fps) {
                for (const [oldFp, rec] of Object.entries(stageObj.fps)) {
                  if ((sName !== st || oldFp !== fp) && rec && rec.attemptId === attemptKey) {
                    delete stageObj.fps[oldFp];
                  }
                }
              }
            }
          }
          const curSt = curIt.stages[st] || { fps: {} };
          curSt.fps = curSt.fps || {};
          curSt.fps[fp] = {
            outcome: runVerdict,
            attemptId: attemptKey,
            at: this.now(),
            imputedTokens: hasTokens ? 0 : 0,
          };
          if (opts.goalId) curSt.fps[fp].goalId = opts.goalId;
          curIt.stages[st] = curSt;
          writeJson(this.file, curState);
        }
      }

      const updatedState = this.progressLedger.load();

      if (opts.goalId) {
        updatedState.goals = updatedState.goals || Object.create(null);
        const gAcc = updatedState.goals[opts.goalId] || {
          attempts: 0,
          ms: 0,
          tokens: 0,
          tokensUnknown: 0,
          unknownTokens: 0,
        };
        const goalAlreadyCharged =
          Boolean(reserved && prev && prev.goalId === opts.goalId) ||
          (updatedState.runs || []).some(
            (r) => r.attemptId === attemptKey && r.goalId === opts.goalId
          );
        if (!goalAlreadyCharged) gAcc.attempts = (gAcc.attempts || 0) + 1;
        gAcc.ms = (gAcc.ms || 0) + ms;
        if (hasTokens) gAcc.tokens = (gAcc.tokens || 0) + tokens;
        else gAcc.tokensUnknown = (gAcc.tokensUnknown || 0) + 1;
        updatedState.goals[opts.goalId] = gAcc;
      }

      const run = {
        decisionId: opts.decisionId || null,
        jobId: opts.jobId || null,
        attemptId: attemptKey,
        launch: opts.launch !== undefined ? opts.launch : null,
        exit: opts.exit !== undefined ? opts.exit : null,
        reviewSha: runReviewSha,
        verdict: opts.verdict || opts.outcome || null,
        stage: st,
        itemId: targetItemId,
        goalId: opts.goalId || null,
        retryLayer: opts.retryLayer || null,
        ms,
        tokens,
        tokenEnforcement,
        route: maskCredentials(opts.route || opts.routeIdentity || null),
        at: this.now(),
      };

      updatedState.runs = updatedState.runs || [];
      updatedState.runs.push(run);

      updatedState.chains = updatedState.chains || Object.create(null);
      updatedState.chains[targetItemId] = updatedState.chains[targetItemId] || [];
      updatedState.chains[targetItemId].push(run);

      if (updatedState.items && updatedState.items[targetItemId]) {
        updatedState.items[targetItemId].runs = updatedState.chains[targetItemId];
      }

      writeJson(this.file, updatedState);
      return { ok: true, run };
    });
  }

  getRuns(itemId) {
    const s = this.progressLedger.load();
    if (itemId) {
      if (s.chains && s.chains[itemId]) return s.chains[itemId];
      if (s.items && s.items[itemId] && s.items[itemId].runs) return s.items[itemId].runs;
      return [];
    }
    return s.runs || [];
  }

  getChain(itemId) {
    return this.getRuns(itemId);
  }

  getSummary(itemId) {
    const s = this.progressLedger.load();
    return itemId
      ? (s.items[itemId] && s.items[itemId].spent) || {
          attempts: 0,
          ms: 0,
          tokens: 0,
          tokensUnknown: 0,
          unknownTokens: 0,
        }
      : s.goal;
  }

  block(itemId, reason) {
    return this.progressLedger.block(itemId, reason);
  }

  unblock(itemId) {
    return this.progressLedger.unblock(itemId);
  }
}

module.exports = { RunLedger, maskCredentials, VALID_STAGES, VALID_RETRY_LAYERS, Cause };
