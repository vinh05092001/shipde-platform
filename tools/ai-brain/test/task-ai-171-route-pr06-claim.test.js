'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const handoff = require('../route-handoff');
const claim = require('../coordinator-claim');
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
    if (state === 'EPERM' || state === undefined) {
      throw Object.assign(new Error(state || 'ESRCH'), { code: state || 'ESRCH' });
    }
  };
  const getProcessStartedAt = (p) => (typeof running.get(p) === 'number' ? running.get(p) : null);
  const base = { runtimeDir, kill, getProcessStartedAt };
  const opts = (pid, startedAt, extra = {}) => ({ ...base, pid, startedAt, ...extra });
  return { dir, worktree, runtimeDir, running, opts };
}
test('B44: concurrent claim, legacy PID lock, EPERM and worktree-bound launch', (t) => {
  const { dir, worktree, running, opts } = makeFixture(t, [[101, 1000]]);
  const otherWt = path.join(dir, 'other-wt');
  fs.mkdirSync(otherWt, { recursive: true });
  running.set(202, 1005).set(999, 'EPERM');
  const first = claim.claimWorktree(worktree, opts(101, 1000));
  const second = claim.claimWorktree(worktree, opts(202, 1005));
  eq([first.claimed, second.claimed, second.reason], [true, false, 'WORKTREE_CLAIMED']);
  fs.writeFileSync(first.lockFile, '101');
  const legacy = claim.claimWorktree(worktree, opts(202, 1005));
  eq([legacy.claimed, fs.readFileSync(first.lockFile, 'utf8')], [false, '101']);
  fs.unlinkSync(first.lockFile);
  const validClaim = claim.claimWorktree(worktree, opts(101, 1000));
  const otherClaim = claim.claimWorktree(otherWt, opts(202, 1005));
  const route = { offeringId: 'a', modelId: 'm/a', gateway: 'gw', upstream: 'u', harness: 'paseo' };
  const providers = { gw: { harness: 'paseo', provider: 'opencode' } };
  const reg = { sources: [], dispatch: { providers, launchModes: { opencode: ['full-access'] } } };
  const dec = { workItemId: 'TASK-AI-171', selected: 'a', candidates: [route] };
  const request = { cwd: worktree };
  const tkt = { workItemId: 'TASK-AI-171', outputTokens: 10, minProof: 'HARNESS_PASS', request };
  const ev = [{ status: 'passed', proofLevel: 'HARNESS_PASS' }];
  const evidenceData = { combinations: [{ ...route, evidence: ev }] };
  const admit = claim.firstLaunch || handoff.firstLaunch;
  const noClaim = admit(dec, tkt, { evidenceData, ledger: {} }, reg);
  const wrongClaim = admit(dec, tkt, { worktreeClaim: otherClaim, evidenceData, ledger: {} }, reg);
  const okLaunch = admit(dec, tkt, { worktreeClaim: validClaim, evidenceData, ledger: {} }, reg);
  eq([noClaim.action, wrongClaim.action, okLaunch.action], ['STOP', 'STOP', 'LAUNCH']);
  validClaim.release();
  otherClaim.release();
  const eperm = claim.claimWorktree(worktree, opts(999));
  const retry = claim.claimWorktree(worktree, opts(202, 1005));
  eq([eperm.claimed, retry.claimed, fs.existsSync(eperm.lockFile)], [true, false, true]);
});
test('B44: dead owner, stale gate and interleaved contenders recover exclusively', (t) => {
  const { worktree, running, opts } = makeFixture(t, [[101, 1000]]);
  const first = claim.claimWorktree(worktree, opts(101, 1000));
  running.delete(101);
  const gateFile = `${first.lockFile}.recover`;
  running.set(303, 2000).set(202, 2005).set(404, 2010);
  fs.writeFileSync(gateFile, JSON.stringify({ pid: 303, startedAt: 2000, claimId: 'dead-gate' }));
  running.delete(303);
  const origRead = fs.readFileSync;
  let [hookedGate, contenderB] = [false, null];
  t.mock.method(fs, 'readFileSync', (f, enc) => {
    const out = origRead.call(fs, f, enc);
    if (!hookedGate && f === gateFile) {
      hookedGate = true;
      contenderB = claim.claimWorktree(worktree, opts(404, 2010));
    }
    return out;
  });
  const contenderA = claim.claimWorktree(worktree, opts(202, 2005));
  fs.readFileSync.mock.restore();
  assert.equal(Number(contenderA.claimed) + Number(contenderB.claimed), 1);
  (contenderA.claimed ? contenderA : contenderB).release();
  const origOpen = fs.openSync;
  let [hookedPub, contenderPub] = [false, null];
  t.mock.method(fs, 'openSync', (f, fl) => {
    const fd = origOpen.call(fs, f, fl);
    if (!hookedPub && f === first.lockFile) {
      hookedPub = true;
      contenderPub = claim.claimWorktree(worktree, opts(404, 2010));
    }
    return fd;
  });
  const pubWinner = claim.claimWorktree(worktree, opts(202, 2005));
  fs.openSync.mock.restore();
  eq([pubWinner.claimed, contenderPub ? contenderPub.claimed : false], [true, false]);
  pubWinner.release();
  fs.writeFileSync(first.lockFile, '');
  assert.equal(claim.claimWorktree(worktree, opts(404, 2010)).claimed, false);
  fs.writeFileSync(first.lockFile, JSON.stringify({ pid: 101, startedAt: 1000, claimId: 'dead' }));
  let [hookedLock, contenderD] = [false, null];
  t.mock.method(fs, 'readFileSync', (f, enc) => {
    const out = origRead.call(fs, f, enc);
    if (!hookedLock && f === first.lockFile && JSON.parse(out || '{}').pid === 101) {
      hookedLock = true;
      const stale = { pid: 303, startedAt: 2000, claimId: 'dead-gate' };
      fs.writeFileSync(gateFile, JSON.stringify(stale));
      contenderD = claim.claimWorktree(worktree, opts(404, 2010));
    }
    return out;
  });
  const contenderC = claim.claimWorktree(worktree, opts(202, 2005));
  fs.readFileSync.mock.restore();
  assert.equal(Number(contenderC.claimed) + Number(contenderD.claimed), 1);
});
test('B44: path aliases share one identity and failed canonicalization fails closed', (t) => {
  const { dir, running, opts } = makeFixture(t, [[101, 1000]]);
  running.set(202, 1005);
  const [realDir, aliasDir] = [path.join(dir, 'Real-Worktree'), path.join(dir, 'alias-junction')];
  fs.mkdirSync(realDir, { recursive: true });
  fs.symlinkSync(realDir, aliasDir, 'junction');
  const held = claim.claimWorktree(realDir, opts(101, 1000));
  assert.equal(held.claimed, true);
  const rel = path.join(dir, 'x', '..', 'Real-Worktree');
  for (const v of [aliasDir, `${realDir.toUpperCase()}${path.sep}`, rel]) {
    const attempt = claim.claimWorktree(v, opts(202, 1005));
    eq([attempt.claimed, attempt.id], [false, held.id]);
  }
  const origReal = fs.realpathSync;
  const failAlias = (p) => {
    if (path.resolve(p) === path.resolve(aliasDir)) {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    }
    return origReal(p);
  };
  t.mock.method(fs, 'realpathSync', failAlias);
  if (fs.realpathSync.native) t.mock.method(fs.realpathSync, 'native', failAlias);
  const unresolved = claim.claimWorktree(aliasDir, opts(202, 1005));
  fs.realpathSync.mock.restore();
  eq([unresolved.claimed, unresolved.reason], [false, 'WORKTREE_PATH_UNRESOLVED']);
});
test('B43: command-line quoting, exact PID generation and untagged orphans', async () => {
  const tag = 'old-run';
  const row = (pid, parentPid, commandLine, createdAt = 100, name = 'node.exe') => {
    return { pid, parentPid, commandLine, createdAt, name };
  };
  const quotedCmd = 'node logger.js --message "retry --title old-run later"';
  assert.equal(claim.hasRunTag(quotedCmd, tag), false);
  const reused = [
    row(77, 1, 'node unrelated-reused-pid.js', 200),
    row(78, 1, quotedCmd, 100),
    row(51, 50, 'node orphan-child.js', 110),
    row(52, 51, 'node orphan-grandchild.js', 120),
    row(53, 50, 'conhost.exe', 110, 'conhost.exe'),
    row(54, 50, 'recycled-before-parent.exe', 50),
  ];
  const headOpts = { listProcesses: () => reused.slice(0, 2) };
  eq(claim.findRunProcesses({ tag, pid: 77, startedAt: 100 }, headOpts), []);
  const allOpts = { listProcesses: () => reused };
  const orphans = claim.findRunProcesses({ tag, pid: 50, startedAt: 100 }, allOpts);
  eq(sorted(orphans.map((p) => p.pid)), [51, 52]);
  const live = new Map(reused.map((r) => [r.pid, r]));
  const sOpts = {
    polls: 2,
    pollIntervalMs: 0,
    listProcesses: () => [...live.values()],
    killProcess: (p) => live.delete(p.pid),
  };
  const res = await claim.stopRun({ tag, pid: 50, startedAt: 100 }, sOpts);
  const sState = [res.stopped, sorted(res.killedPids), live.has(77), live.has(78)];
  eq(sState, [true, [51, 52], true, true]);
});
test('B43: PowerShell query errors and refused child termination never confirm stop', async (t) => {
  const { worktree } = makeFixture(t, [[101, 1000]]);
  const live = new Map([
    [50, { pid: 50, parentPid: 1, commandLine: 'opencode --title run-refused', createdAt: 100 }],
    [51, { pid: 51, parentPid: 50, commandLine: 'node stubborn-child.js', createdAt: 110 }],
  ]);
  const rOpts = {
    polls: 2,
    pollIntervalMs: 0,
    listProcesses: () => [...live.values()],
    killProcess: (p) => p.pid === 50 && live.delete(50),
  };
  const refused = await claim.stopRun('run-refused', rOpts);
  const rState = [refused.stopped, refused.reason, refused.killedPids, refused.remainingPids];
  eq(rState, [false, 'WORKER_NOT_STOPPED', [50], [51]]);
  const spawnSync = () => ({ status: 0, stdout: '', stderr: 'Get-CimInstance: Access denied' });
  assert.throws(() => claim.defaultListProcesses({ spawnSync }), /PROCESS_QUERY_FAILED/);
  const qOpts = { polls: 2, pollIntervalMs: 0, spawnSync };
  const queryFail = await claim.stopRun('run-1', qOpts);
  eq([queryFail.stopped, queryFail.reason], [false, 'PROCESS_QUERY_FAILED']);
  const cand = { offeringId: 'a', upstream: 'u' };
  const dec = { workItemId: 'TASK-AI-171', selected: 'a', candidates: [cand] };
  const tkt = { workItemId: 'TASK-AI-171', maxFallbacks: 1, request: { cwd: worktree } };
  const ctx = { ledger: { activeWorker: { offeringId: 'a' }, worktree } };
  const onFail = claim.afterFailure || handoff.afterFailure;
  const fail = { offeringId: 'a', upstream: 'u', status: 500, stopResult: refused };
  const handoffStop = onFail(dec, tkt, ctx, fail, {});
  eq([handoffStop.action, handoffStop.reason], ['STOP', 'WORKER_NOT_STOPPED']);
});
test('B45: adapter boundary, unreadable state, replacement worker and unlink error', async (t) => {
  const { worktree, runtimeDir, opts } = makeFixture(t, [[101, 1000]]);
  const probe = claim.claimWorktree(worktree, opts(101, 1000));
  const workerFile = path.join(runtimeDir, `worker-${probe.id}.json`);
  probe.release();
  const initialWorker = { item: 'OTHER-1', tag: 'OTHER-1-tag', pid: 77, startedAt: 200 };
  fs.writeFileSync(workerFile, JSON.stringify(initialWorker));
  const [origExists, origStat] = [fs.existsSync, fs.statSync];
  t.mock.method(fs, 'existsSync', (p) => (p === workerFile ? false : origExists.call(fs, p)));
  t.mock.method(fs, 'statSync', (p) => {
    if (p === workerFile) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    return origStat.call(fs, p);
  });
  const unreadable = await claim.acquireWorktreeOwner(worktree, 'TASK-AI-171', opts(101, 1000));
  fs.existsSync.mock.restore();
  fs.statSync.mock.restore();
  eq([unreadable.ok, unreadable.reason], [false, 'WORKER_STATE_UNREADABLE']);
  const cmd77 = 'opencode --title OTHER-1-tag';
  const live = new Map([[77, { pid: 77, parentPid: 1, commandLine: cmd77, createdAt: 200 }]]);
  const nextWorker = JSON.stringify({ item: 'NEW-2', tag: 'NEW-2-tag', pid: 88 });
  const repOpts = opts(101, 1000, {
    polls: 2,
    pollIntervalMs: 0,
    listProcesses: () => [...live.values()],
    killProcess: (p) => live.delete(p.pid),
    sleep: async () => fs.writeFileSync(workerFile, nextWorker),
  });
  const replaced = await claim.acquireWorktreeOwner(worktree, 'TASK-AI-171', repOpts);
  const keptItem = JSON.parse(fs.readFileSync(workerFile, 'utf8')).item;
  eq([replaced.ok, replaced.reason, keptItem], [false, 'WORKER_STATE_CHANGED', 'NEW-2']);
  const origUnlink = fs.unlinkSync;
  t.mock.method(fs, 'unlinkSync', (p) => {
    if (p === workerFile) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    return origUnlink.call(fs, p);
  });
  const emptyOpts = opts(101, 1000, { listProcesses: () => [] });
  await assert.rejects(() => claim.acquireWorktreeOwner(worktree, 'TASK-AI-171', emptyOpts));
  fs.unlinkSync.mock.restore();
  const reacquired = await claim.acquireWorktreeOwner(worktree, 'TASK-AI-171', emptyOpts);
  eq([reacquired.ok, reacquired.claimed, fs.existsSync(workerFile)], [true, true, false]);
  reacquired.release();
  const procAdapter = require('../process-ownership');
  assert.equal(typeof procAdapter.stopRun, 'function');
});
