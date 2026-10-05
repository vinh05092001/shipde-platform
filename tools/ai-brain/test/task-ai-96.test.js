'use strict';

/**
 * Ship Dễ — TASK-AI-96: the isolated opencode-direct launcher sends 9Router
 * the model id 9Router knows.
 *
 * Live proof 12 (2026-10-05): every launch failed with alias_mismatch because
 * for --model 'cl/cline-free/mimo-v2.6-flash' the generated opencode.json
 * mapped the short model to id 'cline-free/mimo-v2.6-flash'; 9Router only
 * knows 'cl/cline-free/mimo-v2.6-flash' and answered "Model not found".
 * Only the router's own prefix ('ninerouter/') may be stripped.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

function generatedConfigFor(model) {
  const isoMod = require('../isolation-launcher');
  const { getHarness } = require('../harness');
  const directAdapter = getHarness('opencode-direct');
  assert.ok(directAdapter);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-96-'));
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
  try {
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
      if (cmd === 'powershell.exe') return { status: 0, stdout: '' };
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
      });
    } catch (_) {
      // The fake host never writes a launch result; only the config matters here.
    }
    const cfgFile = path.join(fakeWorkerRoot, 'opencode.json');
    assert.ok(fs.existsSync(cfgFile), 'opencode.json must exist');
    return {
      cfg: JSON.parse(fs.readFileSync(cfgFile, 'utf8')),
      modelArg: args[args.indexOf('--model') + 1],
    };
  } finally {
    cp.spawnSync = realSpawn;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function wireIds(cfg) {
  const ids = [];
  for (const p of Object.values(cfg.provider || {})) {
    for (const m of Object.values(p.models || {})) ids.push(m.id);
  }
  return ids;
}

describe('TASK-AI-96: launcher model ids match 9Router ids', () => {
  test('an upstream-prefixed model (cl/...) is sent to 9Router whole', () => {
    const { cfg, modelArg } = generatedConfigFor('cl/cline-free/mimo-v2.6-flash');
    assert.equal(modelArg, 'cl/cline-free/mimo-v2.6-flash');
    const ids = wireIds(cfg);
    assert.ok(ids.length > 0);
    for (const id of ids) {
      assert.equal(
        id,
        'cl/cline-free/mimo-v2.6-flash',
        'every model entry must carry the full 9Router id'
      );
    }
  });

  test('an upstream-prefixed model (xmtp/...) is sent to 9Router whole', () => {
    const { cfg } = generatedConfigFor('xmtp/mimo-v2.6-pro');
    for (const id of wireIds(cfg)) assert.equal(id, 'xmtp/mimo-v2.6-pro');
  });

  test('the router prefix (ninerouter/...) is still stripped', () => {
    const { cfg } = generatedConfigFor('ninerouter/ag/gemini-3.1-pro-low');
    const short = cfg.provider.ninerouter.models['ag/gemini-3.1-pro-low'];
    assert.ok(short, 'short entry exists');
    assert.equal(short.id, 'ag/gemini-3.1-pro-low');
  });
});
