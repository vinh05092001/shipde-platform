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

test('explicit catalogue requires and validates sibling accounts.json and catalogue-sources.json', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-explicit-validation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missingAccountsDir = path.join(root, 'missing-accounts');
  const missingSourcesDir = path.join(root, 'missing-sources');
  const invalidAccountsDir = path.join(root, 'invalid-accounts');
  fs.mkdirSync(missingAccountsDir, { recursive: true });
  fs.mkdirSync(missingSourcesDir, { recursive: true });
  fs.mkdirSync(invalidAccountsDir, { recursive: true });

  fs.writeFileSync(path.join(missingAccountsDir, 'catalogue.json'), JSON.stringify(['vendor/one']));
  fs.writeFileSync(
    path.join(missingAccountsDir, 'catalogue-sources.json'),
    JSON.stringify({ router: ['vendor/one'] })
  );

  fs.writeFileSync(path.join(missingSourcesDir, 'catalogue.json'), JSON.stringify(['vendor/one']));
  fs.writeFileSync(path.join(missingSourcesDir, 'accounts.json'), JSON.stringify([]));

  fs.writeFileSync(path.join(invalidAccountsDir, 'catalogue.json'), JSON.stringify(['vendor/one']));
  fs.writeFileSync(
    path.join(invalidAccountsDir, 'catalogue-sources.json'),
    JSON.stringify({ router: ['vendor/one'] })
  );
  fs.writeFileSync(
    path.join(invalidAccountsDir, 'accounts.json'),
    JSON.stringify({ not: 'an array' })
  );

  const { readCandidateInventory } = require('../candidate-inventory');
  assert.throws(
    () =>
      readCandidateInventory({ catalogueFile: path.join(missingAccountsDir, 'catalogue.json') }),
    /Invalid candidate snapshot/
  );
  assert.throws(
    () => readCandidateInventory({ catalogueFile: path.join(missingSourcesDir, 'catalogue.json') }),
    /Invalid source inventory/
  );
  assert.throws(
    () =>
      readCandidateInventory({ catalogueFile: path.join(invalidAccountsDir, 'catalogue.json') }),
    /Invalid candidate snapshot/
  );
});

test('dispatch with explicit catalogue missing sibling accounts fails closed without falling back to live accounts', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-dispatch-missing-accounts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshotDir = path.join(root, 'snapshot-missing-accounts');
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(
    path.join(snapshotDir, 'catalogue.json'),
    JSON.stringify(['vendor/fixture-one'])
  );
  fs.writeFileSync(
    path.join(snapshotDir, 'catalogue-sources.json'),
    JSON.stringify({ 'fixture-router': ['vendor/fixture-one'] })
  );

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
  const profile = {
    taskId: 'TASK-FIXTURE',
    role: 'writer',
    requiredCapabilities: [],
    taskClass: 'T1',
    riskDomains: [],
  };
  const routing = require('../routing');

  await assert.rejects(
    async () =>
      cli.dispatchCommand(
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
      ),
    /Invalid candidate snapshot/
  );
});

test('dispatch dry-run skips newer partial intake snapshots and uses complete snapshot accounts', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-dispatch-latest-intake-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const intake = path.join(root, 'tools/ai-brain/data/intake');
  const complete = path.join(intake, 'complete');
  const partial = path.join(intake, 'partial');
  const partialWithoutSources = path.join(intake, 'partial-without-sources');
  fs.mkdirSync(complete, { recursive: true });
  fs.mkdirSync(partial, { recursive: true });
  fs.mkdirSync(partialWithoutSources, { recursive: true });

  const completeData = {
    catalogue: ['vendor/discovered'],
    sourceModels: { 'fixture-router': ['vendor/discovered'] },
    accounts: [
      {
        id: 'snapshot-discovered-account',
        sourceId: 'fixture-router',
        enabled: true,
        models: ['vendor/discovered'],
      },
    ],
  };
  fs.writeFileSync(path.join(complete, 'catalogue.json'), JSON.stringify(completeData.catalogue));
  fs.writeFileSync(
    path.join(complete, 'catalogue-sources.json'),
    JSON.stringify(completeData.sourceModels)
  );
  fs.writeFileSync(path.join(complete, 'accounts.json'), JSON.stringify(completeData.accounts));

  fs.writeFileSync(
    path.join(partial, 'catalogue-sources.json'),
    JSON.stringify({ unrelated: ['wrong/model'] })
  );

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
    },
    {
      root,
      rootDir: root,
      home: root,
      registry,
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
          models: ['vendor/discovered'],
        },
      ],
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );

  assert.ok(offered && offered.length > 0, 'must have offered candidates');
  assert.equal(
    offered.some((c) => c.accountId === 'snapshot-discovered-account'),
    true,
    'complete snapshot account must be used'
  );
  assert.equal(
    offered.some((c) => c.accountId === 'unrelated-newer-account'),
    false,
    'partial newer snapshot account must be skipped'
  );
  assert.equal(
    offered.some((c) => c.accountId === 'live-newer-account'),
    false,
    'live account must not be merged into snapshot inventory'
  );
});

