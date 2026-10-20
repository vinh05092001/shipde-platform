'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const doc = read('docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-2-WORKFLOW.md');
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
    ['obra/superpowers', 'Fission-AI/OpenSpec', 'pbakaus/impeccable', 'cli/cli']
  );
  assert.equal(new Set(records.map((r) => r.repo)).size, records.length);
  for (const r of records) {
    for (const field of MANDATORY_FIELDS) assert.ok(Object.hasOwn(r, field), field);
    assert.equal(r.workItemId, 'GOAL-AUTOCLAW-REPOS-3');
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

test('existing role loader selects review/UI skills and refuses unknown roles', () => {
  const pack = require('../skill-pack');
  assert.ok(pack.skillsFor('author').some((s) => s.name === 'systematic-debugging'));
  assert.ok(pack.skillsFor('reviewer').some((s) => s.name === 'receiving-code-review'));
  assert.ok(
    pack
      .skillsFor('author.ui')
      .every((s) => s.name.startsWith('impeccable') || s.name.startsWith('vercel-'))
  );
  assert.deepEqual(pack.skillsFor('unassigned'), []);
  const previous = process.env.SHIPDE_SKILL_PACK;
  try {
    delete process.env.SHIPDE_SKILL_PACK;
    assert.ok(pack.lockedPack('author.ui').startsWith(pack.UI_AUTHORITY_HEADER));
    assert.ok(pack.lockedPack('author').startsWith(pack.LOCK_HEADER));
    process.env.SHIPDE_SKILL_PACK = 'off';
    assert.equal(pack.lockedPack('author'), '');
  } finally {
    if (previous === undefined) delete process.env.SHIPDE_SKILL_PACK;
    else process.env.SHIPDE_SKILL_PACK = previous;
  }
  for (const r of records.filter((r) =>
    ['obra/superpowers', 'pbakaus/impeccable'].includes(r.repo)
  ))
    assert.ok(read(r.caller).includes(r.versionRef));
});

// Execute the unchanged Controller gate implementation with offline boundary fixtures.
// No commits, GitHub writes, providers or external scanner are invoked.
async function gateFixture(mode) {
  const source = read('tools/ai-brain/orchestrate.js');
  const start = source.indexOf('async function runToolGates(params)');
  const end = source.indexOf('\n/**', start);
  assert.ok(start > 0 && end > start);
  const tool = {
    id: 'fixture-gate',
    command: mode === 'missing' ? null : 'fixture',
    installed: mode !== 'missing',
  };
  let calls = 0;
  let repairs = 0;
  const log = {};
  const context = {
    require: (id) => {
      assert.equal(id, './tool-manifest');
      return { gatesFor: () => [tool], appliesTo: () => true };
    },
    ToolGate: { PASSED: 'PASSED', UNAVAILABLE: 'UNAVAILABLE', REFUSED: 'REFUSED' },
    SHA_40: /^[a-f0-9]{40}$/,
    roleOf: () => 'author',
    changedFileNames: () => ({ names: ['fixture.js'], detail: null }),
    runGateCommand: () => {
      calls++;
      return { status: mode === 'fail' ? 1 : 0 };
    },
    gateUnavailableReason: () => null,
    gateOutput: () => 'fixture violation',
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.run = runToolGates;', context);
  const result = await context.run({
    o: {},
    item: { id: 'fixture' },
    log,
    workerRoot: '.',
    baseSha: 'a'.repeat(40),
    targetSha: 'b'.repeat(40),
    repair: async () => {
      repairs++;
      return { sha: 'c'.repeat(40) };
    },
  });
  return { result, log, calls, repairs };
}
test('Controller executes available gate and refuses a persistent violation after one repair', async () => {
  const pass = await gateFixture('pass');
  assert.equal(pass.result.status, 'PASSED');
  assert.equal(pass.calls, 1);
  assert.equal(pass.repairs, 0);
  assert.equal(pass.log.toolGates[0].status, 'PASSED');
  const fail = await gateFixture('fail');
  assert.equal(fail.result.status, 'REFUSED');
  assert.equal(fail.calls, 2);
  assert.equal(fail.repairs, 1);
  assert.match(fail.result.reason, /TOOL_GATE_FAILED/);
});
test('unavailable tool has an explicit unavailable record, never an individual pass', async () => {
  const missing = await gateFixture('missing');
  assert.equal(missing.calls, 0);
  assert.equal(missing.log.toolGates.length, 1);
  assert.equal(missing.log.toolGates[0].status, 'UNAVAILABLE');
  assert.ok(!missing.log.toolGates.some((r) => r.status === 'PASSED'));
  const source = read('tools/ai-brain/orchestrate.js');
  const call = source.indexOf('const toolGate = await runToolGates(');
  assert.ok(call > 0);
  assert.match(source.slice(call, call + 1700), /toolGate.status === ToolGate.REFUSED/);
});
