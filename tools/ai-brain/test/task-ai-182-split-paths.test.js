'use strict';
// TASK-AI-182 AC3: code moved into cli/, orchestrate/ and isolation/ must
// still resolve paths from tools/ai-brain. A bare path.join(__dirname, 'data')
// in a submodule silently points at <submodule>/data instead.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const brain = path.join(__dirname, '..');
const SUBDIRS = ['cli', 'orchestrate', 'isolation'];
const DIRNAME_CALL = /path\.(?:join|resolve)\(\s*__dirname\s*,\s*(['"`])([^'"`]*)\1/g;

test('submodules resolve __dirname paths through the parent directory', () => {
  const offenders = [];
  for (const sub of SUBDIRS) {
    const dir = path.join(brain, sub);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const m of src.matchAll(DIRNAME_CALL)) {
        if (m[2] !== '..') offenders.push(`${sub}/${file}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the Controller data and exercise directories the submodules point at exist', () => {
  for (const rel of ['data/evidence', 'data/discovery', 'exercise']) {
    assert.ok(fs.existsSync(path.join(brain, rel)), rel);
  }
});
