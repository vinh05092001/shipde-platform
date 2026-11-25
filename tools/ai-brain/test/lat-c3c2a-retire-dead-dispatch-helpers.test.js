'use strict';

// Lat C-3c-2a: helpers that only the retired profile dispatch used are gone. Guard
// that nothing exports or defines them again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN = path.join(__dirname, '..');
const RETIRED = [
  'formatTopEntry',
  'jsonRejectedSlice',
  'rankProofOf',
  'defaultLauncher',
  'routeScopeOf',
  'resolveFixturePaths',
  'REJECTED_RECORDED_LIMIT',
];

test('Lat C-3c-2a: the retired helpers are no longer exported', () => {
  const routing = require('../routing');
  const helpers = require('../cli/dispatch-helpers');
  for (const name of RETIRED) {
    assert.equal(routing[name], undefined, 'routing.' + name);
    assert.equal(helpers[name], undefined, 'dispatch-helpers.' + name);
  }
});

test('Lat C-3c-2a: no production source defines or references the retired helpers', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'data', 'skills', '.oc'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const src = fs.readFileSync(full, 'utf8');
        for (const name of RETIRED) {
          if (new RegExp('\\b' + name + '\\b').test(src)) {
            offenders.push(path.relative(BRAIN, full) + ': ' + name);
          }
        }
      }
    }
  };
  walk(BRAIN);
  assert.deepEqual(offenders, []);
});
