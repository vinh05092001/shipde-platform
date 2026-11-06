const { test } = require('node:test');
const assert = require('node:assert');
const { assembleForDispatch } = require('../cli');

process.env.GW_FIXTURE_KEY = 'fixture-only';
const endpoint = 'http://127.0.0.1:1/v1';
const registry = {
  sources: [
    {
      id: '9router',
      kind: 'router',
      servesModels: true,
      harness: 'paseo',
      endpoint,
      credential: { type: 'api-key', env: 'GW_FIXTURE_KEY' },
    },
  ],
  dispatch: { nineRouterWriterCombo: 'team', providers: {} },
};
const row = (modelId, gateway = '9router') => ({
  harness: 'paseo',
  accessPath: endpoint,
  gateway,
  upstream: modelId.split('/')[0],
  accountId: 'k',
  quotaScope: 'k',
  modelId,
});
const discovery = { candidates: [row('a/in'), row('b/out'), row('c/direct', 'direct')] };
const read = { name: 'team', state: 'READ', members: ['a/in'] };
const unread = { members: null, state: 'COMBO_CONFIG_UNAVAILABLE' };
const assemble = (over) => {
  const list = assembleForDispatch(discovery, [], registry, {
    allowUnprobedCandidates: true,
    evidenceData: {},
    offerings: [],
    registryAccounts: [],
    discoverPool: false,
    ...over,
  });
  const byModel = Object.fromEntries(list.map((c) => [c.modelId, c]));
  return { byModel, excluded: list.excludedRoutes.map((r) => r.reason) };
};

test('a ticket limited to the combo refuses discovery rows outside it', () => {
  const { byModel, excluded } = assemble({
    role: 'writer',
    routeScope: 'combo-only',
    nineRouterComboConfig: read,
  });
  assert.equal(byModel['a/in'].routeOrigin, 'combo-member');
  assert.equal(byModel['b/out'], undefined);
  assert.equal(byModel['c/direct'], undefined);
  assert.equal(excluded.filter((r) => r === 'NOT_IN_COMBO_CONFIG').length, 2);
});

test('a ticket allowing routes keeps them with their own origin', () => {
  const { byModel } = assemble({
    role: 'writer',
    routeScope: 'combo-and-routes',
    nineRouterComboConfig: read,
  });
  assert.equal(byModel['a/in'].routeOrigin, 'combo-member');
  assert.equal(byModel['b/out'].routeOrigin, 'individual');
  assert.equal(byModel['c/direct'].routeOrigin, 'individual');
});

test('an unread combo infers no member and keeps nothing from a listing as a member', () => {
  const { byModel, excluded } = assemble({
    role: 'writer',
    routeScope: 'combo-only',
    nineRouterComboConfig: unread,
  });
  assert.equal(byModel['a/in'], undefined);
  assert.ok(byModel.team, 'the whole-combo route stays');
  assert.ok(excluded.includes('COMBO_CONFIG_UNAVAILABLE'));
  assert.equal(excluded.includes('NOT_IN_COMBO_CONFIG'), false);
});

test('a non-writer role does not switch the combo on', () => {
  const { byModel, excluded } = assemble({
    role: 'reviewer',
    routeScope: 'combo-only',
    nineRouterComboConfig: read,
  });
  assert.equal(byModel['b/out'].routeOrigin, undefined);
  assert.deepEqual(excluded, []);
  assert.equal(byModel.team, undefined);
});
