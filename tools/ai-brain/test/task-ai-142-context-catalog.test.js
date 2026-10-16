'use strict';

/**
 * Ship Dễ — TASK-AI-142: a route that reports no context window takes it from
 * the public models.dev catalog, recorded as evidence; never from a guess.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const candidatesApi = require('../candidates');
const sourcesApi = require('../sources');
const { contextRefusal } = require('../harness');

const catalog = {
  vendorA: {
    models: {
      'vendor/model-x': {
        id: 'vendor/model-x',
        tool_call: true,
        structured_output: true,
        limit: { context: 262144 },
      },
    },
  },
  vendorB: {
    models: { 'model-x': { id: 'model-x', tool_call: true, limit: { context: 128000 } } },
  },
};

describe('TASK-AI-142: context windows from the public model catalog', () => {
  test('a routed model with no metadata takes the conservative catalog window', () => {
    const r = candidatesApi.resolveCandidateCapabilities(null, 'cl/vendor/model-x', {
      source: { kind: 'router' },
      modelCatalog: catalog,
    });
    assert.equal(r.contextWindow, 128000);
    assert.equal(r.capabilities.contextWindow, 128000);
    assert.equal(r.capabilities.contextEvidence, 'catalog:models.dev');
    assert.equal(contextRefusal('hermes', r.contextWindow), null);
  });

  test('an unknown model stays unverified', () => {
    const r = candidatesApi.resolveCandidateCapabilities(null, 'cl/vendor/unknown-y', {
      source: { kind: 'router' },
      modelCatalog: catalog,
    });
    assert.equal(r.contextWindow, undefined);
    assert.equal(r.capabilities.contextEvidence, undefined);
    assert.match(contextRefusal('hermes', r.contextWindow), /^CONTEXT_WINDOW_UNVERIFIED/);
  });

  test('source metadata wins over the catalog', () => {
    const r = candidatesApi.resolveCandidateCapabilities(null, 'cl/vendor/model-x', {
      source: { kind: 'router', modelMeta: { 'cl/vendor/model-x': { contextWindow: 64000 } } },
      modelCatalog: catalog,
    });
    assert.equal(r.contextWindow, 64000);
    assert.equal(r.capabilities.contextEvidence, undefined);
  });

  test('generateCandidates applies the catalog to gateway routes', () => {
    const registry = JSON.parse(JSON.stringify(sourcesApi.loadSources()));
    const result = candidatesApi.generateCandidates({
      registry,
      accounts: [{ id: 'ninerouter', provider: 'oc' }],
      catalogue: [
        { gateway: '9router', upstream: 'cl', modelId: 'cl/vendor/model-x' },
        { gateway: '9router', upstream: 'cl', modelId: 'cl/vendor/unknown-y' },
      ],
      modelCatalog: catalog,
    });
    const known = result.find((c) => c.modelId.includes('model-x'));
    const unknown = result.find((c) => c.modelId.includes('unknown-y'));
    assert.ok(known && unknown);
    assert.equal(known.contextWindow, 128000);
    assert.equal(unknown.contextWindow, undefined);
  });
});
