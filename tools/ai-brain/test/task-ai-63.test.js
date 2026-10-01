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
      usageFile: '/tmp/worktree/hermes-usage.json',
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

  test('5 launch emits --usage-file, the only channel carrying the durable id', () => {
    // Evidence: logs/night/hermes-durable-evidence.txt — -z stdout is only the
    // final response text ("no session_id line"); the session id is written to
    // the --usage-file JSON report.
    const adapter = getHarness('hermes');
    const base = { candidateKey: 'mock-key', model: 'up-a/model', prompt: 'hello' };

    const withReport = adapter.launch({ ...base, usageFile: '/tmp/usage.json' });
    const idx = withReport.indexOf('--usage-file');
    assert.ok(idx !== -1, 'launch must name the usage report when given a path');
    assert.equal(withReport[idx + 1], '/tmp/usage.json');

    const without = adapter.launch(base);
    assert.equal(
      without.includes('--usage-file'),
      false,
      'no report path, no flag: a launch without the channel must not pretend to have it'
    );
  });

  test('6 sessionIdFrom parses exactly the captured usage-file session_id', () => {
    // Fixture captured verbatim from a successful real run of
    // `hermes -m vinh --safe-mode -z "reply OK" --usage-file …` on v0.21.4;
    // `hermes --resume 20260929_063508_c80aeb -z …` then continued that exact
    // session (evidence: logs/night/hermes-durable-evidence.txt).
    const fixture = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'fixtures/hermes-usage-file-v0.21.4.json'), 'utf8')
    );
    const adapter = getHarness('hermes');
    assert.equal(adapter.sessionIdFrom(fixture), '20260929_063508_c80aeb');
  });

  test('7 sessionIdFrom never invents a handle the CLI did not emit', () => {
    const adapter = getHarness('hermes');
    // A failed run writes the report with a null session_id; null must stay
    // null so the executor fails HARNESS_NO_SESSION_ID instead of resuming a
    // session that cannot be named.
    assert.equal(adapter.sessionIdFrom({ session_id: null, failed: true }), null);
    assert.equal(adapter.sessionIdFrom({}), null);
    assert.equal(adapter.sessionIdFrom(null), null);
    assert.equal(adapter.sessionIdFrom({ session_id: '   ' }), null);
    // Removed guesses: none of these fields exist in any observed v0.21.4
    // output, so they must not be parsed as a handle.
    assert.equal(adapter.sessionIdFrom({ handle: { id: 'x' } }), null);
    assert.equal(adapter.sessionIdFrom({ session: { id: 'x' } }), null);
    assert.equal(adapter.sessionIdFrom({ pid: 1234 }), null);
  });

  test('8 executableFor on Windows spawns native .exe targets directly without node wrapping', () => {
    // Layout with %~dp0%
    const optsTilde = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\opencode.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.exe',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\opencode.cmd') {
          return '@echo off\r\n"%_prog%" "%~dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe" %*\r\n';
        }
        return '';
      },
    };
    const exeTilde = executableFor('opencode', optsTilde);
    assert.equal(exeTilde.file, 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.exe');
    assert.deepEqual(exeTilde.prefixArgs, []);

    // Layout with %dp0%
    const optsPlain = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\opencode.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.exe',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\opencode.cmd') {
          return '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe" %*\r\n';
        }
        return '';
      },
    };
    const exePlain = executableFor('opencode', optsPlain);
    assert.equal(exePlain.file, 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.exe');
    assert.deepEqual(exePlain.prefixArgs, []);
  });

  test('9 executableFor on Windows spawns native .com targets directly (case-insensitive)', () => {
    const opts = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\native-tool.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\native-tool\\bin\\tool.COM',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\native-tool.cmd') {
          return '"%dp0%\\node_modules\\native-tool\\bin\\tool.COM" %*';
        }
        return '';
      },
    };
    const exe = executableFor('native-tool', opts);
    assert.equal(exe.file, 'C:\\fake\\bin\\node_modules\\native-tool\\bin\\tool.COM');
    assert.deepEqual(exe.prefixArgs, []);
  });

  test('10 executableFor on Windows wraps .js launchers and extension-less JS targets with node', () => {
    // Opencode with .js launcher layout using %~dp0%
    const jsOptsTilde = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\opencode.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.js',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\opencode.cmd') {
          return '@echo off\r\n"%_prog%" "%~dp0%\\node_modules\\opencode-ai\\bin\\opencode.js" %*\r\n';
        }
        return '';
      },
    };
    const jsExeTilde = executableFor('opencode', jsOptsTilde);
    assert.equal(jsExeTilde.file, 'C:\\node\\node.exe');
    assert.deepEqual(jsExeTilde.prefixArgs, [
      'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.js',
    ]);

    // Opencode with .js launcher layout using %dp0%
    const jsOptsPlain = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\opencode.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.js',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\opencode.cmd') {
          return '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\opencode-ai\\bin\\opencode.js" %*\r\n';
        }
        return '';
      },
    };
    const jsExePlain = executableFor('opencode', jsOptsPlain);
    assert.equal(jsExePlain.file, 'C:\\node\\node.exe');
    assert.deepEqual(jsExePlain.prefixArgs, [
      'C:\\fake\\bin\\node_modules\\opencode-ai\\bin\\opencode.js',
    ]);

    // Extension-less script target
    const bareOpts = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\cli-tool.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\cli-tool\\bin\\cli',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\cli-tool.cmd') {
          return '"%dp0%\\node_modules\\cli-tool\\bin\\cli" %*';
        }
        return '';
      },
    };
    const bareExe = executableFor('cli-tool', bareOpts);
    assert.equal(bareExe.file, 'C:\\node\\node.exe');
    assert.deepEqual(bareExe.prefixArgs, ['C:\\fake\\bin\\node_modules\\cli-tool\\bin\\cli']);

    // .cjs and .mjs script targets
    const cjsOpts = {
      platform: 'win32',
      path: 'C:\\fake\\bin',
      nodePath: 'C:\\node\\node.exe',
      fileExists: (p) =>
        p === 'C:\\fake\\bin\\cjs-tool.cmd' ||
        p === 'C:\\fake\\bin\\node_modules\\cjs-tool\\bin\\cli.cjs',
      readFile: (p) => {
        if (p === 'C:\\fake\\bin\\cjs-tool.cmd') {
          return '"%dp0%\\node_modules\\cjs-tool\\bin\\cli.cjs" %*';
        }
        return '';
      },
    };
    const cjsExe = executableFor('cjs-tool', cjsOpts);
    assert.equal(cjsExe.file, 'C:\\node\\node.exe');
    assert.deepEqual(cjsExe.prefixArgs, ['C:\\fake\\bin\\node_modules\\cjs-tool\\bin\\cli.cjs']);
  });
});