test('ordinary dispatch (--execute) does not use intake snapshots and prefers live accounts over snapshot accounts', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-dispatch-execute-intake-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const intake = path.join(root, 'tools/ai-brain/data/intake');
  const snapshotRun = path.join(intake, 'run-1');
  fs.mkdirSync(snapshotRun, { recursive: true });

  const snapshotData = {
    catalogue: ['vendor/discovered'],
    sourceModels: { 'fixture-router': ['vendor/discovered'] },
    accounts: [
      {
        id: 'snapshot-discovered-account',
        sourceId: 'fixture-router',
        enabled: true,
        models: ['vendor/discovered'],
      },
    ],
  };
  fs.writeFileSync(
    path.join(snapshotRun, 'catalogue.json'),
    JSON.stringify(snapshotData.catalogue)
  );
  fs.writeFileSync(
    path.join(snapshotRun, 'catalogue-sources.json'),
    JSON.stringify(snapshotData.sourceModels)
  );
  fs.writeFileSync(path.join(snapshotRun, 'accounts.json'), JSON.stringify(snapshotData.accounts));

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

  const ranking = require('../ranking');
  let realDispatchCandidates = null;
  t.mock.method(ranking, 'rankAndRecord', (cs) => {
    realDispatchCandidates = cs;
    return { chosen: null, candidates: [], rejected: [] };
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
      execute: true,
      item: profile.taskId,
      root,
    },
    {
      root,
      rootDir: root,
      home: root,
      registry,
      discoveryDataDir: path.join(root, 'empty-discovery'),
      allowUnprobedCandidates: true,
      capabilitiesPrepared: true,
      discoverPool: false,
      fakeRunsDir: path.join(root, 'pool'),
      evidenceData: { combinations: [] },
      routeHealth: { paths: {}, events: [] },
      env: { FIXTURE_ROUTER_KEY: 'fixture-only' },
      taskProfile: profile,
      ranking: { priors: { ranking: [] } },
      evidenceDir: path.join(root, 'evidence'),
      decisionDir: path.join(root, 'decisions'),
      storePath: path.join(root, 'quota.json'),
      listAccounts: () => [
        {
          id: 'live-newer-account',
          sourceId: 'fixture-router',
          enabled: true,
          models: ['vendor/discovered'],
        },
      ],
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );

  assert.ok(
    realDispatchCandidates && realDispatchCandidates.length > 0,
    'candidates must be offered to real dispatch'
  );
  assert.equal(
    realDispatchCandidates.some((c) => c.accountId === 'live-newer-account'),
    true,
    'real dispatch must use live accounts'
  );
  assert.equal(
    realDispatchCandidates.some((c) => c.accountId === 'snapshot-discovered-account'),
    false,
    'real dispatch must not use automatic intake snapshot accounts'
  );
});

test('supplying catalogue and catalogue-sources from different directories throws error rejecting mixed snapshot paths', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-mixed-snapshots-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const dirA = path.join(root, 'snapshot-a');
  const dirB = path.join(root, 'snapshot-b');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  fs.writeFileSync(path.join(dirA, 'catalogue.json'), JSON.stringify(['vendor/model-a']));
  fs.writeFileSync(path.join(dirA, 'accounts.json'), JSON.stringify([{ id: 'acc-a' }]));
  fs.writeFileSync(
    path.join(dirA, 'catalogue-sources.json'),
    JSON.stringify({ srcA: ['vendor/model-a'] })
  );

  fs.writeFileSync(path.join(dirB, 'catalogue.json'), JSON.stringify(['vendor/model-b']));
  fs.writeFileSync(path.join(dirB, 'accounts.json'), JSON.stringify([{ id: 'acc-b' }]));
  fs.writeFileSync(
    path.join(dirB, 'catalogue-sources.json'),
    JSON.stringify({ srcB: ['vendor/model-b'] })
  );

  const { readCandidateInventory } = require('../candidate-inventory');

  assert.throws(
    () =>
      readCandidateInventory({
        catalogueFile: path.join(dirA, 'catalogue.json'),
        sourceModelsFile: path.join(dirB, 'catalogue-sources.json'),
      }),
    /Cannot mix candidate snapshot paths/
  );

  await assert.rejects(
    async () =>
      cli.dispatchCommand(
        {
          'dry-run': true,
          item: 'TASK-FIXTURE',
          root,
          catalogue: path.join(dirA, 'catalogue.json'),
          'catalogue-sources': path.join(dirB, 'catalogue-sources.json'),
        },
        {
          root,
          rootDir: root,
          home: root,
          log: () => {},
          error: () => {},
          exit: () => {},
        }
      ),
    /Cannot mix candidate snapshot paths/
  );
});

