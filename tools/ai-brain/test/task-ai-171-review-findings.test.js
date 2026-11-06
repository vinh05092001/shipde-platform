'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { decide, routeKey } = require('../route-decision');
const { buildLaunch, launchBlocker, nextDecisionInput } = require('../route-launch');

const quality = (score) => ({ score, scale: 's', version: 'v' });
const options = {
  cwd: 'wt',
  prefixes: { gw: 'gateway' },
  taskFile: '.oc/task.md',
  message: 'Do the task.',
};
const route = (over) => ({
  routeKind: 'model',
  source: 'gw',
  harness: 'opencode',
  modelId: 'model-a',
  account: null,
  quality: quality(5),
  ...over,
});
const decideWith = (input) =>
  decide({
    runId: 'r',
    request: { outputTokens: 10 },
    scale: 's',
    now: 1,
    launchCheck: (c) => launchBlocker(c, options),
    ...input,
  });

test('a top scored route with no launcher adapter never wins', () => {
  const codex = route({
    harness: 'codex',
    source: 'direct',
    modelId: 'model-z',
    quality: quality(99),
  });
  const decision = decideWith({ candidates: [codex, route({})] });
  assert.equal(decision.chosen.harness, 'opencode');
  assert.deepStrictEqual(
    decision.rejected.map((r) => r.reason),
    ['UNSUPPORTED_ROUTE']
  );
});

test('only unsupported routes means BLOCKED, not an unrunnable decision', () => {
  const decision = decideWith({ candidates: [route({ harness: 'codex' })] });
  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.chosen, null);
});

test('decide refuses to run without the launcher check', () => {
  const decision = decide({
    runId: 'r',
    candidates: [route({})],
    request: { outputTokens: 10 },
    scale: 's',
    now: 1,
  });
  assert.equal(decision.status, 'BLOCKED');
  assert.deepStrictEqual(decision.reasons, ['LAUNCH_CHECK_REQUIRED']);
});

test('a gateway account is chosen by the gateway and stays UNKNOWN', () => {
  const launch = buildLaunch(decideWith({ candidates: [route({ account: 'a' })] }), options);
  assert.equal(launch.account, 'NOT_ENFORCED');
  assert.equal(launch.accountChosenBy, 'GATEWAY');
  assert.equal(launch.executedAccount, 'UNKNOWN');
});

test('a null budget is unknown, not zero', () => {
  const decision = decideWith({ candidates: [route({ budget: { maxOutputTokens: null } })] });
  assert.equal(decision.status, 'DECIDED');
});

test('a zero budget is a real budget and rejects the route', () => {
  const decision = decideWith({ candidates: [route({ budget: { maxOutputTokens: 0 } })] });
  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.rejected[0].reason, 'BUDGET_BELOW_REQUEST');
});

test('an invalid request size cannot pass a credit check', () => {
  for (const outputTokens of [undefined, null, NaN, 0, -1, 1.5, '10']) {
    const decision = decideWith({
      candidates: [route({ budget: { maxOutputTokens: 5 } })],
      request: { outputTokens },
    });
    assert.deepStrictEqual(decision.reasons, ['INVALID_REQUEST_SIZE']);
  }
});

test('retry budget must be a finite positive integer', () => {
  for (const retryBudget of [Infinity, NaN, 0, -1, 1.5, '1', undefined]) {
    const input = { runId: 'r', candidates: [route({})], retryBudget };
    const next = nextDecisionInput(input, { runId: 'r', chosen: route({}) }, { class: 'UNKNOWN' });
    assert.equal(next.status, 'BLOCKED');
    assert.equal(next.reason, 'RETRY_BUDGET_EXHAUSTED');
  }
});

const shared = () => [
  route({ modelId: 'model-a', quotaScope: 'wallet-1', quality: quality(9) }),
  route({ modelId: 'model-b', quotaScope: 'wallet-1', quality: quality(8) }),
  route({ modelId: 'model-c', quotaScope: 'wallet-2', quality: quality(7) }),
];

test('monthly quota marks the shared wallet; an independent account stays usable', () => {
  const input = { candidates: shared(), states: {}, retryBudget: 1 };
  const first = decideWith(input);
  const next = nextDecisionInput(input, first, { class: 'QUOTA_MONTHLY', scope: 'wallet-1' });
  assert.equal(next.states[routeKey(shared()[1])].quota, 'EXHAUSTED');
  const second = decideWith(next);
  assert.equal(second.chosen.modelId, 'model-c');
  assert.equal(second.rejected[0].reason, 'QUOTA_EXHAUSTED');
});

test('a credit failure caps the shared wallet at what it can afford', () => {
  const input = {
    candidates: shared(),
    states: {},
    retryBudget: 1,
    request: { outputTokens: 100 },
  };
  const first = decideWith(input);
  const next = nextDecisionInput(input, first, {
    class: 'CREDIT_BUDGET',
    affordable: 50,
    scope: 'wallet-1',
  });
  const second = decideWith(next);
  assert.equal(second.chosen.modelId, 'model-c');
  assert.equal(second.rejected[0].reason, 'BUDGET_BELOW_REQUEST');
});

