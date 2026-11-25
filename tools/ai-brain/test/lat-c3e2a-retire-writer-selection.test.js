'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('Lat C-3e-2a guard: writer-selection.js is deleted', () => {
  const target = path.resolve(__dirname, '..', 'writer-selection.js');
  assert.equal(fs.existsSync(target), false, 'writer-selection.js must remain deleted');
});

test('Lat C-3e-2a guard: zero production references to writer-selection', () => {
  const brainDir = path.resolve(__dirname, '..');
  const files = collectProductionJsFiles(brainDir);
  const hits = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (/\bwriter-selection\b/.test(src)) hits.push(path.relative(brainDir, file));
  }
  assert.deepEqual(
    hits,
    [],
    `unexpected production references to writer-selection: ${hits.join(', ')}`
  );
});
