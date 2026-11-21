'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN_DIR = path.resolve(__dirname, '..');
const comboReader = require('../combo-reader');
const writerCombo = require('../writer-combo');

test('TASK-AI-192 AC1: combo-reader.js exports match writer-combo.js re-exports and read fixture', async () => {
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
    assert.equal(writerCombo[name], comboReader[name], `writer-combo.${name} must re-export`);
  }

  const res = await comboReader.readComboConfig({
    name: 'vinh',
    fixture: { combos: [{ name: 'vinh', models: ['grok-4.7', 'claude-4.5'] }] },
  });
  assert.equal(res.state, 'READ');
  assert.deepEqual(res.members, ['grok-4.7', 'claude-4.5']);

  // Regression: writer-combo.syncWriterCombo default evidenceDir still resolves path.join
  await assert.rejects(
    () =>
      writerCombo.syncWriterCombo({
        name: 'vinh',
        host: '127.0.0.1',
        port: 1,
        protocol: 'http:',
      }),
    (err) => {
      assert.notEqual(err.name, 'ReferenceError');
      return true;
    }
  );
});

test('TASK-AI-192 AC2: live callers require combo-reader instead of writer-combo', () => {
  for (const rel of ['intake.js', 'cli.js', 'cli/dispatch.js']) {
    const src = fs.readFileSync(path.join(BRAIN_DIR, rel), 'utf8');
    assert.doesNotMatch(
      src,
      /require\(\s*['"]\.{1,2}\/writer-combo['"]\s*\)/,
      `${rel} should not require writer-combo.js`
    );
    assert.match(
      src,
      /require\(\s*['"]\.{1,2}\/combo-reader['"]\s*\)/,
      `${rel} should require combo-reader.js`
    );
  }
});
