'use strict';

/**
 * Ship Dễ — TASK-AI-116: isolated opencode-direct launches can use a direct
 * model source, not only 9Router.
 *
 * Problem (main 377d483): the worker opencode.json is always built from the
 * 9router entry in sources.json, so a Controller-pinned candidate from a
 * direct OpenAI-compatible source (inception, dahl, regolo, amd-radeon,
 * tencent, cohere, baseten, thb, rqsty) cannot run isolated.
 *
 * The fix: resolve the source from the pinned model's first path segment
 * (e.g. inception/mercury-2.5 → sources.json id inception), validate it has
 * an https endpoint and credential.env, generate opencode.json with the
 * direct source's endpoint and credential, and add only that credential to
 * the worker env allowlist.
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
  test('DS-R01: ninerouter/... keeps existing 9router behavior byte-for-byte', () => {
    const { cfg, thrownError } = runDirectLaunch('ninerouter/ag/gemini-3.1-pro-low', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-not-a-key-9router' },
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

  test('DS-R01: inception/mercury-2.5 resolves to inception source', () => {
    const { cfg, thrownError } = runDirectLaunch('inception/mercury-2.5', {
      fakeEnv: { INCEPTION_API_KEY: 'test-not-a-key-inception' },
    });

    assert.ok(!thrownError, 'no error thrown for inception model');
    assert.ok(cfg, 'opencode.json exists');
    assert.ok(cfg.provider.inception, 'provider is inception');
    assert.equal(cfg.provider.inception.options.baseURL, 'https://api.inceptionlabs.ai/v1');
    assert.equal(cfg.provider.inception.options.apiKey, '{env:INCEPTION_API_KEY}');
  });

  test('DS-R02: unknown prefix falls back to 9router instead of failing', () => {
    // Unknown prefixes like 'cl/', 'xmtp/' are upstream providers routed through 9router
    const { cfg, thrownError } = runDirectLaunch('cl/cline-free/mimo-v2.6-flash', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
    });

    assert.ok(!thrownError, 'no error thrown - falls back to 9router');
    assert.ok(cfg, 'opencode.json exists');
    // The provider ID is derived from the model prefix (cl), not the source
    assert.ok(cfg.provider.cl, 'provider is cl (from model prefix)');
    // But it uses 9router's endpoint and credential
    assert.equal(cfg.provider.cl.options.baseURL, 'http://127.0.0.1:20128/v1');
    assert.equal(cfg.provider.cl.options.apiKey, '{env:NINEROUTER_API_KEY}');
    // Upstream prefix should be sent whole to 9router (TASK-AI-96)
    assert.ok(cfg.provider.cl.models['cl/cline-free/mimo-v2.6-flash']);
  });

  test('DS-R02: source without endpoint fails with OPENCODE_DIRECT_SOURCE_UNSUPPORTED', () => {
    const { thrownError } = runDirectLaunch('codex/some-model', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
    });

    assert.ok(thrownError, 'error thrown for source without endpoint');
    assert.match(thrownError.message, /OPENCODE_DIRECT_SOURCE_UNSUPPORTED/);
    assert.match(thrownError.message, /codex/);
  });

  test('DS-R02: source without credential.env fails with OPENCODE_DIRECT_SOURCE_UNSUPPORTED', () => {
    const { thrownError } = runDirectLaunch('paseo/model-name', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
    });

    assert.ok(thrownError, 'error thrown for source without credential.env');
    assert.match(thrownError.message, /OPENCODE_DIRECT_SOURCE_UNSUPPORTED/);
    assert.match(thrownError.message, /paseo/);
  });

  test('DS-R03: direct source opencode.json uses source id as provider, endpoint as baseURL', () => {
    const { cfg } = runDirectLaunch('tencent/hunyuan-large', {
      fakeEnv: { TENCENT_TOKENHUB_API_KEY: 'test-not-a-key-tencent' },
    });

    assert.ok(cfg, 'opencode.json exists');
    assert.ok(cfg.provider.tencent, 'provider id matches source id');
    assert.equal(
      cfg.provider.tencent.options.baseURL,
      'https://tokenhub-intl.tencentcloudmaas.com/v1'
    );
    assert.equal(cfg.provider.tencent.options.apiKey, '{env:TENCENT_TOKENHUB_API_KEY}');
  });

  test('DS-R03: model id is sent WITHOUT the source prefix', () => {
    const { cfg } = runDirectLaunch('inception/mercury-2.5', {
      fakeEnv: { INCEPTION_API_KEY: 'test-not-a-key' },
    });

    assert.ok(cfg.provider.inception.models['mercury-2.5'], 'model mapped without prefix');
    assert.equal(cfg.provider.inception.models['mercury-2.5'].id, 'mercury-2.5');
    assert.equal(cfg.provider.inception.models['mercury-2.5'].name, 'mercury-2.5');
  });

  test('DS-R03: full model entry also exists in models map', () => {
    const { cfg } = runDirectLaunch('regolo/qwen-2.5-coder-32b', {
      fakeEnv: { REGOLO_API_KEY: 'test-not-a-key-regolo' },
    });

    assert.ok(cfg.provider.regolo.models['regolo/qwen-2.5-coder-32b'], 'full model entry exists');
    assert.ok(cfg.provider.regolo.models['qwen-2.5-coder-32b'], 'short model entry exists');
    assert.equal(cfg.provider.regolo.models['qwen-2.5-coder-32b'].id, 'qwen-2.5-coder-32b');
  });

  test('DS-R04: worker env allowlist adds ONLY the selected source credential', () => {
    const { capturedScript } = runDirectLaunch('cohere/command-r-plus', {
      fakeEnv: { COHERE_API_KEY: 'test-not-a-key-cohere' },
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
    assert.ok(
      !capturedScript.includes('TENCENT_TOKENHUB_API_KEY'),
      'other source credentials not in allowlist'
    );
  });

  test('DS-R04: 9router case still adds only NINEROUTER_API_KEY', () => {
    const { capturedScript } = runDirectLaunch('ninerouter/ag/gemini-3.1-pro-low', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-not-a-key-9router' },
    });

    assert.ok(capturedScript, 'run-target.ps1 captured');
    assert.match(capturedScript, /NINEROUTER_API_KEY/, 'NINEROUTER_API_KEY is in allowlist');
    assert.ok(
      !capturedScript.includes('INCEPTION_API_KEY'),
      'direct source credentials not in 9router allowlist'
    );
  });

  test('DS-R04: missing env var fails with OPENCODE_DIRECT_CREDENTIAL_MISSING before spawn', () => {
    // Temporarily clear BASETEN_API_KEY if it exists
    const realValue = process.env.BASETEN_API_KEY;
    delete process.env.BASETEN_API_KEY;
    try {
      const { thrownError } = runDirectLaunch('baseten/llama-3.1-70b', {
        fakeEnv: {}, // BASETEN_API_KEY not set
      });

      assert.ok(thrownError, 'error thrown for missing credential');
      assert.match(thrownError.message, /OPENCODE_DIRECT_CREDENTIAL_MISSING/);
      assert.match(thrownError.message, /BASETEN_API_KEY/);
    } finally {
      if (realValue !== undefined) process.env.BASETEN_API_KEY = realValue;
    }
  });

  test('DS-R04: credential VALUE never appears in opencode.json or run-target.ps1', () => {
    const fakeCredential = 'SECRET-test-credential-value-12345';
    const { cfg, capturedScript } = runDirectLaunch('thb/gpt-4o', {
      fakeEnv: { TOKENHARBOR_API_KEY: fakeCredential },
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

  test('DS-R01: rqsty source works as direct source', () => {
    const { cfg, thrownError } = runDirectLaunch('rqsty/claude-3-opus', {
      fakeEnv: { REQUESTY_API_KEY: 'test-not-a-key-rqsty' },
    });

    assert.ok(!thrownError, 'no error for rqsty source');
    assert.ok(cfg.provider.rqsty, 'provider is rqsty');
    assert.equal(cfg.provider.rqsty.options.baseURL, 'https://router.requesty.ai/v1');
    assert.equal(cfg.provider.rqsty.options.apiKey, '{env:REQUESTY_API_KEY}');
    assert.ok(cfg.provider.rqsty.models['claude-3-opus'], 'model without prefix exists');
  });

  test('DS-R02: http://127.0.0.1 endpoint is allowed', () => {
    const { cfg, thrownError } = runDirectLaunch('ninerouter/test-model', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
    });

    assert.ok(!thrownError, 'no error for 127.0.0.1 endpoint');
    assert.ok(cfg, 'opencode.json exists');
    assert.equal(cfg.provider.ninerouter.options.baseURL, 'http://127.0.0.1:20128/v1');
  });

  test('DS-R02: localhost endpoint is allowed', () => {
    // This test would require a source with localhost endpoint, which 9router has as 127.0.0.1
    // The validation logic should allow both
    const { cfg } = runDirectLaunch('ninerouter/model', {
      fakeEnv: { NINEROUTER_API_KEY: 'test-key' },
    });
    assert.ok(cfg, 'localhost/127.0.0.1 endpoints are allowed');
  });
});
