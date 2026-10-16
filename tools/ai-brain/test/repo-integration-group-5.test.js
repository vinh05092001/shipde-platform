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
  'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-5-TESTING.md'
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
    assert.equal(record.workItemId, 'GOAL-AUTOCLAW-REPOS-6');
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

test('testing inventory preserves all nine capabilities and migration consumers', () => {
  assert.deepEqual(
    records.map((r) => r.toolId).sort(),
    [
      'axe-core',
      'k6',
      'lighthouse-ci',
      'msw',
      'openapi-typescript',
      'playwright',
      'playwright-cli',
      'supertest',
    ].sort()
  );
  assert.match(document, /ChromeDevTools\/chrome-devtools-mcp/);
  assert.equal(
    manifest.some((m) => /chrome-devtools-mcp/i.test(m.repo)),
    false
  );
  assert.match(document, /absent shared manifest id/);
  assert.match(document, /@playwright\/cli@0\.1\.2/);
  const kit = json('packages/testkit/package.json');
  assert.ok(kit.dependencies.msw && kit.dependencies.supertest);
  assert.ok(json('apps/api/package.json').devDependencies.supertest);
  assert.match(kit.scripts.test, /src\/msw\/msw.test.ts/);
  assert.match(json('apps/web/package.json').scripts['test:e2e'], /tsx/);
  assert.match(read('scripts/verify-contracts.ts'), /openapi-typescript/);
  assert.match(pkg.scripts['contract:check'], /verify-contracts/);
  assert.ok(pkg.scripts.typecheck);
  for (const p of [
    'packages/testkit/src/msw/msw.test.ts',
    'packages/testkit/src/integration.ts',
    'docs/product-spec/contracts/openapi.yaml',
    'packages/contracts/src/openapi.ts',
  ]) {
    assert.ok(fs.existsSync(path.join(root, p)), p);
  }
  for (const phrase of [
    'teardown on success, failure and timeout',
    'incomplete/violations become findings',
    'Keep MSW/Supertest',
    'exact SHA',
  ]) {
    assert.ok(document.includes(phrase), phrase);
  }
});
