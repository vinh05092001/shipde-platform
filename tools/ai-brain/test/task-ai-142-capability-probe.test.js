'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const routing = require('../routing');
const { buildTaskProfile } = require('../orchestrate');
const { candidateKey, resolveCandidateCapabilities } = require('../candidates');
const profile = buildTaskProfile({
  id: 'CAP',
  requiredCapabilities: ['jsonSchema', 'tools'],
  contextSize: 100,
});
function candidate(extra = {}) {
  return {
    harness: 'direct-http',
    accessPath: 'https://fixture.example/v1',
    gateway: 'fixture',
    upstream: 'vendor',
    modelId: 'vendor/model',
    accountId: 'acct',
    quotaScope: 'acct',
    capabilities: {},
    ...extra,
  };
}
const registry = {
  sources: [
    {
      id: 'fixture',
      kind: 'model-source',
      endpoint: 'https://fixture.example/v1',
      credential: { env: 'FIXTURE_KEY' },
    },
  ],
};

test('undefined capabilities are pending verification, never CAPABILITY_MISSING or ranked', () => {
  const c = candidate();
  const result = routing.rankForProfile(
    [c],
    profile,
    { weightProfile: 'quality' },
    { priors: { ranking: [] } }
  );
  assert.ok(!result.rejected.some((r) => r.reasonCode.startsWith('CAPABILITY_MISSING')));
  assert.ok(result.needsCapabilityProbe.some((r) => r.candidateKey === candidateKey(c)));
  assert.equal(result.ranking.length, 0);
});

test('account registry caps are declarations, not per-model probe proof', () => {
  const result = resolveCandidateCapabilities(
    { capabilities: { tools: true, jsonSchema: true, contextWindow: 200000 } },
    'vendor/model',
    { source: registry.sources[0] }
  );
  assert.equal(result.capabilities.tools, undefined);
  assert.equal(result.capabilities.jsonSchema, undefined);
  assert.equal(result.contextWindow, undefined);
});

test('HTTP schema and forced tool-call probes persist distinct timestamped evidence and reuse it', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-probe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const options = {
    registry,
    evidenceDir: dir,
    env: { FIXTURE_KEY: 'fixture-only' },
    fetch: async (_url, init) => {
      calls++;
      const req = JSON.parse(init.body);
      if (req.response_format) {
        const props = req.response_format.json_schema.schema.properties;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    candidateKey: props.candidateKey.enum[0],
                    nonce: props.nonce.enum[0],
                    status: 'completed',
                    artifacts: [],
                  }),
                },
              },
            ],
          }),
        };
      }
      assert.equal(req.tool_choice.type, 'function');
      const tool = req.tools[0].function;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    type: 'function',
                    function: {
                      name: tool.name,
                      arguments: JSON.stringify({
                        nonce: tool.parameters.properties.nonce.enum[0],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      };
    },
  };
  const api = require('../capability-probe');
  const first = candidate();
  await api.probeCapabilities([first], profile, options);
  assert.equal(first.capabilities.jsonSchema, true);
  assert.equal(first.capabilities.tools, true);
  assert.equal(calls, 2);
  const second = candidate();
  await api.probeCapabilities([second], profile, options);
  assert.equal(calls, 2);
  assert.equal(second.capabilities.tools, true);
  const data = require('../evidence').loadEvidence(dir);
  assert.ok(data.capabilityProbes[candidateKey(first)].tools.observedAt);
});

test('agy authorization and exhausted budget remain unknown without running or caching false', async () => {
  const api = require('../capability-probe');
  const c = candidate({ harness: 'agy-pool', accessPath: 'pool' });
  let launched = 0;
  await api.probeCapabilities([c], profile, {
    registry,
    run: () => {
      launched++;
    },
    capabilityEvidence: {},
  });
  assert.equal(launched, 0);
  assert.equal(c.capabilities.jsonSchema, undefined);
  assert.equal(c.jsonSchemaEvidence.reason, 'WRITER_SCHEMA_LAUNCH_NOT_AUTHORIZED');
  const cold = candidate();
  await api.probeCapabilities([cold], profile, {
    registry,
    deadline: Date.now() - 1,
    fetch: () => {
      throw Error('must not run');
    },
  });
  assert.equal(cold.capabilities.tools, undefined);
});

