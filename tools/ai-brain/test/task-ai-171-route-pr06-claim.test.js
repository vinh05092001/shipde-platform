'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const handoff = require('../route-handoff');
const claim = require('../coordinator-claim');
const eq = assert.deepEqual;

const route = { offeringId: 'a', modelId: 'm/a', gateway: 'gw', upstream: 'u', harness: 'paseo' };
const reg = {
  sources: [],
  dispatch: {
    providers: { gw: { harness: 'paseo', provider: 'opencode' } },
    launchModes: { opencode: ['full-access'] },
  },
};
const dec = { workItemId: 'TASK-AI-171', selected: 'a', candidates: [route] };
const evidenceData = {
  combinations: [{ ...route, evidence: [{ status: 'passed', proofLevel: 'HARNESS_PASS' }] }],
};

function fixture(t, entries = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr06-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const [worktree, runtimeDir] = [path.join(dir, 'wt'), path.join(dir, 'rt')];
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  const running = new Map(entries);
  const kill = (pid) => {
    const s = running.get(pid);
    if (s === 'EPERM' || s === undefined)
      throw Object.assign(new Error(s || 'ESRCH'), { code: s || 'ESRCH' });
  };
  const getProcessStartedAt = (p) => (typeof running.get(p) === 'number' ? running.get(p) : null);
  const opts = (pid, startedAt, extra = {}) => ({
    runtimeDir,
    kill,
    getProcessStartedAt,
    pid,
    startedAt,
    ...extra,
  });
  const tkt = (cwd = worktree) => ({
    workItemId: 'TASK-AI-171',
    outputTokens: 10,
    minProof: 'HARNESS_PASS',
    request: cwd ? { cwd } : {},
  });
  return { dir, worktree, runtimeDir, opts, tkt };
}

test('Finding 1 / Item d1: firstLaunch rejects when no claim, unresolved or omitted cwd', (t) => {
  const f = fixture(t, [[101, 1000]]);
  const chk = (cwd, c) =>
    handoff.firstLaunch(dec, f.tkt(cwd), { evidenceData, ledger: {}, ...c }, reg);
  eq([chk().reason], ['WORKTREE_CLAIM_REQUIRED']);
  const pr07Dir = path.join(f.dir, 'pr07-worktree');
  fs.mkdirSync(pr07Dir, { recursive: true });
  const pr07Lock = claim.claimWorktree(pr07Dir, f.opts(101, 1000));
  eq([chk(pr07Dir).reason], ['WORKTREE_CLAIM_REQUIRED']);
  pr07Lock.release();
  eq([chk(path.join(f.dir, 'no-path')).reason], ['WORKTREE_CLAIM_REQUIRED']);
  eq([chk(null).reason], ['WORKTREE_CLAIM_REQUIRED']);
  const permissive = () => ({ ok: true });
  const outPermissiveNoClaim = chk(f.worktree, { verifyWorktreeClaim: permissive });
  assert.notEqual(outPermissiveNoClaim.action, 'LAUNCH');
  eq(
    [outPermissiveNoClaim.action, outPermissiveNoClaim.reason],
    ['STOP', 'WORKTREE_CLAIM_REQUIRED']
  );
  const outPermissiveNoCwd = chk(null, { verifyWorktreeClaim: permissive });
  assert.notEqual(outPermissiveNoCwd.action, 'LAUNCH');
  eq([outPermissiveNoCwd.action, outPermissiveNoCwd.reason], ['STOP', 'WORKTREE_CLAIM_REQUIRED']);
  const valid = claim.claimWorktree(f.worktree, f.opts(101, 1000));
  assert.equal(chk(f.worktree, { worktreeClaim: valid, ...f.opts(101, 1000) }).action, 'LAUNCH');
  valid.release();
});

test('Finding 2 / Item d4: metadata-only and missing worktree disk binding rejected', async (t) => {
  const f = fixture(t, [
    [101, 1000],
    [202, 2000],
  ]);
  const realOwner = claim.claimWorktree(f.worktree, f.opts(101, 1000));
  const target = claim.worktreeId(f.worktree);
  const metadataOnly = { claimed: true, id: target.id, worktree: target.worktree };
  eq(
    [claim.verifyWorktreeClaim(f.worktree, metadataOnly, f.opts(202, 2000)).reason],
    ['WORKTREE_CLAIM_REQUIRED']
  );
  const chk = (c) =>
    handoff.firstLaunch(dec, f.tkt(), { worktreeClaim: c, evidenceData, ledger: {} }, reg).reason;
  const rec = (c, o) =>
    claim.reconcileWorktreeWorker(f.worktree, 'TASK-AI-171', { ...o, worktreeClaim: c });
  eq([chk(metadataOnly)], ['WORKTREE_CLAIM_REQUIRED']);
  eq([(await rec(metadataOnly, f.opts(202, 2000))).reason], ['WORKTREE_CLAIMED']);
  fs.writeFileSync(realOwner.lockFile, JSON.stringify({ pid: 101, claimId: realOwner.claimId }));
  eq(
    [claim.verifyWorktreeClaim(f.worktree, realOwner, f.opts(101, 1000)).reason],
    ['WORKTREE_CLAIMED']
  );
  eq([chk(realOwner)], ['WORKTREE_CLAIMED']);
  eq([(await rec(realOwner, f.opts(101, 1000))).reason], ['WORKTREE_CLAIMED']);
  realOwner.release();
});

