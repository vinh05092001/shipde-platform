'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parsePaseoAgents, relativeToIso, harnessOf } = require('../paseo-adapter');

const NOW = Date.parse('2026-09-22T12:00:00Z');

test('relative ages from `paseo ls` become timestamps', () => {
  assert.strictEqual(relativeToIso('15 hours ago', NOW), '2026-09-21T21:00:00.000Z');
  assert.strictEqual(relativeToIso('a minute ago', NOW), '2026-09-22T11:59:00.000Z');
  assert.strictEqual(relativeToIso('just now', NOW), '2026-09-22T12:00:00.000Z');
  assert.strictEqual(relativeToIso('someday', NOW), null);
});

test('provider names map onto the harnesses the role classifier knows', () => {
  assert.strictEqual(harnessOf('codex/gpt-5.6-sol'), 'codex');
  assert.strictEqual(harnessOf('claude/sonnet'), 'claude');
  assert.strictEqual(harnessOf('opencode/kimi'), 'dsh');
});

test('agents are shaped like the sessions the panels already render', () => {
  const json = JSON.stringify([
    { id: 'a5f0b392-full', shortId: 'a5f0b39', name: 'probe', provider: 'codex/gpt-5.6-sol', status: 'running', cwd: 'C:/x', created: '2 minutes ago' },
    { id: 'b1', shortId: 'b1', name: 'old', provider: 'opencode/kimi', status: 'archived', created: '3 days ago' },
  ]);
  const [a, b] = parsePaseoAgents(json, NOW);
  assert.strictEqual(a.id, 'a5f0b39');
  assert.strictEqual(a.status, 'RUNNING');
  assert.strictEqual(a.roleCategory, 'REVIEWER');
  assert.strictEqual(a.isTerminated, false);
  assert.strictEqual(b.isTerminated, true);
  assert.strictEqual(b.isWriter, true);
});

test('malformed output throws so the collector can report it as partial', () => {
  assert.throws(() => parsePaseoAgents('not json'));
});
