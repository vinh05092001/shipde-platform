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
    maxConcurrentProbes: 1,
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

test('review P1: daemon URL stays on CLI capability seam', async () => {
  let http = 0,
    cli = 0;
  const c = candidate({ harness: 'paseo', accessPath: 'http://127.0.0.1:20128/v1' });
  await require('../capability-probe').probeCapabilities([c], profile, {
    registry,
    env: { FIXTURE_KEY: 'fixture' },
    fetch: async () => {
      http++;
      return { ok: false, status: 451, json: async () => ({}) };
    },
    probeCli: async () => {
      cli++;
      return { ok: true };
    },
  });
  assert.equal(http, 0);
  assert.equal(cli, 2);
});

test('review P1: dispatch dry-run honors injected probe and never uses ambient fetch', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-seam-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let ambient = 0,
    injected = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    ambient++;
    throw Error('ambient network forbidden');
  });
  const opts = {
    candidates: [candidate()],
    items: [{ workItemId: 'CAP-SEAM', requiredCapabilities: ['tools'], qualityFloor: 0 }],
    registry,
    accounts: [],
    env: { FIXTURE_KEY: 'fixture' },
    evidenceDir: path.join(root, 'evidence'),
    assessment: { weightProfile: 'BALANCED', weights: routing.WEIGHT_PROFILES.BALANCED },
    log: () => {},
    exit: () => {},
  };
  await require('../cli').dispatchCommand(
    { 'dry-run': true, root },
    {
      ...opts,
      probeCapabilities: async () => {
        injected++;
      },
    }
  );
  assert.equal(injected, 1);
  await require('../cli').dispatchCommand({ 'dry-run': true, root }, opts);
  assert.equal(ambient, 0);
});

test('review P2: selection without registry never reads host sources or probes HTTP', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-no-registry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let reads = 0,
    http = 0;
  t.mock.method(require('../sources'), 'loadSources', () => {
    reads++;
    return registry;
  });
  await require('../orchestrate').selectCandidateForProfile(
    { id: 'NO-REG', role: 'reviewer.primary', requiredCapabilities: ['tools'], qualityFloor: 0 },
    [candidate()],
    [],
    {},
    {
      jevAsk: async () => null,
      env: { FIXTURE_KEY: 'fixture' },
      fetch: async () => {
        http++;
        return { ok: false, status: 451, json: async () => ({}) };
      },
    },
    { dir },
    Date.now()
  );
  assert.equal(reads, 0);
  assert.equal(http, 0);
});

test('review P3: pool schema proof uses configured worker timeout within remaining budget', async (t) => {
  const pool = require('../agy-pool-runtime');
  let timeout;
  t.mock.method(pool, 'readResult', () => null);
  t.mock.method(pool, 'readOutText', () => '');
  t.mock.method(pool, 'submitJob', (_a, _j, o) => {
    timeout = o.timeoutMs;
    return { state: 'error', reason: 'POOL_TIMEOUT' };
  });
  await require('../writer-schema').verify(candidate({ harness: 'agy-pool' }), {
    workerTimeoutMs: 2345,
    schemaTimeoutMs: 90000,
  });
  assert.equal(timeout, 2345);
});

test('review P1: profile dispatch also honors injected capability probe', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-profile-seam-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'profile.json');
  fs.writeFileSync(file, JSON.stringify(profile));
  await assert.rejects(
    require('../cli').dispatchProfileCommand(
      { profile: file, json: true },
      {
        candidates: [candidate()],
        accounts: [],
        registry,
        evidenceDir: path.join(root, 'evidence'),
        decisionDir: root,
        ask: async () => null,
        env: { FIXTURE_KEY: 'fixture' },
        fetch: async () => ({ ok: false, status: 451, json: async () => ({}) }),
        probeCapabilities: async () => {
          throw Error('INJECTED_PROFILE_PROBE');
        },
        log: () => {},
        exit: () => {},
      }
    ),
    /INJECTED_PROFILE_PROBE/
  );
});

test('a forced tool call wrapped as {"data": ...} with a trailing [DONE] marker is observed', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-probe-wrap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wrapped = (payload) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: payload }) + '\n\ndata: [DONE]\n',
  });
  const api = require('../capability-probe');
  const c = candidate();
  await api.probeCapabilities([c], profile, {
    registry,
    evidenceDir: dir,
    env: { FIXTURE_KEY: 'fixture-only' },
    fetch: async (_url, init) => {
      const req = JSON.parse(init.body);
      if (req.response_format) {
        const props = req.response_format.json_schema.schema.properties;
        return wrapped({
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
        });
      }
      const tool = req.tools[0].function;
      return wrapped({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: tool.name,
                    arguments: JSON.stringify({ nonce: tool.parameters.properties.nonce.enum[0] }),
                  },
                },
              ],
            },
          },
        ],
      });
    },
  });
  assert.equal(c.capabilities.tools, true);
  assert.equal(c.capabilities.jsonSchema, true);
});

test('a forced tool call streamed as SSE chunks (non-stream request) is observed', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-probe-sse-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sse = (events) => ({
    ok: true,
    status: 200,
    text: async () =>
      events.map((e) => 'data: ' + JSON.stringify(e)).join('\n\n') + '\n\ndata: [DONE]\n',
  });
  const api = require('../capability-probe');
  const c = candidate();
  await api.probeCapabilities([c], profile, {
    registry,
    evidenceDir: dir,
    env: { FIXTURE_KEY: 'fixture-only' },
    fetch: async (_url, init) => {
      const req = JSON.parse(init.body);
      if (req.response_format) {
        const props = req.response_format.json_schema.schema.properties;
        const answer = JSON.stringify({
          candidateKey: props.candidateKey.enum[0],
          nonce: props.nonce.enum[0],
          status: 'completed',
          artifacts: [],
        });
        return sse([
          { choices: [{ delta: { content: answer.slice(0, 20) } }] },
          { choices: [{ delta: { content: answer.slice(20) } }] },
        ]);
      }
      const tool = req.tools[0].function;
      const args = JSON.stringify({ nonce: tool.parameters.properties.nonce.enum[0] });
      return sse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, type: 'function', function: { name: tool.name, arguments: '' } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(0, 5) } }] } },
          ],
        },
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] } },
          ],
        },
      ]);
    },
  });
  assert.equal(c.capabilities.tools, true);
  assert.equal(c.capabilities.jsonSchema, true);
});
