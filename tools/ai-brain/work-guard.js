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
    const s = readJson(this.file, null) || {};
    return { items: s.items || {}, goal: s.goal || { attempts: 0, ms: 0, tokens: 0 } };
  }

  /** May this stage run for this fingerprint? Returns { ok, cause? }. */
  admit(itemId, stage, fp) {
    const s = this.load();
    const it = s.items[itemId] || {};
    if (it.blocked) return { ok: false, cause: Cause.ITEM_BLOCKED, reason: it.blocked };
    const over = exceeded(s.goal, this.limits.goal);
    if (over) return { ok: false, cause: Cause.GOAL_EXHAUSTED, limit: over };
    const own = exceeded(it.spent || {}, this.limits.item);
    if (own) return { ok: false, cause: limitCause(own), limit: own };
    // Every fingerprint keeps its outcome, so alternating inputs (F1, F2, F1) cannot loop.
    const seen = ((it.stages || {})[stage] || {}).fps || {};
    if (seen[fp] && !TRANSIENT.has(seen[fp].outcome)) {
      return { ok: false, cause: Cause.NO_PROGRESS, outcome: seen[fp].outcome };
    }
    return { ok: true };
  }

  /** Record a finished attempt. usage: { ms?, tokens? }; unknown tokens stay unknown. */
  record(itemId, stage, fp, outcome, usage) {
    const s = this.load();
    const it = s.items[itemId] || { spent: { attempts: 0, ms: 0, tokens: 0 }, stages: {} };
    it.spent = it.spent || { attempts: 0, ms: 0, tokens: 0 };
    it.stages = it.stages || {};
    const u = usage || {};
    for (const acc of [it.spent, s.goal]) {
      acc.attempts += 1;
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
    const s = this.load();
    const it = s.items[itemId] || { spent: { attempts: 0, ms: 0, tokens: 0 }, stages: {} };
    it.blocked = String(reason);
    s.items[itemId] = it;
    writeJson(this.file, s);
  }

  unblock(itemId) {
    const s = this.load();
    if (s.items[itemId]) delete s.items[itemId].blocked;
    writeJson(this.file, s);
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

/** Atomic lock. Returns { ok, owner } or { ok:false, cause, holder }. */
function acquireLock(file, owner, o) {
  const alive = (o && o.pidAlive) || pidAlive;
  if (!owner || !owner.jobId) throw new Error('WORK_GUARD_REFUSED: lock owner needs jobId');
  const body = JSON.stringify({ jobId: owner.jobId, pid: owner.pid || process.pid, at: Date.now() });
  for (let i = 0; i < 2; i += 1) {
    try {
      fs.writeFileSync(file, body, { flag: 'wx' });
      return { ok: true, owner };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = readJson(file, null);
      // Stale only when the holder pid is provably dead; unreadable or live holders keep the lock.
      // Takeover is serialised by a second exclusive file, and the lock is removed only if it is
      // still the exact instance observed dead, so a racing contender cannot delete a new owner.
      if (holder && Number.isInteger(holder.pid) && !alive(holder.pid) && i === 0) {
        const guard = file + '.takeover';
        try {
          fs.writeFileSync(guard, String(owner.jobId), { flag: 'wx' });
        } catch (_) {
          return { ok: false, cause: Cause.LOCK_HELD, holder };
        }
        try {
          const again = readJson(file, null);
          if (!again || again.jobId !== holder.jobId || again.at !== holder.at) {
            return { ok: false, cause: Cause.LOCK_HELD, holder: again };
          }
          fs.unlinkSync(file);
          fs.writeFileSync(file, body, { flag: 'wx' });
          return { ok: true, owner };
        } finally {
          fs.unlinkSync(guard);
        }
      }
      return { ok: false, cause: Cause.LOCK_HELD, holder };
    }
  }
  return { ok: false, cause: Cause.LOCK_HELD, holder: readJson(file, null) };
}

function releaseLock(file, owner) {
  const holder = readJson(file, null);
  if (!holder || !owner || holder.jobId !== owner.jobId) {
    return { ok: false, cause: Cause.LOCK_NOT_OWNER, holder };
  }
  fs.unlinkSync(file);
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
    if (cleanupError) err.cleanupError = cleanupError;
    throw err;
  }
  if (cleanupError && out && typeof out === 'object') {
    const note = String(cleanupError.message || cleanupError);
    // Never mutate a frozen result: a TypeError here would replace the real exit code.
    if (Object.isExtensible(out)) out.cleanupError = note;
    else return Object.assign({}, out, { cleanupError: note });
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
  acceptResult,
  runWithCleanup,
};

// CLI for shell runtimes (pipeline scripts, Hermes): JSON on stdout, exit 0 when
// allowed, 3 when refused, 2 on usage error.
//   check-workspace --cwd D --item ID [--root R]
//   admit  --ledger F --item ID --stage S --head SHA [--base SHA] [--inputs STR] [--limits JSON]
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
      const r = ledger.admit(a.item, a.stage, fp);
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
