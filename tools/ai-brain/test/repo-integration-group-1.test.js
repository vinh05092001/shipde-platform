'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const doc = read('docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-1-BRAIN.md');
const records = JSON.parse(doc.match(/```json\s*([\s\S]*?)```/)[1]);
const manifest = JSON.parse(read('tools/ai-brain/data/tool-manifest.json'));
// Use item 1's actual validator; suppress only its test registration.
const sandbox = {
  require: (id) => (id === 'node:test' ? { describe() {}, test() {} } : require(id)),
  __dirname,
  module: { exports: {} },
};
vm.runInNewContext(
  read('tools/ai-brain/test/repo-integration-evidence.test.js') +
    '\nmodule.exports = { validateEvidenceRecord, MANDATORY_FIELDS };',
  sandbox
);
const { validateEvidenceRecord, MANDATORY_FIELDS } = sandbox.module.exports;

test('exact group inventory and shared contract, without claiming missing manifest registration', () => {
  assert.deepEqual(
    records.map((r) => r.repo),
    [
      'vinh05092001/shipde-platform',
      'NousResearch/hermes-agent',
      'vinh05092001/shipde-brain',
      'decolua/9router',
      'anomalyco/opencode',
      'openai/codex',
      'google-gemini/gemini-cli',
      'getpaseo/paseo',
      'anthropic-ai/claude-code',
    ]
  );
  assert.equal(new Set(records.map((r) => r.repo)).size, records.length);
  for (const r of records) {
    for (const field of MANDATORY_FIELDS) assert.ok(Object.hasOwn(r, field), field);
    assert.equal(r.workItemId, 'GOAL-AUTOCLAW-REPOS-2');
    assert.equal(r.state, 'DECLARED');
    assert.equal(r.execution, 'NOT_RUN');
    assert.equal(r.acceptance, 'PENDING');
    assert.equal(r.blocked, true);
    assert.ok(r.blockedReason.trim());
    assert.ok(Number.isFinite(Date.parse(r.verifiedAt)));
    assert.ok(fs.existsSync(path.join(root, r.caller)), r.caller);
    const entry = manifest.find((m) => m.repo.toLowerCase() === r.repo.toLowerCase());
    if (entry) {
      assert.equal(r.toolId, entry.id);
      assert.equal(r.registrationPending, false);
      assert.equal(entry.installed, false, 'state must be reconsidered if manifest changes');
      assert.equal(r.evidenceRef, entry.evidenceRef);
      assert.equal(r.command, entry.command);
      const result = validateEvidenceRecord(r, root);
      assert.equal(result.valid, true, result.errors.join('; '));
    } else {
      assert.equal(r.toolId, null);
      assert.equal(r.registrationPending, true);
      assert.ok(doc.includes('incomplete contract records'));
      assert.ok(fs.existsSync(path.join(root, r.evidenceRef.split(':')[0])));
      // Do not pass pending records off as complete validator successes.
    }
  }
});
test('shared validator rejects damaged evidence, with no alternate lifecycle', () => {
  const base = { ...records[0] };
  delete base.evidenceRef;
  assert.equal(validateEvidenceRecord(base, root).valid, false);
  assert.equal(validateEvidenceRecord({ ...records[0], state: 'UNAVAILABLE' }, root).valid, false);
  assert.equal(validateEvidenceRecord({ ...records[0], blockedReason: null }, root).valid, false);
  assert.equal(
    validateEvidenceRecord(
      { ...records[0], evidenceRef: 'missing-integration-proof.json:key' },
      root
    ).valid,
    false
  );
  assert.match(doc, /SHA: pending Claude commit/);
});

test('existing executor resolves only declared routes and keeps session uncertainty explicit', () => {
  const { resolveRoute, inspectVerdict } = require('../executor');
  const registry = { sources: [], dispatchRoutes: {} };
  assert.equal(resolveRoute({ provider: 'missing', model: 'fixture' }, {}, registry), null);
  const route = resolveRoute(
    { provider: 'fixture', model: 'fixture-model', harness: 'fixture-harness' },
    {},
    registry
  );
  assert.equal(route.harnessName, 'fixture-harness');
  assert.equal(route.model, 'fixture-model');
  assert.equal(inspectVerdict({ exitCode: 0, stdout: '{"status":"running"}' }), 'alive');
  assert.equal(inspectVerdict({ exitCode: 1, stderr: 'Agent not found' }), 'gone');
  assert.equal(inspectVerdict({ exitCode: 1, stderr: 'gateway timeout' }), 'unknown');
  assert.equal(inspectVerdict({ exitCode: 0, stdout: '' }), 'unknown');
});
test('handoff points to the existing Controller adapters and requires missing live artifacts', () => {
  for (const file of [
    'orchestrate.js',
    'executor.js',
    'sources.js',
    'hermes-session.js',
    'route-probe.js',
    'route-health.js',
  ])
    assert.ok(doc.includes('tools/ai-brain/' + file), file);
  assert.match(
    read('tools/ai-brain/hermes-session.js'),
    /Controller retains model\/account choice/
  );
  for (const artifact of [
    'decision log',
    'launch result',
    'session ID',
    'independent review',
    'response',
  ])
    assert.ok(doc.includes(artifact), artifact);
});
