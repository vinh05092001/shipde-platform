'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Cause, Scope } = require('../failure-classifier');
const { DEFAULT_WORKER_TIMEOUT_MS } = require('../isolation-launcher');
const { createWorktreeClaim } = require('./helpers/worktree-claim');

function makeFixture(t) {
  const claimHelper = createWorktreeClaim();
  if (t && typeof t.after === 'function') t.after(claimHelper.cleanup);
  const cwd = claimHelper.worktree;
  const mkCand = (id) => {
    const c = { offeringId: id, modelId: `vendor/model-${id}`, upstream: `up-${id}` };
    return Object.assign(c, { gateway: 'gw', accountId: `acc-${id}`, harness: 'paseo' });
  };
  const candidates = ['a', 'b'].map(mkCand);
  const providers = { gw: { harness: 'paseo', provider: 'opencode' } };
  const dispatch = { providers, launchModes: { opencode: ['full-access'] } };
  const registry = { sources: [], dispatch };
  const decision = { workItemId: 'TASK-AI-171', selected: 'a', candidates };
  const request = { cwd, branch: 'fix/b', prompt: 'task' };
  const ticket = { workItemId: 'TASK-AI-171', outputTokens: 100, minProof: 'HARNESS_PASS' };
  Object.assign(ticket, { maxFallbacks: 1, request });
  const evidence = [{ status: 'passed', proofLevel: 'HARNESS_PASS' }];
  const activeWorker = { offeringId: 'a', upstream: 'up-a', runId: 'run-1' };
  const ledger = { launches: 1, fallbacksUsed: 0, worktree: cwd, activeWorker };
  const combinations = candidates.map((c) => ({ ...c, evidence }));
  const context = { now: 1e6, ledger, evidenceData: { combinations }, ...claimHelper.context };
  const base = { runId: 'run-1', offeringId: 'a', upstream: 'up-a', cwd };
  Object.assign(base, { workerTimeoutMs: 1000, decision, ticket, context, registry });
  Object.assign(base, { waitForExit: (cb) => cb(0), stopWorker: async () => true });
  return {
    context,
    cleanup: claimHelper.cleanup,
    base: Object.assign(base, { readOutput: () => '', readCommit: () => null }),
  };
}

test('B51: validateWorkerTimeout rejects zero, NaN, negative and non-numeric values', () => {
  const { validateWorkerTimeout } = require('../coordinator-completion');
  assert.equal(validateWorkerTimeout(DEFAULT_WORKER_TIMEOUT_MS), DEFAULT_WORKER_TIMEOUT_MS);
  assert.equal(validateWorkerTimeout('1500'), 1500);
  for (const bad of [0, -1, -500, NaN, Infinity, null, undefined, '', false, true, 'abc']) {
    assert.throws(() => validateWorkerTimeout(bad), { code: 'WORKER_TIMEOUT_INVALID' });
  }
});

test('B51: exit vs timeout race cleans up timer on exit and ignores late exit', async (t) => {
  const { superviseWorkerCompletion } = require('../coordinator-completion');
  const s = { cleared: [], stops: [], timer: null, exit: null };
  const commit = { runId: 'run-1', workItemId: 'TASK-AI-171', sha: 'abc1234' };
  const o1 = { setTimer: (fn) => ((s.timer = fn), 't1'), clearTimer: (id) => s.cleared.push(id) };
  Object.assign(o1, { waitForExit: (cb) => ((s.exit = cb), cb(0)), readCommit: () => commit });
  const out1 = await superviseWorkerCompletion({ ...makeFixture(t).base, ...o1 });
  if (s.timer) s.timer();
  assert.deepEqual([s.cleared, out1.status, out1.finished], [['t1'], 'WORKER_FINISHED', true]);

  const stopWorker = async (id) => (s.stops.push(id), s.exit && s.exit(0), true);
  const o2 = { setTimer: (fn) => (fn(), 't2'), clearTimer: () => {}, stopWorker };
  Object.assign(o2, { waitForExit: (cb) => (s.exit = cb), readCommit: () => commit });
  const out2 = await superviseWorkerCompletion({ ...makeFixture(t).base, ...o2 });
  const got2 = [s.stops, out2.timedOut, out2.finished, out2.record.category];
  assert.deepEqual(got2, [['run-1'], true, false, Cause.TIMEOUT]);
  assert.equal(out2.next.launch.offeringId, 'b');
});

test('B51: unconfirmed stop on timeout or exit blocks fallback and keeps activeWorker', async (t) => {
  const { superviseWorkerCompletion } = require('../coordinator-completion');
  const f = makeFixture(t);
  const o = { setTimer: (fn) => (fn(), 't'), clearTimer: () => {}, waitForExit: () => {} };
  const out = await superviseWorkerCompletion({ ...f.base, ...o, stopWorker: async () => false });
  const got = [out.status, out.workerStopped, out.next.action, out.next.reason];
  assert.deepEqual(got, ['BLOCKED_WORKER_NOT_STOPPED', false, 'STOP', 'WORKER_STOP_REQUIRED']);
  assert.equal(f.context.ledger.activeWorker.offeringId, 'a');
  assert.equal(f.context.ledger.fallbacksUsed, 0);
});

