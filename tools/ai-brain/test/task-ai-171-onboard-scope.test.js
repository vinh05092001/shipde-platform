'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { onboardSourceRolling } = require('../rolling-onboard');
const { candidatesFromEvidence } = require('../candidates');
const { dispatchRoute, qualifyModel } = require('../sources');
const { getHarness } = require('../harness');

const registry = {
  sources: [
    {
      id: 'gw',
      kind: 'router',
      servesModels: true,
      harness: 'paseo',
      models: ['vu/own'],
      endpoint: 'http://127.0.0.1:1/v1',
      credential: { type: 'api-key', env: 'GW_KEY' },
    },
  ],
  dispatch: {
    providers: { gw: { harness: 'paseo', provider: 'opencode', modelPrefix: 'gateway/' } },
  },
};

const scope = (source, model) => ({
  source,
  scope: source,
  upstream: source,
  model,
  code: 'OK',
  status: 200,
  at: new Date(0).toISOString(),
  elapsedMs: 7,
});

const completion = {
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ choices: [{ message: { content: 'pong' } }] }),
};

const onboard = async (scopes) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-scope-'));
  const evidenceData = { combinations: [] };
  const result = await onboardSourceRolling(registry.sources[0], {
    registry,
    evidenceData,
    persist: false,
    evidenceDir: dir,
    routeHealthFile: path.join(dir, 'route-health.json'),
    quotaState: { scopes },
    accounts: [{ id: 'acct', provider: 'gw' }],
    env: { GW_KEY: 'test-value' },
    fetch: async () => completion,
  });
  return { result, evidenceData };
};

const finalArgv = (evidenceData) =>
  candidatesFromEvidence(evidenceData, { registry }).map((c) => {
    const route = dispatchRoute(c.source, registry);
    const launch = getHarness(c.harness).launch({
      provider: route.provider,
      model: qualifyModel(c.modelId, route),
      prompt: 'p',
      branch: 'b',
      cwd: 'wt',
      title: 't',
      labels: {},
    });
    return (launch.args || launch).join(' ');
  });

test('a source keeps its own scope and never launches a scope of another source', async () => {
  const { evidenceData } = await onboard({
    other: scope('other', 'direct-only'),
    gw: scope('gw', 'vu/own'),
  });
  const argv = finalArgv(evidenceData);
  assert.equal(argv.length, 1, argv.join(' | '));
  assert.ok(argv[0].includes('--model gateway/vu/own'), argv[0]);
  assert.ok(!argv[0].includes('direct-only'), argv[0]);
});

test('a source with no scope of its own cannot pass on a scope borrowed from another', async () => {
  const { result, evidenceData } = await onboard({ other: scope('other', 'direct-only') });
  assert.equal(result.ok, false);
  assert.deepStrictEqual(evidenceData.combinations, []);
  assert.deepStrictEqual(finalArgv(evidenceData), []);
});
