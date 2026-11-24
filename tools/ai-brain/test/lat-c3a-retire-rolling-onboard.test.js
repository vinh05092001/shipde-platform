'use strict';

// Lat C-3a: rolling-onboard.js and the dispatch-only helpers in cli/dispatch-helpers.js
// lost their last caller when cli/dispatch.js was retired in TASK-AI-203.
// Guard that the deleted module and exports stay gone from production code.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN = path.join(__dirname, '..');
const RETIRED_EXPORTS = [
  'usageReportFile',
  'candidateFromDecision',
  'simulatedFailureFor',
  'candidateContextWindow',
  'applyHarnessVerification',
  'resolveExecuteBase',
];

test('Lat C-3a: rolling-onboard.js is deleted and retired dispatch-helpers exports are gone', () => {
  assert.equal(fs.existsSync(path.join(BRAIN, 'rolling-onboard.js')), false);
  const dispatchHelpers = require('../cli/dispatch-helpers');
  for (const name of RETIRED_EXPORTS) {
    assert.equal(dispatchHelpers[name], undefined, name);
  }
  const cli = require('../cli');
  assert.equal(cli.resolveExecuteBase, undefined);
});

test('Lat C-3a: no production source references rolling-onboard and cli modules drop retired helpers', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'data', 'skills', '.oc'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const src = fs.readFileSync(full, 'utf8');
        if (src.includes('rolling-onboard')) {
          offenders.push(path.relative(BRAIN, full) + ': rolling-onboard');
        }
      }
    }
  };
  walk(BRAIN);
  for (const rel of ['cli.js', path.join('cli', 'dispatch-helpers.js')]) {
    const src = fs.readFileSync(path.join(BRAIN, rel), 'utf8');
    for (const name of RETIRED_EXPORTS) {
      if (src.includes(name)) offenders.push(rel + ': ' + name);
    }
  }
  assert.deepEqual(offenders, []);
});