test('when intake runs exist but none is complete, candidate inventory reader and dispatch fail closed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-intake-incomplete-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const intake = path.join(root, 'tools/ai-brain/data/intake');
  const run1 = path.join(intake, 'run-partial-1');
  const run2 = path.join(intake, 'run-partial-2');
  fs.mkdirSync(run1, { recursive: true });
  fs.mkdirSync(run2, { recursive: true });

  fs.writeFileSync(path.join(run1, 'catalogue.json'), JSON.stringify(['vendor/discovered']));
  fs.writeFileSync(
    path.join(run2, 'catalogue-sources.json'),
    JSON.stringify({ 'fixture-router': ['vendor/discovered'] })
  );

  const { readCandidateInventory } = require('../candidate-inventory');

  assert.throws(
    () => readCandidateInventory({ rootDir: root, useLatestIntake: true }),
    /No complete intake snapshot found/
  );

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

  const profile = {
    taskId: 'TASK-FIXTURE',
    role: 'writer',
    requiredCapabilities: [],
    taskClass: 'T1',
    riskDomains: [],
  };

  await assert.rejects(
    async () =>
      cli.dispatchCommand(
        {
          'dry-run': true,
          item: profile.taskId,
          root,
        },
        {
          root,
          rootDir: root,
          home: root,
          registry,
          discoveryDataDir: path.join(root, 'empty-discovery'),
          allowUnprobedCandidates: true,
          capabilitiesPrepared: true,
          discoverPool: false,
          fakeRunsDir: path.join(root, 'pool'),
          evidenceData: { combinations: [] },
          routeHealth: { paths: {}, events: [] },
          env: { FIXTURE_ROUTER_KEY: 'fixture-only' },
          taskProfile: profile,
          listAccounts: () => [
            {
              id: 'live-newer-account',
              sourceId: 'fixture-router',
              enabled: true,
              models: ['vendor/discovered'],
            },
          ],
          log: () => {},
          error: () => {},
          exit: () => {},
        }
      ),
    /No complete intake snapshot found/
  );
});

test('dispatch with explicit snapshot rejects conflicting injected inventory', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-conflict-inventory-'));
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

  const snapshotDir = path.join(root, 'snapshot');
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(
    path.join(snapshotDir, 'catalogue.json'),
    JSON.stringify(['vendor/fixture-snapshot-model'])
  );
  fs.writeFileSync(
    path.join(snapshotDir, 'catalogue-sources.json'),
    JSON.stringify({ 'fixture-router': ['vendor/fixture-snapshot-model'] })
  );
  fs.writeFileSync(
    path.join(snapshotDir, 'accounts.json'),
    JSON.stringify([
      {
        id: 'snapshot-account',
        sourceId: 'fixture-router',
        enabled: true,
        models: ['vendor/fixture-snapshot-model'],
      },
    ])
  );

  const profile = {
    taskId: 'TASK-FIXTURE',
    role: 'writer',
    requiredCapabilities: [],
    taskClass: 'T1',
    riskDomains: [],
  };

  const baseDeps = {
    root,
    rootDir: root,
    home: root,
    registry,
    allowUnprobedCandidates: true,
    capabilitiesPrepared: true,
    discoverPool: false,
    fakeRunsDir: path.join(root, 'pool'),
    evidenceData: { combinations: [] },
    routeHealth: { paths: {}, events: [] },
    env: { FIXTURE_ROUTER_KEY: 'fixture-only' },
    taskProfile: profile,
    log: () => {},
    error: () => {},
    exit: () => {},
  };

  await assert.rejects(
    async () =>
      cli.dispatchCommand(
        {
          'dry-run': true,
          item: profile.taskId,
          root,
          catalogue: path.join(snapshotDir, 'catalogue.json'),
        },
        {
          ...baseDeps,
          accounts: [
            {
              id: 'conflicting-account',
              sourceId: 'fixture-router',
              enabled: true,
              models: ['vendor/conflicting-model'],
            },
          ],
        }
      ),
    /Cannot supply conflicting injected inventory with an explicit snapshot/
  );

  await assert.rejects(
    async () =>
      cli.dispatchCommand(
        {
          'dry-run': true,
          item: profile.taskId,
          root,
          catalogue: path.join(snapshotDir, 'catalogue.json'),
        },
        {
          ...baseDeps,
          catalogue: ['vendor/conflicting-model'],
        }
      ),
    /Cannot supply conflicting injected inventory with an explicit snapshot/
  );

  await assert.rejects(
    async () =>
      cli.dispatchCommand(
        {
          'dry-run': true,
          item: profile.taskId,
          root,
          catalogue: path.join(snapshotDir, 'catalogue.json'),
        },
        {
          ...baseDeps,
          sourceModels: { 'fixture-router': ['vendor/conflicting-model'] },
        }
      ),
    /Cannot supply conflicting injected inventory with an explicit snapshot/
  );
});

