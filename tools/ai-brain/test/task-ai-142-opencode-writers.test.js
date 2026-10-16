'use strict';

/**
 * TASK-AI-142 H3 live: a probed direct source discovered from an OpenCode
 * provider becomes an opencode-direct writer candidate `<providerKey>/<model>`.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { generateCandidates } = require('../candidates');
const { routeProbeCandidate } = require('../orchestrate');

function source(extra) {
  return Object.assign(
    {
      id: 'opencode-provider-x-options',
      kind: 'model-source',
      harness: 'direct-http',
      accessPath: 'direct',
      endpoint: 'https://x.example/v1',
      credential: { type: 'api-key', env: 'X_API_KEY' },
      servesModels: true,
      models: ['m1'],
      modelMeta: { m1: { contextWindow: 65536 } },
    },
    extra
  );
}

const gen = (src) => generateCandidates({ registry: { version: 2, sources: [src] }, accounts: [] });

describe('probed opencode providers become writer candidates', () => {
  test('a source with an opencode provider key yields x/m1', () => {
    const out = gen(source({ opencodeProvider: 'x' })).filter(
      (c) => c.harness === 'opencode-direct'
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].modelId, 'x/m1');
    assert.equal(out[0].gateway, 'opencode-provider-x-options');
    assert.equal(out[0].upstream, 'x');
    assert.deepEqual(out[0].capabilities, { contextWindow: 65536 });
  });

  test('no capability without per-model metadata', () => {
    const out = gen(source({ opencodeProvider: 'x', modelMeta: {} }));
    assert.deepEqual(out[0].capabilities, {});
  });

  test('a source without an opencode provider key yields no writer candidate', () => {
    assert.equal(gen(source({})).filter((c) => c.harness === 'opencode-direct').length, 0);
  });

  test('the route probe sends the wire id without the provider key', () => {
    const reg = { version: 2, sources: [source({ opencodeProvider: 'x' })] };
    const [c] = gen(reg.sources[0]);
    const route = { harnessName: 'opencode-direct', model: c.modelId };
    const probe = routeProbeCandidate(c, route, reg);
    assert.equal(probe.modelId, 'm1');
    assert.equal(probe.apiKeyEnv, 'X_API_KEY');
  });
});
