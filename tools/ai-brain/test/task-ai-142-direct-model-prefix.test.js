'use strict';

/**
 * TASK-AI-142: opencode-direct isolated worker launcher prefixes bare model
 * id with providerId in launch args written to launch-args-*.json.
 *
 * Verifies:
 * 1. A direct source with a bare pinned model yields launch args --model <providerId>/<model>.
 * 2. An already-prefixed model on a direct source is left unchanged.
 * 3. A router model is left unchanged.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

function getLaunchPayload(model, sourceOpts = {}) {
  const isoMod = require('../isolation-launcher');
  const { getHarness } = require('../harness');
  const directAdapter = getHarness('opencode-direct');
  assert.ok(directAdapter);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-prefix-'));
  const fakeHostCwd = path.join(tmpDir, 'host');
  const fakeWorkerRoot = path.join(tmpDir, 'worker');
  fs.mkdirSync(fakeHostCwd, { recursive: true });
  fs.mkdirSync(fakeWorkerRoot, { recursive: true });
  fs.mkdirSync(path.join(fakeHostCwd, 'scripts/ai/isolation'), { recursive: true });

  const verdictFile = path.join(fakeHostCwd, 'verdict.json');
  fs.writeFileSync(
    verdictFile,
    JSON.stringify({
      verdict: 'CLOSED',
      worktree: fakeHostCwd,
      timestamp: Date.now() - 1000,
      policyHash: isoMod.getFolderHash(path.join(fakeHostCwd, 'scripts/ai/isolation')),
      sid: 'TEST-SID',
      details: {},
    })
  );

  const realSpawn = cp.spawnSync;
  const realTemp = process.env.TEMP;

  try {
    const tempShim = path.join(tmpDir, 'launch-temp');
    fs.mkdirSync(tempShim, { recursive: true });
    process.env.TEMP = tempShim;

    cp.spawnSync = (cmd, cargs, opts) => {
      if (cmd === 'git') {
        if (cargs && cargs[0] === 'clone') {
          fs.mkdirSync(path.join(cargs[cargs.length - 1], '.git', 'info'), { recursive: true });
        }
        if (cargs && cargs.includes('rev-parse')) {
          return { status: 0, stdout: '0123456789012345678901234567890123456789\n' };
        }
        return { status: 0 };
      }
      if (cmd === 'powershell.exe') {
        return { status: 0, stdout: '' };
      }
      return realSpawn(cmd, cargs, opts);
    };

    const runIso = isoMod.getIsolatedLauncher();
    const args = directAdapter.launch({
      isolatedWorker: true,
      model,
      cwd: fakeWorkerRoot,
      prompt: 'test prompt',
    });

    try {
      runIso(directAdapter, args, {
        cwd: fakeHostCwd,
        workerRoot: fakeWorkerRoot,
        verdictPath: verdictFile,
        getWorkerSid: () => 'TEST-SID',
        verifyBoundary: () => true,
        baseSha: '0123456789012345678901234567890123456789',
        workerTimeoutMs: 1000,
        ...sourceOpts,
      });
    } catch (_) {
      // Fake host powershell does not produce real launch result; files under test are inspected
    }

    const shipdeDir = path.join(fakeWorkerRoot, '.shipde');
    const argsFiles = fs
      .readdirSync(shipdeDir)
      .filter((f) => f.startsWith('launch-args-') && f.endsWith('.json'));
    assert.equal(argsFiles.length, 1, 'exactly one launch-args file must be written');

    const payload = JSON.parse(fs.readFileSync(path.join(shipdeDir, argsFiles[0]), 'utf8'));
    const configPath = path.join(fakeWorkerRoot, 'opencode.json');
    Object.defineProperty(payload, 'opencodeConfig', {
      value: fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : null,
    });
    return payload;
  } finally {
    cp.spawnSync = realSpawn;
    if (realTemp === undefined) {
      delete process.env.TEMP;
    } else {
      process.env.TEMP = realTemp;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('TASK-AI-142: direct model prefix in opencode launch args', () => {
  const directSource = {
    id: 'direct-provider-mock',
    opencodeProvider: 'opencode-provider-mock',
    endpoint: 'https://api.mock-direct.com/v1',
    credential: { env: 'MOCK_DIRECT_API_KEY' },
    kind: 'direct',
  };

  test('direct source with bare pinned model rewrites launch args --model to <providerId>/<model>', () => {
    process.env.MOCK_DIRECT_API_KEY = 'mock-key-value';
    try {
      const payload = getLaunchPayload('model-bare-alpha', {
        selectedSource: directSource,
      });
      const modelIdx = payload.indexOf('--model');
      assert.notEqual(modelIdx, -1, 'launch args must contain --model flag');
      assert.equal(
        payload[modelIdx + 1],
        'opencode-provider-mock/model-bare-alpha',
        'bare model must be prefixed with providerId/'
      );
    } finally {
      delete process.env.MOCK_DIRECT_API_KEY;
    }
  });

  test('direct source with already-prefixed model leaves launch args --model unchanged', () => {
    process.env.MOCK_DIRECT_API_KEY = 'mock-key-value';
    try {
      const payload = getLaunchPayload('opencode-provider-mock/model-bare-alpha', {
        selectedSource: directSource,
      });
      const modelIdx = payload.indexOf('--model');
      assert.notEqual(modelIdx, -1, 'launch args must contain --model flag');
      assert.equal(
        payload[modelIdx + 1],
        'opencode-provider-mock/model-bare-alpha',
        'already-prefixed model must remain unchanged'
      );
    } finally {
      delete process.env.MOCK_DIRECT_API_KEY;
    }
  });

  test('direct source model id containing a slash is qualified with the only configured provider', () => {
    // A direct source's worker config registers exactly one provider (providerId) whose models are
    // keyed by the source's own model id, which may itself contain '/' (e.g. dahl's
    // "MiniMaxAI/MiniMax-M2.7"). opencode splits --model at the first '/', so the id must be
    // qualified with providerId even though it already contains a slash.
    process.env.MOCK_DIRECT_API_KEY = 'mock-key-value';
    try {
      const payload = getLaunchPayload('MiniMaxAI/MiniMax-M2.7', {
        selectedSource: directSource,
      });
      const modelIdx = payload.indexOf('--model');
      assert.equal(payload[modelIdx + 1], 'opencode-provider-mock/MiniMaxAI/MiniMax-M2.7');
      const providers = Object.keys(payload.opencodeConfig.provider);
      assert.deepEqual(providers, ['opencode-provider-mock'], 'the worker config has one provider');
      assert.ok(
        payload.opencodeConfig.provider['opencode-provider-mock'].models['MiniMaxAI/MiniMax-M2.7'],
        'the provider resolves the remainder after the first slash'
      );
    } finally {
      delete process.env.MOCK_DIRECT_API_KEY;
    }
  });

  test('router source leaves launch args --model unchanged', () => {
    const payload = getLaunchPayload('ninerouter/ag/gemini-3.1-pro-low');
    const modelIdx = payload.indexOf('--model');
    assert.notEqual(modelIdx, -1, 'launch args must contain --model flag');
    assert.equal(
      payload[modelIdx + 1],
      'ninerouter/ag/gemini-3.1-pro-low',
      'router model must remain unchanged'
    );
  });
});