test('Finding 7 / Item d3: dead worker does not block restart; live worker blocks firstLaunch', async (t) => {
  const f = fixture(t, [[101, 1000]]);
  const target = claim.worktreeId(f.worktree);
  const workerFile = path.join(f.runtimeDir, `worker-${target.id}.json`);
  fs.writeFileSync(
    workerFile,
    JSON.stringify({ item: 'TASK-AI-171', tag: 'dead', pid: 777, startedAt: 500 })
  );
  const res = await claim.acquireWorktreeOwner(f.worktree, 'TASK-AI-171', f.opts(101, 1000));
  eq([res.ok, res.claimed, res.stoppedLeftover?.pid], [true, true, 777]);
  assert.equal(fs.existsSync(workerFile), false);
  const deadLedger = {
    version: 1,
    item: 'TASK-AI-171',
    worktree: f.worktree,
    launches: 1,
    fallbacksUsed: 0,
    failures: [],
    activeWorker: { item: 'TASK-AI-171', tag: 'dead', pid: 777, startedAt: 500, offeringId: 'a' },
  };
  const restart = handoff.firstLaunch(
    dec,
    f.tkt(),
    { worktreeClaim: res, evidenceData, ledger: deadLedger, ...f.opts(101, 1000) },
    reg
  );
  eq([restart.action, restart.launch?.offeringId], ['LAUNCH', 'a']);
  assert.notEqual(restart.reason, 'WORKER_STILL_ACTIVE');
  const deadLedgerDiffTag = {
    ...deadLedger,
    activeWorker: {
      item: 'TASK-AI-171',
      tag: 'diff-dead',
      pid: 777,
      startedAt: 500,
      offeringId: 'a',
    },
  };
  const restartDiffTag = handoff.firstLaunch(
    dec,
    f.tkt(),
    { worktreeClaim: res, evidenceData, ledger: deadLedgerDiffTag, ...f.opts(101, 1000) },
    reg
  );
  eq([restartDiffTag.action, restartDiffTag.launch?.offeringId], ['LAUNCH', 'a']);
  assert.notEqual(restartDiffTag.reason, 'WORKER_STILL_ACTIVE');
  const liveLedgerSameTag = {
    ...deadLedger,
    activeWorker: { item: 'TASK-AI-171', tag: 'dead', pid: 101, startedAt: 1000, offeringId: 'a' },
  };
  const liveLedgerSameTagOut = handoff.firstLaunch(
    dec,
    f.tkt(),
    { worktreeClaim: res, evidenceData, ledger: liveLedgerSameTag, ...f.opts(101, 1000) },
    reg
  );
  assert.notEqual(liveLedgerSameTagOut.action, 'LAUNCH');
  eq(
    [liveLedgerSameTagOut.action, liveLedgerSameTagOut.reason],
    ['BLOCKED', 'WORKER_STILL_ACTIVE']
  );
  const liveLedger = {
    ...deadLedger,
    activeWorker: { item: 'TASK-AI-171', tag: 'live', pid: 101, startedAt: 1000, offeringId: 'a' },
  };
  const liveLedgerOut = handoff.firstLaunch(
    dec,
    f.tkt(),
    { worktreeClaim: res, evidenceData, ledger: liveLedger, ...f.opts(101, 1000) },
    reg
  );
  assert.notEqual(liveLedgerOut.action, 'LAUNCH');
  eq([liveLedgerOut.action, liveLedgerOut.reason], ['BLOCKED', 'WORKER_STILL_ACTIVE']);
  res.release();
  fs.writeFileSync(
    workerFile,
    JSON.stringify({ item: 'TASK-AI-171', tag: 'live', pid: 101, startedAt: 1000 })
  );
  const blocked = await claim.acquireWorktreeOwner(f.worktree, 'TASK-AI-171', f.opts(101, 1000));
  assert.equal(blocked.activeWorker?.pid, 101);
  const out = handoff.firstLaunch(
    dec,
    f.tkt(),
    { worktreeClaim: blocked, evidenceData, ledger: {}, ...f.opts(101, 1000) },
    reg
  );
  assert.notEqual(out.action, 'LAUNCH');
  eq([out.action, out.reason], ['BLOCKED', 'WORKER_STILL_ACTIVE']);
  blocked.release();
});

test('Item d2: foreign owner PID exit rejects launch/reconcile; fresh claimant recovers', async (t) => {
  const f = fixture(t);
  const deadPid = cp.spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  const target = claim.worktreeId(f.worktree);
  const lockFile = path.join(f.runtimeDir, `supervisor-${target.id}.lock`);
  const claimId = 'dead-owner-claim';
  fs.writeFileSync(lockFile, JSON.stringify({ pid: deadPid, claimId, worktree: target.worktree }));
  const stale = { claimed: true, id: target.id, worktree: target.worktree, lockFile, claimId };
  eq(
    [claim.verifyWorktreeClaim(f.worktree, stale, { dir: f.runtimeDir }).reason],
    ['WORKTREE_CLAIMED']
  );
  eq(
    [
      handoff.firstLaunch(dec, f.tkt(), { worktreeClaim: stale, evidenceData, ledger: {} }, reg)
        .reason,
    ],
    ['WORKTREE_CLAIMED']
  );
  const permissive = () => ({ ok: true });
  const outPermissiveStale = handoff.firstLaunch(
    dec,
    f.tkt(),
    { worktreeClaim: stale, verifyWorktreeClaim: permissive, evidenceData, ledger: {} },
    reg
  );
  assert.notEqual(outPermissiveStale.action, 'LAUNCH');
  eq([outPermissiveStale.action, outPermissiveStale.reason], ['STOP', 'WORKTREE_CLAIMED']);
  const rec = await claim.reconcileWorktreeWorker(f.worktree, 'TASK-AI-171', {
    dir: f.runtimeDir,
    worktreeClaim: stale,
  });
  eq([rec.reason], ['WORKTREE_CLAIMED']);
  const fresh = claim.claimWorktree(f.worktree, { dir: f.runtimeDir });
  eq([fresh.ok, fresh.claimed], [true, true]);
  fresh.release();
});