test('snapshot-backed dry-run excludes unrelated discovery candidates from ranking', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-discovery-isolation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const intake = path.join(root, 'tools/ai-brain/data/intake');
  const snapshotRun = path.join(intake, 'run-1');
  fs.mkdirSync(snapshotRun, { recursive: true });

  const snapshotData = {
    catalogue: ['vendor/snapshot-model'],
    sourceModels: { 'fixture-router': ['vendor/snapshot-model'] },
    accounts: [
      {
        id: 'snapshot-account',
        sourceId: 'fixture-router',
        enabled: true,
        models: ['vendor/snapshot-model'],
      },
    ],
  };
  fs.writeFileSync(
    path.join(snapshotRun, 'catalogue.json'),
    JSON.stringify(snapshotData.catalogue)
  );
  fs.writeFileSync(
    path.join(snapshotRun, 'catalogue-sources.json'),
    JSON.stringify(snapshotData.sourceModels)
  );
  fs.writeFileSync(path.join(snapshotRun, 'accounts.json'), JSON.stringify(snapshotData.accounts));

  const unrelatedDiscDir = path.join(root, 'unrelated-discovery');
  fs.mkdirSync(unrelatedDiscDir, { recursive: true });
  fs.writeFileSync(
    path.join(unrelatedDiscDir, 'catalogue.jsonl'),
    JSON.stringify({
      modelId: 'vendor/unrelated-discovery-model',
      accessPath: 'fixture-router',
      account: '',
    }) + '\n'
  );

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
      'discovery-dir': unrelatedDiscDir,
    },
    {
      root,
      rootDir: root,
      home: root,
      registry,
      discoveryDataDir: unrelatedDiscDir,
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
      listAccounts: () => [],
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );

  assert.ok(offered && offered.length > 0, 'snapshot candidates must be offered');
  assert.equal(
    offered.some((c) => c.modelId === 'vendor/snapshot-model'),
    true,
    'snapshot model must be present'
  );
  assert.equal(
    offered.some((c) => c.modelId === 'vendor/unrelated-discovery-model'),
    false,
    'unrelated discovery candidates cannot enter the ranking'
  );
});

test('snapshot-backed dispatch binds discovery to the selected snapshot when present', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-discovery-bound-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const snapshotDir = path.join(root, 'snapshot');
  const boundDiscDir = path.join(snapshotDir, 'discovery');
  fs.mkdirSync(boundDiscDir, { recursive: true });

  fs.writeFileSync(
    path.join(snapshotDir, 'catalogue.json'),
    JSON.stringify(['vendor/snapshot-model'])
  );
  fs.writeFileSync(
    path.join(snapshotDir, 'catalogue-sources.json'),
    JSON.stringify({ 'fixture-router': ['vendor/snapshot-model'] })
  );
  fs.writeFileSync(
    path.join(snapshotDir, 'accounts.json'),
    JSON.stringify([
      {
        id: 'snapshot-account',
        sourceId: 'fixture-router',
        enabled: true,
        models: ['vendor/snapshot-model'],
      },
    ])
  );
  fs.writeFileSync(
    path.join(boundDiscDir, 'catalogue.jsonl'),
    JSON.stringify({
      modelId: 'vendor/bound-discovery-model',
      accessPath: 'fixture-router',
      account: '',
    }) + '\n'
  );

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
      listAccounts: () => [],
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );

  assert.ok(offered && offered.length > 0, 'candidates must be offered');
  assert.equal(
    offered.some((c) => c.modelId === 'vendor/bound-discovery-model'),
    true,
    'bound discovery model must be present'
  );
});
