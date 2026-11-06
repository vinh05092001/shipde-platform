'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { launchFromDecision } = require('../route-handoff');

const registry = {
  sources: [{ id: 'gw', kind: 'router', servesModels: true, endpoint: 'http://127.0.0.1:1/v1' }],
  dispatch: {
    providers: { gw: { harness: 'paseo', provider: 'opencode', modelPrefix: 'gateway/' } },
  },
};
const route = {
  offeringId: 'route-a',
  harness: 'paseo',
  gateway: 'gw',
  upstream: 'vendor',
  accountId: 'acct',
  quotaScope: 'acct',
  modelId: 'vendor/org/model-a',
};
const request = { prompt: 'p', branch: 'b', base: 'origin/main', cwd: 'wt', title: 't' };

test('the argv keeps the gateway and the full model of the decision', () => {
  const decision = { selected: 'route-a', candidates: [route] };
  const { args } = launchFromDecision(decision, request, registry);
  assert.equal(args[args.indexOf('--provider') + 1], 'opencode');
  assert.equal(args[args.indexOf('--model') + 1], 'gateway/vendor/org/model-a');
  assert.equal(args[args.indexOf('--base') + 1], 'origin/main');
});

test('an offering can be named, but only one the decision holds', () => {
  const decision = { selected: 'route-a', candidates: [route] };
  assert.throws(
    () => launchFromDecision(decision, { ...request, offeringId: 'other' }, registry),
    /DECISION_ROUTE_MISSING/
  );
});

test('a route with no dispatch row is refused, not launched as a bare model', () => {
  const lost = { ...route, harness: undefined, gateway: '', upstream: 'unknown' };
  assert.throws(
    () => launchFromDecision({ selected: 'route-a', candidates: [lost] }, request, registry),
    /DECISION_ROUTE_UNRESOLVED/
  );
});
