'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defaultDispatch = require('../sources.json').dispatch;

const {
  credentialFingerprint,
  detectNewSources,
  onboardSourceRolling,
  autoOnboardNewSources,
} = require('../rolling-onboard');

// Completion probe answers; the quota scan that follows reports exhausted credit.
function refusingQuotaFetch(onCall) {
  let calls = 0;
  return async () => {
    calls += 1;
    onCall();
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
      };
    }
    return { ok: false, status: 402, headers: new Map(), text: async () => 'insufficient_quota' };
  };
}

// The account registry binding that owns a source's route; onboarding never invents one.
function boundAccounts(sourceId) {
  return [
    {
      id: `${sourceId}-acct`,
      provider: sourceId,
      source: sourceId,
      models: [],
      capabilities: { contextWindow: 128000 },
      enabled: true,
    },
  ];
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rolling-onboard-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('TASK-AI-142 T8: rolling source onboarding', () => {
  test('detectNewSources identifies sources in registry with env keys that lack evidence', () => {
    const registry = {
      sources: [
        {
          id: 'existing-source',
          kind: 'model-source',
          servesModels: true,
          credential: { env: 'EXISTING_KEY' },
        },
        {
          id: 'new-source-with-key',
          kind: 'model-source',
          servesModels: true,
          credential: { env: 'NEW_KEY' },
        },
        {
          id: 'new-source-without-key',
          kind: 'model-source',
          servesModels: true,
          credential: { env: 'MISSING_KEY' },
        },
        {
          id: 'non-model-source',
          kind: 'tool',
          servesModels: false,
        },
      ],
    };

    const evidenceData = {
      combinations: [
        {
          source: 'existing-source',
          modelId: 'm1',
          credentialFingerprint: credentialFingerprint('secret1'),
          evidence: [{ status: 'passed' }],
        },
      ],
    };

    const env = {
      EXISTING_KEY: 'secret1',
      NEW_KEY: 'secret2',
    };

    const detected = detectNewSources(registry, evidenceData, env);
    assert.equal(detected.length, 1);
    assert.equal(detected[0].id, 'new-source-with-key');
  });

  test('detectNewSources retries a source whose only prior evidence failed when its key is present', () => {
    const registry = {
      sources: [
        {
          id: 'retry-source',
          kind: 'model-source',
          servesModels: true,
          credential: { env: 'RETRY_SOURCE_KEY' },
        },
      ],
    };
    const evidenceData = {
      combinations: [
        {
          source: 'retry-source',
          modelId: 'fixture/retry-model',
          evidence: [{ status: 'failed', proofLevel: 'API_PASS' }],
        },
      ],
    };

    const detected = detectNewSources(registry, evidenceData, {
      RETRY_SOURCE_KEY: 'replacement-fixture-key',
    });

    assert.deepEqual(
      detected.map((source) => source.id),
      ['retry-source']
    );
  });

  test('onboardSourceRolling probes new source and records passing evidence and quota state', async (t) => {
    const dir = fixture(t);
    const evidenceDir = path.join(dir, 'evidence');
    const quotaFile = path.join(dir, 'quota-state.json');
    const healthFile = path.join(dir, 'route-health.json');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const src = {
      id: 'mock-provider',
      kind: 'model-source',
      servesModels: true,
      endpoint: 'https://api.mockprovider.ai/v1',
      models: ['mockprovider/model-alpha'],
      credential: { env: 'MOCKPROVIDER_KEY' },
    };

    const evidenceData = { combinations: [] };
    const env = { MOCKPROVIDER_KEY: 'mock-secret-token' };

    let fetchCalled = false;
    const fakeFetch = async (url, opts) => {
      fetchCalled = true;
      assert.ok(url.includes('/chat/completions'));
      assert.equal(opts.headers.authorization, 'Bearer mock-secret-token');
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
      };
    };

    const result = await onboardSourceRolling(src, {
      evidenceData,
      accounts: [],
      evidenceDir,
      quotaStateFile: quotaFile,
      routeHealthFile: healthFile,
      env,
      fetch: fakeFetch,
      now: 1700000000000,
    });

    assert.equal(fetchCalled, true);
    assert.equal(result.ok, true);
    assert.equal(result.sourceId, 'mock-provider');

    // Verify evidenceData was populated
    assert.equal(evidenceData.combinations.length, 1);
    const combo = evidenceData.combinations[0];
    assert.equal(combo.source, 'mock-provider');
    assert.equal(combo.modelId, 'mockprovider/model-alpha');
    assert.equal(combo.evidence[0].status, 'passed');

    // Verify quota state was saved
    assert.equal(fs.existsSync(quotaFile), true);
    const quota = JSON.parse(fs.readFileSync(quotaFile, 'utf8'));
    assert.equal(quota.scopes['mock-provider::mock-provider'].code, 'OK');

    // Route health lands in the configured store, not the production default
    const health = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    assert.ok(Object.keys(health.paths).some((key) => key.includes('mockprovider/model-alpha')));
  });

  test('onboardSourceRolling rejects an HTTP 200 application error without API_PASS evidence', async (t) => {
    const dir = fixture(t);
    const evidenceData = { combinations: [] };
    const src = {
      id: 'application-error-source',
      kind: 'model-source',
      servesModels: true,
      endpoint: 'https://application-error.invalid/v1',
      models: ['fixture/application-error-model'],
      credential: { env: 'APPLICATION_ERROR_KEY' },
    };

    const result = await onboardSourceRolling(src, {
      evidenceData,
      accounts: [],
      evidenceDir: path.join(dir, 'evidence'),
      env: { APPLICATION_ERROR_KEY: 'fixture-credential' },
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ error: { code: 'route_unavailable' } }),
      }),
      persist: false,
      routeHealth: { version: 1, paths: {}, events: [] },
      routeHealthFile: path.join(dir, 'route-health.json'),
      now: 1700000000000,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'APPLICATION_ERROR');
    assert.equal(evidenceData.combinations.length, 0);
  });

  test('end-to-end: adding a mock source into registry makes it appear in dispatch --dry-run without code changes', async (t) => {
    const dir = fixture(t);
    const evidenceDir = path.join(dir, 'evidence');
    const quotaFile = path.join(dir, 'quota-state.json');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const { dispatchCommand } = require('../cli');

    const registry = {
      sources: [
        {
          id: 'new-auto-source',
          kind: 'model-source',
          servesModels: true,
          endpoint: 'https://api.autosource.ai/v1',
          models: ['new-auto-source/great-model'],
          harness: 'direct-http',
          credential: { env: 'AUTO_SOURCE_KEY' },
        },
      ],
      dispatch: { ...defaultDispatch, providers: {} },
    };

    const fakeFetch = async (url, opts) => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
    });

    const env = { AUTO_SOURCE_KEY: 'test-auto-key' };

    // Run dry-run dispatch. The source is new, so it triggers auto-onboarding during the run
    const res = await dispatchCommand(
      { 'dry-run': true, item: 'TASK-ONBOARD-TEST' },
      {
        registry,
        env,
        fetch: fakeFetch,
        evidenceDir,
        quotaStateFile: quotaFile,
        routeHealth: { version: 1, paths: {}, events: [] },
        routeHealthFile: path.join(dir, 'route-health.json'),
        discoveryCatalogue: { candidates: [] },
        accounts: boundAccounts('new-auto-source'),
        assessment: {},
        priors: [],
        home: path.join(dir, 'home'),
        storePath: path.join(dir, 'quota-store.json'),
        now: 1700000000000,
        exit: () => {},
      }
    );

    assert.ok(res, 'dispatchCommand must return a result');
    // The newly onboarded model should appear in ranking or candidates
    const allCandidates = (res.decision?.candidates || []).concat(res.decision?.ranking || []);
    const found = allCandidates.some(
      (c) =>
        c.source === 'new-auto-source' ||
        c.sourceId === 'new-auto-source' ||
        (c.modelId && c.modelId.includes('new-auto-source'))
    );
    assert.ok(found, 'Newly onboarded source model must appear in dispatch --dry-run');
  });

  test('normal live dispatch auto-onboards a new keyed source without a dependency flag', async (t) => {
    const dir = fixture(t);
    const evidenceDir = path.join(dir, 'evidence');
    const decisionDir = path.join(dir, 'decisions');
    const home = path.join(dir, 'home');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.mkdirSync(decisionDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });

    // The launch gate checks the worker's real environment for the credential.
    process.env.LIVE_AUTO_SOURCE_KEY = 'live-fixture-credential';
    t.after(() => delete process.env.LIVE_AUTO_SOURCE_KEY);
    const { dispatchCommand } = require('../cli');
    const registry = {
      sources: [
        {
          id: 'live-auto-source',
          kind: 'model-source',
          servesModels: true,
          endpoint: 'https://live-auto.invalid/v1',
          models: ['fixture/live-auto-model'],
          harness: 'direct-http',
          credential: { env: 'LIVE_AUTO_SOURCE_KEY' },
        },
      ],
      dispatch: { ...defaultDispatch, providers: {} },
    };
    const routeHealth = { version: 1, paths: {}, events: [] };
    let fetchCalls = 0;
    const logs = [];
    let launchCalls = 0;

    const result = await dispatchCommand(
      { execute: true, item: 'TASK-ROLLING-LIVE' },
      {
        registry,
        env: { LIVE_AUTO_SOURCE_KEY: 'live-fixture-credential' },
        fetch: async () => {
          fetchCalls += 1;
          return {
            ok: true,
            status: 200,
            headers: new Map(),
            text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
          };
        },
        evidenceDir,
        decisionDir,
        quotaStateFile: path.join(dir, 'quota-state.json'),
        routeHealth,
        routeHealthFile: path.join(dir, 'route-health.json'),
        home,
        discoveryCatalogue: { candidates: [] },
        assessment: {},
        priors: [],
        accounts: boundAccounts('live-auto-source'),
        storePath: path.join(dir, 'quota-store.json'),
        items: [
          {
            workItemId: 'TASK-ROLLING-LIVE',
            role: 'author.foundation',
            branch: 'fix/task-rolling-live',
          },
        ],
        run: () => {
          launchCalls += 1;
          return { exitCode: 0, stdout: '{"id":"fixture-session","status":"running"}' };
        },
        log: (m) => logs.push(String(m)),
        error: () => {},
        exit: () => {},
        now: 1700000000000,
      }
    );

    // Completion probe, quota scan, and tool capability probe of the source scope, then the live run
    // picks the newly onboarded route. Whether the host can launch it (worker isolation)
    // is the launcher's concern and differs per machine, so it is not asserted here.
    assert.equal(fetchCalls, 3);
    assert.ok(result);
    assert.ok(
      logs.some((line) => /^Dispatching TASK-ROLLING-LIVE to .*live-auto-source/.test(line)),
      'live dispatch must select the onboarded source'
    );
  });
  test('router scope discovery invents no scopes when no live or catalogued model exists', async () => {
    const { discover9RouterScopes } = require('../quota-scan');
    const targets = await discover9RouterScopes(
      { id: 'router-fixture', endpoint: 'https://router.invalid/v1' },
      { env: {}, fetch: async () => ({ ok: false, status: 503, text: async () => '' }) }
    );
    assert.deepEqual(targets, []);
  });

  test('router scope discovery groups live model ids by their own upstream prefix', async () => {
    const { discover9RouterScopes } = require('../quota-scan');
    const targets = await discover9RouterScopes(
      { id: 'router-fixture', endpoint: 'https://router.invalid/v1' },
      {
        env: {},
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'router-fixture/up1/model-a' }, { id: 'up2/model-b' }, { id: 'bare' }],
          }),
        }),
      }
    );
    assert.deepEqual(
      targets.map((t) => [t.scope, t.model]),
      [
        ['up1', 'up1/model-a'],
        ['up2', 'up2/model-b'],
      ]
    );
  });
  test('detectNewSources re-probes a source whose key was replaced after it passed', () => {
    const registry = {
      sources: [{ id: 'rotated', kind: 'model-source', credential: { env: 'ROTATED_KEY' } }],
    };
    const evidenceData = {
      combinations: [
        {
          source: 'rotated',
          modelId: 'fixture/rotated-model',
          credentialFingerprint: credentialFingerprint('old-fixture-key'),
          evidence: [{ status: 'passed' }],
        },
      ],
    };
    assert.deepEqual(
      detectNewSources(registry, evidenceData, { ROTATED_KEY: 'old-fixture-key' }),
      []
    );
    assert.deepEqual(
      detectNewSources(registry, evidenceData, { ROTATED_KEY: 'new-fixture-key' }).map((s) => s.id),
      ['rotated']
    );
  });

  test('a source whose quota scan refuses it is recorded but not onboarded', async (t) => {
    const dir = fixture(t);
    const quotaFile = path.join(dir, 'quota-state.json');
    const evidenceData = { combinations: [] };
    let calls = 0;
    const result = await onboardSourceRolling(
      {
        id: 'scan-source',
        kind: 'model-source',
        endpoint: 'https://scan.invalid/v1',
        models: ['fixture/scan-model'],
        credential: { env: 'SCAN_KEY' },
      },
      {
        evidenceData,
        accounts: [],
        evidenceDir: path.join(dir, 'evidence'),
        quotaStateFile: quotaFile,
        routeHealthFile: path.join(dir, 'route-health.json'),
        env: { SCAN_KEY: 'scan-fixture-key' },
        fetch: refusingQuotaFetch(() => (calls += 1)),
        now: 1700000000000,
      }
    );
    assert.equal(calls, 2);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'QUOTA_QUOTA');
    assert.equal(evidenceData.combinations.length, 0);
    const raw = fs.readFileSync(quotaFile, 'utf8');
    assert.equal(JSON.parse(raw).scopes['scan-source::scan-source'].code, 'QUOTA');
    assert.equal(raw.includes('scan-fixture-key'), false);
  });

  test('dispatch does not rank a new source whose quota scan refuses it', async (t) => {
    const dir = fixture(t);
    const { dispatchCommand } = require('../cli');
    const res = await dispatchCommand(
      { 'dry-run': true, item: 'TASK-ONBOARD-REFUSED' },
      {
        registry: {
          sources: [
            {
              id: 'refused-source',
              kind: 'model-source',
              servesModels: true,
              endpoint: 'https://refused.invalid/v1',
              models: ['refused-source/model'],
              harness: 'direct-http',
              credential: { env: 'REFUSED_KEY' },
            },
          ],
          dispatch: { ...defaultDispatch, providers: {} },
        },
        env: { REFUSED_KEY: 'refused-fixture-key' },
        fetch: refusingQuotaFetch(() => {}),
        evidenceDir: path.join(dir, 'evidence'),
        quotaStateFile: path.join(dir, 'quota-state.json'),
        routeHealth: { version: 1, paths: {}, events: [] },
        routeHealthFile: path.join(dir, 'route-health.json'),
        discoveryCatalogue: { candidates: [] },
        accounts: boundAccounts('refused-source'),
        assessment: {},
        priors: [],
        home: path.join(dir, 'home'),
        storePath: path.join(dir, 'quota-store.json'),
        now: 1700000000000,
        exit: () => {},
      }
    );
    const ranked = (res.decision?.candidates || []).concat(res.decision?.ranking || []);
    assert.equal(
      ranked.some((c) => [c.source, c.sourceId, c.gateway].includes('refused-source')),
      false
    );
  });

  test('a router with only live-listed models is onboarded from its /models discovery', async (t) => {
    const dir = fixture(t);
    const evidenceData = { combinations: [] };
    const result = await onboardSourceRolling(
      {
        id: 'live-router',
        kind: 'router',
        endpoint: 'https://router.invalid/v1',
        credential: { env: 'ROUTER_KEY' },
      },
      {
        evidenceData,
        accounts: [],
        evidenceDir: path.join(dir, 'evidence'),
        quotaStateFile: path.join(dir, 'quota-state.json'),
        routeHealthFile: path.join(dir, 'route-health.json'),
        env: { ROUTER_KEY: 'router-fixture-key' },
        fetch: async (url) =>
          url.endsWith('/models')
            ? { ok: true, status: 200, json: async () => ({ data: [{ id: 'up1/listed-model' }] }) }
            : {
                ok: true,
                status: 200,
                headers: new Map(),
                text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
              },
        now: 1700000000000,
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.model, 'up1/listed-model');
    assert.equal(evidenceData.combinations.length, 1);
  });

  test('HTTP 200 with an application error is not recorded as healthy quota', () => {
    const { classifyQuotaResponse } = require('../quota-scan');
    const res = classifyQuotaResponse(200, JSON.stringify({ error: { code: 'x' } }), new Map(), 0);
    assert.notEqual(res.code, 'OK');
  });

  test('scanScope never falls back to the host env when the caller supplies one', async () => {
    const { scanScope } = require('../quota-scan');
    process.env.HOST_ONLY_FIXTURE_KEY = 'host-fixture-key';
    try {
      let auth;
      await scanScope(
        {
          source: 's',
          scope: 's',
          model: 'm/x',
          endpoint: 'https://s.invalid/v1',
          apiKeyEnv: 'HOST_ONLY_FIXTURE_KEY',
        },
        {
          env: {},
          registry: { sources: [], dispatch: { ...defaultDispatch, providers: {} } },
          fetch: async (url, opts) => {
            auth = opts.headers.authorization;
            return { ok: true, status: 200, headers: new Map(), text: async () => '{}' };
          },
        }
      );
      assert.equal(auth, undefined);
    } finally {
      delete process.env.HOST_ONLY_FIXTURE_KEY;
    }
  });

  test('quota classification never copies the provider body into the persisted reason', () => {
    const { classifyQuotaResponse } = require('../quota-scan');
    const res = classifyQuotaResponse(418, 'echo: Bearer sk-fixture-secret', new Map(), 0);
    assert.equal(res.reason.includes('sk-fixture-secret'), false);
  });

  test('a full scan skips a source with no configured model instead of inventing one', async (t) => {
    const dir = fixture(t);
    const { scanAllQuotas } = require('../quota-scan');
    let calls = 0;
    const res = await scanAllQuotas({
      registry: {
        sources: [{ id: 'no-model', kind: 'model-source', endpoint: 'https://x.invalid/v1' }],
        dispatch: { ...defaultDispatch, providers: {} },
      },
      quotaStateFile: path.join(dir, 'q.json'),
      fetch: async () => {
        calls += 1;
        return { ok: true, status: 200, headers: new Map(), text: async () => '{}' };
      },
      env: {},
      now: 1700000000000,
    });
    assert.equal(calls, 0);
    assert.equal(res.count, 0);
  });
  test('a nonblocking but unusable quota scan (rate limited) still does not onboard', async (t) => {
    const dir = fixture(t);
    const evidenceData = { combinations: [] };
    let calls = 0;
    const result = await onboardSourceRolling(
      {
        id: 'rated-source',
        kind: 'model-source',
        endpoint: 'https://rated.invalid/v1',
        models: ['fixture/rated-model'],
        credential: { env: 'RATED_KEY' },
      },
      {
        evidenceData,
        accounts: [],
        evidenceDir: path.join(dir, 'evidence'),
        quotaStateFile: path.join(dir, 'quota-state.json'),
        routeHealthFile: path.join(dir, 'route-health.json'),
        env: { RATED_KEY: 'rated-fixture-key' },
        fetch: async () => {
          calls += 1;
          return calls === 1
            ? {
                ok: true,
                status: 200,
                headers: new Map(),
                text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
              }
            : { ok: false, status: 429, headers: new Map(), text: async () => 'slow down' };
        },
        now: 1700000000000,
      }
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /^QUOTA_/);
    assert.equal(evidenceData.combinations.length, 0);
  });

  test('after a key rotation a failed re-probe removes the old pass from dispatch', async (t) => {
    const dir = fixture(t);
    const { dispatchCommand } = require('../cli');
    const registry = {
      sources: [
        {
          id: 'rotating-source',
          kind: 'model-source',
          servesModels: true,
          endpoint: 'https://rotating.invalid/v1',
          models: ['rotating-source/model'],
          harness: 'direct-http',
          credential: { env: 'ROTATING_KEY' },
        },
      ],
      dispatch: { ...defaultDispatch, providers: {} },
    };
    const routeHealth = { version: 1, paths: {}, events: [] };
    const okFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
    });
    const failFetch = async () => ({
      ok: false,
      status: 401,
      headers: new Map(),
      text: async () => 'invalid api key',
    });
    const run = (key, fetch) =>
      dispatchCommand(
        { 'dry-run': true, item: 'TASK-ONBOARD-ROTATE' },
        {
          registry,
          env: { ROTATING_KEY: key },
          fetch,
          evidenceDir: path.join(dir, 'evidence'),
          quotaStateFile: path.join(dir, 'quota-state.json'),
          routeHealth,
          routeHealthFile: path.join(dir, 'route-health.json'),
          discoveryCatalogue: { candidates: [] },
          accounts: boundAccounts('rotating-source'),
          assessment: {},
          priors: [],
          home: path.join(dir, 'home'),
          storePath: path.join(dir, 'quota-store.json'),
          now: 1700000000000,
          exit: () => {},
        }
      );
    const ranked = (res) =>
      (res.decision?.candidates || [])
        .concat(res.decision?.ranking || [])
        .some((c) => [c.source, c.sourceId, c.gateway].includes('rotating-source'));

    fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
    assert.equal(ranked(await run('first-fixture-key', okFetch)), true);
    const second = await run('second-fixture-key', failFetch);
    assert.equal(ranked(second), false);
  });
  test('after a successful key rotation, old-key passes for other models cannot rank', async (t) => {
    const dir = fixture(t);
    const evidenceDir = path.join(dir, 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const { dispatchCommand } = require('../cli');
    const registry = {
      sources: [
        {
          id: 'multi-source',
          kind: 'model-source',
          servesModels: true,
          endpoint: 'https://multi.invalid/v1',
          models: ['multi-source/first', 'multi-source/second'],
          harness: 'direct-http',
          credential: { env: 'MULTI_KEY' },
        },
      ],
      dispatch: { ...defaultDispatch, providers: {} },
    };
    const routeHealth = { version: 1, paths: {}, events: [] };
    const okFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
    });
    // Old key: evidence for a second model exists, earned before the rotation.
    const {
      onboardSourceRolling: onboard,
      credentialFingerprint: fp,
    } = require('../rolling-onboard');
    const evidenceData = { combinations: [] };
    await onboard(registry.sources[0], {
      evidenceData,
      accounts: boundAccounts('multi-source'),
      evidenceDir,
      quotaStateFile: path.join(dir, 'quota-state.json'),
      routeHealth,
      registry,
      env: { MULTI_KEY: 'old-fixture-key' },
      fetch: okFetch,
      routeHealthFile: path.join(dir, 'route-health.json'),
      now: 1700000000000,
    });
    const second = { ...evidenceData.combinations[0] };
    second.model = second.modelId = 'multi-source/second';
    second.candidateKey = require('../candidates').candidateKey(second);
    second.evidence = [
      {
        status: 'passed',
        level: 1,
        proofLevel: 'API_PASS',
        observedAt: '2023-11-14T22:13:20.000Z',
      },
    ];
    evidenceData.combinations.push(second);
    require('../route-health').rememberProbe(
      second,
      { ok: true, status: 200 },
      { routeHealth, now: 1700000000000, persistRouteHealth: false }
    );
    require('../evidence').saveEvidence(evidenceDir, evidenceData);
    assert.equal(second.credentialFingerprint, fp('old-fixture-key'));

    const res = await dispatchCommand(
      { 'dry-run': true, item: 'TASK-ONBOARD-MULTI' },
      {
        registry,
        env: { MULTI_KEY: 'new-fixture-key' },
        fetch: okFetch,
        evidenceDir,
        quotaStateFile: path.join(dir, 'quota-state.json'),
        routeHealth,
        routeHealthFile: path.join(dir, 'route-health.json'),
        discoveryCatalogue: { candidates: [] },
        accounts: boundAccounts('multi-source'),
        assessment: {},
        priors: [],
        home: path.join(dir, 'home'),
        storePath: path.join(dir, 'quota-store.json'),
        now: 1700000000000,
        exit: () => {},
      }
    );
    const ranked = (res.decision?.ranking || []).map((c) => c.modelId || c.model);
    assert.ok(ranked.includes('multi-source/first'), 'the re-verified model ranks');
    assert.equal(ranked.includes('multi-source/second'), false, 'the old-key model does not');
  });

  test('a quota scan whose body never finishes is cut off by the configured timeout', async () => {
    const { scanScope } = require('../quota-scan');
    const result = await scanScope(
      { source: 's', scope: 's', model: 'm/x', endpoint: 'https://s.invalid/v1' },
      {
        env: {},
        registry: { sources: [], dispatch: { ...defaultDispatch, providers: {} } },
        probeTimeoutMs: 50,
        fetch: async () => ({
          ok: true,
          status: 200,
          headers: new Map(),
          text: () => new Promise(() => {}),
        }),
      }
    );
    assert.equal(result.code, 'TIMEOUT');
  });
  test('legacy passing evidence without a fingerprint is neither re-probed nor retired', async (t) => {
    const dir = fixture(t);
    const legacy = {
      source: 'legacy-source',
      sourceId: 'legacy-source',
      gateway: 'legacy-source',
      modelId: 'legacy-source/model',
      evidence: [{ status: 'passed', proofLevel: 'API_PASS' }],
    };
    const src = {
      id: 'legacy-source',
      kind: 'model-source',
      endpoint: 'https://legacy.invalid/v1',
      models: ['legacy-source/model'],
      credential: { env: 'LEGACY_KEY' },
    };
    const evidenceData = { combinations: [legacy] };
    assert.deepEqual(
      detectNewSources({ sources: [src] }, evidenceData, { LEGACY_KEY: 'legacy-fixture-key' }),
      []
    );
    // Even a forced, transiently failing re-probe leaves the legacy pass intact.
    const result = await onboardSourceRolling(src, {
      evidenceData,
      accounts: [],
      evidenceDir: path.join(dir, 'evidence'),
      quotaStateFile: path.join(dir, 'quota-state.json'),
      routeHealthFile: path.join(dir, 'route-health.json'),
      env: { LEGACY_KEY: 'legacy-fixture-key' },
      fetch: async () => {
        throw new Error('network down');
      },
      now: 1700000000000,
    });
    assert.equal(result.ok, false);
    assert.equal(legacy.evidence.at(-1).status, 'passed');
  });

  test('onboarding without a registry binding invents no account and the source does not rank', async (t) => {
    const dir = fixture(t);
    const { dispatchCommand } = require('../cli');
    const accounts = [];
    const evidenceDir = path.join(dir, 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const res = await dispatchCommand(
      { 'dry-run': true, item: 'TASK-ONBOARD-UNBOUND' },
      {
        registry: {
          sources: [
            {
              id: 'unbound-source',
              kind: 'model-source',
              servesModels: true,
              endpoint: 'https://unbound.invalid/v1',
              models: ['unbound-source/model'],
              harness: 'direct-http',
              credential: { env: 'UNBOUND_KEY' },
            },
          ],
          dispatch: { ...defaultDispatch, providers: {} },
        },
        env: { UNBOUND_KEY: 'unbound-fixture-key' },
        fetch: async () => ({
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
        }),
        evidenceDir,
        quotaStateFile: path.join(dir, 'quota-state.json'),
        routeHealth: { version: 1, paths: {}, events: [] },
        routeHealthFile: path.join(dir, 'route-health.json'),
        discoveryCatalogue: { candidates: [] },
        accounts,
        assessment: {},
        priors: [],
        home: path.join(dir, 'home'),
        storePath: path.join(dir, 'quota-store.json'),
        now: 1700000000000,
        exit: () => {},
      }
    );
    assert.deepEqual(accounts, []);
    const ranked = (res.decision?.ranking || []).some((c) => c.source === 'unbound-source');
    assert.equal(ranked, false);
    const stored = JSON.parse(
      fs.readFileSync(path.join(evidenceDir, fs.readdirSync(evidenceDir)[0]), 'utf8')
    );
    assert.ok(stored.combinations.every((c) => c.accountId === null));
  });

  test('a router onboards its usable scopes while a refused scope stays blocked', async (t) => {
    const dir = fixture(t);
    const evidenceData = { combinations: [] };
    const quotaFile = path.join(dir, 'quota-state.json');
    const completion = {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
    };
    const result = await onboardSourceRolling(
      {
        id: 'split-router',
        kind: 'router',
        endpoint: 'https://split.invalid/v1',
        credential: { env: 'SPLIT_KEY' },
      },
      {
        evidenceData,
        accounts: [],
        evidenceDir: path.join(dir, 'evidence'),
        quotaStateFile: quotaFile,
        routeHealthFile: path.join(dir, 'route-health.json'),
        env: { SPLIT_KEY: 'split-fixture-key' },
        fetch: async (url, opts) => {
          if (url.endsWith('/models')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ data: [{ id: 'good/model' }, { id: 'dry/model' }] }),
            };
          }
          return JSON.parse(opts.body).model === 'dry/model'
            ? { ok: false, status: 402, headers: new Map(), text: async () => 'insufficient_quota' }
            : completion;
        },
        now: 1700000000000,
      }
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.models, ['good/model']);
    assert.deepEqual(
      evidenceData.combinations.map((c) => c.modelId),
      ['good/model']
    );
    assert.equal(typeof evidenceData.combinations[0].evidence[0].elapsedMs, 'number');
    const quota = JSON.parse(fs.readFileSync(quotaFile, 'utf8'));
    assert.equal(quota.scopes['split-router::dry'].code, 'QUOTA');
    assert.equal(quota.scopes['split-router::good'].code, 'OK');
  });

  test('onboardSourceRolling probes forced tool call and records tools capability evidence into capabilityProbes and combo', async (t) => {
    const dir = fixture(t);
    const evidenceDir = path.join(dir, 'evidence');
    const quotaFile = path.join(dir, 'quota-state.json');
    const healthFile = path.join(dir, 'route-health.json');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const src = {
      id: '9router',
      kind: 'router',
      servesModels: true,
      harness: 'paseo',
      endpoint: 'http://127.0.0.1:20128/v1',
      credential: { env: 'NINEROUTER_API_KEY' },
    };

    const evidenceData = { combinations: [] };
    const env = { NINEROUTER_API_KEY: 'test-ninerouter-key' };

    let toolCallReceived = false;
    const fakeFetch = async (url, opts) => {
      if (url.endsWith('/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'ag/claude-opus-4-6-thinking' }],
          }),
        };
      }
      const body = JSON.parse(opts.body);
      if (body.tool_choice && body.tools) {
        toolCallReceived = true;
        const tool = body.tools[0].function;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
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
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
      };
    };

    const accounts = [
      {
        id: 'xkiro',
        provider: '9router',
        source: '9router',
        capabilities: {},
      },
    ];

    const result = await onboardSourceRolling(src, {
      evidenceData,
      registry: { sources: [src], dispatch: { ...defaultDispatch, providers: {} } },
      accounts,
      evidenceDir,
      quotaStateFile: quotaFile,
      routeHealthFile: healthFile,
      env,
      fetch: fakeFetch,
      now: 1700000000000,
    });

    assert.equal(result.ok, true);
    assert.equal(toolCallReceived, true);
    assert.deepEqual(result.tools, [{ model: 'ag/claude-opus-4-6-thinking', ok: true }]);

    // Combo carries tools capability
    assert.equal(evidenceData.combinations.length, 1);
    const combo = evidenceData.combinations[0];
    assert.equal(combo.capabilities.tools, true);
    assert.equal(combo.capabilityEvidence.tools.ok, true);
    assert.equal(combo.capabilityEvidence.tools.method, 'http-forced-tool-call');

    // Capability probes table carries valid binding and tools proof
    assert.ok(evidenceData.capabilityProbes[combo.candidateKey]);
    assert.equal(evidenceData.capabilityProbes[combo.candidateKey].tools.ok, true);
    assert.ok(evidenceData.capabilityProbes[combo.candidateKey].binding);

    // The opencode harness candidate dispatch builds for this router reuses the
    // proof: same key, and the binding dispatch computes from its own route.
    const { candidateKey } = require('../candidates');
    const { computeBinding } = require('../capability-probe');
    const { routeProbeCandidate } = require('../orchestrate');
    const registry = { sources: [src], dispatch: { ...defaultDispatch, providers: {} } };
    const ocCand = {
      harness: 'opencode',
      accessPath: 'cli',
      gateway: '9router',
      upstream: combo.upstream,
      accountId: 'xkiro',
      quotaScope: 'xkiro',
      modelId: '9router/ag/claude-opus-4-6-thinking',
    };
    const ocKey = candidateKey(ocCand);
    const ocRecord = evidenceData.capabilityProbes[ocKey];
    assert.ok(ocRecord, 'opencode proof recorded under the dispatch key');
    assert.equal(ocRecord.tools.ok, true);
    assert.equal(
      ocRecord.binding,
      computeBinding(ocKey, routeProbeCandidate(ocCand, { model: ocCand.modelId }, registry, false))
    );

    // Reload from persisted store
    const reloaded = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'evidence.json'), 'utf8'));
    assert.equal(reloaded.combinations[0].capabilities.tools, true);
    assert.equal(reloaded.capabilityProbes[combo.candidateKey].tools.ok, true);
  });

  test('dispatch dry-run with writer role requiring tools admits onboarded model without CAPABILITY_UNVERIFIED:tools', async (t) => {
    const dir = fixture(t);
    const evidenceDir = path.join(dir, 'evidence');
    const decisionDir = path.join(dir, 'decisions');
    const home = path.join(dir, 'home');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.mkdirSync(decisionDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });

    const { dispatchCommand } = require('../cli');

    const registry = {
      sources: [
        {
          id: '9router',
          kind: 'router',
          servesModels: true,
          harness: 'paseo',
          endpoint: 'http://127.0.0.1:20128/v1',
          credential: { env: 'NINEROUTER_API_KEY' },
        },
      ],
      dispatch: { ...defaultDispatch, providers: {} },
    };

    const fakeFetch = async (url, opts) => {
      if (url.endsWith('/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'ag/claude-opus-4-6-thinking' }],
          }),
        };
      }
      const body = JSON.parse(opts.body);
      if (body.tool_choice && body.tools) {
        const tool = body.tools[0].function;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
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
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
      };
    };

    const env = { NINEROUTER_API_KEY: 'test-ninerouter-key' };
    const accounts = [
      {
        id: 'xkiro',
        provider: '9router',
        source: '9router',
        capabilities: { contextWindow: 200000 },
      },
    ];

    const res = await dispatchCommand(
      { 'dry-run': true, item: 'TASK-WRITER-TOOL-QUAL' },
      {
        registry,
        env,
        fetch: fakeFetch,
        evidenceDir,
        decisionDir,
        quotaStateFile: path.join(dir, 'quota-state.json'),
        routeHealth: { version: 1, paths: {}, events: [] },
        routeHealthFile: path.join(dir, 'route-health.json'),
        discoveryCatalogue: { candidates: [] },
        accounts,
        assessment: {},
        priors: [
          {
            canonical: 'claude-opus-4-6-thinking',
            score: 95,
            tier: 'T0',
          },
        ],
        taskProfile: {
          role: 'writer',
          requiredCapabilities: ['tools'],
          contextSize: 1000,
        },
        profile: {
          role: 'writer',
          requiredCapabilities: ['tools'],
          contextSize: 1000,
        },
        home,
        storePath: path.join(dir, 'quota-store.json'),
        now: 1700000000000,
        exit: () => {},
      }
    );

    assert.ok(res, 'dispatchCommand must return result');
    const decision = res.decision;
    assert.ok(decision, 'decision must be recorded');
    // Model must be ranked
    const opusRanked = (decision.ranking || []).some(
      (c) => c.candidateKey && c.candidateKey.includes('ag/claude-opus-4-6-thinking')
    );
    assert.equal(opusRanked, true, 'ag/claude-opus-4-6-thinking must be ranked');
    // Must NOT be rejected with CAPABILITY_UNVERIFIED:tools
    const rejectedForTools = (decision.rejected || []).some(
      (r) =>
        r.candidateKey &&
        r.candidateKey.includes('ag/claude-opus-4-6-thinking') &&
        r.reasonCode === 'CAPABILITY_UNVERIFIED:tools'
    );
    assert.equal(rejectedForTools, false, 'must not be rejected with CAPABILITY_UNVERIFIED:tools');
  });

  test('when forced tool call probe fails, model is not granted tools capability and fails closed', async (t) => {
    const dir = fixture(t);
    const evidenceDir = path.join(dir, 'evidence');
    const quotaFile = path.join(dir, 'quota-state.json');
    const healthFile = path.join(dir, 'route-health.json');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const src = {
      id: 'notool-source',
      kind: 'model-source',
      servesModels: true,
      endpoint: 'https://notool.invalid/v1',
      models: ['notool/weak-model'],
      credential: { env: 'NOTOOL_KEY' },
    };

    const evidenceData = { combinations: [] };
    const env = { NOTOOL_KEY: 'test-notool-key' };

    // Returns plain text response even when tools are requested
    const fakeFetch = async (url, opts) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: 'I cannot use tools' } }] }),
    });

    const result = await onboardSourceRolling(src, {
      evidenceData,
      accounts: [],
      evidenceDir,
      quotaStateFile: quotaFile,
      routeHealthFile: healthFile,
      env,
      fetch: fakeFetch,
      now: 1700000000000,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.tools, [
      { model: 'notool/weak-model', ok: false, reason: 'TOOL_CALL_NOT_OBSERVED' },
    ]);
    assert.equal(evidenceData.combinations[0].capabilities?.tools, undefined);
  });

  test('TASK-AI-142 Finding 3: onboardSourceRolling does NOT copy route-health probe success to sibling accounts', async (t) => {
    const dir = fixture(t);
    const evidenceDir = path.join(dir, 'evidence');
    const quotaFile = path.join(dir, 'quota-state.json');
    const healthFile = path.join(dir, 'route-health.json');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const src = {
      id: 'multi-acc-source',
      kind: 'model-source',
      servesModels: true,
      endpoint: 'https://multi.invalid/v1',
      models: ['multi/model-1'],
      credential: { env: 'ACC1_KEY' },
    };

    const acc1 = { id: 'acc1', source: 'multi-acc-source' };
    const acc2 = { id: 'acc2', source: 'multi-acc-source' };

    const evidenceData = { combinations: [] };
    const env = { ACC1_KEY: 'key-1' };

    const fakeFetch = async (url, opts) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'OK',
              },
            },
          ],
        }),
    });

    const result = await onboardSourceRolling(src, {
      evidenceData,
      accounts: [acc1, acc2],
      evidenceDir,
      quotaStateFile: quotaFile,
      routeHealthFile: healthFile,
      env,
      fetch: fakeFetch,
      now: 1700000000000,
    });

    assert.equal(result.ok, true);

    // Read the saved route health store
    const healthStore = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    const paths = healthStore.paths || {};

    // Sibling account acc2 was never probed; it must NOT have a success/AVAILABLE record in route-health
    const acc2Entries = Object.entries(paths).filter(
      ([key, rec]) => rec?.accountId === 'acc2' || key.includes('acc2')
    );
    assert.equal(
      acc2Entries.length,
      0,
      `Sibling account acc2 must not have route-health records copied from acc1, but found: ${JSON.stringify(acc2Entries)}`
    );
  });
});
