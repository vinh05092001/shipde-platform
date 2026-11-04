'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ProgressLedger, Cause, fingerprint } = require('./work-guard');

const VALID_STAGES = new Set(['writer', 'reviewer', 'repair', 'fallback', 'review']);
const VALID_RETRY_LAYERS = new Set(['pipeline', 'cli', 'gateway']);

function isForbiddenId(id) {
  if (!id || typeof id !== 'string') return false;
  return id in Object.prototype || id === 'prototype';
}

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
      for (const [k] of [...u.searchParams.entries()]) {
        if (/key|secret|token|password|auth|credential/i.test(k)) {
          u.searchParams.set(k, '[REDACTED]');
        }
      }
      let res = u.toString().replace(/%5BREDACTED%5D/g, '[REDACTED]');
      if (!s.endsWith('/') && res.endsWith('/')) res = res.slice(0, -1);
      if (sm) res = res.replace(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//, sm[1]);
      return res;
    } catch (_) {
      let res = s.replace(/([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)[^@/\s]*@/gi, '$1');
      res = res.replace(
        /([?&](?:[^=&#\s]*?(?:key|secret|token|password|auth|credential)[^=&#\s]*)=)[^&#\s]*/gi,
        '$1[REDACTED]'
      );
      return res;
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
    if (itemId && isForbiddenId(itemId)) {
      throw new Error('RUN_LEDGER_REFUSED: invalid itemId ' + itemId);
    }
    if (opts && opts.goalId && isForbiddenId(opts.goalId)) {
      throw new Error('RUN_LEDGER_REFUSED: invalid goalId ' + opts.goalId);
    }
    const rawAdmitFp = fp || (opts && (opts.fp || opts.fingerprint));
    if (rawAdmitFp && isForbiddenId(rawAdmitFp)) {
      throw new Error('RUN_LEDGER_REFUSED: invalid fingerprint ' + rawAdmitFp);
    }
    this.progressLedger.limits = this.limits;
    const attemptKey = opts.attemptId || opts.jobId;
    const actualFp =
      fp ||
      (opts.headSha
        ? fingerprint({ headSha: opts.headSha, baseSha: opts.baseSha, inputs: opts.inputs })
        : 'att-' + (attemptKey || ''));

    if (itemId && stage) {
      const res = this.progressLedger.admit(itemId, stage, actualFp, opts);
      if (res && res.ok && opts.reserve) {
        this.progressLedger.locked(() => {
          const s = this.progressLedger.load();
          const it = s.items && s.items[itemId];
          const stObj = it && it.stages && it.stages[stage];
          const cur = stObj && stObj.fps && stObj.fps[actualFp];
          if (cur && attemptKey) cur.attemptId = attemptKey;
          if (opts.goalId) {
            if (cur && cur.goalId === opts.goalId) return;
            const itemGoalAttemptsInRuns = new Set(
              (s.runs || [])
                .filter((r) => r.goalId === opts.goalId && r.itemId === itemId && r.attemptId)
                .map((r) => r.attemptId)
            ).size;
            const itemSpentAttempts = (it && it.spent && it.spent.attempts) || 0;
            if (itemGoalAttemptsInRuns >= itemSpentAttempts) return;
            if (cur) cur.goalId = opts.goalId;
            s.goals = s.goals || Object.create(null);
            const gAcc = (Object.hasOwn(s.goals, opts.goalId) && s.goals[opts.goalId]) || {
              attempts: 0,
              ms: 0,
              tokens: 0,
              tokensUnknown: 0,
              unknownTokens: 0,
            };
            gAcc.attempts = (gAcc.attempts || 0) + 1;
            const completionRuns =
              cur && cur.outcome !== 'IN_FLIGHT'
                ? (s.runs || []).filter(
                    (r) =>
                      r.itemId === itemId &&
                      r.stage === stage &&
                      (!r.goalId || r.goalId === null) &&
                      (cur.attemptId
                        ? r.attemptId === cur.attemptId
                        : attemptKey
                          ? r.attemptId === attemptKey
                          : false)
                  )
                : [];
            for (const completionRun of completionRuns) {
              completionRun.goalId = opts.goalId;
              if (Number.isFinite(completionRun.ms)) {
                gAcc.ms = (gAcc.ms || 0) + completionRun.ms;
              }
              if (Number.isFinite(completionRun.tokens)) {
                gAcc.tokens = (gAcc.tokens || 0) + completionRun.tokens;
              } else if (completionRun.tokens === 'UNKNOWN') {
                gAcc.tokensUnknown = (gAcc.tokensUnknown || 0) + 1;
              }
              if (s.chains && s.chains[itemId]) {
                for (const r of s.chains[itemId]) {
                  if (r.attemptId === completionRun.attemptId && (!r.goalId || r.goalId === null)) {
                    r.goalId = opts.goalId;
                  }
                }
              }
              if (it && it.runs) {
                for (const r of it.runs) {
                  if (r.attemptId === completionRun.attemptId && (!r.goalId || r.goalId === null)) {
                    r.goalId = opts.goalId;
                  }
                }
              }
            }
            s.goals[opts.goalId] = gAcc;
          }
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
    if (itemId && isForbiddenId(itemId)) {
      throw new Error('RUN_LEDGER_REFUSED: invalid itemId ' + itemId);
    }
    if (opts.goalId && isForbiddenId(opts.goalId)) {
      throw new Error('RUN_LEDGER_REFUSED: invalid goalId ' + opts.goalId);
    }
    const rawFp = opts.fp || opts.fingerprint;
    if (rawFp && isForbiddenId(rawFp)) {
      throw new Error('RUN_LEDGER_REFUSED: invalid fingerprint ' + rawFp);
    }

    return this.progressLedger.locked(() => {
      this.progressLedger.limits = this.limits;
      const s = this.progressLedger.load();

      if (!itemId && attemptKey && s.runs) {
        const priorRun = s.runs.find((r) => r.attemptId === attemptKey && r.itemId);
        if (priorRun) itemId = priorRun.itemId;
      }

      const targetItemId = itemId || attemptKey;
      if (isForbiddenId(targetItemId)) {
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
      let fp =
        opts.fp ||
        opts.fingerprint ||
        (runReviewSha
          ? fingerprint({ headSha: runReviewSha, baseSha: opts.baseSha, inputs: opts.inputs })
          : 'att-' + attemptKey);
      if (isForbiddenId(fp)) {
        throw new Error('RUN_LEDGER_REFUSED: invalid fingerprint ' + fp);
      }

      const it = (Object.hasOwn(s.items, targetItemId) && s.items[targetItemId]) || null;
      let prev = it && it.stages && it.stages[st] && it.stages[st].fps && it.stages[st].fps[fp];
      let prevStage = prev ? st : null;
      let prevFp = prev ? fp : null;
      if (!prev && it && it.stages) {
        if (opts.fp || opts.fingerprint) {
          for (const [sName, stageObj] of Object.entries(it.stages)) {
            if (stageObj && stageObj.fps && Object.hasOwn(stageObj.fps, fp)) {
              const rec = stageObj.fps[fp];
              if (
                rec &&
                rec.outcome === 'IN_FLIGHT' &&
                (!rec.attemptId || rec.attemptId === attemptKey)
              ) {
                prev = rec;
                prevStage = sName;
                prevFp = fp;
                break;
              }
            }
          }
        } else {
          if (it.stages[st] && it.stages[st].fps) {
            for (const [existingFp, rec] of Object.entries(it.stages[st].fps)) {
              if (
                rec &&
                rec.outcome === 'IN_FLIGHT' &&
                (rec.attemptId === attemptKey || existingFp === '__probe__' + attemptKey)
              ) {
                prev = rec;
                prevStage = st;
                prevFp = existingFp;
                fp = existingFp;
                break;
              }
            }
          }
          if (!prev) {
            for (const [sName, stageObj] of Object.entries(it.stages)) {
              if (sName !== st && stageObj && stageObj.fps) {
                for (const [existingFp, rec] of Object.entries(stageObj.fps)) {
                  if (
                    rec &&
                    rec.outcome === 'IN_FLIGHT' &&
                    (rec.attemptId === attemptKey || existingFp === '__probe__' + attemptKey)
                  ) {
                    prev = rec;
                    prevStage = sName;
                    prevFp = existingFp;
                    fp = existingFp;
                    break;
                  }
                }
                if (prev) break;
              }
            }
          }
        }
      }
      const reserved = Boolean(
        prev &&
        prev.outcome === 'IN_FLIGHT' &&
        Number.isInteger(prev.pid) &&
        (!prev.attemptId || prev.attemptId === attemptKey)
      );

      const isExistingAttempt = (s.runs || []).some(
        (r) => r.attemptId === attemptKey && (!itemId || r.itemId === itemId)
      );

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

      const isReservedFlight =
        prev &&
        prev.outcome === 'IN_FLIGHT' &&
        prev.attemptId &&
        !(s.runs || []).some((r) => r.attemptId === prev.attemptId);

      if (prev && prev.outcome === 'IN_FLIGHT' && !reserved) {
        if (runVerdict !== 'IN_FLIGHT' || isReservedFlight) {
          return {
            ok: false,
            cause: Cause.NO_PROGRESS,
            reason: 'in-flight-owned-by-other-attempt',
          };
        }
      }

      const effectiveGoalId =
        opts.goalId ||
        (prev && prev.goalId) ||
        ((s.runs || []).find((r) => r.attemptId === attemptKey && r.goalId) || {}).goalId ||
        null;
      if (effectiveGoalId && isForbiddenId(effectiveGoalId)) {
        throw new Error('RUN_LEDGER_REFUSED: invalid goalId ' + effectiveGoalId);
      }

      if (prevStage && prevStage !== st) {
        const curState = this.progressLedger.load();
        const curIt = curState.items && curState.items[targetItemId];
        if (curIt && curIt.stages && curIt.stages[prevStage] && curIt.stages[prevStage].fps) {
          const reservation = curIt.stages[prevStage].fps[prevFp];
          delete curIt.stages[prevStage].fps[prevFp];
          curIt.stages[st] = curIt.stages[st] || { fps: {} };
          curIt.stages[st].fps = curIt.stages[st].fps || {};
          curIt.stages[st].fps[fp] = reservation;
          writeJson(this.file, curState);
        }
      }

      if (!isExistingAttempt) {
        if (runVerdict === 'IN_FLIGHT') {
          const perAttemptTokens =
            this.limits.item && this.limits.item.tokens ? this.limits.item.tokens : 0;
          const curState = this.progressLedger.load();
          const curIt = (Object.hasOwn(curState.items, targetItemId) &&
            curState.items[targetItemId]) || {
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
            if (consumesAttempt) acc.attempts = (acc.attempts || 0) + 1;
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
          if (effectiveGoalId) curSt.fps[fp].goalId = effectiveGoalId;
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
            if (effectiveGoalId) curFp.goalId = effectiveGoalId;
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
          } else {
            curIt.spent.tokensUnknown = (curIt.spent.tokensUnknown || 0) + 1;
            curState.goal.tokensUnknown = (curState.goal.tokensUnknown || 0) + 1;
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
          const curPid =
            Number.isInteger(opts.pid) && opts.pid > 0
              ? opts.pid
              : Number.isInteger(prev && prev.pid) && prev.pid > 0
                ? prev.pid
                : process.pid;
          curSt.fps[fp] = {
            outcome: runVerdict,
            attemptId: attemptKey,
            at: this.now(),
            imputedTokens: hasTokens ? 0 : 0,
            ...(runVerdict === 'IN_FLIGHT' ? { pid: curPid } : {}),
          };
          if (effectiveGoalId) curSt.fps[fp].goalId = effectiveGoalId;
          curIt.stages[st] = curSt;
          writeJson(this.file, curState);
        }
      }

      const updatedState = this.progressLedger.load();

      if (effectiveGoalId) {
        updatedState.goals = updatedState.goals
          ? Object.assign(Object.create(null), updatedState.goals)
          : Object.create(null);
        const gAcc = (Object.hasOwn(updatedState.goals, effectiveGoalId) &&
          updatedState.goals[effectiveGoalId]) || {
          attempts: 0,
          ms: 0,
          tokens: 0,
          tokensUnknown: 0,
          unknownTokens: 0,
        };
        const goalAlreadyCharged =
          Boolean(reserved && prev && prev.goalId === effectiveGoalId) ||
          (updatedState.runs || []).some(
            (r) => r.attemptId === attemptKey && r.goalId === effectiveGoalId
          );
        if (!goalAlreadyCharged) gAcc.attempts = (gAcc.attempts || 0) + 1;
        gAcc.ms = (gAcc.ms || 0) + ms;
        if (hasTokens) gAcc.tokens = (gAcc.tokens || 0) + tokens;
        else gAcc.tokensUnknown = (gAcc.tokensUnknown || 0) + 1;
        updatedState.goals[effectiveGoalId] = gAcc;
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
        goalId: effectiveGoalId,
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
