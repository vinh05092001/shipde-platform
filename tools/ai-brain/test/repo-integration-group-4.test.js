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
  'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-4-LINT-FORMAT.md'
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
    assert.equal(record.workItemId, 'GOAL-AUTOCLAW-REPOS-5');
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

test('Biome migration cannot remove legacy gates without per-scope parity', () => {
  assert.deepEqual(records.map((r) => r.toolId).sort(), ['eslint', 'prettier']);
  assert.equal(
    manifest.some((m) => m.repo === 'biomejs/biome'),
    false
  );
  for (const file of [
    'package.json',
    'apps/web/package.json',
    'apps/api/package.json',
    'packages/testkit/package.json',
  ]) {
    const p = json(file);
    assert.equal(p.dependencies?.['@biomejs/biome'], undefined);
    assert.equal(p.devDependencies?.['@biomejs/biome'], undefined);
    assert.equal(p.devDependencies?.['oxlint'], undefined);
  }
  assert.match(pkg.scripts.lint, /eslint/);
  assert.match(pkg.scripts['format:check'], /verify-formatting/);
  assert.ok(pkg.devDependencies.eslint && pkg.devDependencies.prettier);
  assert.match(read('eslint.config.mjs'), /@typescript-eslint\/parser/);
  assert.match(read('apps/web/eslint.config.mjs'), /eslint-config-next/);
  assert.match(read('scripts/verify-contracts.ts'), /prettier\.format/);
  assert.match(read('.github/workflows/current-application.yml'), /pnpm lint/);
  assert.match(read('.github/workflows/current-application.yml'), /pnpm format:check/);
  assert.match(read('lefthook.yml'), /staged-secret-scan/);
  for (const scope of [
    'scripts and workspace lint',
    'Next.js rules/plugins',
    'formatting',
    'generated output',
    'CI',
    'hooks',
    'import organization',
  ]) {
    assert.ok(
      document.split('\n').some((line) => line.split('|')[1]?.trim() === scope),
      scope
    );
  }
  assert.match(document, /No scope has parity/);
  assert.match(document, /version\/ref unresolved/);
});
