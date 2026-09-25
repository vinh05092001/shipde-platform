'use strict';
const { inspectVerdict } = require('../executor');
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('inspectVerdict returns STALLED when progress indicates stalled', () => {
  const res = { exitCode: 0, stdout: JSON.stringify({ progress: 'stalled' }) };
  const verdict = inspectVerdict(res);
  assert.strictEqual(verdict, 'stalled');
});

test('inspectVerdict returns UNKNOWN when no forward flags present', () => {
  const res = { exitCode: 0, stdout: JSON.stringify({}) };
  const verdict = inspectVerdict(res);
  assert.strictEqual(verdict, 'unknown');
});

test('inspectVerdict falls back to ALIVE for non‑JSON output', () => {
  const res = { exitCode: 0, stdout: 'some text output' };
  const verdict = inspectVerdict(res);
  assert.strictEqual(verdict, 'alive');
});
