'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const posInt = (v) => Number.isInteger(v) && v > 0;
const origReal = fs.realpathSync;
const sha = (s, n = 16) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, n);
const tryCall = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};
const tryOk = (fn) => {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
};

function resolveWorktreePath(cwd, options = {}) {
  if (!nonEmpty(cwd)) throw new Error('WORKTREE_PATH_INVALID');
  const resolved = options.root ? path.resolve(options.root, cwd) : path.resolve(cwd);
  const def = fs.realpathSync !== origReal ? fs.realpathSync : fs.realpathSync?.native || origReal;
  const real = tryCall(() => (options.realpath || options.fs?.realpathSync || def)(resolved));
  if (!nonEmpty(real)) throw new Error('WORKTREE_PATH_UNRESOLVED');
  return path.resolve(real);
}
function worktreeId(cwd, options = {}) {
  const norm = resolveWorktreePath(cwd, options).replace(/\\/g, '/').replace(/\/+$/, '');
  const worktree = norm.toLowerCase();
  return { id: sha(worktree, 16), worktree };
}
function parseLockRecord(raw) {
  if (!nonEmpty(raw)) return null;
  const s = raw.trim();
  if (/^\d+$/.test(s)) return posInt(Number(s)) ? { pid: Number(s) } : null;
  const p = tryCall(() => JSON.parse(s));
  if (posInt(p)) return { pid: p };
  return p && typeof p === 'object' && !Array.isArray(p) && posInt(p.pid) ? p : null;
}
function isOwnerAlive(rec, options = {}) {
  if (!rec || !posInt(rec.pid)) return false;
  try {
    (options.kill || process.kill)(rec.pid, 0);
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
  const live = rec.startedAt != null && options.getProcessStartedAt?.(rec.pid);
  return !(live != null && live !== false && String(live) !== String(rec.startedAt));
}
function wxWrite(file, text, io = fs) {
  try {
    io.writeFileSync(file, text, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}
function evictDeadFile(file, payload, claimId, options, io) {
  const raw = tryCall(() => io.readFileSync(file, 'utf8'));
  const rec = parseLockRecord(raw);
  if (!rec || isOwnerAlive(rec, options)) return false;
  const evict = `${file}.${sha(raw, 12)}.evict`;
  if (!wxWrite(evict, payload, io)) return false;
  try {
    if (tryCall(() => io.readFileSync(file, 'utf8')) !== raw) return false;
    if (!tryOk(() => io.unlinkSync(file)) || !wxWrite(file, payload, io)) return false;
    return parseLockRecord(tryCall(() => io.readFileSync(file, 'utf8')))?.claimId === claimId;
  } finally {
    tryOk(() => io.unlinkSync(evict));
  }
}
function claimWorktree(cwd, options = {}) {
  const [io, dir] = [options.fs || fs, options.runtimeDir || options.stateDir || options.dir];
  if (!nonEmpty(dir)) throw new Error('RUNTIME_DIR_REQUIRED');
  if (!nonEmpty(cwd)) throw new Error('WORKTREE_PATH_INVALID');
  const target = tryCall(() => worktreeId(cwd, options));
  if (!target)
    return { ok: false, claimed: false, action: 'STOP', reason: 'WORKTREE_PATH_UNRESOLVED' };
  const { id, worktree } = target;
  io.mkdirSync(dir, { recursive: true });
  const lockFile = path.join(dir, `supervisor-${id}.lock`);
  const gateFile = `${lockFile}.recover`;
  const pid = posInt(options.pid) ? options.pid : process.pid;
  const claimId = crypto.randomBytes(8).toString('hex');
  const payload = JSON.stringify({ pid, startedAt: options.startedAt ?? null, claimId, worktree });
  const base = { id, worktree, lockFile };
  const readRec = (f) => parseLockRecord(tryCall(() => io.readFileSync(f, 'utf8')));
  const releaseFile = (f, c = readRec(f)) =>
    c && (c.claimId ? c.claimId === claimId : c.pid === pid) && tryOk(() => io.unlinkSync(f));
  const release = () => releaseFile(lockFile);
  const okRec = { ok: true, claimed: true, ...base, pid, claimId, release };
  const busy = () => ({ ok: false, claimed: false, reason: 'WORKTREE_CLAIMED', ...base });
  const wx = (f) => wxWrite(f, payload, io) && readRec(f)?.claimId === claimId;
  if (!(wx(gateFile) || evictDeadFile(gateFile, payload, claimId, options, io))) return busy();
  try {
    if (readRec(gateFile)?.claimId !== claimId) return busy();
    if (!(wx(lockFile) || evictDeadFile(lockFile, payload, claimId, options, io))) return busy();
    return readRec(lockFile)?.claimId === claimId ? okRec : busy();
  } finally {
    releaseFile(gateFile);
  }
}
function verifyWorktreeClaim(cwd, claim, options = {}) {
  const io = options?.fs || fs;
  if (!claim || typeof claim !== 'object') return { ok: false, reason: 'WORKTREE_CLAIM_REQUIRED' };
  if (claim.claimed !== true)
    return { ok: false, reason: claim.reason || 'WORKTREE_CLAIMED', worktree: claim.worktree };
  const target = tryCall(() => worktreeId(cwd, options));
  if (!target) return { ok: false, reason: 'WORKTREE_PATH_UNRESOLVED', worktree: cwd || null };
  if (claim.id !== target.id || claim.worktree !== target.worktree) {
    return { ok: false, reason: 'WORKTREE_CLAIM_MISMATCH', worktree: target.worktree };
  }
  if (!nonEmpty(claim.lockFile) || !nonEmpty(claim.claimId)) {
    return { ok: false, reason: 'WORKTREE_CLAIM_REQUIRED', worktree: target.worktree };
  }
  const disk = parseLockRecord(tryCall(() => io.readFileSync(claim.lockFile, 'utf8')));
  const same = disk && disk.claimId === claim.claimId;
  const live = isOwnerAlive(disk, options);
  if (!same || disk?.worktree !== target.worktree || !live) {
    return { ok: false, reason: 'WORKTREE_CLAIMED', worktree: target.worktree };
  }
  return { ok: true, id: target.id, worktree: target.worktree };
}
async function reconcileWorktreeWorker(cwd, item, options = {}) {
  if (!nonEmpty(item)) throw new Error('WORK_ITEM_INVALID');
  const [io, dir] = [options.fs || fs, options.runtimeDir || options.stateDir || options.dir];
  const target = tryCall(() => worktreeId(cwd, options));
  if (!target) return { ok: false, action: 'STOP', reason: 'WORKTREE_PATH_UNRESOLVED' };
  const workerFile = path.join(dir, `worker-${target.id}.json`);
  const base = { worktree: target.worktree, workerFile };
  const passed = options.claim || options.worktreeClaim;
  const own = passed ? null : claimWorktree(cwd, options);
  const active = passed || own;
  if (!verifyWorktreeClaim(cwd, active, options).ok) {
    own?.release?.();
    return { ok: false, action: 'STOP', reason: active?.reason || 'WORKTREE_CLAIMED', ...base };
  }
  try {
    let raw;
    try {
      raw = io.readFileSync(workerFile, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, ...base, stoppedLeftover: null };
      return { ok: false, action: 'STOP', reason: 'WORKER_STATE_UNREADABLE', ...base };
    }
    const p = tryCall(() => JSON.parse(raw));
    const wItem = p && (p.item || p.workItemId);
    const okPid = p && !Array.isArray(p) && (p.pid === undefined || posInt(p.pid));
    if (!okPid || !nonEmpty(wItem) || !nonEmpty(p.tag)) {
      return { ok: false, action: 'STOP', reason: 'WORKER_STATE_UNREADABLE', ...base };
    }
    if (wItem === item) {
      if (posInt(p.pid) && !isOwnerAlive({ pid: p.pid, startedAt: p.startedAt }, options)) {
        io.unlinkSync(workerFile);
        return { ok: true, ...base, stoppedLeftover: { item: wItem, tag: p.tag, pid: p.pid } };
      }
      return { ok: true, ...base, activeWorker: { ...p, item: wItem } };
    }
    if (typeof options.stopRun !== 'function') {
      return { ok: false, action: 'STOP', reason: 'STOP_RUN_REQUIRED', ...base };
    }
    const res = await options.stopRun({ tag: p.tag, pid: p.pid, startedAt: p.startedAt }, options);
    if (!res?.stopped) {
      return {
        ok: false,
        action: 'STOP',
        reason: 'BLOCKED_WORKER_NOT_STOPPED',
        run: p.tag,
        item: wItem,
        ...base,
        remainingPids: res?.remainingPids,
      };
    }
    if (!verifyWorktreeClaim(cwd, active, options).ok) {
      return { ok: false, action: 'STOP', reason: 'WORKTREE_CLAIMED', ...base };
    }
    if (tryCall(() => io.readFileSync(workerFile, 'utf8')) !== raw) {
      return { ok: false, action: 'STOP', reason: 'WORKER_STATE_CHANGED', ...base };
    }
    io.unlinkSync(workerFile);
    return { ok: true, ...base, stoppedLeftover: { item: wItem, tag: p.tag, pid: p.pid } };
  } finally {
    own?.release?.();
  }
}
async function acquireWorktreeOwner(cwd, item, options = {}) {
  const claim = claimWorktree(cwd, options);
  if (!claim.claimed) return { ...claim, action: 'STOP' };
  try {
    const rec = await reconcileWorktreeWorker(cwd, item, { ...options, claim });
    if (rec?.ok) return { ...claim, ...rec, ok: true, claimed: true };
    claim.release();
    return { ...rec, ok: false, claimed: false };
  } catch (err) {
    claim.release();
    throw err;
  }
}
module.exports = {
  parseLockRecord,
  resolveWorktreePath,
  worktreeId,
  claimWorktree,
  verifyWorktreeClaim,
  reconcileWorktreeWorker,
  acquireWorktreeOwner,
  isOwnerAlive,
};
