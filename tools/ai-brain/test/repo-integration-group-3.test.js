'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const doc = read(
  'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-3-CODE-CONTEXT.md'
);
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
    ['oraios/serena', 'ast-grep/ast-grep', 'yamadashy/repomix', 'upstash/context7', 'rtk-ai/rtk']
  );
  assert.equal(new Set(records.map((r) => r.repo)).size, records.length);
  for (const r of records) {
    for (const field of MANDATORY_FIELDS) assert.ok(Object.hasOwn(r, field), field);
    assert.equal(r.workItemId, 'GOAL-AUTOCLAW-REPOS-4');
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

test('existing context builder packs explicit scope and rejects unsafe paths and oversized input', () => {
  const os = require('node:os');
  const { createContextPack, safeRelative } = require('../context-pack');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-group3-'));
  try {
    fs.writeFileSync(path.join(temp, 'selected.js'), 'function selected() { return 1; }\n');
    fs.writeFileSync(path.join(temp, 'unrelated.js'), 'not selected');
    const packed = createContextPack([{ allowedPaths: ['selected.js', '../outside.js'] }], {
      root: temp,
      outputDir: path.join(temp, 'artifacts'),
      maxFileBytes: 100,
      maxTotalBytes: 100,
    });
    assert.deepEqual(packed.files, ['selected.js']);
    assert.ok(packed.content.includes('function selected'));
    assert.ok(!packed.content.includes('not selected'));
    assert.deepEqual(JSON.parse(fs.readFileSync(packed.path + '.manifest.json', 'utf8')).files, [
      'selected.js',
    ]);
    assert.throws(
      () =>
        createContextPack([{ allowedPaths: ['selected.js'] }], {
          root: temp,
          outputDir: path.join(temp, 'rejected'),
          maxFileBytes: 1,
        }),
      /CONTEXT_FILE_TOO_LARGE/
    );
    assert.equal(fs.existsSync(path.join(temp, 'rejected')), false);
    for (const value of ['../outside.js', '/absolute.js', 'Z:/absolute.js'])
      assert.equal(safeRelative(value), null);
    const serena = require('../serena');
    assert.throws(() => serena.assertReadOnly({ edit: true }), /MUTATION_REFUSED/);
    assert.equal(serena.estimateTokens('abcdefgh'), 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
test('documents byte versus token limits and the missing upstream acceptance paths', () => {
  for (const phrase of [
    'NOT a token budget',
    'preview diff',
    'source citations',
    'raw fallback',
    'MUTATION_REFUSED',
    'Never pack the whole repository',
  ])
    assert.ok(doc.includes(phrase), phrase);
  const source = read('tools/ai-brain/context-pack.js');
  assert.ok(source.includes('maxTotalBytes'));
  assert.ok(!source.includes('maxTokens'), 'reassess evidence if a token gate is added');
});
