const { test } = require('node:test');
const assert = require('node:assert');
const { assembleForDispatch, dispatchCommand } = require('../cli');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { candidateKey, generateCandidates } = require('../candidates');

process.env.GW_FIXTURE_KEY = 'fixture-only';
const endpoint = 'http://127.0.0.1:1/v1';
const registry = {
  sources: [
    {
      id: '9router',
      kind: 'router',
      servesModels: true,
      harness: 'paseo',
      endpoint,
      credential: { type: 'api-key', env: 'GW_FIXTURE_KEY' },
    },
  ],
  dispatch: { nineRouterWriterCombo: 'team', providers: {} },
};
const row = (modelId, gateway = '9router') => ({
  harness: 'paseo',
  accessPath: endpoint,
  gateway,
  upstream: modelId.split('/')[0],
  accountId: 'k',
  quotaScope: 'k',
  modelId,
});
const discovery = { candidates: [row('a/in'), row('b/out'), row('c/direct', 'direct')] };
const read = { name: 'team', state: 'READ', members: ['a/in'] };
const unread = { members: null, state: 'COMBO_CONFIG_UNAVAILABLE' };
const refusalCases = [
  [read, 'NOT_IN_COMBO_CONFIG'],
  [unread, 'COMBO_CONFIG_UNAVAILABLE'],
];
const assemble = (over) => {
  const list = assembleForDispatch(discovery, [], registry, {
    allowUnprobedCandidates: true,
    evidenceData: {},
    offerings: [],
    registryAccounts: [],
    discoverPool: false,
    ...over,
  });
  const byModel = Object.fromEntries(list.map((c) => [c.modelId, c]));
  return { byModel, excluded: list.excludedRoutes.map((r) => r.reason) };
};

test('a ticket limited to the combo refuses discovery rows outside it', () => {
  const { byModel, excluded } = assemble({
    role: 'writer',
    routeScope: 'combo-only',
    nineRouterComboConfig: read,
  });
  assert.equal(byModel['a/in'].routeOrigin, 'combo-member');
  assert.equal(byModel['b/out'], undefined);
  assert.equal(byModel['c/direct'], undefined);
  // Two discovery rows plus the inventory row on its credential account.
  assert.equal(excluded.filter((r) => r === 'NOT_IN_COMBO_CONFIG').length, 3);
});

test('a ticket allowing routes keeps them with their own origin', () => {
  const { byModel } = assemble({
    role: 'writer',
    routeScope: 'combo-and-routes',
    nineRouterComboConfig: read,
  });
  assert.equal(byModel['a/in'].routeOrigin, 'combo-member');
  assert.equal(byModel['b/out'].routeOrigin, 'individual');
  assert.equal(byModel['c/direct'].routeOrigin, 'individual');
});

test('an unread combo infers no member and keeps nothing from a listing as a member', () => {
  const { byModel, excluded } = assemble({
    role: 'writer',
    routeScope: 'combo-only',
    nineRouterComboConfig: unread,
  });
  assert.equal(byModel['a/in'], undefined);
  assert.ok(byModel.team, 'the whole-combo route stays');
  assert.ok(excluded.includes('COMBO_CONFIG_UNAVAILABLE'));
  assert.equal(excluded.includes('NOT_IN_COMBO_CONFIG'), false);
});

test('a non-writer role does not switch the combo on', () => {
  const { byModel, excluded } = assemble({
    role: 'reviewer',
    routeScope: 'combo-only',
    nineRouterComboConfig: read,
  });
  assert.equal(byModel['b/out'].routeOrigin, undefined);
  assert.deepEqual(excluded, []);
  assert.equal(byModel.team, undefined);
});

test('P1-1: combo origin requires the router source and the combo route kind', () => {
  const impostors = [
    row('direct/team', 'direct'),
    row('other/team', 'gateway'),
    row('ninerouter/team', 'direct'),
    row('a/team'),
    { ...row('fake/team', 'direct'), comboMembers: [] },
  ];
  const list = assembleForDispatch({ candidates: impostors }, [], registry, {
    role: 'writer',
    routeScope: 'combo-only',
    nineRouterComboConfig: read,
    allowUnprobedCandidates: true,
    evidenceData: {},
    offerings: [],
    registryAccounts: [],
    discoverPool: false,
  });
  assert.equal(list.filter((c) => c.routeOrigin === 'combo').length, 1);
  assert.equal(list.find((c) => c.modelId === 'team').gateway, '9router');
  for (const c of impostors) {
    assert.ok(
      list.excludedRoutes.some(
        (r) => r.candidateKey === candidateKey(c) && r.reason === 'NOT_IN_COMBO_CONFIG'
      )
    );
  }
});

