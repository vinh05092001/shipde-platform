'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { decide } = require('../route-decision');
const decideOpen = (input) => decide({ launchCheck: () => null, ...input });
const { buildLaunch, launchBlocker, observed, nextDecisionInput } = require('../route-launch');

const quality = (score) => ({ score, scale: 's', version: 'v' });
const request = { outputTokens: 10 };
const options = {
  cwd: 'wt',
  prefixes: { gw: 'gateway' },
  taskFile: '.oc/task.md',
  message: 'Do the task.',
};
const viaGateway = (account, score) => ({
  routeKind: 'model',
  source: 'gw',
  harness: 'opencode',
  modelId: 'vendor/Model-1',
  account,
  quality: quality(score),
});
const lane = (account, score) => ({
  routeKind: 'agy-pool',
  source: 'pool',
  harness: 'agy',
  modelId: 'model-a',
  account,
  quality: quality(score),
});
const choose = (candidates, launchOptions) =>
  decide({
    runId: 'r',
    candidates,
    request,
    states: {},
    scale: 's',
    now: 1,
    launchCheck: (c) => launchBlocker(c, launchOptions),
  });

test('argv is the real opencode run form', () => {
  const launch = buildLaunch(choose([viaGateway(null, 5)], options), options);
  assert.equal(launch.status, 'READY');
  assert.deepStrictEqual(launch.args, [
    'run',
    '-m',
    'gateway/vendor/Model-1',
    'Do the task.',
    '-f',
    '.oc/task.md',
  ]);
});

test('a higher scored route that cannot launch loses to one that can', () => {
  const unsupported = { ...viaGateway(null, 99), harness: 'other' };
  const decision = choose([unsupported, viaGateway(null, 5)], options);
  assert.equal(decision.chosen.harness, 'opencode');
  assert.equal(decision.rejected[0].reason, 'UNSUPPORTED_ROUTE');
  assert.equal(buildLaunch(decision, options).status, 'READY');
});

test('a busy lane loses to a free lane instead of winning and stalling', () => {
  const opts = { ...options, busyLanes: ['a'] };
  const decision = choose([lane('a', 99), lane('b', 5)], opts);
  assert.equal(decision.chosen.account, 'b');
  assert.equal(buildLaunch(decision, opts).job.accountId, 'b');
});

test('no launchable route is BLOCKED with the reason kept', () => {
  const decision = choose([viaGateway(null, 5)], { ...options, taskFile: undefined });
  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.rejected[0].reason, 'TASK_FILE_MISSING');
});

test('every launch blocker refuses in buildLaunch too', () => {
  for (const [route, opts, reason] of [
    [lane(null, 1), options, 'LANE_UNKNOWN'],
    [lane('a', 1), { ...options, cwd: undefined }, 'CWD_MISSING'],
    [viaGateway(null, 1), { ...options, message: undefined }, 'MESSAGE_MISSING'],
  ]) {
    const decision = decideOpen({ runId: 'r', candidates: [route], request, scale: 's', now: 1 });
    assert.deepStrictEqual(buildLaunch(decision, opts), { status: 'BLOCKED', reason });
  }
});

test('two gateway accounts give one command and report the account as not enforced', () => {
  const first = buildLaunch(choose([viaGateway('a', 5)], options), options);
  const second = buildLaunch(choose([viaGateway('b', 5)], options), options);
  assert.deepStrictEqual(first.args, second.args);
  assert.notEqual(first.requestedRoute, second.requestedRoute);
  assert.equal(first.account, 'NOT_ENFORCED');
  assert.equal(second.account, 'NOT_ENFORCED');
});

test('an AGY lane binds its account; a request without account says so', () => {
  assert.equal(buildLaunch(choose([lane('a', 5)], options), options).account, 'ENFORCED');
  assert.equal(
    buildLaunch(choose([viaGateway(null, 5)], options), options).account,
    'NOT_REQUESTED'
  );
});

test('accountHeld is proven only by an observed account', () => {
  const decision = choose([viaGateway('a', 5)], options);
  assert.equal(observed(decision, {}).accountHeld, 'UNKNOWN');
  assert.equal(observed(decision, { executedAccount: 'a' }).accountHeld, true);
  assert.equal(observed(decision, { executedAccount: 'b' }).accountHeld, false);
});

test('a retry cannot repeat the same command under another account label', () => {
  const candidates = [viaGateway('a', 9), viaGateway('b', 8), lane('c', 1)];
  const input = { runId: 'r', candidates, request, scale: 's', now: 1, retryBudget: 1 };
  const next = nextDecisionInput(input, decideOpen(input), { class: 'UPSTREAM_UNAVAILABLE' });
  assert.deepStrictEqual(
    next.candidates.map((c) => c.account),
    ['c']
  );
});

test('a second AGY lane of one model remains a real retry', () => {
  const input = {
    runId: 'r',
    candidates: [lane('a', 9), lane('b', 8)],
    request,
    scale: 's',
    now: 1,
    retryBudget: 1,
  };
  const next = nextDecisionInput(input, decideOpen(input), { class: 'UPSTREAM_UNAVAILABLE' });
  assert.deepStrictEqual(
    next.candidates.map((c) => c.account),
    ['b']
  );
});
