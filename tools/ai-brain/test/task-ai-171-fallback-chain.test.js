'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { firstLaunch, afterFailure } = require('../route-handoff');
const { resolveRoute, readSessionId } = require('../executor');
const { getHarness } = require('../harness');

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-d-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const candidates = ['a', 'b', 'c'].map((id) => ({
    offeringId: id,
    modelId: 'fake/' + id,
    upstream: id,
    gateway: 'fake-gateway',
    accountId: id,
    harness: 'paseo',
  }));
  const registry = {
    sources: [],
    dispatch: {
      providers: { 'fake-gateway': { harness: 'paseo', provider: 'opencode' } },
      launchModes: { opencode: ['full-access', 'plan'] },
    },
  };
  const decision = { workItemId: 'TASK-AI-171', selected: 'a', candidates };
  const ticket = {
    workItemId: decision.workItemId,
    outputTokens: 100,
    minProof: 'HARNESS_PASS',
    maxFallbacks: 1,
    request: { cwd, branch: 'fake-branch', prompt: 'fake ticket' },
  };
  const context = {
    ledger: {},
    evidenceData: {
      combinations: candidates.map((c) => ({
        ...c,
        evidence: [{ status: 'passed', proofLevel: 'HARNESS_PASS' }],
      })),
    },
  };
  const ledgerFile = path.join(cwd, 'ledger.json');
  const checkpoint = () => fs.writeFileSync(ledgerFile, JSON.stringify(context.ledger));
  const reload = () => {
    context.ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  };
  const failure = (id, status, extra) => ({
    offeringId: id,
    upstream: id,
    status,
    phase: 'after-launch',
    worktree: cwd,
    workerStopped: true,
    ...extra,
  });
  return { cwd, candidates, registry, decision, ticket, context, checkpoint, reload, failure };
}

test('A edits then 429, stop A, reload ledger, B sees diff then 402 and STOP', (t) => {
  const f = fixture(t);
  const { decision, ticket, context, registry } = f;
  const file = path.join(f.cwd, 'partial.txt');
  const active = new Set();
  const events = [];
  const run = (adapter, args) => {
    if (args[0] === 'stop') {
      assert.ok(active.delete(args[1]));
      events.push('stop:' + args[1]);
      return { exitCode: 0 };
    }
    assert.equal(active.size, 0, 'never two writers on the worktree');
    const model = args[args.indexOf('--model') + 1];
    const candidate = f.candidates.find((c) => c.modelId === model);
    assert.ok(candidate);
    const id = candidate.offeringId;
    active.add(id);
    events.push('launch:' + id);
    if (id === 'a') fs.writeFileSync(file, 'partial edit from A\n');
    else {
      assert.equal(args[args.indexOf('--cwd') + 1], f.cwd);
      assert.ok(!args.includes('--new-workspace'));
      assert.equal(fs.readFileSync(file, 'utf8'), 'partial edit from A\n');
    }
    return { exitCode: 0, stdout: JSON.stringify({ id }) };
  };
  const launch = (out) => {
    assert.equal(out.action, 'LAUNCH');
    const c = f.candidates.find((c) => c.offeringId === out.launch.offeringId);
    const route = resolveRoute(
      { provider: c.gateway, model: c.modelId, harness: c.harness },
      {},
      registry
    );
    const adapter = getHarness(route.harnessName);
    const result = run(adapter, out.launch.args);
    const session = readSessionId(adapter, {}, result);
    assert.equal(session.cause, null);
    context.ledger.activeWorker = { offeringId: c.offeringId, sessionId: session.id };
    f.checkpoint();
    return adapter;
  };
  const a = launch(firstLaunch(decision, ticket, context, registry));
  f.reload();
  assert.equal(firstLaunch(decision, ticket, context, registry).reason, 'WORKER_STILL_ACTIVE');
  const pending = f.failure('a', 429, { workerStopped: false });
  assert.equal(
    afterFailure(decision, ticket, context, pending, registry).reason,
    'WORKER_STOP_REQUIRED'
  );
  assert.equal(context.ledger.fallbacksUsed, undefined);
  assert.equal(context.ledger.failures, undefined);
  run(a, a.stop('a'));
  const next = afterFailure(decision, ticket, context, f.failure('a', 429), registry);
  f.checkpoint();
  f.reload();
  assert.equal(context.ledger.fallbacksUsed, ticket.maxFallbacks);
  const b = launch(next);
  run(b, b.stop('b'));
  f.reload();
  const stop = afterFailure(decision, ticket, context, f.failure('b', 402), registry);
  assert.equal(stop.action, 'STOP');
  assert.equal(stop.reason, 'FALLBACK_LIMIT');
  assert.equal(stop.worktree, f.cwd);
  assert.equal(active.size, 0);
  assert.deepEqual(events, ['launch:a', 'stop:a', 'launch:b', 'stop:b']);
  assert.deepEqual(
    context.ledger.failures.map((x) => x.class),
    ['RATE_LIMITED', 'NO_CREDIT']
  );
  f.checkpoint();
  f.reload();
  assert.equal(firstLaunch(decision, ticket, context, registry).action, 'STOP');
});

