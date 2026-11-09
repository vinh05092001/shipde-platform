'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runHarness } = require('./harness');

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const posInt = (v) => Number.isInteger(v) && v > 0;
function tryCall(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
function resolveWorktreePath(cwd, options = {}) {
  if (!nonEmpty(cwd)) throw new Error('WORKTREE_PATH_INVALID');
  const resolved = options.root ? path.resolve(options.root, cwd) : path.resolve(cwd);
  const realpath = (fs.realpathSync && fs.realpathSync.native) || fs.realpathSync;
  for (let cur = resolved, tail = []; cur; cur = path.dirname(cur)) {
    const real = tryCall(() => path.join(realpath(cur), ...tail));
    if (real || path.dirname(cur) === cur) return real || resolved;
    tail.unshift(path.basename(cur));
  }
  return resolved;
}
function worktreeId(cwd, options = {}) {
  const raw = resolveWorktreePath(cwd, options).replace(/\\/g, '/').replace(/\/+$/, '');
  const worktree = raw.toLowerCase();
  return { id: crypto.createHash('sha256').update(worktree).digest('hex').slice(0, 16), worktree };
}
function parseLockRecord(raw) {
  const p = nonEmpty(raw) && (tryCall(() => JSON.parse(raw)) || { pid: Number(raw) });
  return p && !Array.isArray(p) && posInt(p.pid) ? p : null;
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
function claimWorktree(cwd, options = {}) {
  const dir = options.runtimeDir || options.stateDir || options.dir;
  if (!nonEmpty(dir)) throw new Error('RUNTIME_DIR_REQUIRED');
  const { id, worktree } = worktreeId(cwd, options);
  fs.mkdirSync(dir, { recursive: true });
  const lockFile = path.join(dir, `supervisor-${id}.lock`);
  const gateFile = `${lockFile}.recover`;
  const pid = posInt(options.pid) ? options.pid : process.pid;
  const claimId = crypto.randomBytes(8).toString('hex');
  const payload = JSON.stringify({ pid, startedAt: options.startedAt ?? null, claimId, worktree });
  const base = { id, worktree, lockFile };
  const readRec = (f) => parseLockRecord(tryCall(() => fs.readFileSync(f, 'utf8')));
  const releaseFile = (f, c = readRec(f)) =>
    c && (c.claimId ? c.claimId === claimId : c.pid === pid) && tryCall(() => fs.unlinkSync(f));
  const release = () => releaseFile(lockFile);
  const okRec = { ok: true, claimed: true, ...base, pid, claimId, release };
  const busy = () => ({ ok: false, claimed: false, reason: 'WORKTREE_CLAIMED', ...base });
  const wx = (f) => tryCall(() => (fs.writeFileSync(f, payload, { flag: 'wx' }), true));
  if (wx(lockFile)) return okRec;
  if (!wx(gateFile)) {
    if (isOwnerAlive(readRec(gateFile), options)) return busy();
    if ((tryCall(() => fs.unlinkSync(gateFile)), !wx(gateFile))) return busy();
  }
  try {
    if (isOwnerAlive(readRec(lockFile), options)) return busy();
    return (tryCall(() => fs.unlinkSync(lockFile)), wx(lockFile) ? okRec : busy());
  } finally {
    releaseFile(gateFile);
  }
}
function hasRunTag(commandLine, tag) {
  if (!nonEmpty(tag)) throw new Error('RUN_TAG_INVALID');
  const re = /(?:^|\s)--title(?:\s+|=)(?:"([^"]*)"|'([^']*)'|([^\s"']+))(?=\s|$)/g;
  for (let m; typeof commandLine === 'string' && (m = re.exec(commandLine));)
    if ((m[1] ?? m[2] ?? m[3]) === tag) return true;
  return false;
}
function defaultListProcesses(options = {}) {
  const props = 'ProcessId,ParentProcessId,CommandLine,CreationDate,Name';
  const cmd = `@(Get-CimInstance Win32_Process -Property ${props}) | ConvertTo-Json -Compress`;
  const opts = { encoding: 'utf8', timeout: options.queryTimeoutMs, windowsHide: true };
  const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', cmd], opts);
  if (res.status !== 0 || res.error) throw new Error('PROCESS_QUERY_FAILED');
  const parsed = String(res.stdout || '').trim() ? JSON.parse(res.stdout) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}
function findRunProcesses(target, options = {}) {
  const spec = typeof target === 'string' ? { tag: target } : target || {};
  if (!nonEmpty(spec.tag)) throw new Error('RUN_TAG_INVALID');
  const raw = (options.listProcesses || defaultListProcesses)(options);
  if (!Array.isArray(raw)) throw new Error('PROCESS_QUERY_FAILED');
  const selfPid = Number.isInteger(options.selfPid) ? options.selfPid : process.pid;
  const tracked = options.tracked instanceof Map ? options.tracked : new Map();
  const [children, matched, queue] = [new Map(), new Map(), []];
  for (const r of raw) {
    const pid = Number(r?.pid ?? r?.ProcessId);
    const ppid = Number(r?.parentPid ?? r?.ParentProcessId);
    const name = String(r?.name ?? r?.Name ?? '');
    if (!posInt(pid) || pid === selfPid || /^conhost\.exe$/i.test(name)) continue;
    const commandLine = String(r?.commandLine ?? r?.CommandLine ?? '');
    const createdAt = r?.createdAt ?? r?.CreationDate ?? null;
    const row = { pid, parentPid: Number.isInteger(ppid) ? ppid : 0, commandLine, createdAt, name };
    children.set(row.parentPid, (children.get(row.parentPid) || []).concat(row));
    const tStart = tracked.get(pid);
    const seen = tracked.has(pid) && (!tStart || !createdAt || tStart === createdAt);
    const okStart = !spec.startedAt || !createdAt || createdAt >= spec.startedAt;
    if (hasRunTag(commandLine, spec.tag) || seen || (pid === spec.pid && okStart))
      (matched.set(pid, row), queue.push(row));
  }
  for (let cur; (cur = queue.shift());)
    for (const c of children.get(cur.pid) || []) {
      const older = cur.createdAt != null && c.createdAt != null && c.createdAt < cur.createdAt;
      if (!matched.has(c.pid) && !older) (matched.set(c.pid, c), queue.push(c));
    }
  for (const row of matched.values()) tracked.set(row.pid, row.createdAt);
  return [...matched.values()];
}
async function stopRun(target, options = {}) {
  const tracked = new Map();
  const killOne = options.killProcess || ((p) => runHarness(null, { killTree: p.pid }, options));
  const killed = new Set();
  const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0))));
  const polls = posInt(options.polls) ? options.polls : 1;
  let rem = null;
  for (let i = 0; i <= polls; i += 1) {
    rem = tryCall(() => findRunProcesses(target, { ...options, tracked }));
    if (rem && rem.length === 0 && i > 0)
      return { ok: true, stopped: true, killedPids: [...killed], remainingPids: [] };
    for (const p of rem || []) tryCall(() => (killOne(p, options), killed.add(p.pid)));
    if (i < polls) await sleep(options.pollIntervalMs);
  }
  const reason = rem ? 'WORKER_NOT_STOPPED' : 'PROCESS_QUERY_FAILED';
  const remainingPids = (rem || []).map((p) => p.pid);
  return { ok: false, stopped: false, reason, killedPids: [...killed], remainingPids };
}
async function reconcileWorktreeWorker(cwd, item, options = {}) {
  if (!nonEmpty(item)) throw new Error('WORK_ITEM_INVALID');
  const dir = options.runtimeDir || options.stateDir || options.dir;
  const { id, worktree } = worktreeId(cwd, options);
  const workerFile = path.join(dir, `worker-${id}.json`);
  const base = { worktree, workerFile };
  if (!fs.existsSync(workerFile)) return { ok: true, ...base, stoppedLeftover: null };
  const p = tryCall(() => JSON.parse(fs.readFileSync(workerFile, 'utf8')));
  const wItem = p && (p.item || p.workItemId);
  const okPid = p && !Array.isArray(p) && (p.pid === undefined || posInt(p.pid));
  if (!okPid || !nonEmpty(wItem) || !nonEmpty(p.tag))
    return { ok: false, action: 'STOP', reason: 'WORKER_STATE_UNREADABLE', ...base };
  if (wItem === item) return { ok: true, ...base, activeWorker: { ...p, item: wItem } };
  const res = await stopRun({ tag: p.tag, pid: p.pid, startedAt: p.startedAt }, options);
  if (!res.stopped) {
    const extra = { run: p.tag, item: wItem, ...base, remainingPids: res.remainingPids };
    return { ok: false, action: 'STOP', reason: 'BLOCKED_WORKER_NOT_STOPPED', ...extra };
  }
  fs.unlinkSync(workerFile);
  return { ok: true, ...base, stoppedLeftover: { item: wItem, tag: p.tag, pid: p.pid } };
}
async function acquireWorktreeOwner(cwd, item, options = {}) {
  const claim = claimWorktree(cwd, options);
  if (!claim.claimed) return { ...claim, action: 'STOP' };
  const rec = await reconcileWorktreeWorker(cwd, item, options);
  if (!rec.ok) return (claim.release(), { ...rec, claimed: false });
  return { ...claim, ...rec, ok: true, claimed: true };
}
Object.assign(exports, { resolveWorktreePath, worktreeId, claimWorktree, hasRunTag });
Object.assign(exports, { findRunProcesses, stopRun, reconcileWorktreeWorker });
exports.acquireWorktreeOwner = acquireWorktreeOwner;
