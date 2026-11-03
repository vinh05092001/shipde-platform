'use strict';

/**
 * Ship Dễ — Work guard: stop no-progress loops before they spend tokens.
 *
 * Repository-agnostic. Every path, id pattern and limit is supplied by the
 * caller; nothing here knows about Ship Dễ items or a particular checkout.
 *
 *   checkWorkspace   the cwd is the expected checkout, on a branch that belongs
 *                    to the Work Item, before launch, push or review.
 *   ProgressLedger   per-item, per-stage fingerprint of (headSha, baseSha,
 *                    inputs). The same fingerprint is not run twice unless the
 *                    previous outcome was transient. Attempts, wall time and
 *                    tokens are capped per item and per goal. A blocked item
 *                    is blocked alone; independent items keep running.
 *   acquireLock      atomic create; only the owner (same jobId) releases. A
 *                    lock is stale only when its owner pid is provably dead,
 *                    never by age alone.
 *   acceptResult     a lane result counts only when its jobId matches the job.
 *   runWithCleanup   cleanup never replaces the real exit code.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const Cause = Object.freeze({
  CWD_MISMATCH: 'CWD_MISMATCH',
  NOT_A_CHECKOUT: 'NOT_A_CHECKOUT',
  CONFLICT_UNKNOWN: 'CONFLICT_INSPECTION_FAILED',
  DETACHED_HEAD: 'DETACHED_HEAD',
  WRONG_BRANCH: 'WRONG_BRANCH',
  CONFLICT: 'MERGE_CONFLICT',
  NO_PROGRESS: 'NO_PROGRESS_SAME_INPUT',
  ITEM_BLOCKED: 'ITEM_BLOCKED',
  ATTEMPTS_EXHAUSTED: 'ATTEMPT_BUDGET_EXHAUSTED',
  TIME_EXHAUSTED: 'TIME_BUDGET_EXHAUSTED',
  TOKENS_EXHAUSTED: 'TOKEN_BUDGET_EXHAUSTED',
  GOAL_EXHAUSTED: 'GOAL_BUDGET_EXHAUSTED',
  LOCK_HELD: 'LOCK_HELD',
  LOCK_NOT_OWNER: 'LOCK_NOT_OWNER',
  JOB_MISMATCH: 'JOB_ID_MISMATCH',
  JOB_UNBOUND: 'JOB_ID_UNBOUND',
});

// Outcomes after which the same input may be tried again: the failure was in
// the environment, not in the work, so the input is not proven unproductive.
const TRANSIENT = new Set(['TIMEOUT', 'RATE_LIMIT', 'NETWORK', 'LAUNCH_FAILED', 'NOT_ATTEMPTED']);

// Paths only compare case-insensitively where the filesystem does. Probing the
// filesystem via inode matching establishes the actual semantics on disk (handling
// both case-sensitive and default case-insensitive APFS on macOS).
// WORK_GUARD_CASE_INSENSITIVE=1/0 overrides with the caller's explicit fact.
function probeCaseInsensitive(p) {
  try {
    let cur = path.resolve(String(p));
    while (cur) {
      if (fs.existsSync(cur)) {
        const base = path.basename(cur);
        if (base && /[a-zA-Z]/.test(base)) {
          const toggled = base.replace(/[a-zA-Z]/, (c) =>
            c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()
          );
          const alt = path.join(path.dirname(cur), toggled);
          try {
            const s1 = fs.statSync(cur);
            const s2 = fs.statSync(alt);
            return s1.dev === s2.dev && s1.ino === s2.ino;
          } catch (e) {
            if (e && e.code === 'ENOENT') return false;
          }
        }
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  } catch (_) {}
  return null;
}

function caseInsensitiveFs(p) {
  const forced = process.env.WORK_GUARD_CASE_INSENSITIVE;
  if (forced === '0' || forced === 'false') return false;
  if (forced === '1' || forced === 'true') return true;
  if (p) {
    const probed = probeCaseInsensitive(p);
    if (typeof probed === 'boolean') return probed;
  }
  return process.platform === 'win32';
}

function norm(p) {
  const abs = path.resolve(String(p)).replace(/\\/g, '/');
  // A root such as 'C:\' keeps its one trailing slash; /+ would strip it into 'C:'.
  const trimmed = abs.length > 1 ? abs.replace(/\/+$/, '') || '/' : abs;
  return caseInsensitiveFs(p) ? trimmed.toLowerCase() : trimmed;
}

/**
 * @param o {
 *   cwd, expectedRoot?, workItemId, branchPattern? (RegExp; default: branch
 *   contains the lowercase id), git(args[], cwd) -> { status, stdout }
 * }
 */
