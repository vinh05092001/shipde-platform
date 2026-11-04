'use strict';

/*
 * RunLedger is a thin execution-chain adapter over ProgressLedger (work-guard).
 * Budget ownership stays in ProgressLedger: admission, caps, attempt counting and
 * goal totals are delegated there. RunLedger only persists writer -> review ->
 * repair links and retry-layer metadata under keys ProgressLedger's validator
 * ignores. Masking uses fast-redact (MIT) with explicit paths and URL parsing.
 */

const fs = require('node:fs');
const path = require('node:path');
const fastRedact = require('fast-redact');
const { ProgressLedger, Cause, fingerprint } = require('./work-guard');

const VALID_STAGES = new Set(['writer', 'reviewer', 'repair', 'fallback', 'review']);
const VALID_RETRY_LAYERS = new Set(['pipeline', 'cli', 'gateway']);
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const SECRET_KEY = /^(api[-_]?key|secret|token|password|passwd|auth|authorization|credential|cookie)$/i;
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
  if (Number.isFinite(lim.tokens) && (spent.tokens || 0) + (spent.unknownTokens || 0) >= lim.tokens) {
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

  settleAll() {
    const s = this.progressLedger.load();
    const pending = s.pending || {};
    for (const [itemId, byAttempt] of Object.entries(pending)) {
      for (const p of Object.values(byAttempt || {})) {
        if (!p || p.inflight) continue;
        this.progressLedger.recordUnlocked(itemId, p.stage, p.fp, p.outcome, {
          ms: p.ms,
          tokens: p.tokensKnown ? p.tokens : undefined,
        });
      }
    }
    const fresh = this.progressLedger.load();
    for (const [itemId, byAttempt] of Object.entries(fresh.pending || {})) {
      for (const [key, p] of Object.entries(byAttempt || {})) {
        if (p && !p.inflight) delete byAttempt[key];
      }
      if (Object.keys(byAttempt || {}).length === 0) delete fresh.pending[itemId];
    }
    if (fresh.pending && Object.keys(fresh.pending).length === 0) delete fresh.pending;
    if (fresh.pending !== undefined || s.pending !== undefined) writeJson(this.file, fresh);
    return fresh;
  }

  admit(arg1, arg2, arg3, arg4) {
    const a = normalizeAdmit(arg1, arg2, arg3, arg4);
    const opts = a.opts || a;
    const stage = a.stage;
    let itemId = a.itemId;
    const fp0 = a.fp || a.fingerprint;
    assertValidId(itemId, 'itemId');
    assertValidId(opts.goalId, 'goalId');
    assertValidId(fp0, 'fingerprint');
    const attemptKey = opts.attemptId || opts.jobId;
    const targetItemId = itemId || (attemptKey ? String(attemptKey) : null);
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
      const s = this.settleAll();
      if (!targetItemId) {
        const over = overLimit(s.goal, this.limits.goal, this.now());
        if (over) return { ok: false, cause: limitCause(over), limit: over };
        return { ok: true };
      }
      return this.progressLedger.admitUnlocked(targetItemId, stage, fp, opts);
    });
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
      (typeof opts.tokens !== 'number' || !Number.isFinite(opts.tokens) || opts.tokens < 0)
    ) {
      throw new Error('RUN_LEDGER_REFUSED: invalid tokens');
    }
    const attemptKey = String(opts.attemptId || opts.jobId);
    assertValidId(opts.itemId, 'itemId');
    assertValidId(opts.goalId, 'goalId');
    assertValidId(opts.fp || opts.fingerprint, 'fingerprint');

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
        (s.runs || []).some(
          (r) => r.attemptId === attemptKey && r.itemId && r.itemId !== itemId
        )
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
      const pending = (s.pending = s.pending || Object.create(null));
      const byItem = (pending[targetItemId] = pending[targetItemId] || Object.create(null));
      const current = byItem[attemptKey];

      if (current) {
        const owner = Object.values(byItem).find(
          (p) => p && p.fp === fp && p.stage === st && p.attemptId !== attemptKey && p.inflight
        );
        if (owner) {
          return { ok: false, cause: Cause.NO_PROGRESS, reason: 'in-flight-owned-by-other-attempt' };
        }
        current.ms += ms;
        if (known) {
          current.tokens = (current.tokens || 0) + opts.tokens;
          current.tokensKnown = true;
        }
        current.outcome = verdict;
        current.inflight = verdict === 'IN_FLIGHT';
      } else {
        const owner = Object.values(byItem).find(
          (p) => p && p.fp === fp && p.stage === st && p.inflight
        );
        if (owner) {
          return { ok: false, cause: Cause.NO_PROGRESS, reason: 'in-flight-owned-by-other-attempt' };
        }
        s = this.settleAll();
        const item = s.items && s.items[targetItemId];
        const rec = item && item.stages && item.stages[st] && item.stages[st].fps[fp];
        if (!rec || rec.outcome !== 'IN_FLIGHT') {
          const res = this.progressLedger.admitUnlocked(targetItemId, st, fp, {
            reserve: true,
            pid:
              Number.isInteger(opts.pid) && opts.pid > 0
                ? opts.pid
                : this.progressLedger.lastPid || process.pid,
          });
          if (!res.ok) return res;
        }
        s = this.progressLedger.load();
        const pend = (s.pending = s.pending || Object.create(null));
        const itemPend = (pend[targetItemId] = pend[targetItemId] || Object.create(null));
        itemPend[attemptKey] = {
          attemptId: attemptKey,
          stage: st,
          fp,
          ms,
          tokens: known ? opts.tokens : 0,
          tokensKnown: known,
          outcome: verdict,
          inflight: verdict === 'IN_FLIGHT',
        };
      }

      s = this.progressLedger.load();
      const effectiveGoalId =
        opts.goalId ||
        ((s.runs || []).find((r) => r.attemptId === attemptKey && r.goalId) || {}).goalId ||
        null;
      assertValidId(effectiveGoalId, 'goalId');
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
      s.goals = computeGoals(s.runs);
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
    return this.progressLedger.locked(() => {
      const s = this.settleAll();
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
    });
  }

  block(itemId, reason) {
    return this.progressLedger.block(itemId, reason);
  }

  unblock(itemId) {
    return this.progressLedger.unblock(itemId);
  }
}

module.exports = { RunLedger, maskCredentials, VALID_STAGES, VALID_RETRY_LAYERS, Cause };
