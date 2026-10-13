'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const health = require('../route-health');
const { candidateKey } = require('../discovery/identity');
const { preferKnownGood } = require('../probe-order');

test('known-good order preserves rank within groups and expires after 24h', () => {
  const now = Date.now();
  const candidates = ['unknown-high', 'live-low', 'unknown-low'].map((modelId) => {
    const c = { harness: 'opencode', modelId, gateway: 'fixture', accountId: 'a' };
    return { ...c, candidateKey: candidateKey(c) };
  });
  const store = { version: 1, paths: {}, events: [] };
  health.recordResult(
    store,
    'live-low',
    { id: 'fixture', accountId: 'a' },
    { ok: true, status: 200 },
    now
  );
  const rank = () => ({ chosen: candidates[0].candidateKey, ranking: [...candidates] });
  const result = preferKnownGood(rank(), candidates, { routeHealth: store, now });
  assert.equal(result.chosen, candidates[1].candidateKey);
  assert.deepEqual(result.ranking, [candidates[1], candidates[0], candidates[2]]);
  assert.match(result.reason, /PROBE_ORDER_KNOWN_GOOD/);
  assert.equal(
    preferKnownGood(rank(), candidates, { routeHealth: store, now: now + 24 * 3600000 + 1 }).chosen,
    candidates[0].candidateKey
  );
  const refused = { chosen: null, ranking: [] };
  assert.equal(preferKnownGood(refused, candidates, { routeHealth: store, now }).chosen, null);
});

test('intake discovered Codex CLI account needs CLI availability, not HTTP credential', () => {
  const { mergeDiscoveredSources } = require('../intake');
  const accounts = mergeDiscoveredSources(
    [],
    [{ id: 'codex', kind: 'agent-cli', status: 'available', models: ['fixture-model'] }]
  );
  assert.equal(accounts[0].enabled, true);
  const registry = {
    sources: [{ id: 'codex', kind: 'agent-cli', harness: 'codex', accessPath: 'cli' }],
  };
  const candidates = require('../candidates').generateCandidates({
    registry,
    accounts,
    catalogue: ['unrelated-http-model'],
  });
  assert.ok(candidates.some((c) => c.harness === 'codex' && c.modelId === 'fixture-model'));
  const c = candidates[0];
  c.candidateKey = candidateKey(c);
  const unknown = { ...c, harness: 'opencode', candidateKey: 'unknown' };
  assert.equal(
    preferKnownGood({ chosen: 'unknown', ranking: [unknown, c] }, [unknown, c], {
      routeHealth: { paths: {} },
    }).chosen,
    c.candidateKey
  );
  assert.equal(
    mergeDiscoveredSources(
      [],
      [{ id: 'codex', kind: 'agent-cli', status: 'unavailable', models: ['fixture-model'] }]
    )[0].enabled,
    false
  );
});

test('JSON-roundtripped failure causes serialize to reason strings', () => {
  const { classifyProbeFailure, failureReason } = require('../route-probe');
  const cause = JSON.parse(
    JSON.stringify(
      classifyProbeFailure({ status: 503, body: 'No active credentials for provider: fixture' })
    )
  );
  assert.equal(failureReason(cause), 'PROVIDER_UNAVAILABLE');
  assert.equal(failureReason({ reasonCode: { reason: 'TIMEOUT' } }), 'TIMEOUT');
});

test('Hermes success orders OpenCode writers by gateway and upstream, preserving floors', () => {
  const now = Date.now();
  const registry = {
    sources: [
      { id: '9router', endpoint: 'http://127.0.0.1:20128/v1' },
      { id: 'inventory-router', endpoint: 'http://localhost:20128/v1/' },
      { id: 'other-router', endpoint: 'http://127.0.0.1:9999/v1' },
    ],
  };
  const store = { paths: {}, events: [] };
  health.rememberProbe(
    {
      harness: 'hermes',
      sourceId: 'inventory-router',
      modelId: 'cbai/deepseek-v4.1-flash',
      accountId: 'inventory-account',
      candidateKey: 'hermes::fixture',
    },
    { ok: true, status: 200 },
    { routeHealth: store, now, persistRouteHealth: false }
  );
  const make = (modelId, gateway = '9router') => {
    const c = {
      harness: 'opencode',
      accessPath: 'cli',
      gateway,
      modelId,
      accountId: 'writer-account',
    };
    return { ...c, candidateKey: candidateKey(c) };
  };
  const unknown = make('ninerouter/ocz/dead');
  const live = make('ninerouter/cbai/deepseek-v4.1-flash');
  const other = make(live.modelId, 'other-router');
  const options = { registry, routeHealth: store, now };
  const ordered = preferKnownGood(
    { chosen: unknown.candidateKey, ranking: [unknown, other, live] },
    [unknown, other, live],
    options
  );
  assert.equal(ordered.chosen, live.candidateKey);
  const refusal = {
    chosen: unknown.candidateKey,
    ranking: [unknown],
    rejected: [{ candidateKey: live.candidateKey, reasonCode: 'QUALITY_FLOOR_NOT_MET' }],
  };
  preferKnownGood(refusal, [unknown, live], options);
  assert.equal(refusal.chosen, unknown.candidateKey);
  assert.equal(refusal.knownGoodRejected[0].reasonCode, 'QUALITY_FLOOR_NOT_MET');
  health.recordResult(
    store,
    'cbai/deepseek-v4.1-flash',
    '9router',
    { ok: false, status: 503 },
    now + 1
  );
  assert.equal(
    require('../probe-order').recentRouteSuccess(live, store, { ...options, now: now + 2 }),
    false
  );
});

