'use strict';

// Lat C-3d: ranking.rankAndRecord lost its last caller with cli/dispatch.js. Guard that
// it stays gone and that the score parts routing still uses remain exported.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN = path.join(__dirname, '..');

test('Lat C-3d: rankAndRecord is gone and the live score parts remain', () => {
  const ranking = require('../ranking');
  assert.equal(ranking.rankAndRecord, undefined);
  for (const name of ['scoreCandidate', 'WEIGHTS', 'resolveCandidateHeadroom']) {
    assert.notEqual(ranking[name], undefined, name);
  }
});

test('Lat C-3d: no production source references rankAndRecord', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'data', 'skills', '.oc'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.name.endsWith('.js') &&
        fs.readFileSync(full, 'utf8').includes('rankAndRecord')
      ) {
        offenders.push(path.relative(BRAIN, full));
      }
    }
  };
  walk(BRAIN);
  assert.deepEqual(offenders, []);
});
