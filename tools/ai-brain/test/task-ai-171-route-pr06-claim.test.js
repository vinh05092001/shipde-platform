'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const handoff = require('../route-handoff');
const claim = require('../coordinator-claim');
const eq = assert.deepEqual;

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

function makeRoute() {
  const route = { offeringId: 'a', modelId: 'm/a', gateway: 'gw', upstream: 'u', harness: 'paseo' };
  const providers = { gw: { harness: 'paseo', provider: 'opencode' } };
  const reg = { sources: [], dispatch: { providers, launchModes: { opencode: ['full-access'] } } };
  const dec = { workItemId: 'TASK-AI-171', selected: 'a', candidates: [route] };
  const ev = [{ status: 'passed', proofLevel: 'HARNESS_PASS' }];
  const evidenceData = { combinations: [{ ...route, evidence: ev }] };
  return { route, reg, dec, evidenceData };
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
  const { reg, dec, evidenceData } = makeRoute();
  const request = { cwd: worktree };
  const tkt = { workItemId: 'TASK-AI-171', outputTokens: 10, minProof: 'HARNESS_PASS', request };
  const noClaim = handoff.firstLaunch(dec, tkt, { evidenceData, ledger: {} }, reg);
  const wrongClaim = handoff.firstLaunch(
    dec,
    tkt,
    { worktreeClaim: otherClaim, evidenceData, ledger: {} },
    reg,
  );
  const okLaunch = handoff.firstLaunch(
    dec,
    tkt,
    { worktreeClaim: validClaim, evidenceData, ledger: {} },
    reg,
  );
  eq([noClaim.action, wrongClaim.action, okLaunch.action], ['STOP', 'STOP', 'LAUNCH']);
  validClaim.release();
  otherClaim.release();
  const eperm = claim.claimWorktree(worktree, opts(999));
  const retry = claim.claimWorktree(worktree, opts(202, 1005));
  eq([eperm.claimed, retry.claimed, fs.existsSync(eperm.lockFile)], [true, false, true]);
});

test('Finding 1: route-handoff.firstLaunch rejects when no claim is present', (t) => {
  const { worktree, opts } = makeFixture(t, [[101, 1000]]);
  const { reg, dec, evidenceData } = makeRoute();
  const request = { cwd: worktree };
  const tkt = { workItemId: 'TASK-AI-171', outputTokens: 10, minProof: 'HARNESS_PASS', request };
  // Call route-handoff.firstLaunch directly — no claim in context
  const out = handoff.firstLaunch(dec, tkt, { evidenceData, ledger: {} }, reg);
  eq([out.action, out.reason], ['STOP', 'WORKTREE_CLAIM_REQUIRED']);
  // With a valid claim it works
  const valid = claim.claimWorktree(worktree, opts(101, 1000));
  const ok = handoff.firstLaunch(
    dec,
    tkt,
    { worktreeClaim: valid, evidenceData, ledger: {} },
    reg,
  );
  assert.equal(ok.action, 'LAUNCH');
  valid.release();
});

test('Finding 2: metadata-only claim is rejected for launch and reconciliation', async (t) => {
  const { worktree, runtimeDir, running, opts } = makeFixture(t, [[101, 1000]]);
  running.set(202, 2000);
  // Real owner holds the lock
  const realOwner = claim.claimWorktree(worktree, opts(101, 1000));
  assert.equal(realOwner.claimed, true);
  // Forge a metadata-only claim: has claimed:true + matching id/worktree but no lockFile/claimId
  const target = claim.worktreeId(worktree);
  const metadataOnly = { claimed: true, id: target.id, worktree: target.worktree };
  // verifyWorktreeClaim rejects metadata-only
  const check = claim.verifyWorktreeClaim(worktree, metadataOnly, opts(202, 2000));
  eq([check.ok, check.reason], [false, 'WORKTREE_CLAIM_REQUIRED']);
  // firstLaunch via route-handoff with metadata-only claim rejects
  const { reg, dec, evidenceData } = makeRoute();
  const request = { cwd: worktree };
  const tkt = { workItemId: 'TASK-AI-171', outputTokens: 10, minProof: 'HARNESS_PASS', request };
  const launch = handoff.firstLaunch(
    dec,
    tkt,
    { worktreeClaim: metadataOnly, evidenceData, ledger: {} },
    reg,
  );
  eq([launch.action, launch.reason], ['STOP', 'WORKTREE_CLAIM_REQUIRED']);
  // reconcileWorktreeWorker with metadata-only claim rejects
  const workerFile = path.join(runtimeDir, `worker-${target.id}.json`);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    workerFile,
    JSON.stringify({ item: 'OTHER-1', tag: 'other-tag', pid: 303 }),
  );
  const rec = await claim.reconcileWorktreeWorker(worktree, 'TASK-AI-171', {
    ...opts(202, 2000),
    worktreeClaim: metadataOnly,
  });
  eq([rec.ok, rec.reason], [false, 'WORKTREE_CLAIMED']);
  realOwner.release();
});

