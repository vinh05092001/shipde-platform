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

function norm(p) {
  return path.resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
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
  const unmerged = git(['diff', '--name-only', '--diff-filter=U'], o.cwd);
  if (unmerged && unmerged.status === 0 && String(unmerged.stdout).trim() !== '') {
    return { ok: false, cause: Cause.CONFLICT, files: String(unmerged.stdout).trim().split(/\r?\n/) };
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
  return { ok: true, root, branch, head: head && head.status === 0 ? String(head.stdout).trim() : null };
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
    if (raw === null) return { items: {}, goal: { attempts: 0, ms: 0, tokens: 0 } };
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

  admitUnlocked(itemId, stage, fp, opts) {
    const s = this.load();
    const it = s.items[itemId] || {};
    if (it.blocked) return { ok: false, cause: Cause.ITEM_BLOCKED, reason: it.blocked };
    const over = exceeded(s.goal, this.limits.goal);
    if (over) return { ok: false, cause: Cause.GOAL_EXHAUSTED, limit: over };
    const own = exceeded(it.spent || {}, this.limits.item);
    if (own) return { ok: false, cause: limitCause(own), limit: own };
    // Every fingerprint keeps its outcome, so alternating inputs (F1, F2, F1) cannot loop.
    const seen = ((it.stages || {})[stage] || {}).fps || {};
    const prior = seen[fp];
    const deadFlight = prior && prior.outcome === 'IN_FLIGHT' && Number.isInteger(prior.pid) && !pidAlive(prior.pid);
    if (prior && !TRANSIENT.has(prior.outcome) && !deadFlight) {
      return { ok: false, cause: Cause.NO_PROGRESS, outcome: prior.outcome };
    }
    if (opts.reserve) {
      // A reservation must name a live owner, or a crash would leave it IN_FLIGHT forever.
      // 0 and negative pids name process groups, not one owner.
      if (!Number.isInteger(opts.pid) || opts.pid <= 0) {
        throw new Error('WORK_GUARD_REFUSED: reserve needs an integer owner pid');
      }
      const t = it.spent ? it : Object.assign(it, { spent: { attempts: 0, ms: 0, tokens: 0 }, stages: it.stages || {} });
      t.stages = t.stages || {};
      t.spent.attempts += 1;
      s.goal.attempts += 1;
      const st = t.stages[stage] || { fps: {} };
      st.fps = st.fps || {};
      st.fps[fp] = { outcome: 'IN_FLIGHT', pid: opts.pid, at: this.now() };
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
    const it = s.items[itemId] || { spent: { attempts: 0, ms: 0, tokens: 0 }, stages: {} };
    it.spent = it.spent || { attempts: 0, ms: 0, tokens: 0 };
    it.stages = it.stages || {};
    const u = usage || {};
    // Usage only ever adds: negative or non-finite values would refund a spent budget.
    if (u.ms !== undefined && !isCount(Number(u.ms))) throw new Error('WORK_GUARD_REFUSED: invalid usage.ms');
    if (u.tokens !== undefined && !isCount(u.tokens)) throw new Error('WORK_GUARD_REFUSED: invalid usage.tokens');
    const prev = ((it.stages[stage] || {}).fps || {})[fp];
    const reserved = Boolean(prev && prev.outcome === 'IN_FLIGHT');
    for (const acc of [it.spent, s.goal]) {
      if (!reserved) acc.attempts += 1;
      acc.ms += Number(u.ms) || 0;
      if (Number.isFinite(u.tokens)) acc.tokens += u.tokens;
      else acc.tokensUnknown = (acc.tokensUnknown || 0) + 1;
    }
    const st = it.stages[stage] || { fps: {} };
    st.fps = st.fps || {};
    st.fps[fp] = { outcome: String(outcome), at: this.now() };
    it.stages[stage] = st;
    s.items[itemId] = it;
    writeJson(this.file, s);
  }

  block(itemId, reason) {
    return this.locked(() => this.blockUnlocked(itemId, reason));
  }

  blockUnlocked(itemId, reason) {
    const s = this.load();
    const it = s.items[itemId] || { spent: { attempts: 0, ms: 0, tokens: 0 }, stages: {} };
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

// Persisted counters are mandatory: a missing counter would read as zero and reopen a spent budget.
function validSpent(v) {
  return (
    isObj(v) &&
    ['attempts', 'ms', 'tokens'].every((k) => isCount(v[k])) &&
    (v.tokensUnknown === undefined || isCount(v.tokensUnknown))
  );
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
  return k === 'ms' ? Cause.TIME_EXHAUSTED : k === 'tokens' ? Cause.TOKENS_EXHAUSTED : Cause.ATTEMPTS_EXHAUSTED;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
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
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('WORK_GUARD_REFUSED: lock owner needs a positive pid');
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
    fs.writeFileSync(mine, JSON.stringify({ jobId: owner.jobId, pid, at: Date.now() }), { flag: 'wx' });
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
  for (const g of after) {
    if (g.gen < gen) {
      try {
        fs.unlinkSync(g.path);
      } catch (_) {
        /* superseded generation already gone */
      }
    }
  }
  return { ok: true, owner: Object.assign({}, owner, { gen }) };
}

function releaseLock(file, owner) {
  const gens = lockGenerations(file).filter((g) => !g.released);
  const own = owner && gens.find((g) => (readJson(g.path, {}) || {}).jobId === owner.jobId);
  if (!own) return { ok: false, cause: Cause.LOCK_NOT_OWNER, holder: lockHolder(file) };
  fs.renameSync(own.path, own.path + '.released');
  return { ok: true };
}

function acceptResult(job, result) {
  if (!result || !result.jobId) return { ok: false, cause: Cause.JOB_UNBOUND };
  if (!job || result.jobId !== job.jobId) return { ok: false, cause: Cause.JOB_MISMATCH, got: result.jobId };
  return { ok: true };
}

/** Run fn, then cleanup; the result (and its exit code) is fn's, whatever cleanup does. */
async function runWithCleanup(fn, cleanup) {
  let out;
  let err;
  try {
    out = await fn();
  } catch (e) {
    err = e;
  }
  let cleanupError = null;
  try {
    await cleanup();
  } catch (e) {
    cleanupError = e;
  }
  if (err) {
    if (cleanupError) {
      try {
        err.cleanupError = cleanupError;
      } catch (_) {
        /* annotation is best effort; the original error is what propagates */
      }
    }
    throw err;
  }
  if (cleanupError && out && typeof out === 'object') {
    const note = String(cleanupError.message || cleanupError);
    // Never mutate the worker's result: a TypeError here would replace the real exit code.
    // Inherit from the result so inherited and non-enumerable fields (exitCode) stay readable.
    return Object.defineProperty(Object.create(out), 'cleanupError', { value: note, enumerable: true });
  }
  return out;
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
    const ledger = new ProgressLedger({ file: a.ledger, limits: a.limits ? JSON.parse(a.limits) : undefined });
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
      const usage = { ms: a.ms === undefined ? 0 : Number(a.ms), tokens: a.tokens === undefined ? undefined : Number(a.tokens) };
      ledger.record(a.item, a.stage, fp, a.outcome, usage);
      out({ ok: true }, 0);
    }
    out({ ok: false, cause: 'USAGE' }, 2);
  } catch (e) {
    out({ ok: false, cause: 'USAGE', error: String(e.message) }, 2);
  }
}
