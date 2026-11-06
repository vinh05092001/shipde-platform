const { test } = require('node:test');
const assert = require('node:assert');
const combo = require('../writer-combo');
const candidates = require('../candidates');
const sources = require('../sources');

const registry = sources.loadSources();
const config = {
  name: 'vinh',
  members: ['gcli/grok-a', 'kr/unlisted-b'],
  readVia: 'GET /api/combos',
  readAt: 'T',
};
const generate = (extra) =>
  candidates.generateCandidates({
    registry,
    nineRouterWriterCombo: 'vinh',
    catalogue: [
      { modelId: 'gcli/grok-a', gateway: '9router' },
      { modelId: 'cmc/catalogue-only', gateway: '9router' },
    ],
    sourceModels: { '9router': ['gcli/grok-a', 'cmc/catalogue-only'], xkiro: ['x-ai/grok-a'] },
    env: { NINEROUTER_API_KEY: 'x', XKIRO_API_KEY: 'x' },
    listOpencodeModels: () => '',
    discoverPool: false,
    ...extra,
  });
const route = (list, id) => list.find((c) => c.gateway === '9router' && c.modelId === id);

test('readComboConfig issues one GET and returns members without the admin token', async () => {
  const calls = [];
  const out = await combo.readComboConfig({
    name: 'vinh',
    endpoint: 'http://127.0.0.1:1/v1',
    loadCliToken: () => 'admin-token-value',
    httpRequest: async (req) => {
      calls.push(req);
      return {
        status: 200,
        data: { combos: [{ id: 'i', name: 'vinh', models: ['a/b', { bad: 1 }] }] },
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].path, '/api/combos');
  assert.deepEqual(out.members, ['a/b']);
  assert.equal(out.strategy, 'UNKNOWN');
  assert.ok(!JSON.stringify(out).includes('admin-token-value'));
});

test('an unreadable combo yields no members', async () => {
  const out = await combo.readComboConfig({
    name: 'vinh',
    endpoint: 'http://127.0.0.1:1/v1',
    loadCliToken: () => '',
    httpRequest: async () => ({ status: 401 }),
  });
  assert.equal(out.members, null);
  assert.equal(out.status, 401);
  assert.equal(out.state, 'COMBO_CONFIG_UNAVAILABLE');
});

test('a truly empty combo differs from an unreadable one', async () => {
  const out = await combo.readComboConfig({
    name: 'vinh',
    endpoint: 'http://127.0.0.1:1/v1',
    loadCliToken: () => '',
    httpRequest: async () => ({ status: 200, data: { combos: [{ name: 'vinh', models: [] }] } }),
  });
  assert.equal(out.state, 'EMPTY');
  const state = (extra) =>
    generate(extra).find((c) => c.modelId === 'vinh').comboConfigState;
  assert.equal(state({ nineRouterComboConfig: out }), 'EMPTY');
  assert.equal(state({}), 'COMBO_CONFIG_UNAVAILABLE');
});

test('the whole combo stays callable and keeps its timeout class without a read', () => {
  const row = generate({}).find((c) => c.modelId === 'vinh');
  assert.ok(!row.blocked);
  const read = generate({ nineRouterComboConfig: config }).find((c) => c.modelId === 'vinh');
  const cfg = { schemaProbeBudgetMs: 5000 };
  const timeout = (c) => sources.resolveProbeTimeout(c, {}, cfg, Infinity);
  assert.equal(timeout(row), timeout(read));
  assert.equal(timeout(row), 5000);
});

test('a failure on one upstream of a shared account leaves the other upstream usable', () => {
  const evidence = require('../evidence');
  const account = '9router-ninerouter-api-key';
  const a = { gateway: '9router', upstream: 'gcli', accountId: account, modelId: 'gcli/a' };
  const b = { gateway: '9router', upstream: 'cmc', accountId: account, modelId: 'cmc/b' };
  const data = {
    cooldowns: {
      k: { scope: 'account', accountId: account, upstream: 'gcli', modelId: 'gcli/a', blockReason: '429', blockedAt: new Date().toISOString(), lastStatus: 'blocked', cooldownUntil },
    },
  };
  const opts = { loadQuotaState: false };
  assert.equal(evidence.isCandidateBlocked(data, a, opts).blocked, true);
  assert.equal(evidence.isCandidateBlocked(data, b, opts).blocked, false);
});

test('a listing never becomes combo members', () => {
  const list = generate({});
  const row = list.find((c) => c.modelId === 'vinh');
  assert.deepEqual(row.comboMembers, []);
  assert.equal(route(list, 'gcli/grok-a'), undefined);
});

test('configured branches become routes with their exact ID; catalogue-only ones do not', () => {
  const rejected = [];
  const list = generate({ nineRouterComboConfig: config, candidateGenerationRejections: rejected });
  const member = route(list, 'gcli/grok-a');
  assert.equal(member.comboMembership.state, 'MEMBER');
  assert.equal(route(list, 'kr/unlisted-b'), undefined);
  assert.equal(route(list, 'cmc/catalogue-only'), undefined);
  assert.equal(
    rejected.find((r) => r.modelId === 'cmc/catalogue-only').reasonCode,
    'NOT_IN_COMBO_CONFIG'
  );
  const row = list.find((c) => c.modelId === 'vinh');
  assert.deepEqual(row.comboMembers, config.members);
  assert.deepEqual(row.comboMembersWithoutCatalogue, ['kr/unlisted-b']);
  assert.equal(row.comboConfigState, 'READ');
});

test('membership is UNKNOWN without a read configuration and NOT_MEMBER only with one', () => {
  const c = { gateway: '9router', modelId: 'a/b' };
  assert.equal(combo.comboMembershipOf(c, { name: 'vinh' }).state, 'UNKNOWN');
  assert.equal(combo.comboMembershipOf(c, config).state, 'NOT_MEMBER');
});

test('xkiro is a direct OpenCode route, not 9Router', () => {
  const rows = generate({ nineRouterComboConfig: config }).filter((c) => c.source === 'xkiro');
  assert.ok(rows.length > 0);
  for (const c of rows) {
    assert.equal(c.gateway, 'xkiro');
    assert.equal(c.upstream, 'xkiro');
    assert.equal(c.harness, 'opencode-direct');
    assert.ok(c.modelId.startsWith('xkiro/'));
    assert.equal(c.reachedVia, undefined);
    assert.equal(c.modelListing, 'CONFIGURED_NOT_LIVE');
    assert.equal(c.budget, 'UNKNOWN');
  }
  const annotated = candidates.annotateCandidates(rows, {}, { quotaState: null });
  assert.ok(annotated.every((c) => c.blocked && c.blockReason === 'BUDGET_UNKNOWN'));
});

test('route status reads only the exact route and leaves the rest UNKNOWN', () => {
  const c = { gateway: '9router', upstream: 'gcli', modelId: 'gcli/grok-a' };
  const otherAccount = { paths: { 'gcli/grok-a|9router@xkiro': { status: 'AVAILABLE' } } };
  assert.equal(candidates.routeStatusOf(c, otherAccount, {}).health, 'UNKNOWN');
  const exact = { paths: { 'gcli/grok-a|9router': { status: 'AVAILABLE', lastCheckedAt: 'T' } } };
  assert.equal(candidates.routeStatusOf(c, exact, {}).health.state, 'AVAILABLE');
  const quota = {
    scopes: {
      gcli: {
        source: '9router',
        upstream: 'gcli',
        scope: 'gcli',
        code: 'OK',
        model: 'gcli/x',
        at: 'T',
      },
    },
  };
  assert.equal(candidates.routeStatusOf(c, {}, quota).quota.state, 'OK');
  const direct = { gateway: 'xkiro', upstream: 'xkiro', modelId: 'xkiro/m' };
  const misfiled = {
    scopes: { xkiro: { source: '9router', upstream: '9router', scope: 'xkiro', code: 'UNSCOPED' } },
  };
  assert.equal(candidates.routeStatusOf(direct, {}, misfiled).quota, 'UNKNOWN');
  assert.equal(candidates.routeStatusOf(c, {}, {}).executionAccount, 'UNKNOWN');
});