test('Finding 7: dead same-item worker record does not block restart', async (t) => {
  const { worktree, runtimeDir, running, opts } = makeFixture(t, [[101, 1000]]);
  // Set up a worker file for the same item, with a dead PID
  const target = claim.worktreeId(worktree);
  const workerFile = path.join(runtimeDir, `worker-${target.id}.json`);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const deadWorker = { item: 'TASK-AI-171', tag: 'dead-tag', pid: 777, startedAt: 500 };
  fs.writeFileSync(workerFile, JSON.stringify(deadWorker));
  // PID 777 is not alive (not in running map)
  const result = await claim.acquireWorktreeOwner(worktree, 'TASK-AI-171', opts(101, 1000));
  // Should succeed — dead same-item worker was cleaned up, not blocking
  eq([result.ok, result.claimed], [true, true]);
  assert.equal(result.stoppedLeftover?.item, 'TASK-AI-171');
  assert.equal(result.stoppedLeftover?.pid, 777);
  assert.equal(fs.existsSync(workerFile), false);
  result.release();
  // Verify a LIVE same-item worker DOES block
  const liveWorker = { item: 'TASK-AI-171', tag: 'live-tag', pid: 101, startedAt: 1000 };
  fs.writeFileSync(workerFile, JSON.stringify(liveWorker));
  const blocked = await claim.acquireWorktreeOwner(worktree, 'TASK-AI-171', opts(101, 1000));
  assert.equal(blocked.activeWorker?.item, 'TASK-AI-171');
  assert.equal(blocked.activeWorker?.pid, 101);
  blocked.release();
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
  const caseAlias = process.platform === 'win32' ? [`${realDir.toUpperCase()}${path.sep}`] : [];
  for (const v of [aliasDir, ...caseAlias, rel]) {
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

test('B45: unreadable state, replacement worker and unlink error', async (t) => {
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
  const nextWorker = JSON.stringify({ item: 'NEW-2', tag: 'NEW-2-tag', pid: 88 });
  const raceStopRun = async () => {
    // Simulate another process replacing the worker file during stop
    fs.writeFileSync(workerFile, nextWorker);
    return { ok: true, stopped: true, killedPids: [77], remainingPids: [] };
  };
  const repOpts = opts(101, 1000, { stopRun: raceStopRun });
  const replaced = await claim.acquireWorktreeOwner(worktree, 'TASK-AI-171', repOpts);
  const keptItem = JSON.parse(fs.readFileSync(workerFile, 'utf8')).item;
  eq([replaced.ok, replaced.reason, keptItem], [false, 'WORKER_STATE_CHANGED', 'NEW-2']);
  const origUnlink = fs.unlinkSync;
  t.mock.method(fs, 'unlinkSync', (p) => {
    if (p === workerFile) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    return origUnlink.call(fs, p);
  });
  const emptyOpts = opts(101, 1000, {
    stopRun: async () => ({ ok: true, stopped: true, killedPids: [], remainingPids: [] }),
  });
  await assert.rejects(() => claim.acquireWorktreeOwner(worktree, 'TASK-AI-171', emptyOpts));
  fs.unlinkSync.mock.restore();
  const reacquired = await claim.acquireWorktreeOwner(worktree, 'TASK-AI-171', emptyOpts);
  eq([reacquired.ok, reacquired.claimed, fs.existsSync(workerFile)], [true, true, false]);
  reacquired.release();
});
