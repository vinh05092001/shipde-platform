'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const hermesSession = require('../hermes-session');

const RETIRED_SYMBOLS = [
  'legacyConfigFilePath',
  'getFsCheckReasons',
  'clearFsCheckReasons',
  'parseCodexModelsFromToml',
  'readCodexConfigModels',
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

test('Lat C-3g-4 guard: retired hermes-session helpers are undefined', () => {
  for (const sym of RETIRED_SYMBOLS) {
    assert.equal(hermesSession[sym], undefined);
  }
  assert.equal(typeof hermesSession.chatCommand, 'function');
  assert.equal(typeof hermesSession.goalSessionCommand, 'function');
});

test('Lat C-3g-4 guard: zero production references to retired hermes-session helpers', () => {
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
