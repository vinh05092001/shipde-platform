'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadScoringPolicy, joinMeasurements } = require('../scoring-policy');

function policyDir(t, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-join-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'aa.json'),
    JSON.stringify({ source: 'https://aa.example/models', version: 'AA-T', unit: 'pct', observedAt: new Date().toISOString(), rows })
  );
  fs.writeFileSync(
    path.join(dir, 'policy.json'),
    JSON.stringify({
      version: 'T', source: 'https://aa.example/models', rationale: 'test', maxAgeMs: 86400000, priorsFile: 'aa.json', deploymentTags: ['free'],
      dimensions: { quality: { weight: 1, min: 0, max: 100, unit: 'pct', direction: 'higher', measurement: { store: 'priors', metric: 'quality' } } },
    })
  );
  return loadScoringPolicy(path.join(dir, 'policy.json'));
}
const rows = [
  { name: 'Grok 4.7 (High)', base: 'grok-4-7', variant: 'high', ii: 35, pct: 62.6 },
  { name: 'Grok 4.7 (Low)', base: 'grok-4-7', variant: 'low', ii: 30, pct: 54 },
  { name: 'Kimi K3.1 Pro', base: 'kimi-k3-1-pro', variant: '', ii: 40, pct: 76.8 },
];
const quality = (assessment, modelId) => {
  const c = { harness: 'opencode', source: 'x', modelId };
  joinMeasurements([c], assessment, { routeHealth: { paths: {} }, priors: { ranking: [] } });
  return c.measurements.quality;
};

test('gateway path and deployment tag do not hide the AA base', (t) => {
  const q = quality(policyDir(t, rows), 'openrouter/moonshotai/kimi-k3.1-pro:free');
  assert.equal(q.value, 76.8);
  assert.equal(q.matchedVia, 'aa-base');
  assert.equal(q.aaModelId, 'kimi-k3-1-pro');
});

test('a named effort takes that published effort only', (t) => {
  assert.equal(quality(policyDir(t, rows), 'gcli/grok-4.7-high').value, 62.6);
  assert.equal(quality(policyDir(t, rows), 'gcli/grok-4.7-xhigh'), undefined);
});

test('no effort named takes the lowest published effort, never a higher one', (t) => {
  const q = quality(policyDir(t, rows), 'gcli/grok-4.7');
  assert.equal(q.value, 54);
  assert.equal(q.matchedVia, 'aa-lowest-effort');
});

test('a model AA does not publish stays unscored', (t) => {
  assert.equal(quality(policyDir(t, rows), 'kr/glm-5'), undefined);
});

test('a revision or quantization tag is a different model and stays unscored', (t) => {
  const a = policyDir(t, rows);
  assert.equal(quality(a, 'gateway/kimi-k3.1-pro:q4_K_M'), undefined);
  assert.equal(quality(a, 'gateway/kimi-k3.1-pro:unmeasured-revision'), undefined);
  assert.equal(quality(a, 'gateway/kimi-k3.1-pro:free').value, 76.8);
});
