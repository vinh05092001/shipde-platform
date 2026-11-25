'use strict';

// Lat C-3c-1: the legacy profile and coordinator dispatch paths are gone. Guard
// that nothing exports or references them again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN = path.join(__dirname, '..');
const RETIRED = [
  'dispatchProfileCommand',
  'coordinatorDispatchCommand',
  'runProfileDispatch',
  'dispatch-output',
  'coordinator-options',
];

test('Lat C-3c-1: the retired dispatch exports and modules are gone', () => {
  assert.equal(require('../cli').dispatchProfileCommand, undefined);
  const helpers = require('../cli/dispatch-helpers');
  assert.equal(helpers.dispatchProfileCommand, undefined);
  assert.equal(helpers.coordinatorDispatchCommand, undefined);
  assert.equal(require('../routing').runProfileDispatch, undefined);
  for (const file of ['dispatch-output.js', 'coordinator-options.js']) {
    assert.equal(fs.existsSync(path.join(BRAIN, file)), false, file + ' must stay deleted');
  }
});

test('Lat C-3c-1: no production source references the retired dispatch paths', () => {
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
