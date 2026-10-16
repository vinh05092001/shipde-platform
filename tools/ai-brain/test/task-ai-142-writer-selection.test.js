'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const selection = require('../writer-selection');
const routing = require('../routing');
const { generateCandidates, candidateKey } = require('../candidates');
const { selectCandidateForProfile } = require('../orchestrate');

function registry() {
  return {
    sources: [
      {
        id: 'fixture-router',
        kind: 'router',
        harness: 'opencode',
        endpoint: 'https://fixture.invalid/v1',
        models: [],
        credential: { type: 'api-key', env: 'FIXTURE_KEY' },
      },
    ],
    dispatch: {
      providers: {
        'fixture-router': {
          harness: 'opencode-direct',
          accessPath: 'https://fixture.invalid/v1',
          provider: 'fixture-router',
        },
      },
    },
  };
}
function candidate(overrides = {}) {
  const c = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: 'fixture-router',
    source: 'fixture-router',
    upstream: 'vendor',
    accountId: 'fixture-account',
    quotaScope: 'fixture-account',
    modelId: 'vendor/fixture',
    quality: 90,
    cost: 1,
    latencyMs: 100,
    capabilities: { tools: true, jsonSchema: true, contextWindow: 64000 },
    evidence: [],
    ...overrides,
  };
  c.candidateKey = candidateKey(c);
  return c;
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-selection-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('909 listed models expand independently of 82 OpenCode declarations; zero inference probes', async () => {
  const ids = Array.from({ length: 909 }, (_, i) => `vendor/model-${i}`);
  let listings = 0;
  const r = await selection.refreshWriterRegistry(registry(), {
    env: { FIXTURE_KEY: 'fixture-only' },
    fetchModels: async (url) => {
      assert.equal(url, 'https://fixture.invalid/v1/models');
      listings++;
      return { ok: true, json: async () => ({ data: ids.map((id) => ({ id })) }) };
    },
  });
  const candidates = generateCandidates({
    registry: r,
    accounts: [
      { id: 'fixture-account', provider: 'fixture-router', capabilities: { contextWindow: 64000 } },
    ],
    catalogue: ids.slice(0, 82),
  });
  assert.equal(new Set(candidates.map((c) => c.modelId)).size, 909);
  assert.equal(candidates.length, 909);
  assert.equal(listings, 1);
  assert.equal(r.sources[0].writerInventory.listed, 909);
  assert.equal(r.sources[0].writerInventory.probeSucceeded, false);
  assert.ok(candidates.every((c) => !c.routeEvidence?.probeSucceeded));
  assert.equal(registry().sources[0].models.length, 0);
});

test('listing failure preserves configured inventory and reports unavailable; listings stay source scoped', async () => {
  const original = registry();
  original.sources[0].models = ['vendor/configured'];
  const r = await selection.refreshWriterRegistry(original, {
    fetchModels: async () => ({ ok: false, status: 503 }),
  });
  assert.deepEqual(r.sources[0].models, ['vendor/configured']);
  assert.equal(r.sources[0].writerInventory.listed, null);
  assert.equal(r.sources[0].writerInventory.status, 'unavailable');
  const other = { ...r.sources[0], id: 'other', models: ['vendor/other'] };
  r.sources.push(other);
  r.dispatch.providers.other = r.dispatch.providers['fixture-router'];
  const generated = generateCandidates({
    registry: r,
    accounts: [
      { id: 'one', provider: 'fixture-router' },
      { id: 'two', provider: 'other' },
    ],
    catalogue: [],
  });
  assert.ok(
    generated.some((c) => c.gateway === 'fixture-router' && c.modelId === 'vendor/configured')
  );
  assert.ok(!generated.some((c) => c.gateway === 'fixture-router' && c.modelId === 'vendor/other'));
});

