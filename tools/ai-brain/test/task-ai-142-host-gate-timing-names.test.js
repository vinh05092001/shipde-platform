'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runHostBrainGate } = require('../orchestrate');

// Live 19/10 trial 19: node --test prints "✖ <name> (<duration>ms)". The run and the
// base run of the same pre-existing failure differ only in duration, so the base
// failure was counted as new and the host gate failed a clean worker commit.
test('TASK-AI-142: a base failure reported with a different duration is not a new failure', () => {
  const baseSha = 'b'.repeat(40);
  const out = (ms) => ({
    status: 1,
    stdout: `✖ replaying 9router from recorded fixtures (${ms}ms)\nℹ pass 10\nℹ fail 1\n`,
  });
  let nodeCalls = 0;
  const spawnSync = (cmd, args) => {
    if (cmd === 'git') {
      if (args && args[0] === 'rev-parse') return { status: 0, stdout: baseSha + '\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }
    nodeCalls++;
    return nodeCalls === 1 ? out('1796.6611') : out('1805.1234');
  };
  const result = runHostBrainGate({ baseSha }, { spawnSync, baseCache: new Map() });
  assert.deepEqual(result.hostGateFailures.newFailures, []);
  assert.deepEqual(result.hostGateFailures.baselineFailures, [
    'replaying 9router from recorded fixtures',
  ]);
  assert.equal(result.pass, true);
});

test('TASK-AI-142: a new failure is still reported when only durations are stripped', () => {
  const baseSha = 'c'.repeat(40);
  let nodeCalls = 0;
  const spawnSync = (cmd, args) => {
    if (cmd === 'git') {
      if (args && args[0] === 'rev-parse') return { status: 0, stdout: baseSha + '\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }
    nodeCalls++;
    return nodeCalls === 1
      ? { status: 1, stdout: '✖ old failure (12ms)\n✖ worker regression (3.5s)\n' }
      : { status: 1, stdout: '✖ old failure (40ms)\n' };
  };
  const result = runHostBrainGate({ baseSha }, { spawnSync, baseCache: new Map() });
  assert.equal(result.pass, false);
  assert.deepEqual(result.hostGateFailures.newFailures, ['worker regression']);
});
