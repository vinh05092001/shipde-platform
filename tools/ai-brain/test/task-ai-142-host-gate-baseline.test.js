'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runHostBrainGate, baseGateCache } = require('../orchestrate');

test('TASK-AI-142: (a) same failures on base -> pass', () => {
  const baseSha = 'a'.repeat(40);
  const workerOutput = {
    status: 1,
    stdout:
      'not ok 1 - AF-R01: worker prettier .cmd launches\n' +
      'not ok 2 - AF-R02: repair logic changes\n' +
      'ℹ pass 10\n' +
      'ℹ fail 2\n',
  };
  const baseOutput = {
    status: 1,
    stdout:
      'not ok 1 - AF-R01: worker prettier .cmd launches\n' +
      'not ok 2 - AF-R02: repair logic changes\n' +
      'ℹ pass 10\n' +
      'ℹ fail 2\n',
  };

  let nodeCalls = 0;
  const customCache = new Map();
  const spawnSync = (cmd, args) => {
    if (cmd === 'git') {
      if (args && args[0] === 'rev-parse') return { status: 0, stdout: baseSha + '\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }
    nodeCalls++;
    if (nodeCalls === 1) return workerOutput;
    return baseOutput;
  };

  const result = runHostBrainGate({ baseSha }, { spawnSync, baseCache: customCache });

  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.hostGateFailures.newFailures, []);
  assert.deepEqual(result.hostGateFailures.baselineFailures, [
    'AF-R01: worker prettier .cmd launches',
    'AF-R02: repair logic changes',
  ]);
  assert.equal(nodeCalls, 2);
  assert.ok(customCache.has(baseSha));
});

test('TASK-AI-142: (b) one extra failure -> HOST_GATE_FAILED listing it', () => {
  const baseSha = 'b'.repeat(40);
  const workerOutput = {
    status: 1,
    stdout:
      'not ok 1 - AF-R01: worker prettier .cmd launches\n' +
      'not ok 2 - AF-R02: repair logic changes\n' +
      'not ok 3 - worker introduced regression\n' +
      'ℹ pass 9\n' +
      'ℹ fail 3\n',
  };
  const baseOutput = {
    status: 1,
    stdout:
      'not ok 1 - AF-R01: worker prettier .cmd launches\n' +
      'not ok 2 - AF-R02: repair logic changes\n' +
      'ℹ pass 10\n' +
      'ℹ fail 2\n',
  };

  let nodeCalls = 0;
  const customCache = new Map();
  const spawnSync = (cmd, args) => {
    if (cmd === 'git') {
      if (args && args[0] === 'rev-parse') return { status: 0, stdout: baseSha + '\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }
    nodeCalls++;
    if (nodeCalls === 1) return workerOutput;
    return baseOutput;
  };

  const result = runHostBrainGate({ baseSha }, { spawnSync, baseCache: customCache });

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, ['worker introduced regression']);
  assert.deepEqual(result.hostGateFailures.newFailures, ['worker introduced regression']);
  assert.deepEqual(result.hostGateFailures.baselineFailures, [
    'AF-R01: worker prettier .cmd launches',
    'AF-R02: repair logic changes',
  ]);
  assert.equal(result.hostGateFailures[0], 'worker introduced regression');
  assert.equal(result.hostGateFailures.join(', '), 'worker introduced regression');
});

test('TASK-AI-142: (c) base run errors -> block', () => {
  const baseSha = 'c'.repeat(40);
  const workerOutput = {
    status: 1,
    stdout: 'not ok 1 - failing worker test\n' + 'ℹ pass 5\n' + 'ℹ fail 1\n',
  };

  let nodeCalls = 0;
  const customCache = new Map();
  const spawnSync = (cmd, args) => {
    if (cmd === 'git') {
      if (args && args[0] === 'rev-parse') return { status: 0, stdout: baseSha + '\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }
    nodeCalls++;
    if (nodeCalls === 1) return workerOutput;
    return {
      status: 1,
      error: new Error('Base test command execution crashed'),
      stdout: '',
      stderr: 'fatal runtime error',
    };
  };

  const result = runHostBrainGate({ baseSha }, { spawnSync, baseCache: customCache });

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, ['failing worker test']);
  assert.deepEqual(result.hostGateFailures.newFailures, ['failing worker test']);
  assert.deepEqual(result.hostGateFailures.baselineFailures, []);
  assert.equal(customCache.has(baseSha), false);
});

test('TASK-AI-142: (d) base result is cached per base SHA for the session', () => {
  const baseSha = 'd'.repeat(40);
  const workerOutput = {
    status: 1,
    stdout: 'not ok 1 - AF-R01: worker prettier .cmd launches\n' + 'ℹ pass 10\n' + 'ℹ fail 1\n',
  };
  const baseOutput = {
    status: 1,
    stdout: 'not ok 1 - AF-R01: worker prettier .cmd launches\n' + 'ℹ pass 10\n' + 'ℹ fail 1\n',
  };

  let baseRunCalls = 0;
  const customCache = new Map();
  const spawnSync = (cmd, args, opts) => {
    if (cmd === 'git') {
      if (args && args[0] === 'rev-parse') return { status: 0, stdout: baseSha + '\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }
    const isBase = opts && opts.cwd && String(opts.cwd).includes('wt');
    if (isBase) {
      baseRunCalls++;
      return baseOutput;
    }
    // Worker run call:
    return workerOutput;
  };

  // First run: evaluates base and caches it
  const result1 = runHostBrainGate({ baseSha }, { spawnSync, baseCache: customCache });
  assert.equal(result1.pass, true);
  assert.equal(baseRunCalls, 1);
  assert.ok(customCache.has(baseSha));

  // Second run: same base SHA should hit cache and NOT re-run base suite
  const result2 = runHostBrainGate({ baseSha }, { spawnSync, baseCache: customCache });
  assert.equal(result2.pass, true);
  assert.equal(baseRunCalls, 1);
  assert.deepEqual(result2.failures, []);
  assert.deepEqual(result2.hostGateFailures.newFailures, []);
  assert.deepEqual(result2.hostGateFailures.baselineFailures, [
    'AF-R01: worker prettier .cmd launches',
  ]);
});
