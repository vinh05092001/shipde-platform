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
  findReservation,
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
      });
      if (!res.ok) return res;
      if (opts.reserve && targetItemId) {
        const fresh = this.progressLedger.load();
        const entry = fresh.items?.[targetItemId]?.stages?.[stage]?.fps?.[fp];
        if (entry) {
          if (attemptKey) entry.attemptId = attemptKey;
          if (opts.goalId) entry.goalId = String(opts.goalId);
          fresh.goals = computeGoals(fresh.runs, fresh.items);
          writeJson(this.file, fresh);
        }
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
      if (
        itemId &&
        (s.runs || []).some((r) => r.attemptId === attemptKey && r.itemId && r.itemId !== itemId)
      ) {
        return { ok: false, cause: Cause.NO_PROGRESS, reason: 'attempt-owned-by-other-item' };
      }

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

      const it = s.items[targetItemId] || {};
      const stages = it.stages || {};

      const found = findReservation(stages, attemptKey);
      let reservedStage = found ? found.stage : null;
      let reservedFp = found ? found.fp : null;
      let reservedEntry = found ? found.entry : null;

      const targetEntry = stages[st]?.fps?.[fp];
      if (targetEntry && targetEntry.outcome === 'IN_FLIGHT') {
        if (targetEntry.attemptId && targetEntry.attemptId !== attemptKey) {
          return {
            ok: false,
            cause: Cause.NO_PROGRESS,
            reason: 'in-flight-owned-by-other-attempt',
          };
        }
        if (!reservedEntry || reservedStage !== st || reservedFp !== fp) {
          reservedStage = st;
          reservedFp = fp;
          reservedEntry = targetEntry;
        }
      }

      if (reservedEntry && (reservedStage !== st || reservedFp !== fp)) {
        delete stages[reservedStage].fps[reservedFp];
        if (Object.keys(stages[reservedStage].fps).length === 0) {
          delete stages[reservedStage];
        }
        stages[st] = stages[st] || { fps: {} };
        stages[st].fps[fp] = reservedEntry;
        writeJson(this.file, s);
      }

      const effectiveGoalId =
        opts.goalId ||
        reservedEntry?.goalId ||
        ((s.runs || []).find((r) => r.attemptId === attemptKey && r.goalId) || {}).goalId ||
        null;
      assertValidId(effectiveGoalId, 'goalId');

      const alreadyRecorded = (s.runs || []).some(
        (r) => r.attemptId === attemptKey && r.itemId === targetItemId
      );

      if (verdict === 'IN_FLIGHT') {
        if (!stages[st]?.fps?.[fp] || stages[st].fps[fp].outcome !== 'IN_FLIGHT') {
          const admitRes = this.progressLedger.admitUnlocked(targetItemId, st, fp, {
            reserve: true,
            pid: Number.isInteger(opts.pid) && opts.pid > 0 ? opts.pid : process.pid,
          });
          if (!admitRes.ok) return admitRes;
        }
        s = this.progressLedger.load();
        const ent = s.items[targetItemId].stages[st].fps[fp];
        ent.attemptId = attemptKey;
        if (effectiveGoalId) ent.goalId = effectiveGoalId;
        if (ms > 0) {
          s.items[targetItemId].spent.ms += ms;
          s.goal.ms += ms;
        }
        writeJson(this.file, s);
      } else {
        if (alreadyRecorded) {
          const priorVerdict = stages[st]?.fps?.[fp]?.outcome || 'DONE';
          const finalVerdict = opts.verdict || opts.outcome || priorVerdict;
          stages[st] = stages[st] || { fps: {} };
          stages[st].fps[fp] = Object.assign({}, stages[st].fps[fp], {
            outcome: 'IN_FLIGHT',
            pid: process.pid,
            at: this.now(),
            imputedTokens: 0,
            attemptId: attemptKey,
          });
          writeJson(this.file, s);
          this.progressLedger.recordUnlocked(targetItemId, st, fp, finalVerdict, {
            ms,
            tokens: known ? opts.tokens : undefined,
          });
        } else if (!reservedEntry) {
          const admitRes = this.progressLedger.admitUnlocked(targetItemId, st, fp, {
            reserve: true,
            pid: Number.isInteger(opts.pid) && opts.pid > 0 ? opts.pid : process.pid,
          });
          if (!admitRes.ok) return admitRes;
          this.progressLedger.recordUnlocked(targetItemId, st, fp, verdict, {
            ms,
            tokens: known ? opts.tokens : undefined,
          });
        } else {
          this.progressLedger.recordUnlocked(targetItemId, st, fp, verdict, {
            ms,
            tokens: known ? opts.tokens : undefined,
          });
        }
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
