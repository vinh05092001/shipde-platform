'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ProgressLedger, Cause, fingerprint } = require('./work-guard');

const VALID_STAGES = new Set(['writer', 'reviewer', 'repair', 'fallback', 'review']);
const VALID_RETRY_LAYERS = new Set(['pipeline', 'cli', 'gateway']);

function maskCredentials(v) {
  if (!v) return v;
  if (typeof v === 'string') {
    // Strip the whole userinfo section: a credential may sit in the username as well
    // as in the password, so masking only the password would persist the username one.
    // Use new URL() first (handles any scheme case); fall back to a case-insensitive
    // regex for strings that look like URLs but cannot be parsed.
    const masked = v.replace(/(sk-[a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]+/g, '$1***');
    return masked.replace(/([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)[^@/\s]*@/gi, '$1');
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
    if (opts.reserve) {
      const actualFp =
        fp ||
        opts.fp ||
        opts.fingerprint ||
        (opts.headSha
          ? fingerprint({ headSha: opts.headSha, baseSha: opts.baseSha, inputs: opts.inputs })
          : null);
      if (itemId && stage && actualFp) {
        this.progressLedger.limits = this.limits;
        const res = this.progressLedger.admit(itemId, stage, actualFp, opts);
        if (res && res.ok && opts.goalId) {
          this.progressLedger.locked(() => {
            const s = this.progressLedger.load();
            const it = s.items && s.items[itemId];
            const stObj = it && it.stages && it.stages[stage];
            const cur = stObj && stObj.fps && stObj.fps[actualFp];
            // If the goal was already charged to this entry (either this call set it
            // or a concurrent record already set it), just persist and return.
            if (cur && cur.goalId === opts.goalId) {
              writeJson(this.file, s);
              return;
            }
            // No fp entry: the admission may have been reconciled away; nothing to charge.
            if (!cur) {
              writeJson(this.file, s);
              return;
            }
            // Annotate the fp entry with the goalId regardless of its outcome, so
            // subsequent calls won't double-charge.
            cur.goalId = opts.goalId;
            s.goals = s.goals || {};
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
    return this.progressLedger.locked(() => {
      const s = this.progressLedger.load();
      const attemptKey = opts.attemptId || opts.jobId;
      let itemId = opts.itemId;
      if (!itemId && attemptKey && s.runs) {
        const priorRun = s.runs.find((r) => r.attemptId === attemptKey && r.itemId);
        if (priorRun) itemId = priorRun.itemId;
      }
      // A placeholder is an item created from this attempt alone with no explicit
      // itemId in any prior run that named it. A real item named by jobId that
      // holds only other attempts is not a placeholder; migrating it would
      // transfer another item's budget and chain on an identifier coincidence.
      const isPlaceholder = (key) => {
        const cand = key && Object.hasOwn(s.items, key) ? s.items[key] : null;
        if (!cand) return false;
        const keys = Object.keys(cand.seenAttempts || {});
        const chain = (cand.runs || []).map((r) => r.attemptId);
        // If any global run or any item run explicitly names this key as its itemId,
        // then it is an established item, not a placeholder created from an attempt key.
        const namedExplicitly = (s.runs || []).some((r) => r.itemId === key);
        return (
          !namedExplicitly &&
          (keys.length === 0 || (keys.length === 1 && keys[0] === attemptKey)) &&
          chain.every((a) => a === attemptKey)
        );
      };
      const prevPlaceholderKey =
        itemId &&
        ((opts.attemptId !== itemId && opts.attemptId && isPlaceholder(opts.attemptId)
          ? opts.attemptId
          : null) ||
          (opts.jobId !== itemId && opts.jobId && isPlaceholder(opts.jobId) ? opts.jobId : null));
      if (prevPlaceholderKey && Object.hasOwn(s.items, prevPlaceholderKey)) {
        const placeholder = s.items[prevPlaceholderKey];
        delete s.items[prevPlaceholderKey];
        if (!Object.hasOwn(s.items, itemId)) {
          s.items[itemId] = placeholder;
        } else {
          const dest = s.items[itemId];
          dest.spent = dest.spent || {
            attempts: 0,
            ms: 0,
            tokens: 0,
            tokensUnknown: 0,
            unknownTokens: 0,
          };
          const plSpent = placeholder.spent || {};
          for (const k of ['attempts', 'ms', 'tokens', 'tokensUnknown', 'unknownTokens']) {
            dest.spent[k] = (dest.spent[k] || 0) + (plSpent[k] || 0);
          }
          dest.stages = dest.stages || {};
          for (const [stName, stData] of Object.entries(placeholder.stages || {})) {
            dest.stages[stName] = dest.stages[stName] || { fps: {} };
            dest.stages[stName].fps = Object.assign(
              dest.stages[stName].fps || {},
              stData.fps || {}
            );
          }
          dest.seenAttempts = Object.assign(
            dest.seenAttempts || {},
            placeholder.seenAttempts || {}
          );
          dest.runs = (dest.runs || []).concat(placeholder.runs || []);
        }
        for (const r of s.items[itemId].runs || []) {
          if (r.attemptId === attemptKey) r.itemId = itemId;
        }
        for (const r of s.runs || []) {
          if (r.attemptId === attemptKey) r.itemId = itemId;
        }
      }

      const itemKey = itemId || attemptKey;
      const it = (itemKey && Object.hasOwn(s.items, itemKey) && s.items[itemKey]) || {
        spent: { attempts: 0, ms: 0, tokens: 0, tokensUnknown: 0, unknownTokens: 0 },
        stages: {},
      };
      it.spent = it.spent || {
        attempts: 0,
        ms: 0,
        tokens: 0,
        tokensUnknown: 0,
        unknownTokens: 0,
      };
      it.spent.attempts = it.spent.attempts || 0;
      it.spent.ms = it.spent.ms || 0;
      it.spent.tokens = it.spent.tokens || 0;
      it.spent.tokensUnknown = it.spent.tokensUnknown || 0;
      it.spent.unknownTokens = it.spent.unknownTokens || 0;
      it.stages = it.stages || {};
      it.seenAttempts = it.seenAttempts || {};
      s.seenAttempts = s.seenAttempts || {};

      s.goal = s.goal || {
        attempts: 0,
        ms: 0,
        tokens: 0,
        tokensUnknown: 0,
        unknownTokens: 0,
      };
      s.goal.attempts = s.goal.attempts || 0;
      s.goal.ms = s.goal.ms || 0;
      s.goal.tokens = s.goal.tokens || 0;
      s.goal.tokensUnknown = s.goal.tokensUnknown || 0;
      s.goal.unknownTokens = s.goal.unknownTokens || 0;

      const isNew =
        !Object.hasOwn(it.seenAttempts, attemptKey) && !Object.hasOwn(s.seenAttempts, attemptKey);
      // The attempt is already charged to another item: charging it here as well would
      // either double the budget or leave this item's attempts below its own records.
      if (!isNew && itemId) {
        const owner = Object.keys(s.items || {}).find(
          (k) =>
            k !== itemId && Object.hasOwn((s.items[k] && s.items[k].seenAttempts) || {}, attemptKey)
        );
        if (owner)
          return { ok: false, cause: Cause.NO_PROGRESS, reason: 'attempt-owned-by-other-item' };
      }

      const runReviewSha = opts.reviewSha || opts.headSha || null;
      const fp =
        opts.fp ||
        opts.fingerprint ||
        (runReviewSha
          ? fingerprint({ headSha: runReviewSha, baseSha: opts.baseSha, inputs: opts.inputs })
          : attemptKey
            ? 'att-' + attemptKey
            : 'fp-' + ((s.runs && s.runs.length) || 0));
      const prev = ((it.stages[st] || {}).fps || {})[fp];
      const reserved = Boolean(
        prev &&
        prev.outcome === 'IN_FLIGHT' &&
        Number.isInteger(prev.pid) &&
        (!prev.attemptId || prev.attemptId === attemptKey)
      );

      const consumesAttempt = isNew && !reserved;

      if (it.blocked) return { ok: false, cause: Cause.ITEM_BLOCKED, reason: it.blocked };
      const over = exceeded(s.goal, this.limits.goal, { ignoreAttempts: !consumesAttempt });
      if (over) return { ok: false, cause: Cause.GOAL_EXHAUSTED, limit: over };
      const own = exceeded(it.spent, this.limits.item, { ignoreAttempts: !consumesAttempt });
      if (own) return { ok: false, cause: limitCause(own), limit: own };

      Object.defineProperty(it.seenAttempts, attemptKey, {
        value: true,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(s.seenAttempts, attemptKey, {
        value: true,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      const ms = Number(opts.ms) || 0;
      const hasTokens = Number.isFinite(opts.tokens);
      const tokens = hasTokens ? opts.tokens : 'UNKNOWN';
      const tokenEnforcement = hasTokens ? opts.tokenEnforcement || 'ENFORCED' : 'UNENFORCED';
      const prevImputed = prev && prev.imputedTokens !== undefined ? Number(prev.imputedTokens) : 0;
      const prevHasKnownTokens = Boolean(
        (prev && prev.hasTokens) ||
        (prev &&
          (s.runs || []).some((r) => r.attemptId === attemptKey && Number.isFinite(r.tokens)))
      );
      const prevHasUnknownCredit = Boolean(reserved && !prevHasKnownTokens);
      for (const acc of [it.spent, s.goal]) {
        if (consumesAttempt) acc.attempts += 1;
        acc.ms += ms;
        if (hasTokens) {
          acc.tokens += tokens;
          if (prevHasUnknownCredit) {
            acc.unknownTokens = Math.max(0, (acc.unknownTokens || 0) - prevImputed);
            acc.tokensUnknown = Math.max(0, (acc.tokensUnknown || 0) - 1);
          }
        } else {
          if (!prevHasUnknownCredit) {
            acc.tokensUnknown = (acc.tokensUnknown || 0) + 1;
          }
        }
      }
      if (opts.goalId) {
        s.goals = s.goals || {};
        const gAcc = s.goals[opts.goalId] || {
          attempts: 0,
          ms: 0,
          tokens: 0,
          tokensUnknown: 0,
          unknownTokens: 0,
        };
        gAcc.attempts = gAcc.attempts || 0;
        gAcc.ms = gAcc.ms || 0;
        gAcc.tokens = gAcc.tokens || 0;
        gAcc.tokensUnknown = gAcc.tokensUnknown || 0;
        gAcc.unknownTokens = gAcc.unknownTokens || 0;
        // Charged when the item was first charged to this goal (a reservation admitted
        // under it) or the item charged it later (a run already recorded for it). A
        // retry that only now names the goal counts the existing attempt once here.
        const goalAlreadyCharged =
          Boolean(reserved && prev && prev.goalId === opts.goalId) ||
          (s.runs || []).some((r) => r.attemptId === attemptKey && r.goalId === opts.goalId);
        if (!goalAlreadyCharged) gAcc.attempts += 1;
        gAcc.ms += ms;
        if (hasTokens) gAcc.tokens += tokens;
        else gAcc.tokensUnknown = (gAcc.tokensUnknown || 0) + 1;
        s.goals[opts.goalId] = gAcc;
      }
      const run = {
        decisionId: opts.decisionId || null,
        jobId: opts.jobId || null,
        attemptId: opts.attemptId || opts.jobId || null,
        launch: opts.launch !== undefined ? opts.launch : null,
        exit: opts.exit !== undefined ? opts.exit : null,
        reviewSha: runReviewSha,
        verdict: opts.verdict || opts.outcome || null,
        stage: st,
        itemId: itemId || null,
        goalId: opts.goalId || null,
        retryLayer: opts.retryLayer || null,
        ms,
        tokens,
        tokenEnforcement,
        route: maskCredentials(opts.route || opts.routeIdentity || null),
        at: this.now(),
      };
      s.runs = s.runs || [];
      s.runs.push(run);
      it.runs = it.runs || [];
      it.runs.push(run);
      it.stages[st] = it.stages[st] || { fps: {} };
      it.stages[st].fps = it.stages[st].fps || {};
      if (!isNew) {
        for (const stageObj of Object.values(it.stages)) {
          if (stageObj && stageObj.fps) {
            for (const [oldFp, rec] of Object.entries(stageObj.fps)) {
              if (rec && rec.attemptId === attemptKey) {
                delete stageObj.fps[oldFp];
              }
            }
          }
        }
      }
      const runVerdict = String(run.verdict || 'DONE');
      const fpsRecord = {
        outcome: runVerdict,
        attemptId: attemptKey,
        at: this.now(),
      };
      if (runVerdict === 'IN_FLIGHT') {
        fpsRecord.pid =
          Number.isInteger(opts.pid) && opts.pid > 0
            ? opts.pid
            : prev && Number.isInteger(prev.pid) && prev.pid > 0
              ? prev.pid
              : process.pid;
        fpsRecord.imputedTokens =
          opts.imputedTokens !== undefined &&
          Number.isFinite(opts.imputedTokens) &&
          opts.imputedTokens >= 0
            ? opts.imputedTokens
            : prev && prev.imputedTokens !== undefined && Number.isFinite(prev.imputedTokens)
              ? prev.imputedTokens
              : 0;
        fpsRecord.hasTokens = hasTokens;
      } else if (reserved && prev && prev.imputedTokens !== undefined) {
        fpsRecord.imputedTokens = hasTokens ? 0 : prev.imputedTokens;
      }
      if (opts.goalId) {
        fpsRecord.goalId = opts.goalId;
      }
      it.stages[st].fps[fp] = fpsRecord;
      if (itemKey) {
        // Use Object.defineProperty so that a key like '__proto__' creates an own
        // property instead of mutating the object's prototype.
        Object.defineProperty(s.items, itemKey, {
          value: it,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      writeJson(this.file, s);
      return { ok: true, run };
    });
  }

  getRuns(itemId) {
    const s = this.progressLedger.load();
    return (itemId ? s.items[itemId] && s.items[itemId].runs : s.runs) || [];
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
