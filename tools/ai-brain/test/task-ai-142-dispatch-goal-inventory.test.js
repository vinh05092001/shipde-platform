'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../cli');
const goal = require('../orchestrate');
const { candidateKey } = require('../candidates');

test('source inventory, without injected candidates, has dispatch/goal generation and ranking parity', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-parity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = {
    sources: [
      {
        id: 'fixture-router',
        kind: 'router',
        harness: 'paseo',
        endpoint: 'https://router.invalid/v1',
        writerEnabled: true,
        models: [],
        credential: { type: 'api-key', env: 'FIXTURE_ROUTER_KEY' },
      },
    ],
    dispatch: { providers: {} },
  };
  const sourceModels = { 'fixture-router': ['vendor/fixture-one', 'vendor/fixture-two'] };
  const options = {
    root,
    rootDir: root,
    home: root,
    discoveryCatalogue: { candidates: [] },
    registry,
    sourceModels,
    catalogue: Object.values(sourceModels).flat(),
    accounts: [],
    registryAccounts: [],
    listAccounts: () => [],
    discoverPool: false,
    fakeRunsDir: path.join(root, 'pool'),
    evidenceData: { combinations: [] },
    routeHealth: { paths: {}, events: [] },
    allowUnprobedCandidates: true,
    probeEvidence: () => true,
    offerings: [],
    env: { FIXTURE_ROUTER_KEY: 'fixture-only' },
    codexOpts: { home: root },
  };
  const generated = goal.buildCandidates(options, options.evidenceData);
  assert.ok(generated.length > 0, 'fixture must generate actual source candidates');
  const assembled = await cli.assembleForDispatch({ candidates: [] }, [], registry, options);
  const keys = (cs) => cs.map(candidateKey).sort();
  assert.deepEqual(keys(assembled), keys(generated));

  // Exercise the real dry-run command, intercepting only ranking inputs. No
  // prebuilt candidates are supplied to either generation path.
  const routing = require('../routing');
  const originalRank = routing.rankForProfile;
  let offered;
  t.mock.method(routing, 'rankForProfile', (cs, ...args) => {
    offered = cs;
    return originalRank(cs, ...args);
  });
  const profile = {
    taskId: 'TASK-FIXTURE',
    role: 'writer',
    requiredCapabilities: [],
    taskClass: 'T1',
    riskDomains: [],
  };
  const assessment = { weightProfile: 'BALANCED', weights: routing.WEIGHT_PROFILES.BALANCED };
  const rankOptions = { priors: { ranking: [] }, enforceKnownQuota: false, useStoredQuota: false };
  const result = await cli.dispatchCommand(
    { 'dry-run': true, item: profile.taskId, root },
    {
      ...options,
      assessment,
      taskProfile: profile,
      capabilitiesPrepared: true,
      evidenceDir: path.join(root, 'evidence'),
      decisionDir: path.join(root, 'decisions'),
      storePath: path.join(root, 'quota.json'),
      ranking: rankOptions,
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );
  assert.deepEqual(keys(offered), keys(generated));
  const ranked = originalRank(generated, profile, assessment, {
    ...rankOptions,
    registry,
    accounts: [],
    evidenceData: options.evidenceData,
    dryRun: true,
    home: root,
    storePath: path.join(root, 'quota.json'),
  });
  assert.equal(result.decision.chosen, ranked.chosen);
  assert.ok(ranked.chosen, JSON.stringify(ranked.rejected));
  assert.deepEqual(
    result.decision.ranking.map((r) => r.candidateKey),
    ranked.ranking.map((r) => r.candidateKey)
  );

  const snapshot = path.join(root, 'snapshot');
  fs.mkdirSync(snapshot);
  for (const [name, value] of Object.entries({
    'catalogue.json': options.catalogue,
    'catalogue-sources.json': sourceModels,
    'accounts.json': [],
  }))
    fs.writeFileSync(path.join(snapshot, name), JSON.stringify(value));
  const { catalogue, sourceModels: omitted, accounts, ...snapshotOptions } = options;
  const fromSnapshot = await cli.dispatchCommand(
    {
      'dry-run': true,
      item: profile.taskId,
      root,
      catalogue: path.join(snapshot, 'catalogue.json'),
    },
    {
      ...snapshotOptions,
      assessment,
      taskProfile: profile,
      capabilitiesPrepared: true,
      evidenceDir: path.join(root, 'snapshot-evidence'),
      decisionDir: path.join(root, 'snapshot-decisions'),
      storePath: path.join(root, 'quota.json'),
      ranking: rankOptions,
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );
  assert.deepEqual(keys(offered), keys(generated));
  assert.equal(fromSnapshot.decision.chosen, ranked.chosen);
});

test('latest coherent snapshot retains discovered accounts and skips a newer partial intake', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const intake = path.join(root, 'tools/ai-brain/data/intake');
  const complete = path.join(intake, 'complete');
  const partial = path.join(intake, 'partial');
  fs.mkdirSync(complete, { recursive: true });
  fs.mkdirSync(partial);
  const expected = {
    catalogue: ['vendor/discovered'],
    sourceModels: { discovered: ['vendor/discovered'] },
    accounts: [
      {
        id: 'source-discovered',
        sourceId: 'discovered',
        enabled: true,
        models: ['vendor/discovered'],
      },
    ],
  };
  for (const [name, value] of Object.entries({
    'catalogue.json': expected.catalogue,
    'catalogue-sources.json': expected.sourceModels,
    'accounts.json': expected.accounts,
  }))
    fs.writeFileSync(path.join(complete, name), JSON.stringify(value));
  fs.writeFileSync(
    path.join(partial, 'catalogue-sources.json'),
    JSON.stringify({ unrelated: ['wrong/model'] })
  );
  const partialWithoutSources = path.join(intake, 'partial-without-sources');
  fs.mkdirSync(partialWithoutSources);
  fs.writeFileSync(
    path.join(partialWithoutSources, 'catalogue.json'),
    JSON.stringify(['vendor/unrelated-newer'])
  );
  fs.writeFileSync(
    path.join(partialWithoutSources, 'accounts.json'),
    JSON.stringify([{ id: 'unrelated-newer-account' }])
  );
  fs.utimesSync(complete, new Date(1000), new Date(1000));
  fs.utimesSync(partial, new Date(2000), new Date(2000));
  fs.utimesSync(partialWithoutSources, new Date(3000), new Date(3000));
  const { readCandidateInventory } = require('../candidate-inventory');
  assert.deepEqual(readCandidateInventory({ rootDir: root, useLatestIntake: true }), expected);
  assert.deepEqual(
    readCandidateInventory({ catalogueFile: path.join(complete, 'catalogue.json') }),
    expected
  );
});

