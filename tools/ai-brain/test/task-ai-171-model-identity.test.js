'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  ScoreSource,
  modelIdentity,
  startingScore,
  outcomeTargets,
  jevOptions,
  acceptJevChoice,
} = require('../model-identity');

const route = (over) => ({
  routeId: 'r1',
  source: 's1',
  modelId: 'x/m',
  modelVersion: 'v1',
  ...over,
});
const mappings = [
  {
    canonicalModelId: 'shared',
    routes: [
      { source: 's1', modelId: 'x/m', version: 'v1', evidence: 'doc-1' },
      { source: 's2', modelId: 'y/other-name', version: 'v1', evidence: 'doc-2' },
    ],
  },
];
const data = { modelScores: { shared: 70 } };

test('two names of one verified model share a start score and keep their own calls', () => {
  const a = route({});
  const b = route({ routeId: 'r2', source: 's2', modelId: 'y/other-name' });
  for (const r of [a, b]) {
    assert.deepStrictEqual(startingScore(r, data, mappings), {
      score: 70,
      source: ScoreSource.VERIFIED_MODEL_REFERENCE,
      canonicalModelId: 'shared',
    });
  }
  assert.equal(modelIdentity(a, mappings).outboundModelId, 'x/m');
  assert.equal(modelIdentity(b, mappings).outboundModelId, 'y/other-name');
});

test('similar names without evidence are not merged', () => {
  for (const r of [
    route({ modelId: 'x/m-1' }),
    route({ source: 's3' }),
    route({ modelVersion: 'v2' }),
    route({ modelVersion: undefined }),
  ]) {
    assert.equal(modelIdentity(r, mappings).canonicalModelId, null);
    assert.deepStrictEqual(startingScore(r, data, mappings), {
      score: null,
      source: ScoreSource.NO_DATA,
    });
  }
  const bare = [
    { canonicalModelId: 'shared', routes: [{ source: 's1', modelId: 'x/m', version: 'v1' }] },
  ];
  assert.equal(modelIdentity(route({}), bare).canonicalModelId, null);
});

test('route history outranks a shared reference', () => {
  const out = startingScore(route({}), { ...data, routeScores: { r1: 40 } }, mappings);
  assert.deepStrictEqual(out, { score: 40, source: ScoreSource.ROUTE_HISTORY });
});

test('a 429 on one account stays in that scope, not on the shared model', () => {
  const a = route({ quotaScope: 'acct-a' });
  assert.deepStrictEqual(outcomeTargets(a, { status: 429, scope: 'quotaScope' }), {
    routes: ['r1'],
    quotaScopes: ['acct-a'],
    models: [],
  });
});

test('a combo with unknown executed model scores no child model', () => {
  const combo = route({ routeId: 'combo-1', modelId: 'combo-name', isCombo: true });
  assert.equal(modelIdentity(combo, mappings).canonicalModelId, null);
  assert.deepStrictEqual(outcomeTargets(combo, { status: 200 }), {
    routes: ['combo-1'],
    quotaScopes: [],
    models: [],
  });
});

test('JEV picks only among filtered route ids', () => {
  const options = jevOptions([route({}), route({ routeId: 'r2' })]);
  assert.deepStrictEqual(options, ['r1', 'r2']);
  assert.equal(acceptJevChoice('r2', options), 'r2');
  assert.equal(acceptJevChoice('x/m', options), null);
});
