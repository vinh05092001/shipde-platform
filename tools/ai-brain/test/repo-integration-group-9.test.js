'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const doc = read(
  'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-9-CANDIDATES.md'
);
const records = JSON.parse(doc.match(/```json\s*([\s\S]*?)```/)[1]);
const manifest = JSON.parse(read('tools/ai-brain/data/tool-manifest.json'));
test('exact inventory without duplicates', () => {
  assert.deepEqual(
    records.map((r) => r.repo),
    ['DeusData/codebase-memory-mcp', 'Nox-HQ/nox']
  );
  assert.equal(new Set(records.map((r) => r.repo.toLowerCase())).size, records.length);
});
test('reuse shared contract and manifest evidence without state inflation', () => {
  const contract = read('docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-EVIDENCE.md');
  for (const r of records) {
    for (const k of [
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
    ])
      assert.ok(Object.hasOwn(r, k), k);
    assert.equal(r.workItemId, 'GOAL-AUTOCLAW-REPOS-10');
    assert.ok(contract.includes(r.state));
    assert.ok(Number.isFinite(Date.parse(r.verifiedAt)));
    assert.equal(r.command, null);
    assert.equal(r.blocked, true);
    assert.ok(r.blockedReason.length > 10);
    assert.ok(r.capability.length > 5);
    assert.ok(fs.existsSync(path.join(root, r.evidenceRef.split(':')[0])));
    const m = manifest.find((m) => m.repo.toLowerCase() === r.repo.toLowerCase());
    if (!m) {
      assert.equal(r.toolId, null);
      assert.equal(r.registrationPending, true);
      assert.equal(r.state, 'DECLARED');
      continue;
    }
    assert.equal(r.toolId, m.id);
    assert.equal(r.evidenceRef, m.evidenceRef);
    assert.equal(r.registrationPending, false);
    assert.equal(r.state, 10 === 8 && m.installed ? 'INSTALLED' : 'DECLARED');
    if (r.state === 'INSTALLED') {
      const [file, key] = r.evidenceRef.split(':');
      assert.deepEqual(r.versionRef, JSON.parse(read(file))[key]);
    }
  }
});
test('explicit limitations and real caller paths, entirely offline', () => {
  for (const s of [
    'incomplete contract records',
    'SHA: pending Claude commit',
    'not live tool availability',
  ])
    assert.ok(doc.includes(s));
  for (const m of doc.matchAll(
    /(?:scripts|apps|packages|infra|prisma)\/[\w/.-]+\.(?:ts|json|yaml|yml|prisma)/g
  ))
    assert.ok(fs.existsSync(path.join(root, m[0])), m[0]);
  if (10 !== 8) {
    assert.ok(records.every((r) => r.state === 'DECLARED'));
    assert.match(doc, /not wired/);
  }
  if (10 === 9) {
    assert.match(doc, /Before installation/);
    assert.match(doc, /No packages installed/);
  }
  if (10 === 10)
    for (const s of [
      'Serena',
      'semantic editing',
      'coverage parity',
      'benign and violating fixtures',
    ])
      assert.ok(doc.includes(s));
});