test('an upstream outage or a missing scope does not spread', () => {
  const input = { candidates: shared(), states: {}, retryBudget: 1 };
  const outage = nextDecisionInput(input, decideWith(input), { class: 'UPSTREAM_UNAVAILABLE' });
  assert.equal(decideWith(outage).chosen.modelId, 'model-b');

  const noScope = [
    route({ modelId: 'model-a', quality: quality(9) }),
    route({ modelId: 'model-b' }),
  ];
  const plain = { candidates: noScope, states: {}, retryBudget: 1 };
  const next = nextDecisionInput(plain, decideWith(plain), { class: 'QUOTA_MONTHLY' });
  assert.equal(decideWith(next).chosen.modelId, 'model-b');
});

const gatewayWallets = () => [
  route({ modelId: 'model-a', account: 'a', quotaScope: 'wallet-a', quality: quality(9) }),
  route({ modelId: 'model-b', account: 'a', quotaScope: 'wallet-a', quality: quality(8) }),
  route({ modelId: 'model-a', account: 'b', quotaScope: 'wallet-b', quality: quality(7) }),
];

test('gateway 402 with an unconfirmed account does not punish the wallet on paper', () => {
  const input = { candidates: gatewayWallets(), states: {}, retryBudget: 1 };
  const first = decideWith(input);
  const next = nextDecisionInput(input, first, { class: 'QUOTA_MONTHLY' });
  assert.deepStrictEqual(next.states, {});
  assert.deepStrictEqual(
    next.candidates.map((c) => c.modelId),
    ['model-b']
  );
  assert.equal(decideWith(next).chosen.modelId, 'model-b');
});

test('gateway credit failure with an unconfirmed account keeps the wallet budget unknown', () => {
  const input = { candidates: gatewayWallets(), states: {}, retryBudget: 1 };
  const next = nextDecisionInput(input, decideWith(input), {
    class: 'CREDIT_BUDGET',
    affordable: 50,
  });
  assert.equal(next.candidates[0].budget, undefined);
});

test('a confirmed executed account proves the wallet; another account does not', () => {
  const input = { candidates: gatewayWallets(), states: {}, retryBudget: 1 };
  const first = decideWith(input);
  const failure = { class: 'QUOTA_MONTHLY' };
  const proven = nextDecisionInput(input, first, failure, { executedAccount: 'a' });
  assert.equal(decideWith(proven).status, 'BLOCKED');
  const other = nextDecisionInput(input, first, failure, { executedAccount: 'b' });
  assert.deepStrictEqual(other.states, {});
});

test('a provider failure naming another scope does not touch this wallet', () => {
  const input = { candidates: gatewayWallets(), states: {}, retryBudget: 1 };
  const next = nextDecisionInput(input, decideWith(input), {
    class: 'QUOTA_MONTHLY',
    scope: 'wallet-z',
  });
  assert.deepStrictEqual(next.states, {});
});

test('an AGY lane binds its account, so its failure proves its wallet', () => {
  const lane = (account, modelId) => ({
    routeKind: 'agy-pool',
    source: 'pool',
    harness: 'agy',
    modelId,
    account,
    cwd: 'wt',
    quotaScope: 'lane-' + account,
    quality: quality(modelId === 'model-a' ? 9 : 8),
  });
  const candidates = [lane('a', 'model-a'), lane('a', 'model-b'), lane('b', 'model-b')];
  const input = { candidates, states: {}, retryBudget: 1 };
  const next = nextDecisionInput(input, decideWith(input), { class: 'QUOTA_MONTHLY' });
  assert.equal(decideWith(next).chosen.account, 'b');
});

test('two routes with equal score win the same way in either input order', () => {
  const one = route({ modelId: 'model-a' });
  const two = route({ modelId: 'model-b' });
  const forward = decideWith({ candidates: [one, two] });
  const reverse = decideWith({ candidates: [two, one] });
  assert.equal(forward.chosen.modelId, reverse.chosen.modelId);
});

test('on equal score a known budget beats an unknown one, in either order', () => {
  const known = route({ modelId: 'model-z', budget: { maxOutputTokens: 100 } });
  const unknown = route({ modelId: 'model-a' });
  assert.equal(decideWith({ candidates: [known, unknown] }).chosen.modelId, 'model-z');
  assert.equal(decideWith({ candidates: [unknown, known] }).chosen.modelId, 'model-z');
});

test('an id that already holds the prefix is refused, never doubled', () => {
  for (const candidate of [
    route({ modelId: 'gateway/model-a' }),
    route({ source: 'direct', modelId: 'direct/model-a' }),
  ]) {
    const decision = decideWith({ candidates: [candidate] });
    assert.equal(decision.status, 'BLOCKED');
    assert.equal(decision.rejected[0].reason, 'PREFIX_ALREADY_PRESENT');
  }
});

test('model id forms keep their exact text in the argv', () => {
  const cases = [
    [route({ modelId: 'vendor/org/Model-1:free' }), 'gateway/vendor/org/Model-1:free'],
    [route({ source: 'direct', modelId: 'model-a' }), 'direct/model-a'],
    [route({ routeKind: 'combo', modelId: 'combo-a' }), 'gateway/combo-a'],
  ];
  for (const [candidate, expected] of cases) {
    const launch = buildLaunch(decideWith({ candidates: [candidate] }), options);
    assert.equal(launch.args[2], expected);
  }
});