test('B52: exit 0 with an unnumbered Error line or without a commit is not finished', async (t) => {
  const { superviseWorkerCompletion } = require('../coordinator-completion');
  const commit = { runId: 'run-1', workItemId: 'TASK-AI-171', sha: 'deadbeef' };
  const errOpts = { readOutput: () => 'ok\n\x1b[31mError: x\x1b[0m\n', readCommit: () => commit };
  const wErr = await superviseWorkerCompletion({ ...makeFixture(t).base, ...errOpts });
  assert.notEqual(wErr.status, 'WORKER_FINISHED');
  assert.deepEqual(
    [wErr.finished, wErr.completed, wErr.next.launch.offeringId],
    [false, false, 'b']
  );

  const noC = await superviseWorkerCompletion({ ...makeFixture(t).base, readOutput: () => 'ok' });
  const gotNoC = [noC.status, noC.finished, noC.record.category, noC.next.action];
  assert.deepEqual(gotNoC, ['WORKER_NO_COMMIT', false, 'NO_COMMIT_ARTIFACT', 'LAUNCH']);
});

test('B52: inner 503 and outer 503 classify by inner status with no raw text in records', async (t) => {
  const { superviseWorkerCompletion } = require('../coordinator-completion');
  const f1 = makeFixture(t);
  const notes = [];
  const rawSecret = 'RAW_SECRET_TAIL_DO_NOT_RECORD_999';
  const msg1 = `trace ${rawSecret}\nError: HTTP 500: [p/m] [503]: no capacity available ${rawSecret}`;
  const o1 = { httpStatus: 500, note: (e) => notes.push(e), waitForExit: (cb) => cb(1) };
  const in503 = await superviseWorkerCompletion({ ...f1.base, ...o1, readOutput: () => msg1 });
  const got1 = [in503.record.status, in503.record.category, in503.record.scope];
  assert.deepEqual(got1, [503, Cause.GENUINE_CAPACITY, Scope.UPSTREAM]);
  for (const item of [in503.record, notes, f1.context.ledger])
    assert.doesNotMatch(JSON.stringify(item), new RegExp(rawSecret));

  const f2 = makeFixture(t);
  const msg2 = `Error: [gateway/model] [503]: [upstream/model] [429]: rate limit ${rawSecret}`;
  const o2 = { httpStatus: 503, waitForExit: (cb) => cb(1), readOutput: () => msg2 };
  const out503 = await superviseWorkerCompletion({ ...f2.base, ...o2 });
  const got2 = [out503.record.status, out503.record.category, f2.context.ledger.failures[0].class];
  assert.deepEqual(got2, [429, Cause.UPSTREAM_RATE_LIMIT, 'RATE_LIMITED']);
  assert.doesNotMatch(JSON.stringify(out503.record), new RegExp(rawSecret));
});

test('B26: lane hold requires validated duration and releases only on run-bound evidence', () => {
  const { evaluateLaneHold, activeHeldLanes } = require('../coordinator-completion');
  const run = { lane: 'agy02', runId: 'run-42', workItemId: 'TASK-AI-171', launchedAt: 1e6 };
  Object.assign(run, { cwd: '/wt', baseSha: 'b0' });
  for (const bad of [0, -10, NaN, null, undefined, false]) {
    const fn = () => evaluateLaneHold(run, { holdDurationMs: bad, now: 1_001_000 });
    assert.throws(fn, /HOLD_DURATION_INVALID/);
  }
  const check = (opts) => evaluateLaneHold(run, { holdDurationMs: 6e4, now: 1_010_000, ...opts });
  const unrel = check({ readCommit: () => ({ runId: 'other-run', sha: 'c1' }) });
  assert.deepEqual([unrel.held, unrel.completed, unrel.reason], [true, false, 'UNRELATED_COMMIT']);

  const fRes = () => ({ runId: 'other-run', finishedAt: 1_005_000 });
  const fEnd = () => ({ runId: 'other-run', endedAt: 1_006_000 });
  const otherM = check({ readResult: fRes, readEndedMarker: fEnd });
  assert.deepEqual([otherM.held, otherM.reason], [true, 'FOREIGN_RUN_MARKER']);

  const noCom = check({ readResult: () => ({ runId: 'run-42', finishedAt: 1_005_000 }) });
  const gotNoCom = [noCom.held, noCom.completed, noCom.status, noCom.reason];
  assert.deepEqual(gotNoCom, [false, false, 'COMPLETED_EMPTY', 'COMPLETION_WITHOUT_COMMIT']);

  const expUnc = check({ now: 1_100_000, stopConfirmed: false });
  const gotUnc = [expUnc.expired, expUnc.held, expUnc.reason];
  assert.deepEqual(gotUnc, [true, true, 'HOLD_EXPIRED_UNCONFIRMED']);

  const expCon = check({ now: 1_100_000, stopConfirmed: true });
  const gotCon = [expCon.held, expCon.completed, expCon.status];
  assert.deepEqual(gotCon, [false, false, 'STOPPED_AFTER_EXPIRY']);

  const comm = check({ readCommit: () => ({ runId: 'run-42', sha: 'newsha1' }) });
  assert.deepEqual([comm.held, comm.completed, comm.status], [false, true, 'WORKER_FINISHED']);

  const readCommit = (r) => (r.runId === 'run-42' ? { runId: 'run-42', sha: 'newsha1' } : null);
  const runs = [run, { ...run, lane: 'agy03', runId: 'run-99' }];
  const summary = activeHeldLanes(runs, { holdDurationMs: 6e4, now: 1_100_000, readCommit });
  assert.deepEqual([...summary.busyLanes], ['agy03']);
});
