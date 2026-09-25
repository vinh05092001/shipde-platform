'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessProgress } = require('../progress');

test('forward motion diffChanged => ALIVE', () => {
  const verdict = assessProgress(null, { diffChanged: true });
  assert.strictEqual(verdict, 'ALIVE');
});

test('forward motion logGrew => ALIVE', () => {
  const verdict = assessProgress({ diffChanged: false }, { logGrew: true });
  assert.strictEqual(verdict, 'ALIVE');
});

test('repeating same error => STALLED', () => {
  const prev = { error: 'Unavailable (reset after 151h)' };
  const curr = { error: 'Unavailable (reset after 151h)' };
  const verdict = assessProgress(prev, curr);
  assert.strictEqual(verdict, 'STALLED');
});

test('different error => UNKNOWN', () => {
  const prev = { error: 'first' };
  const curr = { error: 'second' };
  const verdict = assessProgress(prev, curr);
  assert.strictEqual(verdict, 'UNKNOWN');
});

test('no forward flags and no error repeat => UNKNOWN', () => {
  const prev = {};
  const curr = {};
  const verdict = assessProgress(prev, curr);
  assert.strictEqual(verdict, 'UNKNOWN');
});