function checkWorkspace(o) {
  const git = o.git;
  if (typeof git !== 'function') throw new Error('WORK_GUARD_REFUSED: missing git');
  const top = git(['rev-parse', '--show-toplevel'], o.cwd);
  if (!top || top.status !== 0) return { ok: false, cause: Cause.NOT_A_CHECKOUT };
  const root = String(top.stdout).trim();
  if (o.expectedRoot && norm(root) !== norm(o.expectedRoot)) {
    return { ok: false, cause: Cause.CWD_MISMATCH, root };
  }
  // An inspection that did not succeed proves nothing. Only a successful `git diff`
  // with an empty name list proves "no unmerged files"; a missing result or a
  // nonzero status is refused, so a broken git can never admit a conflicted tree.
  const unmerged = git(['diff', '--name-only', '--diff-filter=U'], o.cwd);
  if (!unmerged || unmerged.status !== 0) {
    return { ok: false, cause: Cause.CONFLICT_UNKNOWN };
  }
  if (String(unmerged.stdout).trim() !== '') {
    return {
      ok: false,
      cause: Cause.CONFLICT,
      files: String(unmerged.stdout).trim().split(/\r?\n/),
    };
  }
  const br = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], o.cwd);
  if (!br || br.status !== 0) return { ok: false, cause: Cause.DETACHED_HEAD };
  const branch = String(br.stdout).trim();
  const id = String(o.workItemId || '').toLowerCase();
  // The whole id, bounded: TASK-AI-16 must not accept feat/task-ai-165-ci.
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fits = o.branchPattern
    ? o.branchPattern.test(branch)
    : id !== '' && new RegExp('(^|[/-])' + esc + '(-|$)', 'i').test(branch);
  if (!fits) return { ok: false, cause: Cause.WRONG_BRANCH, branch };
  const head = git(['rev-parse', 'HEAD'], o.cwd);
  return {
    ok: true,
    root,
    branch,
    head: head && head.status === 0 ? String(head.stdout).trim() : null,
  };
}

function fingerprint(parts) {
  const p = parts || {};
  if (!p.headSha) throw new Error('WORK_GUARD_REFUSED: fingerprint needs headSha');
  const inputs = p.inputs === undefined ? null : p.inputs;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([p.headSha, p.baseSha || null, inputs]))
    .digest('hex');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * File-backed ledger. limits: { item: { attempts, ms, tokens }, goal: { attempts, ms, tokens } }
 * Any limit left undefined is not enforced; a limit the caller sets is never
 * defaulted away.
 */
class ProgressLedger {
  constructor(o) {
    if (!o || !o.file) throw new Error('WORK_GUARD_REFUSED: ledger needs file');
    this.file = o.file;
    this.limits = o.limits || {};
    this.now = o.now || (() => Date.now());
  }

