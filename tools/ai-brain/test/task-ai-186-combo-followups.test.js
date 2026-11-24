'use strict';
// TASK-AI-186: intake checks the combo through GET /api/combos instead of the
// full /v1/models listing, and a checkpoint resume re-checks the credential.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const intake = require('../intake');

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

test('B: a router that never answers is bounded by verify.timeoutMs and fails closed', async (t) => {
  let signal = null;
  const started = Date.now();
  const result = await catalogue(t, (o) => {
    signal = o.signal || null;
    if (!signal) return { name: o.name, state: 'READ', members: ['a/b'] };
    return new Promise((resolve) => {
      signal.addEventListener('abort', () =>
        resolve({
          name: o.name,
          members: null,
          state: 'COMBO_CONFIG_UNAVAILABLE',
          status: 'REQUEST_FAILED',
        })
      );
    });
  });
  assert.ok(signal instanceof AbortSignal, 'the combo read carries an abort signal');
  assert.ok(Date.now() - started >= 400, 'it waits for verify.timeoutMs');
  assert.equal(result.sourceStatus['9router'], 'failed');
});

test('B: an empty combo is refused', async (t) => {
  const result = await catalogue(t, async (o) => ({ name: o.name, state: 'EMPTY', members: [] }));
  assert.equal(result.sourceStatus['9router'], 'failed');
});
