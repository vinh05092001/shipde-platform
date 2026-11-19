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
    ['ROUTE_UNAVAILABLE', 0.5],
    ['PROBE_NO_RESPONSE', 0.5],
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
    accounts: [
      { id: 'agy01', provider: 'agy-pool' },
      { id: 'codex-fixture', provider: 'codex', models: ['configured-codex-model'] },
    ],
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
  assert.ok(
    candidates.some((c) => c.harness === 'codex' && c.modelId === 'configured-codex-model')
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
