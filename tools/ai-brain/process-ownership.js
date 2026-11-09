'use strict';
const childProcess = require('node:child_process');

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const posInt = (v) => Number.isInteger(v) && v > 0;
const sameGen = (a, b) => a != null && b != null && String(a) === String(b);
function tryCall(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
function hasRunTag(commandLine, tag) {
  if (!nonEmpty(tag)) throw new Error('RUN_TAG_INVALID');
  const [s, tokens] = [typeof commandLine === 'string' ? commandLine : '', []];
  for (let i = 0; i < s.length; ) {
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (i >= s.length) break;
    let [val, pre, q, quoted] = ['', '', null, false];
    while (i < s.length && (q || !/\s/.test(s[i]))) {
      const ch = s[i++];
      if (!q && (ch === '"' || ch === "'")) {
        q = ch;
        quoted = true;
      } else if (q && ch === q) {
        q = null;
      } else if (q === '"' && ch === '\\' && i < s.length && s[i] === '"') {
        val += s[i++];
      } else {
        val += ch;
        if (!quoted) pre += ch;
      }
    }
    tokens.push({ val, pre, quoted });
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!t.quoted && t.val === '--title') {
      if (i + 1 < tokens.length && tokens[i + 1].val === tag) return true;
      i += 1;
    } else if (t.pre.startsWith('--title=') && t.val.slice(8) === tag) {
      return true;
    }
  }
  return false;
}
function defaultListProcesses(options = {}) {
  const props = 'ProcessId,ParentProcessId,CommandLine,CreationDate,Name';
  const cim = `Get-CimInstance Win32_Process -Property ${props} -ErrorAction Stop`;
  const body = "if ($r.Count -eq 0) { '[]' } else { $r | ConvertTo-Json -Compress }";
  const cmd = `$ErrorActionPreference = 'Stop'; $r = @(${cim}); ${body}`;
  const opts = { encoding: 'utf8', timeout: options.queryTimeoutMs, windowsHide: true };
  const spawn = options.spawnSync || childProcess.spawnSync;
  const res = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], opts);
  const out = String(res?.stdout || '').trim();
  const ok = res?.status === 0 && !res.error && !nonEmpty(res.stderr) && Boolean(out);
  const parsed = ok ? tryCall(() => JSON.parse(out)) : null;
  if (!parsed || typeof parsed !== 'object') throw new Error('PROCESS_QUERY_FAILED');
  return Array.isArray(parsed) ? parsed : [parsed];
}
function defaultKillProcess(proc, options = {}) {
  if (options.env?.ROUTE_TEST_NO_KILL || process.env.ROUTE_TEST_NO_KILL) return false;
  try {
    (options.kill || process.kill)(proc.pid, 'SIGTERM');
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'ESRCH');
  }
}
function findRunProcesses(target, options = {}) {
  const spec = typeof target === 'string' ? { tag: target } : target || {};
  if (!nonEmpty(spec.tag)) throw new Error('RUN_TAG_INVALID');
  const raw = (options.listProcesses || defaultListProcesses)(options);
  if (!Array.isArray(raw)) throw new Error('PROCESS_QUERY_FAILED');
  const selfPid = Number.isInteger(options.selfPid) ? options.selfPid : process.pid;
  const tracked = options.tracked instanceof Map ? options.tracked : new Map();
  const [byPid, children, matched, queue] = [new Map(), new Map(), new Map(), []];
  const add = (row) => {
    matched.set(row.pid, row);
    queue.push(row);
  };
  for (const r of raw) {
    const pid = Number(r?.pid ?? r?.ProcessId);
    const ppid = Number(r?.parentPid ?? r?.ParentProcessId);
    const name = String(r?.name ?? r?.Name ?? '');
    if (!posInt(pid) || pid === selfPid || /^conhost\.exe$/i.test(name)) continue;
    const commandLine = String(r?.commandLine ?? r?.CommandLine ?? '');
    const createdAt = r?.createdAt ?? r?.CreationDate ?? null;
    const row = { pid, parentPid: Number.isInteger(ppid) ? ppid : 0, commandLine, createdAt, name };
    byPid.set(pid, row);
    children.set(row.parentPid, (children.get(row.parentPid) || []).concat(row));
    const seen = tracked.has(pid) && sameGen(createdAt, tracked.get(pid));
    const byId = posInt(spec.pid) && pid === spec.pid && sameGen(createdAt, spec.startedAt);
    if (hasRunTag(commandLine, spec.tag) || seen || byId) add(row);
  }
  if (posInt(spec.pid) && !byPid.has(spec.pid)) {
    queue.push({ pid: spec.pid, createdAt: spec.startedAt ?? null });
  }
  for (const [tPid, tStart] of tracked.entries()) {
    if (!byPid.has(tPid)) queue.push({ pid: tPid, createdAt: tStart ?? null });
  }
  for (let cur; (cur = queue.shift()); ) {
    for (const c of children.get(cur.pid) || []) {
      const older = cur.createdAt != null && c.createdAt != null && c.createdAt < cur.createdAt;
      if (!matched.has(c.pid) && !older) add(c);
    }
  }
  for (const row of matched.values()) tracked.set(row.pid, row.createdAt);
  return [...matched.values()];
}
async function stopRun(target, options = {}) {
  const [tracked, killed, attempted, refused] = [new Map(), new Set(), new Set(), new Set()];
  const killOne = options.killProcess || defaultKillProcess;
  const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0))));
  const polls = posInt(options.polls) ? options.polls : 1;
  const lists = () => ({
    killedPids: [...killed],
    attemptedPids: [...attempted],
    refusedPids: [...refused],
  });
  let rem = null;
  for (let i = 0; i <= polls; i += 1) {
    rem = tryCall(() => findRunProcesses(target, { ...options, tracked }));
    if (rem && rem.length === 0 && i > 0) {
      return { ok: true, stopped: true, ...lists(), remainingPids: [] };
    }
    for (const p of rem || []) {
      attempted.add(p.pid);
      const r = tryCall(() => ({ v: killOne(p, options) }));
      const bad = !r || r.v === false || (r.v && (r.v.ok === false || (r.v.exitCode ?? 0) !== 0));
      if (!bad) {
        killed.add(p.pid);
        refused.delete(p.pid);
      } else {
        refused.add(p.pid);
      }
    }
    if (i < polls) await sleep(options.pollIntervalMs);
  }
  const remainingPids = (rem || []).map((p) => p.pid);
  for (const pid of remainingPids) killed.delete(pid);
  const reason = rem ? 'WORKER_NOT_STOPPED' : 'PROCESS_QUERY_FAILED';
  return { ok: false, stopped: false, reason, ...lists(), remainingPids };
}
module.exports = { hasRunTag, defaultListProcesses, defaultKillProcess, findRunProcesses, stopRun };