test('failed HTTP probe records false with the upstream reason; declarations never bypass verification', async () => {
  const api = require('../capability-probe');
  const c = candidate({
    capabilities: { jsonSchema: true, tools: true },
    capabilityDeclarations: { jsonSchema: true, tools: true },
  });
  let calls = 0;
  await api.probeCapabilities([c], profile, {
    registry,
    env: { FIXTURE_KEY: 'fixture-only' },
    fetch: async () => {
      calls++;
      return {
        ok: false,
        status: 451,
        json: async () => ({ error: { message: 'Unavailable in your location' } }),
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(c.capabilities.jsonSchema, false);
  assert.equal(c.capabilities.tools, false);
  assert.equal(c.capabilityEvidence.tools.reason, 'GEO_BLOCKED');
  assert.ok(c.capabilityEvidence.tools.observedAt);
  const ranked = routing.rankForProfile(
    [c],
    profile,
    { weightProfile: 'quality' },
    { priors: { ranking: [] } }
  );
  assert.equal(ranked.rejected[0].reasonCode, 'CAPABILITY_MISSING:jsonSchema');
});

test('CLI tools require observed tool execution as well as valid final JSON', async () => {
  const schema = require('../writer-schema');
  const c = candidate({ harness: 'codex', accessPath: 'cli' });
  const run = (verifiedToolCalls) => (job) => ({
    exitCode: 0,
    verifiedToolCalls,
    stdout: JSON.stringify({
      candidateKey: job.candidateKey,
      nonce: job.resultSchema.properties.nonce.enum[0],
      status: 'completed',
      artifacts: [],
    }),
  });
  assert.equal((await schema.verify(c, { capability: 'tools', run: run(0) })).ok, false);
  assert.equal((await schema.verify(c, { capability: 'tools', run: run(1) })).ok, true);
});

test('capability budget is shared across checks and does not cache unattempted routes as false', async (t) => {
  const api = require('../capability-probe');
  let clock = Date.now();
  const deadline = clock + api.PROBE_BUDGET_MS;
  t.mock.method(Date, 'now', () => clock);
  const first = candidate({ harness: 'codex', accessPath: 'cli' });
  const second = candidate({ harness: 'codex', accessPath: 'cli', modelId: 'other' });
  let calls = 0;
  await api.probeCapabilities([first, second], profile, {
    deadline,
    probeCli: async () => {
      calls++;
      clock = deadline;
      return { ok: true, method: 'fixture-real-observation' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(first.capabilities.jsonSchema, true);
  assert.equal(first.capabilities.tools, undefined);
  assert.equal(second.capabilities.jsonSchema, undefined);
});

test('a declared false is unverified until a real negative probe exists', () => {
  const c = candidate({
    capabilities: { tools: false, jsonSchema: true },
    capabilityDeclarations: { tools: true, jsonSchema: true },
  });
  const result = routing.rankForProfile(
    [c],
    profile,
    { weightProfile: 'quality' },
    { priors: { ranking: [] } }
  );
  assert.ok(!result.rejected.some((r) => r.reasonCode.startsWith('CAPABILITY_MISSING')));
  assert.equal(result.needsCapabilityProbe.length, 1);
});

test('cached pool proof cannot bypass a revoked externalWorkers permission', async () => {
  const api = require('../capability-probe');
  const options = {
    capabilityEvidence: {},
    externalWorkers: 'agy-pool',
    probeCli: async () => ({ ok: true }),
  };
  const first = candidate({ harness: 'agy-pool', accessPath: 'pool' });
  await api.probeCapabilities([first], profile, options);
  assert.equal(first.capabilities.tools, true);
  const next = candidate({ harness: 'agy-pool', accessPath: 'pool' });
  options.externalWorkers = '';
  await api.probeCapabilities([next], profile, options);
  assert.equal(next.capabilities.tools, undefined);
  assert.equal(next.jsonSchemaEvidence.reason, 'WRITER_SCHEMA_LAUNCH_NOT_AUTHORIZED');
});

test('HTTP error status survives an unreadable body during a capability probe', async () => {
  const c = candidate();
  await require('../capability-probe').probeCapabilities([c], profile, {
    registry,
    env: { FIXTURE_KEY: 'fixture-only' },
    fetch: async () => ({
      ok: false,
      status: 451,
      json: async () => {
        throw Error('broken body');
      },
    }),
  });
  assert.equal(c.capabilityEvidence.jsonSchema.reason, 'GEO_BLOCKED');
  assert.equal(c.capabilityEvidence.tools.reason, 'GEO_BLOCKED');
});

test('evidence history plus account declarations still requires a real capability probe', () => {
  const c = candidate();
  const data = { combinations: [{ ...c, model: c.modelId, evidence: [] }] };
  const rows = require('../candidates').candidatesFromEvidence(data, {
    accounts: [
      { id: c.accountId, capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 } },
    ],
  });
  assert.equal(rows[0].capabilities.contextWindow, undefined);
  const ranked = routing.rankForProfile(
    rows,
    profile,
    { weightProfile: 'quality' },
    { priors: { ranking: [] } }
  );
  assert.equal(ranked.chosen, null);
  assert.equal(ranked.needsCapabilityProbe.length, 1);
});

test('reviewer candidates also verify unknown capabilities before ranking', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const result = await require('../orchestrate').selectCandidateForProfile(
    {
      id: 'CAP-REVIEW',
      role: 'reviewer.primary',
      requiredCapabilities: ['jsonSchema', 'tools'],
      qualityFloor: 0,
    },
    [candidate()],
    [],
    {},
    {
      registry,
      env: { FIXTURE_KEY: 'fixture-only' },
      fetch: async (_url, init) => {
        calls++;
        const req = JSON.parse(init.body);
        const schema = req.response_format?.json_schema.schema;
        const message = schema
          ? {
              content: JSON.stringify({
                candidateKey: schema.properties.candidateKey.enum[0],
                nonce: schema.properties.nonce.enum[0],
                status: 'completed',
                artifacts: [],
              }),
            }
          : {
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: req.tools[0].function.name,
                    arguments: JSON.stringify({
                      nonce: req.tools[0].function.parameters.properties.nonce.enum[0],
                    }),
                  },
                },
              ],
            };
        return { ok: true, status: 200, json: async () => ({ choices: [{ message }] }) };
      },
    },
    { dir },
    Date.now()
  );
  assert.equal(calls, 2);
  assert.ok(
    !result.result.rejected.some((r) => String(r.reasonCode).startsWith('CAPABILITY_UNVERIFIED'))
  );
});

test('direct-source discovery HTTP identities use HTTP probes, not a CLI launch gate', async () => {
  const c = candidate({ harness: 'http', accessPath: 'fixture', source: 'fixture' });
  let calls = 0;
  await require('../capability-probe').probeCapabilities(
    [c],
    { ...profile, requiredCapabilities: ['jsonSchema'] },
    {
      registry,
      env: { FIXTURE_KEY: 'fixture-only' },
      fetch: async (_url, init) => {
        calls++;
        const props = JSON.parse(init.body).response_format.json_schema.schema.properties;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    candidateKey: props.candidateKey.enum[0],
                    nonce: props.nonce.enum[0],
                    status: 'completed',
                    artifacts: [],
                  }),
                },
              },
            ],
          }),
        };
      },
    }
  );
  assert.equal(calls, 1);
  assert.equal(c.capabilities.jsonSchema, true);
});

test('item dry-run probes declared capabilities instead of treating them as evidence', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-dryrun-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const result = await require('../cli').dispatchCommand(
    { 'dry-run': true, root },
    {
      candidates: [
        candidate({
          capabilities: { jsonSchema: true, tools: true },
          capabilityDeclarations: { jsonSchema: true, tools: true },
        }),
      ],
      items: [
        {
          workItemId: 'CAP-ITEM',
          role: 'author.foundation',
          requiredCapabilities: ['jsonSchema', 'tools'],
          qualityFloor: 0,
        },
      ],
      accounts: [],
      registry,
      env: { FIXTURE_KEY: 'fixture-only' },
      evidenceDir: path.join(root, 'evidence'),
      assessment: { weightProfile: 'BALANCED', weights: routing.WEIGHT_PROFILES.BALANCED },
      fetch: async () => {
        calls++;
        return { ok: false, status: 451, json: async () => ({ message: 'region blocked' }) };
      },
      log: () => {},
      exit: () => {},
    }
  );
  assert.equal(calls, 2);
  assert.ok(
    result.decision.rejected.some(
      (row) => row.reasonCode === 'CAPABILITY_MISSING:jsonSchema' && row.reason === 'GEO_BLOCKED'
    )
  );
});
