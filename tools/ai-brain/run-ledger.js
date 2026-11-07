'use strict';

/*
 * RunLedger is a thin execution-chain adapter over ProgressLedger (work-guard).
 * Budget ownership and reservation stay in ProgressLedger: admission, caps,
 * attempt counting and goal totals are delegated there. RunLedger only persists
 * writer -> review -> repair links, retry-layer metadata, and goal rollups.
 */

const { ProgressLedger, Cause, fingerprint } = require('./work-guard');
const {
  VALID_STAGES,
  VALID_RETRY_LAYERS,
  assertValidId,
  maskCredentials,
  writeJson,
  computeGoals,
  normalizeAdmit,
  normalizeRecord,
} = require('./run-ledger-helpers');

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
  }

  load() {
    return this.progressLedger.load();
  }

  admit(arg1, arg2, arg3, arg4) {
    const a = normalizeAdmit(arg1, arg2, arg3, arg4);
    const opts = a.opts || a;
    const stage = a.stage;
    const itemId = a.itemId;
    const fp0 = a.fp || a.fingerprint;
    assertValidId(itemId, 'itemId');
    assertValidId(opts.goalId, 'goalId');
    assertValidId(fp0, 'fingerprint');
    const attemptKey = opts.attemptId || opts.jobId ? String(opts.attemptId || opts.jobId) : null;
    const targetItemId = itemId || attemptKey;
    assertValidId(targetItemId, 'itemId');
    if (opts.reserve && !targetItemId) return { ok: false, cause: Cause.NO_PROGRESS };

    const fp =
      fp0 ||
      (opts.headSha
        ? fingerprint({ headSha: opts.headSha, baseSha: opts.baseSha, inputs: opts.inputs })
        : 'att-' + (attemptKey || 'default'));
    assertValidId(fp, 'fingerprint');

    return this.progressLedger.locked(() => {
      this.progressLedger.limits = this.limits;
      const res = this.progressLedger.admitUnlocked(targetItemId || '__goal__', stage, fp, {
        reserve: opts.reserve,
        pid: Number.isInteger(opts.pid) && opts.pid > 0 ? opts.pid : process.pid,
        attemptId: attemptKey,
        goalId: opts.goalId ? String(opts.goalId) : undefined,
      });
      if (!res.ok) return res;
      if (opts.reserve && opts.goalId) {
        const fresh = this.progressLedger.load();
        fresh.goals = computeGoals(fresh.runs, fresh.items);
        writeJson(this.file, fresh);
      }
      return res;
    });
  }

  record(arg1, arg2, arg3) {
    const { stage: st, opts, attemptKey } = normalizeRecord(arg1, arg2, arg3);

    return this.progressLedger.locked(() => {
      this.progressLedger.limits = this.limits;
      let s = this.progressLedger.load();
      let itemId = opts.itemId;
      if (!itemId) {
        const prior = (s.runs || []).find((r) => r.attemptId === attemptKey && r.itemId);
        if (prior) itemId = prior.itemId;
      }
      const targetItemId = String(itemId || attemptKey);
      assertValidId(targetItemId, 'itemId');

      const reviewSha = opts.reviewSha || opts.headSha || null;
      const fp =
        opts.fp ||
        opts.fingerprint ||
        (reviewSha
          ? fingerprint({ headSha: reviewSha, baseSha: opts.baseSha, inputs: opts.inputs })
          : 'att-' + attemptKey);
      assertValidId(fp, 'fingerprint');
      const verdict = String(opts.verdict || opts.outcome || 'DONE');
      const ms = Number(opts.ms) || 0;
      const known = Number.isFinite(opts.tokens);

      const effectiveGoalId =
        opts.goalId ||
        ((s.runs || []).find((r) => r.attemptId === attemptKey && r.goalId) || {}).goalId ||
        null;
      assertValidId(effectiveGoalId, 'goalId');

      const alreadyRecorded = (s.runs || []).some(
        (r) => r.attemptId === attemptKey && r.itemId === targetItemId
      );

      if (verdict === 'IN_FLIGHT') {
        const admitRes = this.progressLedger.admitUnlocked(targetItemId, st, fp, {
          reserve: true,
          pid: Number.isInteger(opts.pid) && opts.pid > 0 ? opts.pid : process.pid,
          attemptId: attemptKey,
          goalId: effectiveGoalId,
          ms,
        });
        if (!admitRes.ok) return admitRes;
      } else {
        const recRes = this.progressLedger.recordUnlocked(targetItemId, st, fp, verdict, {
          ms,
          tokens: known ? opts.tokens : undefined,
          attemptId: attemptKey,
          reuseAttempt: alreadyRecorded,
        });
        if (!recRes.ok) return recRes;
      }

      s = this.progressLedger.load();
      const run = {
        decisionId: opts.decisionId || null,
        jobId: opts.jobId || null,
        attemptId: attemptKey,
        launch: opts.launch !== undefined ? opts.launch : null,
        exit: opts.exit !== undefined ? opts.exit : null,
        reviewSha,
        verdict: opts.verdict || opts.outcome || null,
        stage: st,
        itemId: targetItemId,
        goalId: effectiveGoalId,
        retryLayer: opts.retryLayer || null,
        ms,
        tokens: known ? opts.tokens : 'UNKNOWN',
        tokenEnforcement: known ? opts.tokenEnforcement || 'ENFORCED' : 'UNENFORCED',
        route: maskCredentials(opts.route || opts.routeIdentity || null),
        at: this.now(),
      };
      s.runs = s.runs || [];
      s.runs.push(run);
      s.chains = s.chains || Object.create(null);
      s.chains[targetItemId] = s.chains[targetItemId] || [];
      s.chains[targetItemId].push(run);
      if (s.items && s.items[targetItemId]) s.items[targetItemId].runs = s.chains[targetItemId];
      s.goals = computeGoals(s.runs, s.items);
      writeJson(this.file, s);
      return { ok: true, run };
    });
  }

  getRuns(itemId) {
    const s = this.progressLedger.load();
    if (itemId) return (s.chains && s.chains[itemId]) || [];
    return s.runs || [];
  }

  getChain(itemId) {
    return this.getRuns(itemId);
  }

  getSummary(itemId) {
    const s = this.progressLedger.load();
    if (itemId) {
      return (
        (s.items[itemId] && s.items[itemId].spent) || {
          attempts: 0,
          ms: 0,
          tokens: 0,
          tokensUnknown: 0,
          unknownTokens: 0,
        }
      );
    }
    return s.goal;
  }

  block(itemId, reason) {
    return this.progressLedger.block(itemId, reason);
  }

  unblock(itemId) {
    return this.progressLedger.unblock(itemId);
  }
}

module.exports = { RunLedger, maskCredentials, VALID_STAGES, VALID_RETRY_LAYERS, Cause };
