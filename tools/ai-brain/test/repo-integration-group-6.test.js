'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const manifest = json('tools/ai-brain/data/tool-manifest.json');
const pkg = json('package.json');
const document = read(
  'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-6-SECURITY.md'
);
const records = JSON.parse(document.match(/```json\s*([\s\S]*?)```/)[1]);
// Reuse item 1's actual validator without registering its tests twice.
// The shared file exposes no exports; evaluate it with a no-op describe only.
const sandbox = {
  require: (id) => (id === 'node:test' ? { describe() {}, test() {} } : require(id)),
  __dirname,
  module: { exports: {} },
};
vm.runInNewContext(
  read('tools/ai-brain/test/repo-integration-evidence.test.js') +
    '\nmodule.exports = validateEvidenceRecord;',
  sandbox
);
const validateEvidenceRecord = sandbox.module.exports;

test('evidence reuses item 1 validator and real manifest identity without promotion', () => {
  assert.ok(records.length > 0);
  assert.equal(new Set(records.map((r) => r.toolId)).size, records.length);
  for (const record of records) {
    const result = validateEvidenceRecord(record, root);
    assert.equal(result.valid, true, result.errors.join('; '));
    const entry = manifest.find((m) => m.id === record.toolId);
    assert.ok(entry, record.toolId);
    assert.equal(record.repo, entry.repo);
    assert.equal(record.workItemId, 'GOAL-AUTOCLAW-REPOS-7');
    assert.equal(record.evidenceRef, entry.evidenceRef);
    assert.equal(
      record.state,
      entry.installed ? (record.command ? 'WIRED' : 'INSTALLED') : 'DECLARED'
    );
    assert.equal(record.execution, 'NOT_RUN');
    assert.equal(record.acceptance, 'PENDING');
    assert.ok(Number.isFinite(Date.parse(record.verifiedAt)));
    assert.ok(record.versionRef);
    if (record.blocked) {
      assert.equal(record.command, null);
      assert.ok(record.blockedReason.trim());
    }
    if (record.command) {
      assert.equal(record.command, entry.command);
      assert.ok(pkg.scripts[record.command]);
    }
    if (record.state === 'INSTALLED') {
      const dependency = record.evidenceRef.split(':')[0];
      const packageFile = json(dependency);
      assert.equal(
        packageFile.dependencies?.[record.toolId] || packageFile.devDependencies?.[record.toolId],
        record.versionRef
      );
    }
  }
});

test('missing fields, invented states and absent evidence cannot validate', () => {
  for (const field of [
    'workItemId',
    'toolId',
    'repo',
    'state',
    'evidenceRef',
    'command',
    'blocked',
    'blockedReason',
    'verifiedAt',
    'verifiedBy',
  ]) {
    const broken = { ...records[0] };
    delete broken[field];
    assert.equal(validateEvidenceRecord(broken, root).valid, false, field);
  }
  assert.equal(validateEvidenceRecord({ ...records[0], state: 'PASS' }, root).valid, false);
  assert.equal(
    validateEvidenceRecord(
      { ...records[0], evidenceRef: 'missing-integration-evidence.json' },
      root
    ).valid,
    false
  );
  assert.equal(
    validateEvidenceRecord({ ...records[0], blocked: true, blockedReason: null }, root).valid,
    false
  );
});

// tsx is already a repository dependency. No native scanner or network is used.
require('tsx/cjs');
const trivy = require('../../../scripts/verify-trivy.ts');
const secrets = require('../../../scripts/verify-secrets.ts');

test('security inventory preserves unavailable gates and existing scan authorities', () => {
  assert.deepEqual(records.map((r) => r.toolId).sort(), [
    'agent-scan',
    'gitleaks',
    'semgrep',
    'trivy',
  ]);
  const unavailable = records.find((r) => r.toolId === 'agent-scan');
  assert.equal(unavailable.blocked, true);
  assert.equal(unavailable.command, null);
  assert.equal(manifest.find((m) => m.id === 'agent-scan').gate, true);
  assert.match(document, /TOOL_GATE_UNAVAILABLE, never PASS/);
  assert.match(read('.github/workflows/security-baseline.yml'), /8\.24\.0/);
  assert.match(read('.github/workflows/security-baseline.yml'), /--test-negative/);
  assert.ok(read('.gitleaks.toml').length > 0);
  assert.equal(trivy.TRIVY_PINNED_VERSION, '0.75.0');
  assert.equal(trivy.TRIVY_SECURITY_CHECKS, 'vuln,misconfig');
});

test('Trivy benign, malicious and broken process fixtures preserve distinct outcomes', () => {
  const args = trivy.buildFsScanArgs('fixture-target');
  for (const [status, kind, code] of [
    [0, 'clean', 0],
    [1, 'finding', 1],
    [2, 'operational', 2],
    [null, 'operational', 2],
  ]) {
    const outcome = trivy.executeTrivy('fixture-scanner', args, () => ({
      status,
      stdout: 'fixture',
      stderr: '',
    }));
    assert.equal(outcome.kind, kind);
    assert.equal(outcome.exitCode, code);
  }
  for (const spawn of [
    () => {
      throw new Error('fixture spawn error');
    },
    () => ({ status: null, error: new Error('ENOENT') }),
  ]) {
    assert.equal(trivy.executeTrivy('fixture-scanner', args, spawn).exitCode, 2);
  }
  const missing = trivy.runTrivyVerification([], {
    getBin: () => null,
    logger: { log() {}, error() {} },
  });
  assert.equal(missing.kind, 'operational');
  assert.equal(missing.exitCode, 2);
});

test('Gitleaks clean, finding, malformed report and operational fixtures never collapse', (t) => {
  const fakeFs = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify([{ RuleID: 'synthetic-rule', File: 'fixture.js' }]),
  };
  const run = (status, fixtureFs = fakeFs) =>
    secrets.executeGitleaks(
      'fixture-scanner',
      [],
      'fixture-report.json',
      () => ({ status, stdout: '', stderr: '' }),
      fixtureFs
    );
  assert.deepEqual([run(0).success, run(0).exitCode, run(0).findings.length], [true, 0, 0]);
  assert.deepEqual([run(1).success, run(1).exitCode, run(1).findings.length], [true, 1, 1]);
  for (const status of [2, 3, null]) {
    assert.equal(run(status).success, false);
    assert.ok(run(status).operationalError);
  }
  for (const fixtureFs of [
    { existsSync: () => false, readFileSync: () => '' },
    { existsSync: () => true, readFileSync: () => '{broken' },
    { existsSync: () => true, readFileSync: () => '[]' },
  ]) {
    assert.equal(run(1, fixtureFs).success, false);
    assert.ok(run(1, fixtureFs).operationalError);
  }
  const thrown = secrets.executeGitleaks(
    'fixture-scanner',
    [],
    'fixture-report.json',
    () => {
      throw new Error('ENOENT');
    },
    fakeFs
  );
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const missing = secrets.runCliVerification([], { rootDir: root, getBin: () => null });
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.message, 'Gitleaks binary not found');
  assert.equal(thrown.success, false);
  assert.ok(thrown.operationalError);
});