test('P1-2: source inventory survives unrestricted scopes and is explicitly refused by combo-only', () => {
  const inventory = { ...registry, sources: [{ ...registry.sources[0], models: ['b/out'] }] };
  for (const [config, reason] of refusalCases) {
    for (const routeScope of [undefined, 'combo-and-routes', 'combo-only']) {
      const list = assembleForDispatch({ candidates: [] }, [], inventory, {
        role: 'writer',
        routeScope,
        nineRouterComboConfig: config,
        allowUnprobedCandidates: true,
        evidenceData: {},
        offerings: [],
        registryAccounts: [],
        discoverPool: false,
      });
      if (routeScope === 'combo-only') {
        assert.equal(
          list.some((c) => c.modelId === 'b/out'),
          false
        );
        assert.ok(list.excludedRoutes.some((r) => r.reason === reason));
      } else {
        assert.equal(list.find((c) => c.modelId === 'b/out')?.routeOrigin, 'individual');
      }
    }
  }
});

test('P1-2: OpenCode agent-CLI inventory survives until the shared scope filter', () => {
  const source = {
    id: 'fixture-opencode',
    kind: 'agent-cli',
    harness: 'opencode',
    accessPath: 'cli',
    reachedVia: '9router',
    modelPrefix: 'ninerouter/',
  };
  const inventory = { ...registry, sources: [source] };
  const modelId = source.modelPrefix + 'b/out';
  const accounts = [{ id: 'fixture-account', provider: source.id, models: [modelId] }];
  const options = {
    allowUnprobedCandidates: true,
    evidenceData: {},
    offerings: [],
    registryAccounts: [],
    discoverPool: false,
  };
  const unscoped = assembleForDispatch({ candidates: [] }, accounts, inventory, options);
  assert.deepEqual(
    unscoped.map((c) => c.modelId),
    [modelId]
  );
  assert.deepEqual(unscoped.excludedRoutes, []);
  for (const [config, reason] of refusalCases) {
    for (const routeScope of ['combo-and-routes', undefined, 'combo-only']) {
      const list = assembleForDispatch({ candidates: [] }, accounts, inventory, {
        ...options,
        role: 'writer',
        routeScope,
        nineRouterComboConfig: config,
      });
      if (routeScope === 'combo-only') {
        assert.equal(list.length, 0);
        assert.ok(list.excludedRoutes.some((r) => r.reason === reason));
      } else {
        assert.deepEqual(
          list.map((c) => c.modelId),
          [modelId]
        );
        assert.equal(list[0].routeOrigin, 'individual');
        assert.deepEqual(list.excludedRoutes, []);
      }
    }
  }
});

test('P1-3: injected candidates receive the same scope check and reasons', () => {
  for (const [config, reason] of refusalCases) {
    const list = assembleForDispatch(null, [], registry, {
      candidates: [row('b/out')],
      role: 'writer',
      routeScope: 'combo-only',
      nineRouterComboConfig: config,
      allowUnprobedCandidates: true,
    });
    assert.equal(list.length, 0);
    assert.equal(list.excludedRoutes[0]?.reason, reason);
  }
});

function dispatchFixture(t, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope181-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const combo = {
    ...row('team'),
    source: '9router',
    comboMembers: config.members || [],
    qualifiedRoles: ['*'],
  };
  return {
    combo,
    deps: {
      candidates: [combo, row('b/out')],
      registry,
      accounts: [],
      nineRouterComboConfig: config,
      allowUnprobedCandidates: true,
      home: dir,
      rootDir: dir,
      evidenceDir: path.join(dir, 'evidence'),
      decisionDir: path.join(dir, 'decisions'),
      storePath: path.join(dir, 'quota.json'),
      decisionLogFile: path.join(dir, 'decision.json'),
      now: Date.parse('2026-11-07T00:00:00Z'),
      reservations: [],
      headrooms: {},
      priors: { ranking: [] },
      taskProfile: {
        taskId: 'TASK-AI-181',
        role: 'writer',
        requiredCapabilities: [],
        proofFloor: 'NONE',
      },
      log: () => {},
      exit: () => {},
    },
  };
}

