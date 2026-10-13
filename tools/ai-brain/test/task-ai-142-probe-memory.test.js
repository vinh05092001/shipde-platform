'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const health = require('../route-health');
const hermes = require('../hermes-session');
const intake = require('../intake');
const { candidateKey } = require('../discovery/identity');

function candidate(model) {
  const c = {
    harness: 'hermes',
    accessPath: 'https://fixture.example/v1',
    gateway: 'fixture',
    upstream: 'openai',
    accountId: 'a',
    quotaScope: 'a',
    modelId: model,
    contextWindow: 128000,
    quality: 99,
  };
  c.candidateKey = candidateKey(c);
  return c;
}

test('H3 durable memory skips dead route before probing, expires, and success clears it', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-memory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'health.json');
  const dead = candidate('openai/dead');
  const live = candidate('openai/live');
  const now = Date.now();
  health.rememberProbe(
    dead,
    { ok: false, status: 404, body: 'secret-body-must-not-persist' },
    { routeHealthFile: file, now }
  );
  const probed = [];
  const deps = {
    candidates: [dead, live],
    registry: {
      sources: [
        {
          id: 'fixture',
          endpoint: 'https://fixture.example/v1',
          credential: { env: 'FIXTURE_KEY' },
        },
      ],
    },
    accountList: [],
    priorsData: { ranking: [] },
    evidenceData: {},
    rankForProfile: (rows) => ({
      chosen: rows[0]?.candidateKey,
      ranking: rows,
      top3: rows,
      rejected: [],
    }),
    probe: async (c) => {
      probed.push(c.modelId);
      return { ok: true, status: 200 };
    },
    spawn: async () => ({ exitCode: 0 }),
  };
  const options = { rootDir: root, routeHealthFile: file, skipDecisionLog: true, now };
  const selection = hermes.selectReasoningCandidate(options, deps);
  assert.equal(selection.chosen, live.candidateKey);
  assert.match(selection.rejected[0].reason, /PROBE_COOLDOWN.*HTTP_404/);
  await hermes.launchHermesSession(options, deps);
  assert.deepEqual(probed, ['openai/live']);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('secret-body'));
  const expired = now + 24 * 3600000;
  assert.equal(health.probeCooldown(dead, { routeHealthFile: file, now: expired }), null);
  await hermes.launchHermesSession({ ...options, now: expired, reselect: true }, deps);
  assert.deepEqual(probed, ['openai/live', 'openai/dead']);
  assert.equal(health.probeCooldown(dead, { routeHealthFile: file, now }), null);
  assert.equal(
    health.getPathRecord(health.loadStore(file), dead.modelId, { id: 'fixture', accountId: 'a' })
      .nextCheckAt,
    null
  );
});

test('H3 cause cooldowns and account isolation; budget exhaustion is not route evidence', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-causes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { routeHealthFile: path.join(root, 'health.json'), now: 1000 };
  assert.equal(
    require('../route-probe').classifyProbeFailure({ status: 0, body: 'Request timed out' }),
    'TIMEOUT'
  );
  assert.equal(
    require('../route-probe').classifyProbeFailure({ status: 403, body: 'Not entitled to model' }),
    'ENTITLEMENT_REQUIRED'
  );
  for (const [reasonCode, hours] of [
    ['UPSTREAM_CREDIT_OR_QUOTA', 6],
    ['HTTP_401', 6],
    ['UPSTREAM_FORBIDDEN', 6],
    ['ALIAS_MISMATCH', 24],
    ['ROUTE_UNAVAILABLE', 24],
    ['TIMEOUT', 0.5],
    ['UPSTREAM_UNAVAILABLE', 0.5],
  ]) {
    const c = candidate('openai/' + reasonCode);
    health.rememberProbe(c, { ok: false, reasonCode }, options);
    assert.ok(health.probeCooldown(c, { ...options, now: 1000 + hours * 3600000 - 1 }));
    assert.equal(health.probeCooldown(c, { ...options, now: 1000 + hours * 3600000 }), null);
    assert.equal(health.probeCooldown({ ...c, accountId: 'b' }, options), null);
  }
  health.rememberProbe(
    candidate('openai/budget'),
    { ok: false, reasonCode: 'PROBE_BUDGET_EXHAUSTED' },
    options
  );
  assert.equal(health.probeCooldown(candidate('openai/budget'), options), null);
});

test('H3 intake keeps configured agy pool even without aggregate quota; launcher retains isolated path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-pools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const built = intake.composeOrchestrateCommand({
    root,
    runDir: root,
    repoRoot: root,
    baseSha: 'a'.repeat(40),
    hasAgyPoolQuota: false,
    externalWorkers: 'agy-pool',
  });
  assert.match(built.command, /--external-workers agy-pool/);
  assert.ok(built.argv.includes('--isolated-worker'));
  const candidates = require('../candidates').generateCandidates({
    registry: require('../sources').loadSources(),
    catalogue: [],
    accounts: [{ id: 'agy01', provider: 'agy-pool' }],
    externalWorkers: built.argv[built.argv.indexOf('--external-workers') + 1],
    discoverPool: true,
    models: ['gemini-3.8-flash-high'],
    fakeRunsDir: path.join(root, 'missing-pool'),
    cacheFile: null,
    spawnSync: (_bin, args) => ({
      status: 0,
      stdout: args[0] === 'models' ? 'gemini-3.8-flash-high\n' : '',
      stderr: '',
    }),
  });
  assert.ok(
    candidates.some((c) => c.harness === 'agy-pool' && c.modelId === 'gemini-3.8-flash-high')
  );
  assert.equal(
    health.probeCooldown(
      { harness: 'agy-pool' },
      { routeHealthFile: path.join(root, 'missing.json') }
    ),
    null
  );
});