test('OpenCode/9Router internal retry keeps its route and does not spend worker fallback', (t) => {
  const f = fixture(t);
  const { decision, ticket, context, registry } = f;
  const first = firstLaunch(decision, ticket, context, registry);
  let calls = 0;
  const retryInsideHarness = (args) => {
    assert.deepEqual(args, first.launch.args);
    calls += 1;
    return { status: calls === 1 ? 429 : 200 };
  };
  assert.equal(retryInsideHarness(first.launch.args).status, 429);
  assert.equal(retryInsideHarness(first.launch.args).status, 200);
  assert.equal(context.ledger.fallbacksUsed, undefined);
  assert.equal(context.ledger.failures, undefined);
  const fallback = afterFailure(decision, ticket, context, f.failure('a', 429), registry);
  assert.equal(fallback.launch.offeringId, 'b');
  assert.equal(context.ledger.fallbacksUsed, ticket.maxFallbacks);
});

test('before-launch failure is local and does not mark the upstream rate limited', (t) => {
  const f = fixture(t);
  f.candidates[1].upstream = f.candidates[0].upstream;
  // The execution proof must describe the changed route's upstream as well.
  f.context.evidenceData.combinations[1].upstream = f.candidates[1].upstream;
  const out = afterFailure(
    f.decision,
    f.ticket,
    f.context,
    {
      offeringId: 'a',
      upstream: 'a',
      phase: 'before-launch',
      status: 429,
    },
    f.registry
  );
  assert.equal(out.action, 'LAUNCH');
  assert.equal(out.launch.offeringId, 'b');
  assert.deepEqual(out.rejected, [{ offeringId: 'a', reason: 'ALREADY_FAILED:LAUNCH_FAILED' }]);
  assert.equal(f.context.ledger.failures[0].class, 'LAUNCH_FAILED');
  assert.equal(f.context.ledger.failures[0].phase, 'before-launch');
  assert.equal(f.context.ledger.worktree, undefined);
  assert.ok(out.launch.args.includes('--new-workspace'));
});

test('after-launch failure requires stop proof even when the worker reported no edits', (t) => {
  const f = fixture(t);
  const out = afterFailure(
    f.decision,
    f.ticket,
    f.context,
    f.failure('a', 429, { worktree: undefined, workerStopped: undefined }),
    f.registry
  );
  assert.equal(out.action, 'STOP');
  assert.equal(out.reason, 'WORKER_STOP_REQUIRED');
  assert.deepEqual(f.context.ledger, {});
});

test('restart cannot launch a third worker after the fallback budget is spent', (t) => {
  const f = fixture(t);
  f.context.ledger = {
    fallbacksUsed: f.ticket.maxFallbacks,
    failures: [{ offeringId: 'a', class: 'RATE_LIMITED', upstream: 'a' }],
    worktree: f.cwd,
  };
  f.checkpoint();
  f.reload();
  const out = firstLaunch(f.decision, f.ticket, f.context, f.registry);
  assert.equal(out.action, 'STOP');
  assert.equal(out.reason, 'FALLBACK_LIMIT');
  assert.equal(out.worktree, f.cwd);
});

test('a different worker failure or before-launch claim cannot release an active writer', (t) => {
  const f = fixture(t);
  f.context.ledger.activeWorker = { offeringId: 'a', sessionId: 'fake-session' };
  for (const failure of [f.failure('b', 402), f.failure('a', 429, { phase: 'before-launch' })]) {
    const out = afterFailure(f.decision, f.ticket, f.context, failure, f.registry);
    assert.equal(out.reason, 'WORKER_STILL_ACTIVE');
    assert.equal(f.context.ledger.activeWorker.offeringId, 'a');
    assert.equal(f.context.ledger.failures, undefined);
  }
});

test('compatible requested mode reaches adapter and incompatible mode never launches', (t) => {
  const f = fixture(t);
  const compatible = firstLaunch(f.decision, { ...f.ticket, mode: 'plan' }, f.context, f.registry);
  assert.equal(compatible.action, 'LAUNCH');
  const args = compatible.launch.args;
  assert.equal(args[args.indexOf('--mode') + 1], 'plan');
  const blocked = firstLaunch(
    f.decision,
    { ...f.ticket, mode: 'unsupported' },
    f.context,
    f.registry
  );
  assert.equal(blocked.action, 'BLOCKED');
  assert.ok(blocked.rejected.every((r) => r.reason === 'LAUNCH_MODE_UNSUPPORTED'));
});
