'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ecosystem = JSON.parse(read('tools/ecosystem-manifest.json'));
const runtime = JSON.parse(read('tools/ai-brain/data/tool-manifest.json'));
const inventory = new Set(
  [
    ecosystem.orchestrator_runtime,
    ...ecosystem.adopted,
    ...ecosystem.product_dependencies,
    ...ecosystem.candidates,
    ...runtime,
  ].map((tool) => tool.id)
);
const audit = read('docs/ai-audit/tool-usage-20261107.md');

function checkCoverage(document) {
  const seen = new Set();
  for (const line of document.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    assert.equal(cells.length, 5, 'each tool needs all four evidence columns');
    for (const [, id] of cells[0].matchAll(/`([^`]+)`/g)) {
      assert.ok(!seen.has(id), `duplicate tool row: ${id}`);
      seen.add(id);
    }
    assert.ok(cells.slice(1).every(Boolean), 'evidence cells must be explicit');
    assert.match(line, /`[^`]+\.(?:js|ts|json|ps1|sh|md|yml):[^`]+`/, 'cite source evidence');
  }
  for (const id of inventory) assert.ok(seen.has(id), `missing tool: ${id}`);
}

test('audit covers both manifests, product dependencies and candidates with explicit evidence', () => {
  checkCoverage(audit);
});

test('audit coverage rejects an omitted inventory row', () => {
  checkCoverage(audit);
  const id = inventory.values().next().value;
  const damaged = audit
    .split('\n')
    .filter((line) => !line.startsWith('| `' + id + '`'))
    .join('\n');
  assert.throws(() => checkCoverage(damaged), /missing tool:/);
});

test('audit source citations name files present in this checkout', () => {
  const citations = [
    ...audit.matchAll(
      /`((?:tools|scripts|apps|packages|docs)\/[^` :]+\.(?:js|ts|json|ps1|sh|md|yml)):[^`]+`/g
    ),
  ];
  assert.ok(citations.length > 0, 'audit must cite repository sources');
  for (const [, file] of citations) assert.ok(fs.existsSync(path.join(root, file)), file);
});
