'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sourcesApi = require('../sources');
const health = require('../route-health');
const probeOrder = require('../probe-order');
const { candidateKey } = require('../candidates');
const capabilityProbe = require('../capability-probe');
const { buildTaskProfile } = require('../orchestrate');

function makeCandidate(extra = {}) {
  const base = {
    harness: 'opencode-direct',
    accessPath: 'https://test.example/v1',
    gateway: 'test-source',
    upstream: 'test-vendor',
    modelId: 'test-vendor/model-a',
    accountId: 'acct-1',
    quotaScope: 'acct-1',
    capabilities: {},
    ...extra,
  };
  return { ...base, candidateKey: candidateKey(base) };
}

test('PR C (Item 1 & 6): sources.json dispatch configuration provides probe and schema budgets', () => {
  // The tracked configuration is an operator choice; these tests fix the agy-pool
  // writer flags explicitly instead of reading whatever the repo currently sets.
  const loaded = sourcesApi.loadSources();
  const defaultRegistry = {
    ...loaded,
    sources: loaded.sources.map((s) =>
      s.id === 'agy-pool' ? { ...s, writerEnabled: false, allowWriter: false } : s
    ),
  };
  const config = sourcesApi.getDispatchConfig(defaultRegistry);
  assert.equal(config.probeBudgetMs, 180000);
  assert.equal(config.maxConcurrentProbes, 8);
  assert.equal(config.probeTimeoutMs, 8000);
  assert.equal(config.safetyMarginMs, 2000);
  assert.equal(config.schemaProbeBudgetMs, 180000);

  // Custom configuration overrides defaults
  const customRegistry = {
    ...defaultRegistry,
    dispatch: {
      probeBudgetMs: 45000,
      maxConcurrentProbes: 4,
      probeTimeoutMs: 3000,
      probeSafetyMarginMs: 1500,
      schemaProbeBudgetMs: 50000,
    },
  };
  const customConfig = sourcesApi.getDispatchConfig(customRegistry);
  assert.equal(customConfig.probeBudgetMs, 45000);
  assert.equal(customConfig.maxConcurrentProbes, 4);
  assert.equal(customConfig.probeTimeoutMs, 3000);
  assert.equal(customConfig.safetyMarginMs, 1500);
  assert.equal(customConfig.schemaProbeBudgetMs, 50000);
});

test('PR C (Item 1): per-probe timeout uses elapsedMs + safetyMarginMs when elapsedMs is measured, probeTimeoutMs otherwise', () => {
  const config = {
    probeTimeoutMs: 8000,
    safetyMarginMs: 2000,
  };

  // Route without measured latency: defaults to probeTimeoutMs
  const cNoLatency = makeCandidate();
  const timeoutNoLatency = sourcesApi.resolveProbeTimeout(cNoLatency, null, config, 60000);
  assert.equal(timeoutNoLatency, 8000);

  // Route with measured elapsedMs on record
  const recordWithElapsed = { elapsedMs: 1400 };
  const timeoutWithRecord = sourcesApi.resolveProbeTimeout(
    cNoLatency,
    recordWithElapsed,
    config,
    60000
  );
  assert.equal(timeoutWithRecord, 3400); // 1400 + 2000

  // Route with elapsedMs on candidate itself
  const cWithElapsed = makeCandidate({ elapsedMs: 2100 });
  const timeoutWithCand = sourcesApi.resolveProbeTimeout(cWithElapsed, null, config, 60000);
  assert.equal(timeoutWithCand, 4100); // 2100 + 2000

  // Bounded by remaining time
  const timeoutCapped = sourcesApi.resolveProbeTimeout(cWithElapsed, null, config, 1500);
  assert.equal(timeoutCapped, 1500);
});

test('PR C (Item 2): orderProbeRoutes places route with recent success ahead of higher-ranked route without evidence', () => {
  const now = Date.now();
  const candHighNoEvidence = makeCandidate({
    modelId: 'vendor/high-score-unprobed',
    score: 100,
  });
  const candLowRecentSuccess = makeCandidate({
    modelId: 'vendor/lower-score-proven',
    score: 60,
  });

  const store = { version: 1, paths: {}, events: [] };
  const options = { routeHealth: store, now };

  // Record recent successful probe for candLowRecentSuccess
  health.rememberProbe(candLowRecentSuccess, { ok: true, status: 200 }, options);

  // High score candidate comes first in ranking
  const ranked = [candHighNoEvidence, candLowRecentSuccess];

  // orderProbeRoutes must place the proven route ahead of unevidenced route
  const ordered = health.orderProbeRoutes(ranked, options);
  assert.equal(ordered[0].candidateKey, candLowRecentSuccess.candidateKey);
  assert.equal(ordered[1].candidateKey, candHighNoEvidence.candidateKey);
});

