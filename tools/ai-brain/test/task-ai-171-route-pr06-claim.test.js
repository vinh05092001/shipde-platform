'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const handoff = require('../route-handoff');
const eq = assert.deepEqual;
const sorted = (a) => [...a].sort((x, y) => x - y);

function makeFixture(t, entries = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr06-claim-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const [worktree, runtimeDir] = [path.join(dir, 'wt'), path.join(dir, 'runtime')];
  fs.mkdirSync(worktree, { recursive: true });
  const running = new Map(entries);
  const kill = (pid) => {
    const state = running.get(pid);
    if (state === 'EPERM' || state === undefined)
      throw Object.assign(new Error(state || 'ESRCH'), { code: state || 'ESRCH' });
  };
  const getProcessStartedAt = (p) => (typeof running.get(p) === 'number' ? running.get(p) : null);
  const opts = (pid, startedAt) => ({ runtimeDir, pid, startedAt, kill, getProcessStartedAt });
  return { dir, worktree, runtimeDir, running, opts };
}
test('B44: concurrent claim blocks second owner and EPERM keeps worktree occupied', (t) => {
  const { worktree, running, opts } = makeFixture(t, [[101, 1000]]);
  running.set(202, 1005).set(999, 'EPERM');
  const first = handoff.claimWorktree(worktree, opts(101, 1000));
  const second = handoff.claimWorktree(worktree, opts(202, 1005));
  eq([first.claimed, second.claimed, second.reason], [true, false, 'WORKTREE_CLAIMED']);
  const dec = { workItemId: 'TASK-AI-171', selected: 'a', candidates: [] };
  const tkt = { workItemId: 'TASK-AI-171', request: { cwd: worktree } };
  const blocked = handoff.firstLaunch(dec, tkt, { worktreeClaim: second, ledger: {} }, {});
  eq([blocked.action, blocked.reason], ['STOP', 'WORKTREE_CLAIMED']);
  first.release();
  const eperm = handoff.claimWorktree(worktree, opts(999));
  const retry = handoff.claimWorktree(worktree, opts(202, 1005));
  eq([eperm.claimed, retry.claimed, fs.existsSync(eperm.lockFile)], [true, false, true]);
});
test('B44: dead owner, stale recovery gate and PID reuse allow exclusive recovery', (t) => {
  const { worktree, running, opts } = makeFixture(t, [[101, 1000]]);
  const first = handoff.claimWorktree(worktree, opts(101, 1000));
  running.delete(101);
  const gateFile = `${first.lockFile}.recover`;
  running.set(303, 2000).set(202, 2005);
  fs.writeFileSync(gateFile, JSON.stringify({ pid: 303, startedAt: 2000, claimId: 'live-gate' }));
  assert.equal(handoff.claimWorktree(worktree, opts(202, 2005)).claimed, false);
  running.delete(303);
  const recovered = handoff.claimWorktree(worktree, opts(202, 2005));
  eq([recovered.claimed, fs.existsSync(gateFile)], [true, false]);
  running.set(202, 9999).set(404, 10000);
  const afterReuse = handoff.claimWorktree(worktree, opts(404, 10000));
  recovered.release();
  eq([afterReuse.claimed, fs.existsSync(afterReuse.lockFile)], [true, true]);
});
test('B44: path aliases and directory junctions resolve to one worktree claim', (t) => {
  const { dir, running, opts } = makeFixture(t, [[101, 1000]]);
  running.set(202, 1005);
  const [realDir, aliasDir] = [path.join(dir, 'Real-Worktree'), path.join(dir, 'alias-junction')];
  fs.mkdirSync(realDir, { recursive: true });
  fs.symlinkSync(realDir, aliasDir, 'junction');
  const claim = handoff.claimWorktree(realDir, opts(101, 1000));
  assert.equal(claim.claimed, true);
  const rel = path.join(dir, 'x', '..', 'Real-Worktree');
  for (const v of [aliasDir, `${realDir.toUpperCase()}${path.sep}`, rel]) {
    const attempt = handoff.claimWorktree(v, opts(202, 1005));
    eq([attempt.claimed, attempt.id], [false, claim.id]);
  }
});
test('B43: exact run tag matching avoids collisions and kills tagged trees and orphans', async () => {
  const tag = 'TASK-AI-171-[1]*?(a)';
  function row(pid, parentPid, commandLine, createdAt = 100, name = 'node.exe') {
    return { pid, parentPid, commandLine, createdAt, name };
  }
  const rows = [
    row(10, 1, 'opencode run --title "TASK-AI-171-[1]*?(a)0"'),
    row(11, 1, 'opencode run --title "TASK-AI-171-1a"'),
    row(20, 1, `opencode run --title "${tag}"`, 100),
    row(21, 20, 'node child-worker.js', 110),
    row(22, 21, 'git status', 120),
    row(23, 20, 'conhost.exe', 110, 'conhost.exe'),
    row(24, 20, 'recycled-parent.exe', 50),
    row(30, 1, `node --title=${tag} orphan.js`, 115),
    row(process.pid, 1, `opencode --title "${tag}"`),
  ];
  const matched = handoff.findRunProcesses(tag, { listProcesses: () => rows });
  eq(sorted(matched.map((p) => p.pid)), [20, 21, 22, 30]);
  const live = new Map(rows.map((r) => [r.pid, r]));
  const killed = [];
  const listProcesses = () => [...live.values()];
  const killProcess = (p) => (killed.push(p.pid), live.delete(p.pid));
  const sOpts = { polls: 2, pollIntervalMs: 0, listProcesses, killProcess };
  const res = await handoff.stopRun(tag, sOpts);
  eq([res.stopped, sorted(killed)], [true, [20, 21, 22, 30]]);
  eq([live.has(10), live.has(11), live.has(24)], [true, true, true]);
});
test('B43: process query failure and refused descendant termination never confirm stop', async () => {
  const throwQuery = () => assert.fail('WMI timeout');
  const qOpts = { polls: 2, pollIntervalMs: 0, listProcesses: throwQuery, killProcess: () => {} };
  const queryFail = await handoff.stopRun('TASK-AI-171-run', qOpts);
  eq([queryFail.stopped, queryFail.reason], [false, 'PROCESS_QUERY_FAILED']);
  const live = new Map([
    [50, { pid: 50, parentPid: 1, commandLine: 'opencode --title run-refused', createdAt: 100 }],
    [51, { pid: 51, parentPid: 50, commandLine: 'node stubborn-child.js', createdAt: 110 }],
  ]);
  const listProcesses = () => [...live.values()];
  const killProcess = (p) => p.pid === 50 && live.delete(50);
  const rOpts = { polls: 3, pollIntervalMs: 0, listProcesses, killProcess };
  const refused = await handoff.stopRun('run-refused', rOpts);
  eq([refused.stopped, refused.reason, refused.remainingPids], [false, 'WORKER_NOT_STOPPED', [51]]);
  const id = 'TASK-AI-171';
  const dec = { workItemId: id, selected: 'a', candidates: [{ offeringId: 'a', upstream: 'u' }] };
  const tkt = { workItemId: id, maxFallbacks: 1, request: {} };
  const ctx = { ledger: { activeWorker: { offeringId: 'a' } } };
  const fail = { offeringId: 'a', upstream: 'u', status: 500, stopResult: refused };
  const handoffStop = handoff.afterFailure(dec, tkt, ctx, fail, {});
  eq([handoffStop.action, handoffStop.reason], ['STOP', 'WORKER_NOT_STOPPED']);
});
test('B45: orphan reconciler fails closed on bad state or live process and unlinks on stop', async (t) => {
  const { worktree, runtimeDir } = makeFixture(t);
  const probe = handoff.claimWorktree(worktree, { runtimeDir, pid: 101 });
  const workerFile = path.join(runtimeDir, `worker-${probe.id}.json`);
  probe.release();
  fs.writeFileSync(workerFile, '{corrupt');
  const baseOpts = { runtimeDir, pid: 101, polls: 2, pollIntervalMs: 0 };
  const acquire = (o) =>
    handoff.acquireWorktreeOwner(worktree, 'TASK-AI-171', { ...baseOpts, ...o });
  const bad = await acquire({ listProcesses: () => [] });
  eq([bad.ok, bad.reason, fs.existsSync(workerFile)], [false, 'WORKER_STATE_UNREADABLE', true]);
  let allowKill = false;
  const cmd = 'opencode --title OTHER-1-tag';
  const live = new Map([[77, { pid: 77, parentPid: 1, commandLine: cmd, createdAt: 200 }]]);
  const killProcess = (p) => allowKill && live.delete(p.pid);
  const io = { listProcesses: () => [...live.values()], killProcess };
  fs.writeFileSync(workerFile, JSON.stringify({ item: 'OTHER-1', tag: 'OTHER-1-tag', pid: 77 }));
  const stuck = await acquire(io);
  eq([stuck.ok, stuck.reason], [false, 'BLOCKED_WORKER_NOT_STOPPED']);
  eq([fs.existsSync(workerFile)], [true]);
  allowKill = true;
  const ok = await acquire(io);
  eq([ok.ok, ok.claimed, ok.stoppedLeftover.item], [true, true, 'OTHER-1']);
  assert.equal(fs.existsSync(workerFile), false);
  ok.release();
});
