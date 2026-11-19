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
      gitRoot: () => dir,
      commitExists: () => true,
      baseSha: '0123456789abcdef0123456789abcdef01234567',
      log: () => {},
      exit: () => {},
    },
  };
}

for (const [config, reason] of refusalCases) {
}

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
