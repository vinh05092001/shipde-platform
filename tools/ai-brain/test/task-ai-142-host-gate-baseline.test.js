'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
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
    const isBase = opts && opts.cwd && String(opts.cwd).includes('host-gate-base-');
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

test('TASK-AI-142: (e) worker suite non-zero exit with zero parsed names -> block UNPARSED_FAILURE without base run', () => {
  const baseSha = 'e'.repeat(40);
  const workerOutput = {
    status: 1,
    stdout: 'Fatal error: startup crash or syntax error\nProcess terminated unexpectedly\n',
    stderr: 'Error: Cannot find module /some/path\n',
  };

  const spawnCalls = [];
  const customCache = new Map();
  const spawnSync = (cmd, args) => {
    spawnCalls.push({ cmd, args });
    return workerOutput;
  };

  const result = runHostBrainGate({ baseSha }, { spawnSync, baseCache: customCache });

  assert.equal(result.pass, false);
  assert.equal(result.reason, 'UNPARSED_FAILURE');
  assert.deepEqual(result.failures, ['UNPARSED_FAILURE']);
  assert.deepEqual(result.hostGateFailures.newFailures, ['UNPARSED_FAILURE']);
  assert.deepEqual(result.hostGateFailures.baselineFailures, []);
  // Only the suite itself runs (the clean HEAD checkout is git, not a suite run).
  assert.equal(spawnCalls.filter((c) => c.cmd !== 'git').length, 1);
  assert.equal(customCache.has(baseSha), false);
});

