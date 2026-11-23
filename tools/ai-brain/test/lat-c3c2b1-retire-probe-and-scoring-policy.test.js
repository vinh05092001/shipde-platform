'use strict';

// Lat C-3c-2b-i: capability-probe.js and scoring-policy.js lost their last production
// caller with the retired profile dispatch. Guard that they stay gone and unreferenced.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN = path.join(__dirname, '..');
const RETIRED_FILES = ['capability-probe.js', 'scoring-policy.js', 'data/scoring-policy.json'];
const RETIRED_NAMES = ['capability-probe', 'scoring-policy'];

test('Lat C-3c-2b-i: the retired modules and policy file are deleted', () => {
  for (const file of RETIRED_FILES) {
    assert.equal(fs.existsSync(path.join(BRAIN, file)), false, file + ' must stay deleted');
  }
});

test('Lat C-3c-2b-i: no production source or test requires the retired modules', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'data', 'skills', '.oc', 'fixtures'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js') && full !== __filename) {
        const src = fs.readFileSync(full, 'utf8');
        for (const name of RETIRED_NAMES) {
          if (src.includes(name)) offenders.push(path.relative(BRAIN, full) + ': ' + name);
        }
      }
    }
  };
  walk(BRAIN);
  assert.deepEqual(offenders, []);
});
