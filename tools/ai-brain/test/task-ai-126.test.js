'use strict';
const { test, describe, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const cp = require('child_process');
const orch = require('../orchestrate');

describe('TASK-AI-126', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('AL-R03: launcher flag gating and launch correctness', () => {
    mock.method(fs, 'mkdirSync', () => {});
    mock.method(fs, 'writeFileSync', () => {});
    let spawnArgs = [];
    mock.method(cp, 'spawnSync', (cmd, args, opts) => {
      spawnArgs.push(args);
      return { status: 0, stdout: 'ok', stderr: '' };
    });

    const job = {
      harness: 'autoclaw',
      model: 'zai/zai_auto',
      cwd: process.cwd(),
      prompt: 'dummy',
      sessionId: 's456',
    };

    const noLauncher = orch.resolveLauncher({ externalWorkers: '' }, null);
    assert.equal(noLauncher, null, 'must be null if missing launcher flag');

    const launcher = orch.resolveLauncher({ externalWorkers: 'autoclaw' }, null);
    const res = launcher(job);
    assert.equal(res.exitCode, 0);
  });
});
