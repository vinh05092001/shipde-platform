'use strict';
// TASK-AI-142 H3: a logged-in Codex CLI is offered as a writer candidate.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { generateCandidates } = require('../candidates');
const { buildCandidates } = require('../orchestrate');
const { mergeDiscoveredSources } = require('../intake');

const HOME = path.join(path.sep, 'fakehome');
const AUTH = path.join(HOME, '.codex', 'auth.json');
const CONFIG = path.join(HOME, '.codex', 'config.toml');

const registry = {
  sources: [
    {
      id: 'codex',
      kind: 'agent-cli',
      servesModels: true,
      modelsFrom: 'account',
      harness: 'codex',
      accessPath: 'cli',
      quota: { unit: 'session', window: '5h' },
    },
  ],
};

function fakeFs({ auth, config }) {
  const files = new Map();
  if (auth) files.set(AUTH, '');
  if (config !== undefined) files.set(CONFIG, config);
  return {
    existsSync: (p) => files.has(p),
    statSync: (p) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return { isFile: () => true };
    },
    readFileSync: (p) => {
      if (p === AUTH) throw new Error('auth.json must never be read');
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    },
  };
}

function codexCands(fsStub, accounts) {
  return generateCandidates({
    registry,
    accounts: accounts || [],
    codexOpts: { homeDir: HOME, fs: fsStub, env: {} },
  }).filter((c) => c.source === 'codex');
}

test('auth.json present + config.toml model -> auto-discovered codex writer candidate', () => {
  const c = codexCands(fakeFs({ auth: true, config: 'model = "op-model-x"\n' }));
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].modelId, 'op-model-x');
  assert.strictEqual(c[0].accountId, 'codex-cli');
  assert.strictEqual(c[0].harness, 'codex');
  assert.strictEqual(c[0].binding, 'cli-login');
  // Live 16/10: a string evidence field crashed the reviewer dry-run ranking.
  assert.ok(c[0].evidence === undefined || Array.isArray(c[0].evidence));
});

test('auth.json absent -> no concrete codex candidate', () => {
  const c = codexCands(fakeFs({ auth: false, config: 'model = "op-model-x"\n' }));
  assert.ok(c.every((x) => x.modelId !== 'op-model-x' && x.binding !== 'cli-login'));
});

test('config.toml without a model -> no invented model id', () => {
  const c = codexCands(fakeFs({ auth: true, config: '' }));
  assert.ok(c.every((x) => x.binding !== 'cli-login'));
});

test('registry codex account wins, no duplicate', () => {
  const c = codexCands(fakeFs({ auth: true, config: 'model = "op-model-x"\n' }), [
    { id: 'codex-reg', sourceId: 'codex', models: ['op-model-x'] },
  ]);
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].accountId, 'codex-reg');
  assert.strictEqual(c[0].binding, undefined);
});

test('auth.json content is never read', () => {
  const stub = fakeFs({ auth: true, config: 'model = "op-model-x"\n' });
  assert.doesNotThrow(() => codexCands(stub));
});

test('intake snapshot disabled CLI inventory does not hide the logged-in Codex candidate', () => {
  const source = registry.sources[0];
  const accounts = mergeDiscoveredSources(
    [],
    [{ id: source.id, status: 'discovered', models: [] }],
    registry
  );
  assert.strictEqual(accounts.length, 1);
  assert.strictEqual(accounts[0].enabled, false);
  const options = {
    registry,
    accounts: JSON.parse(JSON.stringify(accounts)),
    catalogue: [],
    discoverPool: false,
    codexOpts: {
      homeDir: HOME,
      fs: fakeFs({ auth: true, config: 'model = "op-model-x"\n' }),
      env: {},
    },
  };
  const candidates = buildCandidates(options, null).filter((c) => c.source === source.id);
  // Shared dispatch assembly stamps each candidate with its canonical key.
  const { candidateKey } = require('../candidates');
  for (const c of candidates) assert.strictEqual(c.key, candidateKey(c));
  assert.deepStrictEqual(
    candidates.map(({ key, ...rest }) => rest),
    codexCands(options.codexOpts.fs)
  );
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].binding, 'cli-login');
  options.codexOpts.fs = fakeFs({ auth: false, config: 'model = "op-model-x"\n' });
  assert.ok(buildCandidates(options, null).every((c) => c.binding !== 'cli-login'));
});