test('TASK-AI-142: (f) base run cleans up worktree and temp directory', () => {
  const baseSha = 'f'.repeat(40);
  const workerOutput = {
    status: 1,
    stdout: 'not ok 1 - AF-R01: worker prettier .cmd launches\nℹ pass 10\nℹ fail 1\n',
  };
  const baseOutput = {
    status: 1,
    stdout: 'not ok 1 - AF-R01: worker prettier .cmd launches\nℹ pass 10\nℹ fail 1\n',
  };

  const gitCalls = [];
  const rmSyncCalls = [];
  const customFs = {
    mkdtempSync: () => {
      const dir = path.join(os.tmpdir(), 'test-host-gate-clean-' + Date.now());
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
    rmSync: (dir, opts) => {
      rmSyncCalls.push({ dir, opts });
      fs.rmSync(dir, opts);
    },
  };

  let nodeCalls = 0;
  const spawnSync = (cmd, args) => {
    if (cmd === 'git') {
      gitCalls.push({ args: [...args] });
      if (args && args[0] === 'rev-parse') return { status: 0, stdout: baseSha + '\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }
    nodeCalls++;
    if (nodeCalls === 1) return workerOutput;
    return baseOutput;
  };

  const result = runHostBrainGate({ baseSha }, { spawnSync, baseCache: new Map(), fs: customFs });

  assert.equal(result.pass, true);
  const removeCall = gitCalls.find(
    (c) => c.args[0] === 'worktree' && c.args[1] === 'remove' && c.args[2] === '--force'
  );
  assert.ok(removeCall, 'git worktree remove --force must be called');
  assert.ok(rmSyncCalls.length > 0, 'fs.rmSync must be called');
  assert.equal(rmSyncCalls[0].opts.recursive, true);
  assert.equal(rmSyncCalls[0].opts.force, true);
  assert.deepEqual(result.cleanupErrors, []);
  assert.equal(result.cleanupError, null);
});

test('TASK-AI-142: (g) cleanup failure is recorded, not swallowed silently', () => {
  const baseSha = 'g'.repeat(40);
  const workerOutput = {
    status: 1,
    stdout: 'not ok 1 - AF-R01: worker prettier .cmd launches\nℹ pass 10\nℹ fail 1\n',
  };
  const baseOutput = {
    status: 1,
    stdout: 'not ok 1 - AF-R01: worker prettier .cmd launches\nℹ pass 10\nℹ fail 1\n',
  };

  let nodeCalls = 0;
  const reportedErrors = [];
  const spawnSync = (cmd, args) => {
    if (cmd === 'git') {
      if (args && args[0] === 'rev-parse') return { status: 0, stdout: baseSha + '\n', stderr: '' };
      if (args && args[0] === 'worktree' && args[1] === 'remove') {
        return { status: 1, stdout: '', stderr: 'fatal: failed to remove worktree lock held' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    nodeCalls++;
    if (nodeCalls === 1) return workerOutput;
    return baseOutput;
  };

  const customFs = {
    mkdtempSync: () => {
      const dir = path.join(os.tmpdir(), 'test-host-gate-fail-' + Date.now());
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
    rmSync: () => {
      throw new Error('EPERM: operation not permitted, unlink');
    },
  };

  const result = runHostBrainGate(
    { baseSha },
    {
      spawnSync,
      baseCache: new Map(),
      fs: customFs,
      onCleanupError: (err) => reportedErrors.push(err.message || String(err)),
    }
  );

  assert.equal(result.pass, true);
  assert.ok(result.cleanupErrors.length >= 2, 'both worktree remove and rmSync failures recorded');
  assert.match(result.cleanupErrors[0], /failed to remove worktree lock held/);
  assert.match(result.cleanupErrors[1], /EPERM/);
  assert.match(result.cleanupError, /failed to remove worktree lock held/);
  assert.equal(reportedErrors.length >= 2, true);
  assert.match(reportedErrors[0], /failed to remove worktree lock held/);
  assert.match(reportedErrors[1], /EPERM/);
});

test('TASK-AI-142: (h) if origin/main cannot be resolved, stay strict instead of falling back to local main', () => {
  const workerOutput = {
    status: 1,
    stdout: 'not ok 1 - failing worker test\nℹ pass 5\nℹ fail 1\n',
  };

  const gitRevParseCalls = [];
  const spawnSync = (cmd, args) => {
    if (cmd === 'git') {
      if (args && args[0] === 'rev-parse') {
        gitRevParseCalls.push(args[2]);
        return { status: 1, stdout: '', stderr: 'fatal: Needed a single revision' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    return workerOutput;
  };

  const result = runHostBrainGate(
    { workItemId: 'TASK-AI-142' },
    { spawnSync, baseCache: new Map() }
  );

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, ['failing worker test']);
  assert.ok(gitRevParseCalls.includes('origin/main^{commit}'));
  assert.ok(!gitRevParseCalls.includes('main^{commit}'));
});

test('TASK-AI-142: baseline runs at the merge-base of HEAD and the ref, not the moved ref', () => {
  const shaA = 'a'.repeat(40);
  const shaB = 'b'.repeat(40);
  const addedAt = [];
  let baselineDir = null;
  const customCache = new Map();
  const spawnSync = (cmd, args, opts = {}) => {
    if (cmd === 'git') {
      if (args[0] === 'rev-parse') return { status: 0, stdout: shaB + '\n', stderr: '' };
      if (args[0] === 'merge-base') return { status: 0, stdout: shaA + '\n', stderr: '' };
      if (args[0] === 'worktree' && args[1] === 'add') {
        // The suite also runs on a clean checkout of HEAD; only the baseline matters here.
        if (args[args.length - 1] !== 'HEAD') {
          baselineDir = args[args.length - 2];
          addedAt.push(args[args.length - 1]);
        }
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    const isBaseline = baselineDir !== null && opts.cwd === baselineDir;
    // The env-sensitive test fails in the writer tree and at A, but passes at the moved B.
    if (isBaseline && addedAt[0] === shaB) return { status: 0, stdout: 'ℹ pass 6\nℹ fail 0\n' };
    return { status: 1, stdout: 'not ok 1 - env sensitive test\nℹ pass 5\nℹ fail 1\n' };
  };

  const result = runHostBrainGate({ workItemId: 'X' }, { spawnSync, baseCache: customCache });

  assert.deepEqual(addedAt, [shaA]);
  assert.deepEqual(result.hostGateFailures.newFailures, []);
  assert.ok(customCache.has(shaA));
  assert.ok(!customCache.has(shaB));
});
