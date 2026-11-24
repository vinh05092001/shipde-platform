'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN_DIR = path.resolve(__dirname, '..');
const comboReader = require('../combo-reader');
const candidates = require('../candidates');

test('TASK-AI-192 AC1: combo-reader.js exports read-only combo API and reads fixture', async () => {
  for (const name of [
    'resolveEndpoint',
    'assertLoopbackHost',
    'loadCliToken',
    'httpRequest',
    'resolveComboConfig',
    'resolveComboMembers',
    'readComboConfig',
  ]) {
    assert.equal(typeof comboReader[name], 'function', `combo-reader.${name} must be a function`);
  }

  const res = await comboReader.readComboConfig({
    name: 'vinh',
    fixture: { combos: [{ name: 'vinh', models: ['grok-4.7', 'claude-4.5'] }] },
  });
  assert.equal(res.state, 'READ');
  assert.deepEqual(res.members, ['grok-4.7', 'claude-4.5']);
});

test('TASK-AI-192 AC2 / Lat C-2: dead writer-combo.js is removed and candidates keeps predicates', () => {
  assert.equal(
    fs.existsSync(path.join(BRAIN_DIR, 'writer-combo.js')),
    false,
    'writer-combo.js must be deleted'
  );
  for (const rel of ['intake.js', 'cli.js', 'candidates.js']) {
    const src = fs.readFileSync(path.join(BRAIN_DIR, rel), 'utf8');
    assert.doesNotMatch(
      src,
      /require\(\s*['"]\.{1,2}\/writer-combo['"]\s*\)/,
      `${rel} should not require writer-combo.js`
    );
  }
  for (const rel of ['intake.js']) {
    const src = fs.readFileSync(path.join(BRAIN_DIR, rel), 'utf8');
    assert.match(
      src,
      /require\(\s*['"]\.{1,2}\/combo-reader['"]\s*\)/,
      `${rel} should require combo-reader.js`
    );
  }
  assert.equal(candidates.isNineRouterCandidate({ gateway: '9router', modelId: 'x/y' }), true);
  assert.equal(candidates.isNineRouterCandidate({ gateway: 'agy-pool', modelId: 'gemini' }), false);
  assert.equal(
    candidates.isIndividualNineRouterCandidate({ gateway: '9router', modelId: 'vinh' }, 'vinh'),
    false
  );
  assert.equal(
    candidates.isIndividualNineRouterCandidate(
      { gateway: '9router', modelId: 'bzl/glm-5' },
      'vinh'
    ),
    true
  );
});