for (const [config, reason] of refusalCases) {
  test(`P2-1: JEV and capability reinjection retain ${reason}`, async (t) => {
    const { combo, deps } = dispatchFixture(t, config);
    let asks = 0;
    let probes = 0;
    deps.taskProfile.requiredCapabilities = ['tools'];
    const args = {
      item: 'TASK-AI-181',
      role: 'writer',
      'dry-run': true,
      'route-scope': 'combo-only',
    };
    const result = await dispatchCommand(args, {
      ...deps,
      jevAsk: async () => {
        asks++;
        return { choice: 'BALANCED', confidence: 1 };
      },
      probeCapabilities: async (candidates) => {
        probes++;
        for (const c of candidates) c.capabilities = { tools: true };
      },
    });
    assert.equal(asks, 1);
    assert.equal(probes, 1);
    assert.equal(result.decision.chosen, candidateKey(combo));
    assert.ok(result.decision.rejected.some((r) => r.reason === reason));
    assert.equal(
      result.decision.candidates.some((c) => c.modelId === 'b/out'),
      false
    );
    const log = JSON.parse(fs.readFileSync(deps.decisionLogFile, 'utf8'));
    assert.ok(log.excluded.some((r) => r.reasonCode === reason));
    assert.equal(log.candidates.length, log.excluded.length + Number(Boolean(log.selected)));
    assert.equal(new Set(log.candidates.map((c) => c.offeringId)).size, log.candidates.length);
    assert.equal(new Set(log.excluded.map((c) => c.offeringId)).size, log.excluded.length);
  });

  test(`P2-1: execute records ${reason} before mock launch`, (t) => {
    const { combo, deps } = dispatchFixture(t, config);
    const calls = [];
    const args = {
      item: 'TASK-AI-181',
      role: 'writer',
      execute: true,
      'route-scope': 'combo-only',
    };
    const result = dispatchCommand(args, {
      ...deps,
      jevAsk: async () => {
        throw new Error('execute must not ask JEV');
      },
      run: (_adapter, argv) => {
        calls.push(argv);
        const selected = require('../decisions')
          .readDecisions({ dir: deps.decisionDir, now: deps.now })
          .find((r) => r.stage === 'selected');
        assert.ok(selected.rejected.some((r) => r.reason === reason));
        return { exitCode: 0, stdout: '{"id":"fixture-session","status":"completed"}' };
      },
    });
    assert.equal(result.chosen, candidateKey(combo));
    assert.equal(calls.length, 1);
  });
}

test('P2-2: launch argv preserves the registry prefix for combo and individual 9router routes', (t) => {
  for (const [modelId, comboMembers] of [
    ['team', read.members],
    ['b/out', undefined],
  ]) {
    const { deps } = dispatchFixture(t, read);
    let argv;
    const result = dispatchCommand(
      { item: 'TASK-AI-181', role: 'writer', execute: true },
      {
        ...deps,
        registry: {
          ...registry,
          dispatch: {
            ...registry.dispatch,
            providers: {
              '9router': { harness: 'paseo', provider: 'opencode', modelPrefix: 'ninerouter/' },
            },
          },
        },
        candidates: [
          { ...row(modelId), source: '9router', comboMembers, qualifiedRoles: ['writer'] },
        ],
        run: (_adapter, args) => {
          argv = args;
          return { exitCode: 0, stdout: '{"id":"fixture-session","status":"completed"}' };
        },
      }
    );
    assert.equal(result.exitCode, 0);
    assert.equal(argv[argv.indexOf('--model') + 1], 'ninerouter/' + modelId);
    assert.equal(argv[argv.indexOf('--provider') + 1], 'opencode');
  }
});

test('P1-2: generation callers without a role keep their current inventory', () => {
  const list = generateCandidates({
    registry: { ...registry, sources: [{ ...registry.sources[0], models: ['b/out'] }] },
    accounts: [],
    discoverPool: false,
  });
  assert.equal(
    list.some((c) => c.modelId === 'b/out'),
    true
  );
  assert.equal(
    list.some((c) => c.comboMembers),
    false
  );
});

test('combo read order: reviewer profile wastes one read but does not enable a writer combo', async (t) => {
  const { deps } = dispatchFixture(t, read);
  delete deps.candidates;
  const profile = path.join(deps.rootDir, 'profile.json');
  fs.writeFileSync(profile, JSON.stringify({ role: 'reviewer' }));
  let reads = 0;
  t.mock.method(
    require('../routing'),
    'runProfileDispatch',
    (_args, options) => options.candidates
  );
  const candidates = await dispatchCommand(
    { profile, 'dry-run': true },
    {
      ...deps,
      nineRouterComboConfig: undefined,
      discoveryCatalogue: [],
      registryAccounts: [],
      offerings: [],
      discoverPool: false,
      registry: { ...registry, sources: [{ ...registry.sources[0], models: ['b/out'] }] },
      readDispatchComboConfig: async () => {
        reads++;
        return read;
      },
    }
  );
  assert.equal(reads, 1);
  assert.ok(candidates.some((c) => c.modelId === 'b/out'));
  assert.equal(
    candidates.some((c) => c.comboMembers || c.routeOrigin),
    false
  );
});

test('a config for another combo does not establish membership', () => {
  const { byModel, excluded } = assemble({
    role: 'writer',
    routeScope: 'combo-only',
    nineRouterComboConfig: { name: 'different-team', state: 'READ', members: ['b/out'] },
  });
  assert.equal(byModel['b/out'], undefined);
  assert.ok(excluded.includes('COMBO_CONFIG_UNAVAILABLE'));
});
