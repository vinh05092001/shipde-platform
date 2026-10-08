'use strict';

/**
 * Ship Dễ — TASK-AI-116: isolated opencode-direct launches can use a direct
 * model source, not only 9Router.
 *
 * SUPERVISOR FIX: The source is resolved from the candidate gateway field, not
 * the model prefix, because 9Router model IDs can have upstream prefixes that
 * equal direct source IDs (ambiguous).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

/**
 * Drives the real launcher for one opencode-direct launch with stubbed
 * spawnSync and a temp worker root, capturing the generated opencode.json
 * and run-target.ps1.
 */
function runDirectLaunch(model, opts) {
  const isoMod = require('../isolation-launcher');
  const { getHarness } = require('../harness');
  const directAdapter = getHarness('opencode-direct');
  assert.ok(directAdapter);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-116-'));
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
  let capturedScript = null;
  let thrownError = null;
  const fakeEnv = opts && opts.fakeEnv ? { ...opts.fakeEnv } : {};
  const candidateKey = opts && opts.candidateKey !== undefined ? opts.candidateKey : null;

  try {
    const tempShim = path.join(tmpDir, 'launch-temp');
    fs.mkdirSync(tempShim, { recursive: true });
    process.env.TEMP = tempShim;

    // Add fake credentials to process.env so the launcher can read them
    for (const [key, value] of Object.entries(fakeEnv)) {
      process.env[key] = value;
    }

    cp.spawnSync = (cmd, cargs, copts) => {
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
        const fileIdx = cargs ? cargs.indexOf('-File') : -1;
        if (fileIdx !== -1 && cargs[fileIdx + 1] && fs.existsSync(cargs[fileIdx + 1])) {
          capturedScript = fs.readFileSync(cargs[fileIdx + 1], 'utf8');
        }
        return { status: 0, stdout: '' };
      }
      return realSpawn(cmd, cargs, copts);
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
        candidateKey: candidateKey,
      });
    } catch (err) {
      thrownError = err;
    }

    const cfgFile = path.join(fakeWorkerRoot, 'opencode.json');
    let cfg = null;
    if (fs.existsSync(cfgFile)) {
      cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    }

    return {
      cfg,
      capturedScript,
      thrownError,
      args,
    };
  } finally {
    cp.spawnSync = realSpawn;
    if (realTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = realTemp;
    for (const key of Object.keys(fakeEnv)) {
      delete process.env[key];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('TASK-AI-116: isolated launches with direct model sources', () => {
  test('gateway 9router with model xmtp/mimo-v2.6-pro uses 9router config, wire id xmtp/...', () => {
    const { cfg, thrownError } = runDirectLaunch('xmtp/mimo-v2.6-pro', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
      candidateKey: 'harness::accessPath::9router::upstream::*:::xmtp/mimo-v2.6-pro',
    });

    assert.ok(!thrownError, 'no error for 9router with upstream prefix');
    assert.ok(cfg, 'opencode.json exists');
    assert.ok(cfg.provider.xmtp, 'provider is xmtp (from model prefix)');
    assert.equal(cfg.provider.xmtp.options.baseURL, 'http://127.0.0.1:20128/v1');
    assert.equal(cfg.provider.xmtp.options.apiKey, '{env:NINEROUTER_API_KEY}');
    // Upstream prefix sent whole to 9router (TASK-AI-96)
    assert.ok(cfg.provider.xmtp.models['xmtp/mimo-v2.6-pro']);
    assert.equal(cfg.provider.xmtp.models['xmtp/mimo-v2.6-pro'].id, 'xmtp/mimo-v2.6-pro');
    // Short key mapping for opencode resolution (origin/main compatibility)
    assert.ok(cfg.provider.xmtp.models['mimo-v2.6-pro'], 'short key exists');
    assert.equal(
      cfg.provider.xmtp.models['mimo-v2.6-pro'].id,
      'xmtp/mimo-v2.6-pro',
      'short key has full wire id'
    );
  });

  test('gateway inception with model inception/mercury-2.5 uses inception endpoint, id mercury-2.5, env INCEPTION_API_KEY only', () => {
    const { cfg, thrownError, capturedScript } = runDirectLaunch('inception/mercury-2.5', {
      fakeEnv: { INCEPTION_API_KEY: 'test-not-a-key-inception' },
      candidateKey: 'harness::accessPath::inception::upstream::*:::inception/mercury-2.5',
    });

    assert.ok(!thrownError, 'no error thrown for inception model');
    assert.ok(cfg, 'opencode.json exists');
    assert.ok(cfg.provider.inception, 'provider is inception');
    assert.equal(cfg.provider.inception.options.baseURL, 'https://api.inceptionlabs.ai/v1');
    assert.equal(cfg.provider.inception.options.apiKey, '{env:INCEPTION_API_KEY}');
    assert.ok(cfg.provider.inception.models['mercury-2.5'], 'model mapped without prefix');
    assert.equal(cfg.provider.inception.models['mercury-2.5'].id, 'mercury-2.5');

    assert.ok(capturedScript, 'run-target.ps1 captured');
    assert.match(capturedScript, /INCEPTION_API_KEY/, 'INCEPTION_API_KEY is in allowlist');
    assert.ok(
      !capturedScript.includes('NINEROUTER_API_KEY'),
      'NINEROUTER_API_KEY not in allowlist for direct source'
    );
  });

  test('gateway 9router with model inception/mercury-2.5 uses 9router, NOT direct inception', () => {
    const { cfg, thrownError } = runDirectLaunch('inception/mercury-2.5', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
      candidateKey: 'harness::accessPath::9router::upstream::*:::inception/mercury-2.5',
    });

    assert.ok(!thrownError, 'no error for 9router');
    assert.ok(cfg, 'opencode.json exists');
    // When gateway is 9router, use 9router even if model has a direct source prefix
    assert.ok(cfg.provider.inception, 'provider is inception (from model prefix)');
    assert.equal(cfg.provider.inception.options.baseURL, 'http://127.0.0.1:20128/v1');
    assert.equal(cfg.provider.inception.options.apiKey, '{env:NINEROUTER_API_KEY}');
  });

  test('unknown gateway fails with OPENCODE_DIRECT_SOURCE_UNKNOWN', () => {
    const { thrownError } = runDirectLaunch('some-model', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
      candidateKey: 'harness::accessPath::unknown-gateway::upstream::*:::some-model',
    });

    assert.ok(thrownError, 'error thrown for unknown gateway');
    assert.match(thrownError.message, /OPENCODE_DIRECT_SOURCE_UNKNOWN/);
    assert.match(thrownError.message, /unknown-gateway/);
  });

  test('no gateway (legacy) uses 9router unchanged', () => {
    const { cfg, thrownError } = runDirectLaunch('ninerouter/ag/gemini-3.1-pro-low', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
      candidateKey: null,
    });

    assert.ok(!thrownError, 'no error for legacy (no gateway)');
    assert.ok(cfg, 'opencode.json exists');
    assert.ok(cfg.provider.ninerouter, 'provider is ninerouter');
    assert.equal(cfg.provider.ninerouter.options.baseURL, 'http://127.0.0.1:20128/v1');
    assert.equal(cfg.provider.ninerouter.options.apiKey, '{env:NINEROUTER_API_KEY}');
    assert.ok(cfg.provider.ninerouter.models['ag/gemini-3.1-pro-low'], 'short model exists');
    assert.equal(
      cfg.provider.ninerouter.models['ag/gemini-3.1-pro-low'].id,
      'ag/gemini-3.1-pro-low',
      'router prefix is stripped'
    );
  });

  test('gateway 9router with ninerouter/ model strips the router prefix', () => {
    const { cfg, thrownError } = runDirectLaunch('ninerouter/ag/gemini-3.1-pro-low', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-not-a-key-9router' },
      candidateKey: 'harness::accessPath::9router::upstream::*:::ninerouter/ag/gemini-3.1-pro-low',
    });

    assert.ok(!thrownError, 'no error thrown for 9router model');
    assert.ok(cfg, 'opencode.json exists');
    assert.ok(cfg.provider.ninerouter, 'provider is ninerouter');
    assert.equal(cfg.provider.ninerouter.options.baseURL, 'http://127.0.0.1:20128/v1');
    assert.equal(cfg.provider.ninerouter.options.apiKey, '{env:NINEROUTER_API_KEY}');
    assert.ok(cfg.provider.ninerouter.models['ag/gemini-3.1-pro-low'], 'short model exists');
    assert.equal(
      cfg.provider.ninerouter.models['ag/gemini-3.1-pro-low'].id,
      'ag/gemini-3.1-pro-low',
      'router prefix is stripped'
    );
  });

  test('source without endpoint fails with OPENCODE_DIRECT_SOURCE_UNSUPPORTED', () => {
    const { thrownError } = runDirectLaunch('some-model', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
      candidateKey: 'harness::accessPath::codex::upstream::*:::some-model',
    });

    assert.ok(thrownError, 'error thrown for source without endpoint');
    assert.match(thrownError.message, /OPENCODE_DIRECT_SOURCE_UNSUPPORTED/);
    assert.match(thrownError.message, /codex/);
  });

  test('source without credential.env fails with OPENCODE_DIRECT_SOURCE_UNSUPPORTED', () => {
    const { thrownError } = runDirectLaunch('model-name', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
      candidateKey: 'harness::accessPath::paseo::upstream::*:::model-name',
    });

    assert.ok(thrownError, 'error thrown for source without credential.env');
    assert.match(thrownError.message, /OPENCODE_DIRECT_SOURCE_UNSUPPORTED/);
    assert.match(thrownError.message, /paseo/);
  });

  test('direct source model id sent WITHOUT the gateway prefix', () => {
    const { cfg } = runDirectLaunch('regolo/qwen-2.5-coder-32b', {
      fakeEnv: { REGOLO_API_KEY: 'test-not-a-key-regolo' },
      candidateKey: 'harness::accessPath::regolo::upstream::*:::regolo/qwen-2.5-coder-32b',
    });

    assert.ok(cfg.provider.regolo.models['regolo/qwen-2.5-coder-32b'], 'full model entry exists');
    assert.ok(cfg.provider.regolo.models['qwen-2.5-coder-32b'], 'short model entry exists');
    assert.equal(cfg.provider.regolo.models['qwen-2.5-coder-32b'].id, 'qwen-2.5-coder-32b');
  });

  test('worker env allowlist adds ONLY the selected source credential', () => {
    const { capturedScript } = runDirectLaunch('cohere/command-r-plus', {
      fakeEnv: { COHERE_API_KEY: 'test-not-a-key-cohere' },
      candidateKey: 'harness::accessPath::cohere::upstream::*:::cohere/command-r-plus',
    });

    assert.ok(capturedScript, 'run-target.ps1 captured');
    assert.match(capturedScript, /COHERE_API_KEY/, 'COHERE_API_KEY is in allowlist');
    assert.ok(
      !capturedScript.includes('NINEROUTER_API_KEY'),
      'NINEROUTER_API_KEY not in allowlist for non-9router source'
    );
    assert.ok(
      !capturedScript.includes('INCEPTION_API_KEY'),
      'other source credentials not in allowlist'
    );
  });

  test('9router case still adds only NINEROUTER_API_KEY', () => {
    const { capturedScript } = runDirectLaunch('ninerouter/ag/gemini-3.1-pro-low', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-not-a-key-9router' },
      candidateKey: 'harness::accessPath::9router::upstream::*:::ninerouter/ag/gemini-3.1-pro-low',
    });

    assert.ok(capturedScript, 'run-target.ps1 captured');
    assert.match(capturedScript, /NINEROUTER_API_KEY/, 'NINEROUTER_API_KEY is in allowlist');
    assert.ok(
      !capturedScript.includes('INCEPTION_API_KEY'),
      'direct source credentials not in 9router allowlist'
    );
  });

  test('missing env var fails with OPENCODE_DIRECT_CREDENTIAL_MISSING before spawn', () => {
    const realValue = process.env.BASETEN_API_KEY;
    delete process.env.BASETEN_API_KEY;
    try {
      const { thrownError } = runDirectLaunch('baseten/llama-3.1-70b', {
        fakeEnv: {},
        candidateKey: 'harness::accessPath::baseten::upstream::*:::baseten/llama-3.1-70b',
      });

      assert.ok(thrownError, 'error thrown for missing credential');
      assert.match(thrownError.message, /OPENCODE_DIRECT_CREDENTIAL_MISSING/);
      assert.match(thrownError.message, /BASETEN_API_KEY/);
    } finally {
      if (realValue !== undefined) process.env.BASETEN_API_KEY = realValue;
    }
  });

  test('credential VALUE never appears in opencode.json or run-target.ps1', () => {
    const fakeCredential = 'SECRET-test-credential-value-12345';
    const { cfg, capturedScript } = runDirectLaunch('thb/gpt-4o', {
      fakeEnv: { TOKENHARBOR_API_KEY: fakeCredential },
      candidateKey: 'harness::accessPath::thb::upstream::*:::thb/gpt-4o',
    });

    assert.ok(cfg, 'opencode.json exists');
    const cfgStr = JSON.stringify(cfg);
    assert.ok(
      !cfgStr.includes(fakeCredential),
      'credential VALUE must not appear in opencode.json'
    );
    assert.match(cfgStr, /\{env:TOKENHARBOR_API_KEY\}/, 'credential placeholder is present');

    assert.ok(capturedScript, 'run-target.ps1 captured');
    assert.ok(
      !capturedScript.includes(fakeCredential),
      'credential VALUE must not appear in run-target.ps1'
    );
  });

  test('http://127.0.0.1 endpoint is allowed', () => {
    const { cfg, thrownError } = runDirectLaunch('ninerouter/test-model', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
      candidateKey: 'harness::accessPath::9router::upstream::*:::ninerouter/test-model',
    });

    assert.ok(!thrownError, 'no error for 127.0.0.1 endpoint');
    assert.ok(cfg, 'opencode.json exists');
    assert.equal(cfg.provider.ninerouter.options.baseURL, 'http://127.0.0.1:20128/v1');
  });

  test('direct source with unprefixed model uses source id as provider', () => {
    const { cfg, thrownError } = runDirectLaunch('mercury-2.5', {
      fakeEnv: { INCEPTION_API_KEY: 'test-key' },
      candidateKey: 'harness::accessPath::inception::upstream::*:::mercury-2.5',
    });

    assert.ok(!thrownError, 'no error for unprefixed model on direct gateway');
    assert.ok(cfg, 'opencode.json exists');
    assert.ok(cfg.provider.inception, 'provider is source id (inception)');
    assert.equal(cfg.provider.inception.options.baseURL, 'https://api.inceptionlabs.ai/v1');
    assert.equal(cfg.provider.inception.options.apiKey, '{env:INCEPTION_API_KEY}');
    assert.ok(cfg.provider.inception.models['mercury-2.5'], 'model exists without prefix');
    assert.equal(cfg.provider.inception.models['mercury-2.5'].id, 'mercury-2.5');
  });
});
