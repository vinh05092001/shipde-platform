'use strict';

/**
 * Ship Dễ — TASK-AI-142: Router model prefix filtering and upstream derivation.
 *
 * Problem:
 * 9Router is an aggregator gateway requiring model IDs to carry an upstream
 * account prefix (e.g. cl/openai/gpt-6-astra, ag/gemini-3.8-flash, ocz/big-pickle).
 * Bare models or models stripped to bare names without an upstream prefix
 * (e.g. ninerouter/gpt-6-astra, ninerouter/muse-spark-1-3) fail with 404
 * ("Model not found") on 9Router.
 *
 * In addition, candidates generated for OpenCode reaching 9Router previously
 * treated "ninerouter" as the candidate upstream instead of extracting the
 * true upstream failure domain ("cl", "ag", etc.).
 *
 * Fix:
 * 1. Filter out bare router models lacking an upstream provider prefix.
 * 2. Correct candidate upstream to match the true upstream provider ("cl", "ag", etc.).
 * 3. Ensure Hermes and OpenCode candidate sets receive only routable models.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const candidatesApi = require('../candidates');
const sourcesApi = require('../sources');

describe('TASK-AI-142: router model prefix filtering and candidate generation', () => {
  test('bare router models are excluded from candidate generation', () => {
    const registry = sourcesApi.loadSources();
    const routerSource = registry.sources.find((s) => s.id === '9router');
    assert.ok(routerSource, '9router source must exist');

    const catalogue = [
      'ninerouter/gpt-6-astra',
      'ninerouter/muse-spark-1-3',
      'gpt-6-astra',
      'cl/openai/gpt-6-astra',
      'ag/gemini-3.1-pro-low',
    ];

    const openCodeIds = [
      'ninerouter/gpt-6-astra',
      'ninerouter/muse-spark-1-3',
      'ninerouter/cl/openai/gpt-6-astra',
    ];

    const result = candidatesApi.generateCandidates({
      registry,
      catalogue,
      openCodeIds,
    });

    const routerCandidates = result.filter((c) => c.gateway === '9router');
    const generatedModelIds = routerCandidates.map((c) => c.modelId);

    // Bare models must NOT be generated as candidates
    assert.ok(
      !generatedModelIds.includes('ninerouter/gpt-6-astra'),
      'ninerouter/gpt-6-astra must be excluded'
    );
    assert.ok(
      !generatedModelIds.includes('ninerouter/muse-spark-1-3'),
      'ninerouter/muse-spark-1-3 must be excluded'
    );
    assert.ok(!generatedModelIds.includes('gpt-6-astra'), 'bare gpt-6-astra must be excluded');

    // Valid upstream-prefixed models MUST be present
    assert.ok(
      generatedModelIds.includes('cl/openai/gpt-6-astra') ||
        generatedModelIds.includes('ninerouter/cl/openai/gpt-6-astra'),
      'cl/openai/gpt-6-astra must be included'
    );
    assert.ok(
      generatedModelIds.includes('ag/gemini-3.1-pro-low') ||
        generatedModelIds.includes('ninerouter/ag/gemini-3.1-pro-low'),
      'ag/gemini-3.1-pro-low must be included'
    );
  });

  test('OpenCode router candidates carry the true upstream domain instead of router name', () => {
    const registry = sourcesApi.loadSources();
    const openCodeIds = ['ninerouter/cl/openai/gpt-6-astra', 'ninerouter/ag/gemini-3.1-pro-low'];

    const result = candidatesApi.generateCandidates({
      registry,
      openCodeIds,
    });

    const ocCl = result.find(
      (c) => c.harness === 'opencode' && c.modelId === 'ninerouter/cl/openai/gpt-6-astra'
    );
    assert.ok(ocCl, 'OpenCode candidate for cl model must exist');
    assert.equal(
      ocCl.upstream,
      'cl',
      'upstream must be cl (the upstream provider), not ninerouter'
    );

    const ocAg = result.find(
      (c) => c.harness === 'opencode' && c.modelId === 'ninerouter/ag/gemini-3.1-pro-low'
    );
    assert.ok(ocAg, 'OpenCode candidate for ag model must exist');
    assert.equal(
      ocAg.upstream,
      'ag',
      'upstream must be ag (the upstream provider), not ninerouter'
    );
  });

  test('Hermes OpenAI-compatible candidates exclude bare models and set true upstream', () => {
    const registry = sourcesApi.loadSources();
    const catalogue = [
      'ninerouter/gpt-6-astra',
      'ninerouter/muse-spark-1-3',
      'cl/openai/gpt-6-astra',
      'ocz/big-pickle',
    ];

    const hermesCands = candidatesApi
      .generateCandidates({
        harness: 'hermes',
        registry,
        catalogue,
      })
      .filter((c) => c.gateway === '9router');

    const modelIds = hermesCands.map((c) => c.modelId);
    assert.ok(!modelIds.includes('ninerouter/gpt-6-astra'), 'bare model excluded from hermes');
    assert.ok(!modelIds.includes('ninerouter/muse-spark-1-3'), 'bare model excluded from hermes');

    const clCand = hermesCands.find((c) => c.modelId === 'cl/openai/gpt-6-astra');
    assert.ok(clCand, 'cl model must be included in hermes candidates');
    assert.equal(clCand.upstream, 'cl', 'hermes candidate upstream must be cl');

    const oczCand = hermesCands.find((c) => c.modelId === 'ocz/big-pickle');
    assert.ok(oczCand, 'ocz model must be included in hermes candidates');
    assert.equal(oczCand.upstream, 'ocz', 'hermes candidate upstream must be ocz');
  });

  test('resolveRouterModel parses inner model and upstream or rejects invalid models', () => {
    const registry = sourcesApi.loadSources();
    const routerSource = registry.sources.find((s) => s.id === '9router');
    const ocSource = registry.sources.find((s) => s.id === 'oc');

    // Bare models with router prefix -> rejected (null)
    assert.equal(
      candidatesApi.resolveRouterModel('ninerouter/gpt-6-astra', routerSource, registry, ocSource),
      null
    );
    assert.equal(
      candidatesApi.resolveRouterModel(
        'ninerouter/muse-spark-1-3',
        routerSource,
        registry,
        ocSource
      ),
      null
    );
    assert.equal(
      candidatesApi.resolveRouterModel('gpt-6-astra', routerSource, registry, ocSource),
      null
    );

    // Valid models with router prefix -> inner model and upstream extracted
    const res1 = candidatesApi.resolveRouterModel(
      'ninerouter/cl/openai/gpt-6-astra',
      routerSource,
      registry,
      ocSource
    );
    assert.deepEqual(res1, {
      upstream: 'cl',
      innerModelId: 'cl/openai/gpt-6-astra',
    });

    // Valid models without router prefix -> inner model and upstream extracted
    const res2 = candidatesApi.resolveRouterModel(
      'cl/openai/gpt-6-astra',
      routerSource,
      registry,
      ocSource
    );
    assert.deepEqual(res2, {
      upstream: 'cl',
      innerModelId: 'cl/openai/gpt-6-astra',
    });

    // Router self as upstream -> rejected
    assert.equal(
      candidatesApi.resolveRouterModel(
        'ninerouter/ninerouter/something',
        routerSource,
        registry,
        ocSource
      ),
      null
    );
  });
});
