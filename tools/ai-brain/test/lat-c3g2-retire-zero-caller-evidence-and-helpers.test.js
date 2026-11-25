'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const evidence = require('../evidence');
const facts = require('../facts');
const governedMerge = require('../governed-merge');
const jev = require('../jev');

const RETIRED_SYMBOLS = [
  'recordAlias',
  'recordSharedQuota',
  'commitsTouching',
  'normalizeDiff',
  'roleQuestion',
  'transcriptQuestion',
];

function collectProductionJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['test', 'data', 'skills', '.oc', 'acceptance', 'node_modules'].includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectProductionJsFiles(full, out);
    else if (entry.isFile() && /\.(?:js|cjs|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('Lat C-3g-2 guard: retired zero-caller helpers are undefined on their modules', () => {
  assert.equal(evidence.recordAlias, undefined);
  assert.equal(evidence.recordSharedQuota, undefined);
  assert.equal(facts.commitsTouching, undefined);
  assert.equal(governedMerge.normalizeDiff, undefined);
  assert.equal(jev.roleQuestion, undefined);
  assert.equal(jev.transcriptQuestion, undefined);
});

test('Lat C-3g-2 guard: zero production references to retired helpers', () => {
  const brainDir = path.resolve(__dirname, '..');
  const files = collectProductionJsFiles(brainDir);
  const pattern = new RegExp(`\\b(?:${RETIRED_SYMBOLS.join('|')})\\b`);
  const hits = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (pattern.test(src)) hits.push(path.relative(brainDir, file));
  }
  assert.deepEqual(
    hits,
    [],
    `unexpected production references to retired helpers: ${hits.join(', ')}`
  );
});
