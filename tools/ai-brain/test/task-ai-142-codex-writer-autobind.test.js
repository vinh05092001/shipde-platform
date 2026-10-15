'use strict';
// TASK-AI-142 H3: a logged-in Codex CLI is offered as a writer candidate.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { generateCandidates } = require('../candidates');

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