test('goal intake offers pool and registry-declared Codex even with HTTP-shaped inventory', async (t) => {
  const fs = require('fs');
  const path = require('path');
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'h3-writer-intake-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const intake = require('../intake');
  const registry = {
    sources: [
      { id: 'codex', kind: 'agent-cli', harness: 'codex', accessPath: 'cli' },
      {
        id: 'agy-pool',
        kind: 'agent-cli',
        harness: 'agy-pool',
        servesModels: true,
        accounts: ['agy01'],
      },
    ],
  };
  const discovered = [
    {
      id: 'codex',
      kind: 'model-source',
      endpoint: 'http://localhost:20128/v1',
      status: 'available',
      models: ['fixture-model'],
    },
  ];
  const id = 'GOAL-H3-WRITERS-1';
  const workDir = path.join(root, 'docs/product-spec/work-items');
  const registerDir = path.join(root, 'docs/product-spec/docs/10-ai-collaboration');
  const dataDir = path.join(root, 'tools/ai-brain/data');
  for (const dir of [workDir, registerDir, dataDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, id + '.md'),
    `# ${id}
## Control
| Field | Value |
|---|---|
| Work Item ID | ${id} |
| Assigned author | GEMINI |
| Complexity | standard |
| Allowed paths | tools/fixture.js |
## Business Outcome
Inspect writer candidates without launching models.
## Acceptance Matrix
| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| H3-1 | Intake candidates | Pool and Codex offered | Test |
## Verification Commands
- \`node --test tools/fixture.test.js\`
`
  );
  fs.writeFileSync(
    path.join(registerDir, 'FEATURE-DELIVERY-REGISTER.csv'),
    `delivery_order,work_item_id,status,dependencies\n1,${id},READY_FOR_AUTHOR,\n`
  );
  fs.writeFileSync(path.join(dataDir, 'sources.json'), JSON.stringify({ sources: discovered }));
  const pool = require('../agy-pool-runtime');
  const quotaStore = require('../quota-store');
  const originalLoad = quotaStore.loadStore;
  quotaStore.loadStore = () => {
    throw new Error('aggregate quota cache unreadable');
  };
  t.after(() => {
    quotaStore.loadStore = originalLoad;
  });
  const original = pool.discoverAccounts;
  pool.discoverAccounts = () => ['agy01'];
  t.after(() => {
    pool.discoverAccounts = original;
  });
  const hasPool = intake.agyPoolHasQuota({
    quotaStoreOpts: { path: path.join(root, 'missing.json') },
  });
  assert.equal(hasPool, true);
  const command = await intake.runIntake(
    { workItem: id },
    {
      root,
      registry,
      baseSha: 'a'.repeat(40),
      buildCatalogue: () => ['fixture-model'],
      listAccounts: () => [],
      routeHealth: { paths: {}, events: [] },
      persistRouteHealth: false,
      probeRoute: () => {
        throw new Error('no model quota may be used');
      },
      spawnCommand: () => {
        throw new Error('no worker may be launched');
      },
    }
  );
  const accounts = JSON.parse(fs.readFileSync(command.runFiles.accounts, 'utf8'));
  assert.equal(accounts[0].enabled, true);
  assert.equal(command.argv[command.argv.indexOf('--external-workers') + 1], 'agy-pool');
  const rows = require('../candidates').generateCandidates({
    registry,
    accounts,
    catalogue: [],
    models: ['gemini-3-pro'],
    discoverPool: false,
    externalWorkers: command.argv[command.argv.indexOf('--external-workers') + 1],
  });
  assert.ok(rows.some((c) => c.harness === 'codex'));
  assert.ok(rows.some((c) => c.harness === 'agy-pool'));
});
