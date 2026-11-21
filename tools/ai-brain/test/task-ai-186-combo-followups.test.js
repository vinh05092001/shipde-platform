'use strict';
// TASK-AI-186: intake checks the combo through GET /api/combos instead of the
// full /v1/models listing, and a checkpoint resume re-checks the credential.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const intake = require('../intake');
const { dispatchCommand } = require('../cli');
const { candidateKey } = require('../candidates');

const registry = {
  sources: [
    {
      id: '9router',
      kind: 'router',
      endpoint: 'http://127.0.0.1:1/v1',
      verify: { method: 'models-list', path: '/models', timeoutMs: 500 },
      credential: { env: 'TEST_COMBO_KEY_NOT_SET' },
    },
  ],
  dispatch: { nineRouterWriterCombo: 'vinh' },
};

const catalogue = (t, readComboConfig) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-186-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return intake.buildCatalogue({
    root,
    sourcesRegistry: registry,
    readComboConfig,
    readAgyModels: async () => ({ ok: true, models: ['agy-model'] }),
    readEvidenceModels: async () => ({ ok: true, models: [] }),
  });
};

test('B: a readable combo is the 9router catalogue, without listing every model', async (t) => {
  const asked = [];
  const result = await catalogue(t, async (o) => {
    asked.push(o.name);
    return { name: o.name, state: 'READ', members: ['a/b'] };
  });
  assert.deepEqual(asked, ['vinh']);
  assert.equal(result.sourceStatus['9router'], 'ok');
  assert.ok(result.models.includes('vinh'));
});

test('B: a down router or a missing combo fails closed with no models-list fallback', async (t) => {
  for (const status of ['REQUEST_FAILED', 'COMBO_NOT_FOUND', 503]) {
    const result = await catalogue(t, async (o) => ({
      name: o.name,
      members: null,
      state: 'COMBO_CONFIG_UNAVAILABLE',
      status,
    }));
    assert.equal(result.sourceStatus['9router'], 'failed', String(status));
    const warning = result.warnings.find((w) => w.source === '9router');
    assert.match(warning.error, new RegExp('combo "vinh" unavailable: ' + status));
  }
});

test('B: an empty combo is refused', async (t) => {
  const result = await catalogue(t, async (o) => ({ name: o.name, state: 'EMPTY', members: [] }));
  assert.equal(result.sourceStatus['9router'], 'failed');
});

test('C: a checkpoint resume refuses when the combo key is gone now', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-186-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = {
    harness: 'opencode-direct',
    source: '9router',
    gateway: '9router',
    upstream: '9router',
    accessPath: 'http://127.0.0.1:1/v1',
    accountId: '9router',
    quotaScope: '9router',
    modelId: 'vinh',
    qualifiedRoles: ['author.foundation'],
  };
  const key = candidateKey(c);
  const checkpointFile = path.join(root, 'checkpoint.json');
  fs.writeFileSync(checkpointFile, JSON.stringify({ chosen: key, harness: 'opencode-direct' }));
  const prompt = path.join(root, 'prompt.md');
  fs.writeFileSync(prompt, 'Bounded fixture task.');
  let launches = 0;
  const errors = [];
  const result = dispatchCommand(
    {
      execute: true,
      json: true,
      cwd: root,
      item: 'TASK-AI-186-RESUME',
      'base-sha': '0123456789abcdef0123456789abcdef01234567',
      'prompt-file': prompt,
    },
    {
      candidates: [c],
      registry,
      env: {},
      maxAttempts: 1,
      checkpointFile,
      quotaState: { scopes: {} },
      routeHealth: { version: 1, paths: {}, events: [] },
      scoringPolicyFile: path.join(root, 'no-scoring-policy.json'),
      home: root,
      decisionDir: root,
      evidenceDir: root,
      baseSha: '0123456789abcdef0123456789abcdef01234567',
      gitRoot: () => root,
      commitExists: () => true,
      log: () => {},
      error: (m) => errors.push(String(m)),
      exit: () => {},
      probeEvidence: () => true,
      run: () => {
        launches += 1;
        return { exitCode: 0, stdout: '{}' };
      },
    }
  );
  assert.equal(launches, 0);
  assert.equal(result && result.refusal, 'CREDENTIAL_ENV_MISSING');
  assert.ok(errors.some((m) => m.includes('TEST_COMBO_KEY_NOT_SET')));
});