test('PR C (Item 3): agy-pool writer permission is controlled by sources.json configuration', () => {
  // The tracked configuration is an operator choice; these tests fix the agy-pool
  // writer flags explicitly instead of reading whatever the repo currently sets.
  const loaded = sourcesApi.loadSources();
  const defaultRegistry = {
    ...loaded,
    sources: loaded.sources.map((s) =>
      s.id === 'agy-pool' ? { ...s, writerEnabled: false, allowWriter: false } : s
    ),
  };
  // In default sources.json, agy-pool writer must be disabled
  assert.equal(sourcesApi.isAgyPoolWriterEnabled(defaultRegistry), false);

  const agyCand = makeCandidate({ harness: 'agy-pool', accessPath: 'pool' });
  const profile = buildTaskProfile({
    id: 'ITEM-AGY',
    role: 'writer',
    requiredCapabilities: ['jsonSchema'],
    contextSize: 100,
  });

  // When disabled, capability probe returns WRITER_SCHEMA_LAUNCH_NOT_AUTHORIZED without launching
  let launched = 0;
  const disabledOptions = {
    registry: defaultRegistry,
    probeCli: () => {
      launched++;
      return { ok: true };
    },
    capabilityEvidence: {},
  };
  capabilityProbe.probeCapabilities([agyCand], profile, disabledOptions);
  assert.equal(launched, 0);
  assert.equal(agyCand.capabilityEvidence.jsonSchema.reason, 'WRITER_SCHEMA_LAUNCH_NOT_AUTHORIZED');

  // When enabled via configuration on source, agy-pool is authorized
  const enabledRegistry = {
    ...defaultRegistry,
    sources: defaultRegistry.sources.map((s) =>
      s.id === 'agy-pool' ? { ...s, writerEnabled: true } : s
    ),
  };
  assert.equal(sourcesApi.isAgyPoolWriterEnabled(enabledRegistry), true);
});

test('PR C (Item 4): route returning 402 on HTTP probe is NEVER sent to schema check', async () => {
  const c = makeCandidate({
    harness: 'opencode-direct',
    accessPath: 'https://gateway.example/v1',
  });
  const profile = buildTaskProfile({
    id: 'ITEM-402',
    role: 'writer',
    requiredCapabilities: ['jsonSchema'],
    contextSize: 100,
  });

  let schemaChecksAttempted = 0;
  let preflightCalls = 0;

  const options = {
    registry: {
      sources: [
        {
          id: 'test-source',
          kind: 'model-source',
          endpoint: 'https://gateway.example/v1',
          credential: { env: 'TEST_KEY' },
        },
      ],
    },
    env: { TEST_KEY: 'test-key' },
    preflightHttp: true,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.response_format) {
        schemaChecksAttempted++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '{}' } }] }),
        };
      }
      // Cheap HTTP preflight
      preflightCalls++;
      return {
        ok: false,
        status: 402,
        json: async () => ({ error: { message: 'Monthly request count exceeded' } }),
      };
    },
    capabilityEvidence: {},
  };

  await capabilityProbe.probeCapabilities([c], profile, options);

  assert.equal(preflightCalls, 1, 'preflight HTTP probe was executed');
  assert.equal(schemaChecksAttempted, 0, 'schema check must NEVER be attempted on 402 route');
  assert.equal(c.capabilities.jsonSchema, undefined);
  assert.ok(
    c.capabilityEvidence.jsonSchema.reason === 'NO_CREDIT' ||
      c.capabilityEvidence.jsonSchema.reason === 'UPSTREAM_CREDIT_OR_QUOTA'
  );
});

test('PR C (Item 5): HTTP candidates (paseo/opencode via 9router, opencode-direct) prove jsonSchema via HTTP without CLI', async () => {
  const c = makeCandidate({
    harness: 'opencode',
    gateway: '9router',
    modelId: 'ninerouter/kr/model-1',
  });
  const profile = buildTaskProfile({
    id: 'ITEM-HTTP-SCHEMA',
    role: 'writer',
    requiredCapabilities: ['jsonSchema'],
    contextSize: 100,
  });

  let cliLaunched = 0;
  let httpCalls = 0;

  const registry = {
    sources: [
      {
        id: '9router',
        kind: 'router',
        endpoint: 'http://127.0.0.1:20128/v1',
        credential: { env: 'NINEROUTER_API_KEY' },
      },
    ],
  };

  const options = {
    registry,
    env: { NINEROUTER_API_KEY: 'mock-key' },
    probeCli: () => {
      cliLaunched++;
      return { ok: true };
    },
    fetch: async (_url, init) => {
      httpCalls++;
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
      // preflight OK
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'OK' } }] }),
      };
    },
    capabilityEvidence: {},
  };

  await capabilityProbe.probeCapabilities([c], profile, options);

  assert.equal(cliLaunched, 0, 'pure CLI launcher must NOT be called for HTTP-routed model');
  assert.ok(httpCalls > 0, 'HTTP requests were made');
  assert.equal(c.capabilities.jsonSchema, true, 'candidate verified jsonSchema via HTTP');
});

