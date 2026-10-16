'use strict';

/**
 * Ship Dễ — TASK-AI-142: a router only offers models it lists itself.
 * The merged intake catalogue holds ids from many gateways; an id listed by
 * another gateway is no proof the router serves it.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const candidatesApi = require('../candidates');
const sourcesApi = require('../sources');

const OWN = ['cl/openai/gpt-6-astra', 'ag/gemini-3.8-flash'];
const FOREIGN = ['azure/gpt-5.6-sol@westeurope', 'runware/glm-5.3'];

function routerOnly(models) {
  const registry = sourcesApi.loadSources();
  const base = registry.sources.find((s) => s.id === '9router');
  assert.ok(base, '9router source must exist');
  const source = { ...base, models };
  return { ...registry, sources: [source] };
}

function routerIds(candidates) {
  return candidates
    .filter((c) => c.sourceId === '9router')
    .map((c) => `${c.upstream}/${c.modelId}`)
    .sort();
}

describe('TASK-AI-142: router offers only its own listing', () => {
  test('merged catalogue ids from other gateways are not router candidates', () => {
    const registry = routerOnly([]);
    const candidates = candidatesApi.generateCandidates({
      registry,
      catalogue: [...OWN, ...FOREIGN],
      sourceModels: { '9router': OWN },
      accounts: [],
    });
    const ids = candidates.filter((c) => c.sourceId === '9router').map((c) => c.modelId);
    assert.equal(ids.length, 2, JSON.stringify(ids));
    assert.ok(ids.every((id) => !/westeurope|glm-5\.3/.test(id)));
    assert.ok(routerIds(candidates).length === 2);
  });

  test('the router source.models listing also counts as its own', () => {
    const registry = routerOnly(OWN);
    const candidates = candidatesApi.generateCandidates({
      registry,
      catalogue: [...OWN, ...FOREIGN],
      accounts: [],
    });
    assert.equal(candidates.filter((c) => c.sourceId === '9router').length, 2);
  });

  test('unknown listing yields no catalogue-derived candidates and records why', () => {
    const registry = routerOnly([]);
    const rejections = [];
    const candidates = candidatesApi.generateCandidates({
      registry,
      catalogue: [...OWN, ...FOREIGN],
      accounts: [],
      candidateGenerationRejections: rejections,
    });
    assert.equal(candidates.filter((c) => c.sourceId === '9router').length, 0);
    assert.ok(
      rejections.some((r) => r.reasonCode === 'ROUTER_LISTING_UNKNOWN' && r.sourceId === '9router')
    );
  });
});
