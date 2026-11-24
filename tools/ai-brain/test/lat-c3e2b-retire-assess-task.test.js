'use strict';

// Lat C-3e-2b: the JEV task-profile assessment (routing.assessTask and the
// 'assess-task-profile' question kind) lost its last caller with writer-selection.js.
// The live JEV question is 'select-combo-member'. Guard that the old path stays gone.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN = path.join(__dirname, '..');
const RETIRED = [
  'assessTask',
  'jevQuestion(',
  'controllerFallbackProfile',
  'ROLE_FALLBACK_PROFILE',
  'assess-task-profile',
  'scoreDimensions',
  'JEV_MAX_SCORE_LEVELS',
  'qualityImportance',
];

test('Lat C-3e-2b: the task-profile assessment exports are gone, the live JEV call stays', () => {
  const routing = require('../routing');
  for (const name of ['assessTask', 'jevQuestion', 'controllerFallbackProfile']) {
    assert.equal(routing[name], undefined, name);
  }
  const jev = require('../jev');
  for (const name of ['advise', 'buildJevAsk', 'failureReason']) {
    assert.equal(typeof jev[name], 'function', name);
  }
});

test('Lat C-3e-2b: no production source references the retired assessment path', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'data', 'skills', '.oc'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const src = fs.readFileSync(full, 'utf8');
        for (const name of RETIRED) {
          if (src.includes(name)) offenders.push(path.relative(BRAIN, full) + ': ' + name);
        }
      }
    }
  };
  walk(BRAIN);
  assert.deepEqual(offenders, []);
});