test('PR C (Item 5): CLI schema proof recorded in evidence is reused on subsequent rounds without re-launching CLI', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-reuse-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const c = makeCandidate({
    harness: 'codex',
    accessPath: 'cli',
    gateway: 'codex',
  });
  const profile = buildTaskProfile({
    id: 'ITEM-REUSE',
    role: 'writer',
    requiredCapabilities: ['jsonSchema'],
    contextSize: 100,
  });

  let cliLaunches = 0;
  const options = {
    registry: { sources: [] },
    evidenceDir: dir,
    probeCli: (_c, _cap, _rem) => {
      cliLaunches++;
      return { ok: true, method: 'cli-schema-probe' };
    },
  };

  // Round 1: proves via CLI
  await capabilityProbe.probeCapabilities([c], profile, options);
  assert.equal(cliLaunches, 1, 'round 1 launched CLI once');
  assert.equal(c.capabilities.jsonSchema, true);

  // Round 2: same candidate, new instance
  const c2 = makeCandidate({
    harness: 'codex',
    accessPath: 'cli',
    gateway: 'codex',
  });
  await capabilityProbe.probeCapabilities([c2], profile, options);
  assert.equal(cliLaunches, 1, 'round 2 reused recorded evidence without launching CLI again');
  assert.equal(c2.capabilities.jsonSchema, true);
});

test('PR C (Item 3): preferKnownGood does not prioritize agy-pool ahead of known-good when writer is disabled', () => {
  const store = { version: 1, paths: {}, events: [] };
  const now = Date.now();
  // The tracked configuration is an operator choice; these tests fix the agy-pool
  // writer flags explicitly instead of reading whatever the repo currently sets.
  const loaded = sourcesApi.loadSources();
  const defaultRegistry = {
    ...loaded,
    sources: loaded.sources.map((s) =>
      s.id === 'agy-pool' ? { ...s, writerEnabled: false, allowWriter: false } : s
    ),
  };
  const agyCand = makeCandidate({ harness: 'agy-pool', accessPath: 'pool' });
  const liveCand = makeCandidate({ modelId: 'live/model', accessPath: 'live' });

  health.rememberProbe(liveCand, { ok: true, status: 200 }, { routeHealth: store, now });

  const resultDisabled = {
    chosen: agyCand.candidateKey,
    ranking: [agyCand, liveCand],
  };
  probeOrder.preferKnownGood(resultDisabled, [agyCand, liveCand], {
    registry: defaultRegistry,
    routeHealth: store,
    now,
  });
  // When agy-pool is disabled, liveCand (known good) should win over agy-pool
  assert.equal(resultDisabled.chosen, liveCand.candidateKey);

  // When agy-pool writer is enabled in registry
  const enabledRegistry = {
    ...defaultRegistry,
    sources: defaultRegistry.sources.map((s) =>
      s.id === 'agy-pool' ? { ...s, writerEnabled: true } : s
    ),
  };
  const resultEnabled = {
    chosen: liveCand.candidateKey,
    ranking: [liveCand, agyCand],
  };
  probeOrder.preferKnownGood(resultEnabled, [liveCand, agyCand], {
    registry: enabledRegistry,
    routeHealth: store,
    now,
  });
  assert.equal(resultEnabled.chosen, agyCand.candidateKey);
});

test('PR C (Item 3): orchestrate launcher refuses agy-pool when writer is disabled by configuration', () => {
  // The tracked configuration is an operator choice; these tests fix the agy-pool
  // writer flags explicitly instead of reading whatever the repo currently sets.
  const loaded = sourcesApi.loadSources();
  const defaultRegistry = {
    ...loaded,
    sources: loaded.sources.map((s) =>
      s.id === 'agy-pool' ? { ...s, writerEnabled: false, allowWriter: false } : s
    ),
  };
  const orchestrate = require('../orchestrate');
  const launcher = orchestrate.resolveLauncher(
    {
      registry: defaultRegistry,
      externalWorkers: 'agy-pool',
    },
    () => ({ exitCode: 0, stdout: 'ok', stderr: '' })
  );
  const result = launcher({
    harness: 'agy-pool',
    provider: 'agy-pool',
    model: 'gemini-model',
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.refusal, /WRITER_LAUNCH_NOT_AUTHORIZED.*disabled by configuration/);
});

test('PR C (Item 1): probeRankedRoutes enforces maxConcurrentProbes from configuration', async () => {
  const { probeRankedRoutes } = require('../hermes-session');
  let currentInFlight = 0;
  let maxObservedInFlight = 0;

  const routes = Array.from({ length: 12 }, (_, i) =>
    makeCandidate({
      accountId: `acct-${i}`,
      candidateKey: `test::key-${i}`,
    })
  );

  await probeRankedRoutes(routes, {
    maxConcurrentProbes: 3,
    accountKey: (r) => r.accountId,
    runProbe: async () => {
      currentInFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, currentInFlight);
      await new Promise((r) => setTimeout(r, 20));
      currentInFlight--;
      return false; // all fail so all get probed
    },
  });

  assert.equal(maxObservedInFlight, 3, 'concurrency must be capped at 3');
});