test('dispatch from snapshot does not merge live accounts into snapshot inventory', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-live-accounts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = {
    sources: [
      {
        id: 'fixture-router',
        kind: 'router',
        harness: 'paseo',
        endpoint: 'https://router.invalid/v1',
        writerEnabled: true,
        models: [],
        credential: { type: 'api-key', env: 'FIXTURE_ROUTER_KEY' },
      },
    ],
    dispatch: { providers: {} },
  };
  const sourceModels = { 'fixture-router': ['vendor/fixture-one'] };
  const snapshotDir = path.join(root, 'snapshot');
  fs.mkdirSync(snapshotDir);
  fs.writeFileSync(
    path.join(snapshotDir, 'catalogue.json'),
    JSON.stringify(['vendor/fixture-one'])
  );
  fs.writeFileSync(path.join(snapshotDir, 'catalogue-sources.json'), JSON.stringify(sourceModels));
  fs.writeFileSync(
    path.join(snapshotDir, 'accounts.json'),
    JSON.stringify([
      {
        id: 'snapshot-account',
        sourceId: 'fixture-router',
        enabled: true,
        models: ['vendor/fixture-one'],
      },
    ])
  );

  const routing = require('../routing');
  const originalRank = routing.rankForProfile;
  let offered;
  t.mock.method(routing, 'rankForProfile', (cs, ...args) => {
    offered = cs;
    return originalRank(cs, ...args);
  });

  const profile = {
    taskId: 'TASK-FIXTURE',
    role: 'writer',
    requiredCapabilities: [],
    taskClass: 'T1',
    riskDomains: [],
  };

  await cli.dispatchCommand(
    {
      'dry-run': true,
      item: profile.taskId,
      root,
      catalogue: path.join(snapshotDir, 'catalogue.json'),
    },
    {
      root,
      rootDir: root,
      home: root,
      registry,
      discoveryCatalogue: { candidates: [] },
      allowUnprobedCandidates: true,
      capabilitiesPrepared: true,
      discoverPool: false,
      fakeRunsDir: path.join(root, 'pool'),
      evidenceData: { combinations: [] },
      routeHealth: { paths: {}, events: [] },
      env: { FIXTURE_ROUTER_KEY: 'fixture-only' },
      taskProfile: profile,
      assessment: { weightProfile: 'BALANCED', weights: routing.WEIGHT_PROFILES.BALANCED },
      ranking: { priors: { ranking: [] } },
      evidenceDir: path.join(root, 'evidence'),
      decisionDir: path.join(root, 'decisions'),
      storePath: path.join(root, 'quota.json'),
      listAccounts: () => [
        {
          id: 'live-newer-account',
          sourceId: 'fixture-router',
          enabled: true,
          models: ['vendor/fixture-one'],
        },
      ],
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );

  assert.ok(offered && offered.length > 0, 'must have offered candidates');
  assert.equal(
    offered.some((c) => c.accountId === 'live-newer-account'),
    false,
    'live account must not be merged into snapshot inventory'
  );
  assert.equal(
    offered.some((c) => c.accountId === 'snapshot-account'),
    true,
    'snapshot account must be retained'
  );
});