  load() {
    // Missing state is empty; damaged state fails closed, so it can never erase
    // exhausted budgets, blocks or reviewed fingerprints.
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') raw = null;
      else throw new Error('LEDGER_UNREADABLE: ' + e.code);
    }
    let s = {};
    if (raw !== null) {
      try {
        s = JSON.parse(raw);
      } catch (_) {
        throw new Error('LEDGER_CORRUPT: ' + this.file);
      }
    }
    if (raw === null)
      return {
        items: {},
        goal: { attempts: 0, ms: 0, tokens: 0, tokensUnknown: 0, unknownTokens: 0 },
      };
    validateLedger(s, this.file);
    return s;
  }

  /** May this stage run for this fingerprint? Returns { ok, cause? }. */
  /** Serialise read-modify-write of the ledger across processes. */
  locked(fn) {
    const lock = this.file + '.lock';
    const owner = { jobId: 'ledger-' + process.pid + '-' + crypto.randomBytes(4).toString('hex') };
    const until = Date.now() + 10000;
    for (;;) {
      if (acquireLock(lock, owner).ok) break;
      if (Date.now() > until) throw new Error('LEDGER_LOCK_TIMEOUT');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
    try {
      return fn();
    } finally {
      releaseLock(lock, owner);
    }
  }

  /**
   * opts.reserve: mark the fingerprint IN_FLIGHT and count the attempt now, so a
   * second caller cannot admit the same work before the first records it.
   */
  admit(itemId, stage, fp, opts) {
    return this.locked(() => this.admitUnlocked(itemId, stage, fp, opts || {}));
  }

  settleDeadFlights(s) {
    let changed = false;
    for (const item of Object.values((s && s.items) || {})) {
      if (!isObj(item) || !isObj(item.stages)) continue;
      for (const st of Object.values(item.stages)) {
        if (!isObj(st) || !isObj(st.fps)) continue;
        for (const r of Object.values(st.fps)) {
          if (r && r.outcome === 'IN_FLIGHT' && Number.isInteger(r.pid) && pidProvenDead(r.pid)) {
            if (Number.isFinite(r.at) && r.at >= 0) {
              const elapsed = Math.max(0, this.now() - r.at);
              item.spent = item.spent || { attempts: 0, ms: 0, tokens: 0 };
              item.spent.ms = (item.spent.ms || 0) + elapsed;
              s.goal.ms = (s.goal.ms || 0) + elapsed;
              r.outcome = 'TIMEOUT';
              r.at = this.now();
              changed = true;
            }
          }
        }
      }
    }
    if (changed) {
      writeJson(this.file, s);
    }
  }

  admitUnlocked(itemId, stage, fp, opts) {
    const s = this.load();
    const it = s.items[itemId] || {};
    if (it.blocked) return { ok: false, cause: Cause.ITEM_BLOCKED, reason: it.blocked };
    const lim = this.limits || {};

    this.settleDeadFlights(s);

    const goalFlight = inFlightGoalMs(s.items, this.now());
    if (!Number.isFinite(goalFlight)) return { ok: false, cause: Cause.GOAL_EXHAUSTED };
    const itemFlight = inFlightMs(it, this.now());
    if (!Number.isFinite(itemFlight)) return { ok: false, cause: Cause.TIME_EXHAUSTED };

    const goalTimeOver = exceeded({ ms: (s.goal.ms || 0) + goalFlight }, lim.goal);
    if (goalTimeOver) return { ok: false, cause: Cause.GOAL_EXHAUSTED, limit: goalTimeOver };

    const itemTimeOver = exceeded({ ms: ((it.spent && it.spent.ms) || 0) + itemFlight }, lim.item);
    if (itemTimeOver) return { ok: false, cause: Cause.TIME_EXHAUSTED, limit: itemTimeOver };

    const over = exceeded(s.goal, lim.goal);
    if (over) return { ok: false, cause: Cause.GOAL_EXHAUSTED, limit: over };
    const own = exceeded(it.spent || {}, lim.item);
    if (own) return { ok: false, cause: limitCause(own), limit: own };
    // A token cap is enforced over observed *and* imputed tokens. Usage that could not
    // be observed is charged at the per-attempt cap, so repeated unobserved attempts
    // reach the cap instead of running free.
    const ownTokens = exceeded(tokenSpend(it.spent || {}), lim.item);
    if (ownTokens) return { ok: false, cause: limitCause(ownTokens), limit: ownTokens };
    const goalTokens = exceeded(tokenSpend(s.goal), lim.goal);
    if (goalTokens) return { ok: false, cause: Cause.GOAL_EXHAUSTED, limit: goalTokens };
    // Every fingerprint keeps its outcome, so alternating inputs (F1, F2, F1) cannot loop.
    const seen = ((it.stages || {})[stage] || {}).fps || {};
    const prior = seen[fp];
    const deadFlight =
      prior &&
      prior.outcome === 'IN_FLIGHT' &&
      Number.isInteger(prior.pid) &&
      // A reservation is released only on proven death: an uncertain liveness answer
      // keeps the work held, exactly as an uncertain lock holder keeps the lock.
      pidProvenDead(prior.pid);
    if (prior && !TRANSIENT.has(prior.outcome) && !deadFlight) {
      return { ok: false, cause: Cause.NO_PROGRESS, outcome: prior.outcome };
    }
    if (opts.reserve) {
      // A reservation must name a live owner, or a crash would leave it IN_FLIGHT forever.
      // 0 and negative pids name process groups, not one owner.
      if (!Number.isInteger(opts.pid) || opts.pid <= 0) {
        throw new Error('WORK_GUARD_REFUSED: reserve needs an integer owner pid');
      }
      const t = it.spent
        ? it
        : Object.assign(it, {
            spent: { attempts: 0, ms: 0, tokens: 0, tokensUnknown: 0, unknownTokens: 0 },
            stages: it.stages || {},
          });
      t.stages = t.stages || {};
      t.spent.attempts += 1;
      s.goal.attempts += 1;
      // The attempt is charged now with an unknown cost, so a reservation that is never
      // recorded still counts toward the token caps at the conservative per-attempt cap.
      const perAttemptTokens = getPerAttemptTokens(lim);
      for (const acc of [t.spent, s.goal]) {
        acc.tokensUnknown = (acc.tokensUnknown || 0) + 1;
        acc.unknownTokens = (acc.unknownTokens || 0) + perAttemptTokens;
      }
      const st = t.stages[stage] || { fps: {} };
      st.fps = st.fps || {};
      st.fps[fp] = {
        outcome: 'IN_FLIGHT',
        pid: opts.pid,
        at: this.now(),
        imputedTokens: perAttemptTokens,
      };
      t.stages[stage] = st;
      s.items[itemId] = t;
      writeJson(this.file, s);
    }
    return { ok: true };
  }

  /** Record a finished attempt. usage: { ms?, tokens? }; unknown tokens stay unknown. */
  record(itemId, stage, fp, outcome, usage) {
    return this.locked(() => this.recordUnlocked(itemId, stage, fp, outcome, usage));
  }

  recordUnlocked(itemId, stage, fp, outcome, usage) {
    const s = this.load();
    const it = s.items[itemId] || {
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
    it.stages = it.stages || {};
    const u = usage || {};
    // Usage only ever adds: negative or non-finite values would refund a spent budget.
    if (u.ms !== undefined && !isCount(Number(u.ms)))
      throw new Error('WORK_GUARD_REFUSED: invalid usage.ms');
    if (u.tokens !== undefined && (typeof u.tokens !== 'number' || !isCount(u.tokens)))
      throw new Error('WORK_GUARD_REFUSED: invalid usage.tokens');
    const prev = ((it.stages[stage] || {}).fps || {})[fp];
    const reserved = Boolean(prev && prev.outcome === 'IN_FLIGHT');
    const knownTokens = typeof u.tokens === 'number' && Number.isFinite(u.tokens);
    const perAttemptTokens = getPerAttemptTokens(this.limits);
    const prevImputed = reserved
      ? prev.imputedTokens !== undefined
        ? Number(prev.imputedTokens)
        : perAttemptTokens
      : 0;
    const suppliedMs = u.ms !== undefined ? Number(u.ms) : 0;
    const elapsedMs =
      reserved && prev && Number.isFinite(prev.at) && prev.at >= 0
        ? Math.max(0, this.now() - prev.at)
        : 0;
    const consumedMs = Math.max(suppliedMs, elapsedMs);
    for (const acc of [it.spent, s.goal]) {
      if (!reserved) acc.attempts += 1;
      acc.ms += consumedMs;
      if (knownTokens) {
        acc.tokens += Number(u.tokens);
        if (reserved) {
          acc.unknownTokens = Math.max(0, (acc.unknownTokens || 0) - prevImputed);
          acc.tokensUnknown = Math.max(0, (acc.tokensUnknown || 0) - 1);
        }
      } else {
        if (!reserved) {
          acc.tokensUnknown = (acc.tokensUnknown || 0) + 1;
          acc.unknownTokens = (acc.unknownTokens || 0) + perAttemptTokens;
        }
        // If reserved, the attempt was already charged in admit(); preserve its charge.
      }
    }
    const st = it.stages[stage] || { fps: {} };
    st.fps = st.fps || {};
    st.fps[fp] = {
      outcome: String(outcome),
      at: this.now(),
      imputedTokens: knownTokens ? 0 : reserved ? prevImputed : perAttemptTokens,
    };
    it.stages[stage] = st;
    s.items[itemId] = it;
    writeJson(this.file, s);
  }

  block(itemId, reason) {
    return this.locked(() => this.blockUnlocked(itemId, reason));
  }

  blockUnlocked(itemId, reason) {
    const s = this.load();
    const it = s.items[itemId] || {
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
    it.stages = it.stages || {};
    it.blocked = String(reason);
    s.items[itemId] = it;
    writeJson(this.file, s);
  }

  unblock(itemId) {
    return this.locked(() => this.unblockUnlocked(itemId));
  }

  unblockUnlocked(itemId) {
    const s = this.load();
    if (s.items[itemId]) delete s.items[itemId].blocked;
    writeJson(this.file, s);
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isFinite(v) && v >= 0;

const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || proto === Object.prototype;
};

const isInheritedObject = (v) => {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  if (!proto) return false;
  return (
    (proto.constructor === Object || !proto.constructor) &&
    (!v.constructor || v.constructor === Object)
  );
};

// Persisted counters are mandatory: a missing counter would read as zero and reopen a spent budget.
function validSpent(v) {
  return (
    isObj(v) &&
    ['attempts', 'ms', 'tokens', 'tokensUnknown', 'unknownTokens'].every((k) => isCount(v[k]))
  );
}

function inFlightMs(itemOrStages, now) {
  let ms = 0;
  const stages = (itemOrStages && itemOrStages.stages) || itemOrStages;
  if (!isObj(stages)) return 0;
  for (const st of Object.values(stages)) {
    if (!isObj(st) || !isObj(st.fps)) continue;
    for (const r of Object.values(st.fps)) {
      if (r && r.outcome === 'IN_FLIGHT') {
        if (!Number.isFinite(r.at) || r.at < 0) {
          return Infinity;
        }
        ms += Math.max(0, now - r.at);
      }
    }
  }
  return ms;
}

function inFlightGoalMs(items, now) {
  let ms = 0;
  if (!isObj(items)) return 0;
  for (const it of Object.values(items)) {
    const m = inFlightMs(it, now);
    if (!Number.isFinite(m)) return Infinity;
    ms += m;
  }
  return ms;
}

function getPerAttemptTokens(limits) {
  const lim = limits || {};
  if (lim.item && Number.isFinite(lim.item.tokens) && lim.item.tokens > 0) {
    return lim.item.tokens;
  }
  if (lim.goal && Number.isFinite(lim.goal.tokens) && lim.goal.tokens > 0) {
    return lim.goal.tokens;
  }
  return 0;
}

// A usage whose tokens could not be observed is charged the per-attempt token cap,
// which is the most that attempt was allowed to spend. With no token cap there is
// nothing to charge. `usage.tokens === undefined` means the attempt spent nothing
// observable (no tokens field at all); an explicit non-finite count is unknown usage.
function tokenCost(u, lim) {
  // Only a missing or non-finite count is imputed; a negative count is refused by record().
  if (u.tokens !== undefined && Number.isFinite(Number(u.tokens))) {
    const n = Number(u.tokens);
    return n < 0 ? 0 : n;
  }
  return getPerAttemptTokens(lim && (lim.item || lim.goal) ? lim : { item: lim });
}

/** Tokens counted against a cap: observed tokens plus imputed unknown usage. */
function countedTokens(spent) {
  return (spent.tokens || 0) + (spent.unknownTokens || 0);
}

/** The tokens sub-budget of an accumulator, as countedTokens sees it. */
function tokenSpend(spent) {
  return { tokens: countedTokens(spent) };
}

/** Any structural damage fails closed: a damaged ledger must never read as empty. */
function validateLedger(s, file) {
  const bad = () => {
    throw new Error('LEDGER_CORRUPT: ' + file);
  };
  if (!isObj(s) || !isObj(s.items) || !validSpent(s.goal)) bad();
  for (const it of Object.values(s.items)) {
    if (!isObj(it)) bad();
    if (!validSpent(it.spent)) bad();
    if (it.blocked !== undefined && typeof it.blocked !== 'string') bad();
    if (!isObj(it.stages)) bad();
    for (const st of Object.values(it.stages)) {
      if (!isObj(st) || !isObj(st.fps)) bad();
      for (const r of Object.values(st.fps)) if (!isObj(r) || typeof r.outcome !== 'string') bad();
    }
  }
}

function exceeded(spent, lim) {
  if (!lim) return null;
  for (const k of ['attempts', 'ms', 'tokens']) {
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

/**
 * Overall (negative) liveness of a pid. Fail-closed: a probe that cannot prove
 * death (EPERM, EINVAL, any unexpected error) reports the pid as alive, so a lock
 * or reservation is never taken on a guess. Only ESRCH proves the owner is gone.
 */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !(e && e.code === 'ESRCH');
  }
}

/**
 * Positive proof of death, used where an uncertain answer must keep the work
 * held (a reservation whose owner may still be running). Anything other than
 * ESRCH — including an unexpected error — means "not proven dead".
 */
function pidProvenDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return Boolean(e && e.code === 'ESRCH');
  }
}

/**
 * Generation lock. Each owner holds its own file `<file>.g<N>`, created with an
 * exclusive create; the current lock is the highest generation. A dead holder is
 * superseded by creating generation N+1, never by deleting its file, so no racing
 * contender can remove a live owner's lock. After creating, an owner that finds
 * a higher generation backs off. Release renames the file to `.released`, so
 * generation numbers never go backwards.
 */
function lockGenerations(file) {
  const dir = path.dirname(file);
  const base = path.basename(file) + '.g';
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const gens = [];
  for (const n of names) {
    if (!n.startsWith(base)) continue;
    const m = /^(\d+)(\.released)?$/.exec(n.slice(base.length));
    if (m) gens.push({ gen: Number(m[1]), released: Boolean(m[2]), path: path.join(dir, n) });
  }
  return gens.sort((x, y) => x.gen - y.gen);
}

function lockHolder(file) {
  const gens = lockGenerations(file);
  const top = gens[gens.length - 1];
  if (!top || top.released) return null;
  return Object.assign({ gen: top.gen }, readJson(top.path, { unreadable: true }));
}

/** Returns { ok, owner } or { ok:false, cause, holder }. */
function acquireLock(file, owner, o) {
  const alive = (o && o.pidAlive) || pidAlive;
  if (!owner || !owner.jobId) throw new Error('WORK_GUARD_REFUSED: lock owner needs jobId');
  const pid = owner.pid === undefined ? process.pid : owner.pid;
  // 0 and negative pids name process groups; liveness of one owner cannot be proven from them.
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error('WORK_GUARD_REFUSED: lock owner needs a positive pid');
  const gens = lockGenerations(file);
  const top = gens[gens.length - 1];
  if (top && !top.released) {
    const holder = readJson(top.path, null);
    // Unreadable (being written) or live holders keep the lock; stale only when the pid is provably dead.
    if (!holder || !Number.isInteger(holder.pid) || holder.pid <= 0 || alive(holder.pid)) {
      return { ok: false, cause: Cause.LOCK_HELD, holder };
    }
  }
  const gen = top ? top.gen + 1 : 1;
  const mine = file + '.g' + gen;
  try {
    fs.writeFileSync(mine, JSON.stringify({ jobId: owner.jobId, pid, at: Date.now() }), {
      flag: 'wx',
    });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return { ok: false, cause: Cause.LOCK_HELD, holder: lockHolder(file) };
  }
  const after = lockGenerations(file);
  // A higher generation, or a tombstone of this one (it was taken and released while we
  // paused), means another owner already used this number: back off.
  if (after.some((g) => g.gen > gen || (g.gen === gen && g.released))) {
    fs.unlinkSync(mine);
    return { ok: false, cause: Cause.LOCK_HELD, holder: lockHolder(file) };
  }
  // Superseded earlier generations and release markers are preserved: dead owners
  // are superseded through exclusive creation of the next generation, never deletion (BR-LOOP-04).
  return { ok: true, owner: Object.assign({}, owner, { gen }) };
}

function releaseLock(file, owner) {
  if (!owner || !owner.jobId || typeof owner.jobId !== 'string') {
    return { ok: false, cause: Cause.LOCK_NOT_OWNER, holder: lockHolder(file) };
  }
  const gens = lockGenerations(file).filter((g) => !g.released);
  const own = gens.find((g) => {
    if (owner.gen !== undefined && g.gen !== owner.gen) return false;
    const meta = readJson(g.path, null);
    return Boolean(meta && meta.jobId && meta.jobId === owner.jobId);
  });
  if (!own) return { ok: false, cause: Cause.LOCK_NOT_OWNER, holder: lockHolder(file) };
  fs.renameSync(own.path, own.path + '.released');
  return { ok: true };
}

function acceptResult(job, result) {
  if (!result || !result.jobId) return { ok: false, cause: Cause.JOB_UNBOUND };
  if (!job || result.jobId !== job.jobId)
    return { ok: false, cause: Cause.JOB_MISMATCH, got: result.jobId };
  return { ok: true };
}

/**
 * Run fn, then cleanup; the result (and its exit code) is fn's, whatever cleanup does.
 *
 * The worker is watched through a flag, not through the thrown value: a worker may
 * throw `null`, `undefined`, `0` or `''`, and treating a falsy exception as success
 * would turn a crash into a result.
 */
async function runWithCleanup(fn, cleanup) {
  let out;
  let threw = false;
  let err;
  try {
    out = await fn();
  } catch (e) {
    threw = true;
    err = e;
  }
  let cleanupError = null;
  try {
    await cleanup();
  } catch (e) {
    cleanupError = e;
  }
  if (threw) {
    if (cleanupError) {
      try {
        err.cleanupError = cleanupError;
      } catch (_) {
        /* annotation is best effort; the original error is what propagates */
      }
    }
    throw err;
  }
  if (!cleanupError || out === null || typeof out !== 'object') return out;
  const note = String(cleanupError.message || cleanupError);

  // If the result is extensible, directly define cleanupError to preserve internal slots,
  // private fields and prototype getters without any wrapping.
  if (Object.isExtensible(out)) {
    try {
      Object.defineProperty(out, 'cleanupError', {
        value: note,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      return out;
    } catch (_) {
      /* fallback below if defineProperty fails */
    }
  }

  // Never mutate the worker's result if not possible: a TypeError here would replace the real exit code.
  // Preserving built-in types (Array, Date, RegExp, Map, Set, Buffer) and plain objects maintains JSON serialization.
  // Unsupported built-ins or custom class instances with private fields are preserved as-is.
  let copy;
  if (Array.isArray(out)) {
    copy = Array.from(out);
  } else if (out instanceof Date) {
    copy = new Date(out.getTime());
  } else if (out instanceof RegExp) {
    copy = new RegExp(out.source, out.flags);
  } else if (out instanceof Map) {
    copy = new Map(out);
  } else if (out instanceof Set) {
    copy = new Set(out);
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(out)) {
    copy = Buffer.from(out);
  } else if (isPlainObject(out)) {
    copy = Object.assign(Object.getPrototypeOf(out) === null ? Object.create(null) : {}, out);
  } else if (isInheritedObject(out)) {
    copy = Object.create(Object.getPrototypeOf(out));
  } else {
    return out;
  }
  for (const key of Reflect.ownKeys(out)) {
    if (key === 'cleanupError') continue;
    const d = Object.getOwnPropertyDescriptor(out, key);
    if (d) {
      try {
        Object.defineProperty(copy, key, d);
      } catch (_) {}
    }
  }
  try {
    Object.defineProperty(copy, 'cleanupError', {
      value: note,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } catch (_) {}
  return copy;
}

module.exports = {
  Cause,
  TRANSIENT,
  checkWorkspace,
  fingerprint,
  ProgressLedger,
  acquireLock,
  releaseLock,
  lockHolder,
  acceptResult,
  runWithCleanup,
  probeCaseInsensitive,
  norm,
};

// CLI for shell runtimes (pipeline scripts, Hermes): JSON on stdout, exit 0 when
// allowed, 3 when refused, 2 on usage error.
//   check-workspace --cwd D --item ID [--root R]
//   admit  --ledger F --item ID --stage S --head SHA --pid WINPID [--base SHA] [--inputs STR] [--limits JSON]
//   record --ledger F --item ID --stage S --head SHA [--base SHA] [--inputs STR] --outcome O [--ms N] [--tokens N]
//   block  --ledger F --item ID --reason R
if (require.main === module) {
  const a = {};
  const argv = process.argv.slice(2);
  const cmd = argv.shift();
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  const out = (v, code) => {
    process.stdout.write(JSON.stringify(v) + '\n');
    process.exit(code);
  };
  const { spawnSync } = require('node:child_process');
  const git = (args, cwd) => {
    const r = spawnSync('git', ['-c', 'safe.directory=*', ...args], { cwd, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout || '' };
  };
  try {
    if (cmd === 'check-workspace') {
      const r = checkWorkspace({ cwd: a.cwd, expectedRoot: a.root, workItemId: a.item, git });
      out(r, r.ok ? 0 : 3);
    }
    const ledger = new ProgressLedger({
      file: a.ledger,
      limits: a.limits ? JSON.parse(a.limits) : undefined,
    });
    if (cmd === 'block') {
      ledger.block(a.item, a.reason);
      out({ ok: true }, 0);
    }
    const fp = fingerprint({ headSha: a.head, baseSha: a.base, inputs: a.inputs });
    if (cmd === 'admit') {
      const r = ledger.admit(a.item, a.stage, fp, { reserve: true, pid: Number(a.pid) });
      out(r, r.ok ? 0 : 3);
    }
    if (cmd === 'record') {
      const usage = {
        ms: a.ms === undefined ? 0 : Number(a.ms),
        tokens: a.tokens === undefined ? undefined : Number(a.tokens),
      };
      ledger.record(a.item, a.stage, fp, a.outcome, usage);
      out({ ok: true }, 0);
    }
    out({ ok: false, cause: 'USAGE' }, 2);
  } catch (e) {
    out({ ok: false, cause: 'USAGE', error: String(e.message) }, 2);
  }
}