test('JEV result and failure are cached for unchanged input; changed task asks again', async () => {
  let calls = 0;
  const o = {
    jevAsk: async () => {
      calls++;
      throw new Error('offline');
    },
  };
  const p = {
    taskId: 'FIXTURE',
    role: 'writer',
    complexity: 'complex',
    riskDomains: [],
    latencyPriority: 'normal',
  };
  const [a, b] = await Promise.all([
    selection.assessOnce(p, null, o.jevAsk, o, routing),
    selection.assessOnce(p, null, o.jevAsk, o, routing),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.equal(a.jevOutcome, 'UNDECIDED');
  assert.equal(a.weightProfile, 'QUALITY_FIRST');
  await selection.assessOnce({ ...p, complexity: 'trivial' }, null, o.jevAsk, o, routing);
  assert.equal(calls, 2);
  o.jevAsk = async () => {
    calls++;
    return { outcome: 'DECIDED', choice: 'BALANCED', confidence: 1 };
  };
  const c = await selection.assessOnce(p, null, o.jevAsk, o, routing);
  assert.equal(calls, 3);
  assert.equal(c.jevOutcome, 'DECIDED');
});

test('a rejected JEV assessment is not cached; the next call asks again', async () => {
  let calls = 0;
  const routing = {
    jevQuestion: () => 'q',
    assessTask: async () => {
      calls++;
      if (calls === 1) throw new Error('transient');
      return { jevOutcome: 'DECIDED' };
    },
  };
  const o = { jevAsk: async () => ({}) };
  const p = { taskId: 'FIXTURE', role: 'writer', complexity: 'complex' };
  await assert.rejects(selection.assessOnce(p, null, o.jevAsk, o, routing), /transient/);
  const again = await selection.assessOnce(p, null, o.jevAsk, o, routing);
  assert.equal(calls, 2);
  assert.equal(again.jevOutcome, 'DECIDED');
});

test('route success without quota headers remains unknown; exhausted quota blocks only that candidate', () => {
  const c = candidate();
  selection.applyProbe(c, { ok: true, status: 200 });
  assert.equal(c.probeQuota.status, 'unknown');
  assert.equal(c.routeEvidence.probeSucceeded, true);
  const sibling = candidate({ modelId: 'vendor/sibling' });
  selection.applyProbe(c, {
    ok: true,
    status: 200,
    quota: { status: 'exhausted', remaining: { requests: 0 } },
  });
  assert.equal(c.blocked, true);
  assert.equal(sibling.blocked, undefined);
});

test('light tasks prefer an equally capable cheaper route; hard tasks retain their quality floor', async (t) => {
  const dir = temp(t);
  const cheap = candidate({ modelId: 'vendor/cheap-fixture', quality: 80, cost: 1 });
  const dear = candidate({ modelId: 'vendor/dear-fixture', quality: 80, cost: 50 });
  const strong = candidate({ modelId: 'vendor/strong-fixture', quality: 99, cost: 60 });
  const options = {
    registry: registry(),
    jevAsk: async () => {
      throw Error('offline');
    },
    ranking: { priors: {} },
  };
  const item = {
    id: 'FIXTURE',
    roleRequirement: { role: 'writer' },
    proofFloor: 'NONE',
    qualityFloor: 70,
    complexity: 'trivial',
  };
  const light = await selectCandidateForProfile(
    item,
    [dear, cheap],
    [],
    null,
    options,
    { dir },
    Date.now()
  );
  assert.equal(light.chosen, cheap.candidateKey);
  const hard = await selectCandidateForProfile(
    { ...item, complexity: 'complex', qualityFloor: 95 },
    [cheap, strong],
    [],
    null,
    options,
    { dir },
    Date.now()
  );
  assert.equal(hard.chosen, strong.candidateKey);
  assert.equal(hard.decisionRecorded.weightProfile, 'QUALITY_FIRST');
});

test('quota comes only from numeric provider headers, never from HTTP success', async () => {
  const { probeRoute } = require('../route-probe');
  for (const [headers, status] of [
    [{}, 'unknown'],
    [{ 'x-ratelimit-remaining-requests': '3' }, 'open'],
    [{ 'x-ratelimit-remaining-tokens': '0' }, 'exhausted'],
    [{ 'x-ratelimit-remaining-tokens': 'not exposed' }, 'unknown'],
  ]) {
    const result = await probeRoute(
      { accessPath: 'https://fixture.invalid/v1', modelId: 'vendor/fixture' },
      'FIXTURE_KEY',
      { FIXTURE_KEY: 'fixture-only' },
      {
        fetch: async () => ({
          ok: true,
          status: 200,
          headers: new Headers(headers),
          text: async () => 'OK',
        }),
      }
    );
    assert.equal(result.quota.status, status);
    assert.equal(result.ok, true);
  }
});

test('credential and route configuration gates refuse before an inference probe', async (t) => {
  const dir = temp(t);
  const c = candidate({ harness: 'opencode', accessPath: 'https://fixture.invalid/v1' });
  const o = {
    registry: registry(),
    isolatedWorker: true,
    enforceCredentialCheck: true,
    candidates: [c],
    env: { FIXTURE_KEY: '' },
    jevAsk: async () => {
      throw Error('offline');
    },
    ranking: { priors: {} },
  };
  const result = await selectCandidateForProfile(
    { id: 'FIXTURE', roleRequirement: { role: 'writer' }, proofFloor: 'NONE' },
    [c],
    [],
    null,
    o,
    { dir },
    Date.now()
  );
  assert.equal(result.chosen, null);
  assert.match(JSON.stringify(result.result.rejected), /PROVIDER_CREDENTIAL_UNAVAILABLE/);
});

test('selection rejects missing capabilities, low quality, exhausted quota and failed route before choosing', async (t) => {
  const dir = temp(t);
  const base = candidate();
  const low = candidate({ modelId: 'vendor/low', quality: 1 });
  const missing = candidate({ modelId: 'vendor/no-tools', capabilities: { contextWindow: 64000 } });
  const quota = candidate({ modelId: 'vendor/exhausted' });
  selection.applyProbe(quota, { ok: true, quota: { status: 'exhausted' } });
  const failed = candidate({
    modelId: 'vendor/failed',
    blocked: true,
    blockReason: 'ROUTE_UNAVAILABLE',
  });
  const options = {
    registry: registry(),
    jevAsk: async () => {
      throw Error('offline');
    },
    ranking: { priors: {} },
  };
  const item = {
    id: 'FIXTURE',
    roleRequirement: { role: 'writer' },
    requiredCapabilities: ['tools'],
    qualityFloor: 70,
    proofFloor: 'NONE',
  };
  const result = await selectCandidateForProfile(
    item,
    [low, missing, quota, failed, base],
    [],
    null,
    options,
    { dir },
    Date.now()
  );
  assert.equal(result.chosen, base.candidateKey);
  assert.equal(result.result.rejected.length, 4);
  assert.equal(result.result.ranking[0].headroomStatus, 'unknown');
});

test('34 direct source inventories remain independent of the unrelated shared catalogue', () => {
  const sources = Array.from({ length: 34 }, (_, i) => ({
    id: `direct-${i}`,
    kind: 'model-source',
    harness: 'direct-http',
    accessPath: 'direct',
    endpoint: `https://direct-${i}.invalid/v1`,
    models: [`local-model-${i}`],
  }));
  const generated = generateCandidates({
    registry: { sources, dispatch: { providers: {} } },
    accounts: sources.map((s) => ({ id: `account-${s.id}`, provider: s.id, models: s.models })),
    catalogue: ['router/unrelated-model'],
    discoverPool: false,
  });
  assert.equal(generated.length, 34);
  for (const c of generated) {
    const s = sources.find((s) => s.id === c.source);
    assert.ok(s.models.includes(c.modelId));
    assert.equal(c.harness, 'direct-http');
    assert.equal(c.capabilities.jsonSchema, undefined, 'inventory never invents schema proof');
  }
});