test('H3 next forwards configured pools for goal items to intake', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-next-pools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registerPath = path.join(root, 'register.csv');
  fs.writeFileSync(
    registerPath,
    'delivery_order,slice,group,work_item_id,feature_id,feature_name,key_behavior,status,dependencies,work_item_path,branch,pr,codex_verdict,merge_commit\n1,S00,AI,GOAL-H3-1,,Goal,behavior,READY_FOR_AUTHOR,,docs/product-spec/work-items/GOAL-H3-1.md,feat/goal-h3,,,\n'
  );
  let received;
  const result = await require('../next-runner').runNext(
    { rootDir: root, registerPath, decisionDir: path.join(root, 'decisions'), run: true },
    {
      config: { externalWorkers: 'agy-pool' },
      runIntake: async (options) => {
        received = options;
        return { status: 'completed', exitCode: 0 };
      },
    }
  );
  assert.equal(result.ran, true);
  assert.equal(received.workItem, 'GOAL-H3-1');
  assert.equal(received.externalWorkers, 'agy-pool');
});

test('H3 due refresh keeps cause cooldown and success clears memory', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-refresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { routeHealthFile: path.join(root, 'health.json'), now: 1000 };
  const c = candidate('openai/dead');
  health.rememberProbe(c, { ok: false, status: 404 }, options);
  const store = health.loadStore(options.routeHealthFile);
  const due = 1000 + 24 * 3600000;
  await health.recheckDue(store, async () => ({ ok: false, status: 404 }), { now: due });
  assert.ok(health.probeCooldown(c, { routeHealth: store, now: due + 3600000 }));
  await health.recheckDue(store, async () => ({ ok: true, status: 200 }), {
    now: due + 24 * 3600000,
  });
  assert.equal(health.probeCooldown(c, { routeHealth: store, now: due }), null);
});

test('H3 404 missing provider credentials excludes azure/model-b without probing it, and probes a different provider', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-provider-wide-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'health.json');
  const azureA = candidate('azure/model-a');
  const azureB = candidate('azure/model-b');
  const otherC = candidate('openai/model-c');
  const now = Date.now();

  const probed = [];
  const deps = {
    candidates: [azureA, azureB, otherC],
    registry: {
      sources: [
        {
          id: 'fixture',
          endpoint: 'https://fixture.example/v1',
          credential: { env: 'FIXTURE_KEY' },
        },
      ],
    },
    accountList: [],
    priorsData: { ranking: [] },
    evidenceData: {},
    rankForProfile: (rows) => ({
      chosen: rows[0]?.candidateKey,
      ranking: rows,
      top3: rows,
      rejected: [],
    }),
    probe: async (c) => {
      probed.push(c.modelId);
      if (c.modelId === 'azure/model-a') {
        return { ok: false, status: 404, body: 'No active credentials for provider: azure' };
      }
      return { ok: true, status: 200 };
    },
    spawn: async () => ({ exitCode: 0 }),
  };
  const options = { rootDir: root, routeHealthFile: file, skipDecisionLog: true, now };

  await hermes.launchHermesSession(options, deps);

  // A 404 body "No active credentials for provider: azure" for azure/model-a
  // excludes azure/model-b without probing it, and a different provider is still probed.
  assert.deepEqual(probed, ['azure/model-a', 'openai/model-c']);
  assert.ok(!probed.includes('azure/model-b'));

  // azure/model-b is in cooldown with reason PROVIDER_UNAVAILABLE
  const cooldownReason = health.probeCooldown(azureB, { routeHealthFile: file, now });
  assert.ok(cooldownReason);
  assert.match(cooldownReason, /PROVIDER_UNAVAILABLE/);

  // Candidate with leading ninerouter/ prefix is also excluded
  const ninerouterAzureB = candidate('ninerouter/azure/model-b');
  assert.match(
    health.probeCooldown(ninerouterAzureB, { routeHealthFile: file, now }),
    /PROVIDER_UNAVAILABLE/
  );

  // A different provider is NOT in cooldown
  assert.equal(health.probeCooldown(otherC, { routeHealthFile: file, now }), null);

  // Candidate selection records PROVIDER_UNAVAILABLE rejection for azure/model-b
  const selection = hermes.selectReasoningCandidate(options, deps);
  assert.equal(selection.chosen, otherC.candidateKey);
  const rejectedAzureB = selection.rejected.find((r) => r.candidateKey === azureB.candidateKey);
  assert.ok(rejectedAzureB);
  assert.match(rejectedAzureB.reason, /PROVIDER_UNAVAILABLE/);

  // 6 hour cooldown expiration
  assert.equal(
    health.probeCooldown(azureB, { routeHealthFile: file, now: now + 6 * 3600000 + 1 }),
    null
  );
});
