'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sourcesApi = require('../sources');
const comboJev = require('../combo-jev-select');

test('WI-B1: modelFamilyOf maps o* and codex* stems to gpt via sources.json modelStemAliases and fails closed on non-alphabetic stems', () => {
  const reg = sourcesApi.loadSources();
  const aliases = reg.dispatch.modelStemAliases;
  assert.ok(aliases && typeof aliases === 'object');

  assert.equal(comboJev.modelFamilyOf('gh/gpt-5.2-high', aliases), 'gpt');
  assert.equal(comboJev.modelFamilyOf('cx/o3-high', aliases), 'gpt');
  assert.equal(comboJev.modelFamilyOf('cx/o4-mini', aliases), 'gpt');
  assert.equal(comboJev.modelFamilyOf('cx/codex-mini', aliases), 'gpt');
  assert.equal(comboJev.modelFamilyOf('agy-pool/gpt-oss-120b', aliases), 'gpt');
  assert.equal(comboJev.modelFamilyOf('12345', aliases), null);
  assert.equal(comboJev.modelFamilyOf('', aliases), null);
});

test('WI-B1 RED/GREEN: filterForIndependence blocks o3 and codex-mini when writer is gpt-5.2 across different upstreams', async () => {
  const reg = sourcesApi.loadSources();

  // Writer is gh/gpt-5.2-high; cx/o3 and cx/codex-mini share vendor family via modelStemAliases
  const res = await comboJev.selectComboMember({
    item: { id: 'FEAT-B1', complexity: 'high', risk: 'HIGH' },
    role: 'reviewer',
    writerModelId: 'gh/gpt-5.2-high',
    members: ['cx/o3', 'cx/codex-mini', 'gcli/grok-4.7'],
    registry: reg,
  });

  assert.equal(res.ok, true);
  assert.equal(res.independentApplied, true);
  assert.equal(res.eligibleCount, 1);
  assert.equal(res.selected.modelId, 'gcli/grok-4.7');

  // Reverse direction: writer is cx/o3 -> blocks gh/gpt-5.2-high and agy-pool/gpt-oss-120b
  const rev = await comboJev.selectComboMember({
    item: { id: 'FEAT-B1-REV', complexity: 'high', risk: 'HIGH' },
    role: 'reviewer',
    writerModelId: 'cx/o3',
    members: ['gh/gpt-5.2-high', 'cx/codex-mini'],
    registry: reg,
  });
  assert.equal(rev.ok, false);
  assert.equal(rev.reason, 'NO_INDEPENDENT_REVIEWER');
});

test('WI-B1 fail-closed: unknown/numeric writer or member stem is rejected by filterForIndependence', () => {
  const reg = sourcesApi.loadSources();
  const scored = [
    { modelId: 'cx/123-unknown', base: '123-unknown', score: 90, tier: 'T1' },
    { modelId: 'gcli/grok-4.7', base: 'grok-4-7', score: 80, tier: 'T1' },
  ];

  // Unknown member stem is filtered out
  const r1 = comboJev.filterForIndependence(
    scored,
    'gh/gpt-5.2-high',
    ['cx/123-unknown', 'gcli/grok-4.7', 'gh/gpt-5.2-high'],
    '9router',
    { registry: reg }
  );
  assert.deepEqual(
    r1.eligible.map((m) => m.modelId),
    ['gcli/grok-4.7']
  );

  // Unknown writer stem refuses all
  const r2 = comboJev.filterForIndependence(
    scored,
    'gh/999-unknown',
    ['cx/123-unknown', 'gcli/grok-4.7', 'gh/999-unknown'],
    '9router',
    { registry: reg }
  );
  assert.deepEqual(r2.eligible, []);
});
