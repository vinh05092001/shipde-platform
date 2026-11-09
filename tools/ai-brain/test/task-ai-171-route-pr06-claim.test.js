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
  const ok = handoff.firstLaunch(dec, tkt, { worktreeClaim: valid, evidenceData, ledger: {} }, reg);
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
    reg
  );
  eq([launch.action, launch.reason], ['STOP', 'WORKTREE_CLAIM_REQUIRED']);
  // reconcileWorktreeWorker with metadata-only claim rejects
  const workerFile = path.join(runtimeDir, `worker-${target.id}.json`);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(workerFile, JSON.stringify({ item: 'OTHER-1', tag: 'other-tag', pid: 303 }));
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
