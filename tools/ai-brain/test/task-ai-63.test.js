'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getHarness, executableFor, runHarness } = require('../harness');

describe('TASK-AI-63 Hermes CLI contract', () => {
  test('1 adapter emits only documented options', () => {
    const correctHelpPath = path.join(__dirname, 'fixtures/hermes-help-v0.21.4.txt');
    const helpText = fs.readFileSync(correctHelpPath, 'utf8');
    const helpOptions = new Set();
    const regex = /(?:^|\s)(-[a-zA-Z]|--[a-zA-Z0-9-]+)/gm;
    let match;
    while ((match = regex.exec(helpText)) !== null) {
      helpOptions.add(match[1]);
    }

    const adapter = getHarness('hermes');
    const launchArgs = adapter.launch({
      candidateKey: 'mock-key',
      model: 'up-a/model',
      provider: 'up-a',
      cwd: '/tmp/worktree',
      prompt: 'hello',
    });

    for (let i = 0; i < launchArgs.length; i++) {
      const arg = launchArgs[i];
      if (arg.startsWith('-')) {
        assert.ok(helpOptions.has(arg), `Option ${arg} must exist in hermes-help.txt`);
      } else {
        assert.notEqual(arg, 'run', "The 'run' subcommand does not exist in hermes");
      }
    }

    const resumeArgs = adapter.resume('session-123', 'continue', {
      candidateKey: 'mock-key',
      model: 'up-a/model',
      provider: 'up-a',
      cwd: '/tmp/worktree',
    });

    for (let i = 0; i < resumeArgs.length; i++) {
      const arg = resumeArgs[i];
      if (arg.startsWith('-')) {
        assert.ok(helpOptions.has(arg), `Option ${arg} must exist in hermes-help.txt`);
      } else {
        assert.notEqual(
          arg,
          'resume',
          "The 'resume' positional subcommand is for 'hermes pause', use --resume"
        );
      }
    }

    if (adapter.inspect) {
      const inspectArgs = adapter.inspect('session-123');
      for (let i = 0; i < inspectArgs.length; i++) {
        const arg = inspectArgs[i];
        if (arg.startsWith('-')) {
          assert.ok(helpOptions.has(arg), `Option ${arg} must exist in hermes-help.txt`);
        }
      }
    }
  });

  test('2 resume uses a real handle via --resume', () => {
    const adapter = getHarness('hermes');
    const resumeArgs = adapter.resume('session-123', 'continue', {
      candidateKey: 'mock-key',
      model: 'up-a/model',
    });
    const resumeIndex = resumeArgs.indexOf('--resume');
    assert.ok(resumeIndex !== -1, 'Must use --resume option');
    assert.equal(
      resumeArgs[resumeIndex + 1],
      'session-123',
      'Must pass the session id to --resume'
    );
  });

  test('3 stop kills the whole process tree', () => {
    const adapter = getHarness('hermes');
    const stopJob = adapter.stop('456');
    assert.ok(stopJob.killTree);
    assert.equal(stopJob.killTree, 456);
  });

  test('4 executableFor on Windows uses npm shim without shell injection', () => {
    const opts = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\hermes.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\hermes\\bin\\hermes.js',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\hermes.cmd') {
          return `"%dp0%\\node.exe"  "%dp0%\\node_modules\\hermes\\bin\\hermes.js" %*`;
        }
        return '';
      },
    };
    const exe = executableFor('hermes', opts);
    assert.equal(exe.file, 'C:\\node\\node.exe');
    assert.deepEqual(exe.prefixArgs, ['C:\\fake\\bin\\node_modules\\hermes\\bin\\hermes.js']);
  });
});
