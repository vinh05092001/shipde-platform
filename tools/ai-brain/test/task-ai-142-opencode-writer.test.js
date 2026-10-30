'use strict';

/**
 * Ship Dễ — TASK-AI-142: Controller opencode-direct writer configuration and execution
 *
 * Requirements:
 * 1. Provider/model configuration generated according to source data (SSE vs JSON response types).
 * 2. Permissions strictly scoped to worker directory and designated report directories (no whole-machine wildcard).
 * 3. Empty response (exit 0 without content or tool use) produces HARNESS_EMPTY_RESPONSE.
 * 4. Raw API keys never leak into opencode.json (strictly `{env:NAME}`).
 * 5. Pure offline: no network calls, no machine discovery data.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const isoMod = require('../isolation-launcher');
const { getHarness } = require('../harness');
const { readSessionId, hasHarnessResponse, executePlan, Outcome } = require('../executor');

function makeFakeWorker(tmpDir) {
  const fakeHostCwd = path.join(tmpDir, 'host');
  const fakeWorkerRoot = path.join(tmpDir, 'worker');
  const fakeUsageDir = path.join(tmpDir, 'reports');
  fs.mkdirSync(fakeHostCwd, { recursive: true });
  fs.mkdirSync(fakeWorkerRoot, { recursive: true });
  fs.mkdirSync(fakeUsageDir, { recursive: true });
  fs.mkdirSync(path.join(fakeHostCwd, 'scripts', 'ai', 'isolation'), { recursive: true });

  const verdictFile = path.join(fakeHostCwd, 'verdict.json');
  fs.writeFileSync(
    verdictFile,
    JSON.stringify({
      verdict: 'CLOSED',
      worktree: fakeHostCwd,
      timestamp: new Date().toISOString(),
      policyHash: isoMod.getFolderHash(path.join(fakeHostCwd, 'scripts', 'ai', 'isolation')),
      sid: 'TEST-SID',
      details: { acl: 'PASS', firewall: 'PASS' },
    })
  );

  return { fakeHostCwd, fakeWorkerRoot, fakeUsageDir, verdictFile };
}

describe('TASK-AI-142: opencode-direct writer configuration and execution', () => {
  let realSpawn;

  beforeEach(() => {
    realSpawn = cp.spawnSync;
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
      if (cmd === 'powershell.exe' || cmd === 'powershell') {
        return { status: 0, stdout: '' };
      }
      return realSpawn(cmd, cargs, opts);
    };
  });

  afterEach(() => {
    cp.spawnSync = realSpawn;
  });

  test('config generated for SSE source and JSON source according to source data', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-cfg-'));
    try {
      const { fakeHostCwd, fakeWorkerRoot, fakeUsageDir, verdictFile } = makeFakeWorker(tmpDir);
      const directAdapter = getHarness('opencode-direct');
      const runIso = isoMod.getIsolatedLauncher();

      process.env.TEST_SSE_KEY = 'fake-sse-key-secret-1111';
      process.env.TEST_JSON_KEY = 'fake-json-key-secret-2222';

      // 1. SSE source configuration
      const sseSource = {
        id: 'sse-provider-source',
        label: 'SSE Streaming Gateway',
        kind: 'model-source',
        endpoint: 'https://api.sse-provider.test/v1',
        credential: { type: 'api-key', env: 'TEST_SSE_KEY' },
        opencodeProvider: 'sse-provider',
        headers: { 'X-Custom-SSE': 'stream-header' },
        options: { timeout: 60000 },
        modelMeta: {
          'sse-provider/stream-fast': {
            limit: { context: 64000, output: 8192 },
          },
        },
      };

      const sseArgs = directAdapter.launch({
        isolatedWorker: true,
        model: 'sse-provider/stream-fast',
        cwd: fakeWorkerRoot,
        prompt: 'test sse prompt',
      });

      try {
        runIso(directAdapter, sseArgs, {
          cwd: fakeHostCwd,
          workerRoot: fakeWorkerRoot,
          verdictPath: verdictFile,
          getWorkerSid: () => 'TEST-SID',
          verifyBoundary: () => true,
          baseSha: '0123456789012345678901234567890123456789',
          workerTimeoutMs: 1000,
          usageDir: fakeUsageDir,
          selectedSource: sseSource,
          sourceId: sseSource.id,
        });
      } catch (_) {}

      const sseCfgPath = path.join(fakeWorkerRoot, 'opencode.json');
      assert.ok(fs.existsSync(sseCfgPath), 'opencode.json must be generated for SSE source');
      const sseCfg = JSON.parse(fs.readFileSync(sseCfgPath, 'utf8'));

      assert.ok(sseCfg.provider['sse-provider'], 'provider must match source opencodeProvider');
      assert.equal(
        sseCfg.provider['sse-provider'].options.baseURL,
        'https://api.sse-provider.test/v1'
      );
      assert.equal(sseCfg.provider['sse-provider'].options.apiKey, '{env:TEST_SSE_KEY}');
      assert.equal(
        sseCfg.provider['sse-provider'].options.headers['X-Custom-SSE'],
        'stream-header'
      );
      assert.equal(sseCfg.provider['sse-provider'].options.timeout, 60000);
      assert.equal(sseCfg.provider['sse-provider'].models['stream-fast'].id, 'stream-fast');
      assert.equal(sseCfg.provider['sse-provider'].models['stream-fast'].limit.output, 8192);

      // 2. JSON source configuration (with stream: false / non-streaming options)
      const workerJsonRoot = path.join(tmpDir, 'worker-json');
      fs.mkdirSync(workerJsonRoot, { recursive: true });

      const jsonSource = {
        id: 'json-provider-source',
        label: 'JSON Non-Streaming Source',
        kind: 'model-source',
        endpoint: 'https://api.json-provider.test/v1',
        credential: { type: 'api-key', env: 'TEST_JSON_KEY' },
        opencodeProvider: 'json-provider',
        options: { stream: false, format: 'json' },
      };

      const jsonArgs = directAdapter.launch({
        isolatedWorker: true,
        model: 'json-provider/direct-json-model',
        cwd: workerJsonRoot,
        prompt: 'test json prompt',
      });

      try {
        runIso(directAdapter, jsonArgs, {
          cwd: fakeHostCwd,
          workerRoot: workerJsonRoot,
          verdictPath: verdictFile,
          getWorkerSid: () => 'TEST-SID',
          verifyBoundary: () => true,
          baseSha: '0123456789012345678901234567890123456789',
          workerTimeoutMs: 1000,
          usageDir: fakeUsageDir,
          selectedSource: jsonSource,
          sourceId: jsonSource.id,
        });
      } catch (_) {}

      const jsonCfgPath = path.join(workerJsonRoot, 'opencode.json');
      assert.ok(fs.existsSync(jsonCfgPath), 'opencode.json must be generated for JSON source');
      const jsonCfg = JSON.parse(fs.readFileSync(jsonCfgPath, 'utf8'));

      assert.ok(jsonCfg.provider['json-provider'], 'provider must match source opencodeProvider');
      assert.equal(
        jsonCfg.provider['json-provider'].options.baseURL,
        'https://api.json-provider.test/v1'
      );
      assert.equal(jsonCfg.provider['json-provider'].options.apiKey, '{env:TEST_JSON_KEY}');
      assert.equal(jsonCfg.provider['json-provider'].options.stream, false);
      assert.equal(jsonCfg.provider['json-provider'].options.format, 'json');
      assert.equal(
        jsonCfg.provider['json-provider'].models['direct-json-model'].id,
        'direct-json-model'
      );
    } finally {
      delete process.env.TEST_SSE_KEY;
      delete process.env.TEST_JSON_KEY;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('permissions strictly scoped to workerRoot and Controller designated reports (no whole-machine wildcard)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-perm-'));
    try {
      const { fakeHostCwd, fakeWorkerRoot, fakeUsageDir, verdictFile } = makeFakeWorker(tmpDir);
      const directAdapter = getHarness('opencode-direct');
      const runIso = isoMod.getIsolatedLauncher();

      process.env.TEST_PERM_KEY = 'test-perm-key';
      const permSource = {
        id: 'perm-provider-source',
        label: 'Perm Test Source',
        kind: 'model-source',
        endpoint: 'https://api.perm.test/v1',
        credential: { type: 'api-key', env: 'TEST_PERM_KEY' },
        opencodeProvider: 'perm-provider',
      };

      const args = directAdapter.launch({
        isolatedWorker: true,
        model: 'perm-provider/test-perm-model',
        cwd: fakeWorkerRoot,
        prompt: 'test prompt',
      });

      const usageFile = path.join(fakeUsageDir, 'usage-session.json');

      try {
        runIso(directAdapter, args, {
          cwd: fakeHostCwd,
          workerRoot: fakeWorkerRoot,
          verdictPath: verdictFile,
          getWorkerSid: () => 'TEST-SID',
          verifyBoundary: () => true,
          baseSha: '0123456789012345678901234567890123456789',
          workerTimeoutMs: 1000,
          usageFile,
          selectedSource: permSource,
          sourceId: permSource.id,
        });
      } catch (_) {}

      const cfgPath = path.join(fakeWorkerRoot, 'opencode.json');
      assert.ok(fs.existsSync(cfgPath), 'opencode.json must exist');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

      assert.ok(cfg.permission, 'permission block must exist');
      assert.ok(cfg.permission.external_directory, 'permission.external_directory must exist');

      const extDirs = cfg.permission.external_directory;
      const patterns = Object.keys(extDirs);

      assert.ok(patterns.length >= 1, 'must have at least workerRoot pattern');

      // Reject whole-machine wildcards
      assert.equal(patterns.includes('*'), false, 'must not include *');
      assert.equal(patterns.includes('**'), false, 'must not include **');
      assert.equal(patterns.includes('/*'), false, 'must not include /*');
      assert.equal(patterns.includes('C:/**'), false, 'must not include root drive wildcard');

      const normWorker = path.resolve(fakeWorkerRoot).replace(/\\/g, '/');
      const normReports = path.resolve(fakeUsageDir).replace(/\\/g, '/');

      for (const p of patterns) {
        assert.equal(extDirs[p], 'allow');
        const matchesWorker = p.startsWith(normWorker);
        const matchesReports = p.startsWith(normReports);
        assert.ok(
          matchesWorker || matchesReports,
          'permission pattern must strictly scope to worker or report dir: ' + p
        );
      }
    } finally {
      delete process.env.TEST_PERM_KEY;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('raw API key is never written to opencode.json (always {env:NAME})', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-key-'));
    try {
      const { fakeHostCwd, fakeWorkerRoot, verdictFile } = makeFakeWorker(tmpDir);
      const directAdapter = getHarness('opencode-direct');
      const runIso = isoMod.getIsolatedLauncher();

      const secretToken = 'super-secret-high-entropy-token-xyz-987654321';
      process.env.LEAK_TEST_KEY_ENV = secretToken;

      const sourceWithSecret = {
        id: 'leak-test-source',
        label: 'Leak Test Source',
        kind: 'model-source',
        endpoint: 'https://api.leak-test.test/v1',
        credential: { type: 'api-key', env: 'LEAK_TEST_KEY_ENV' },
        opencodeProvider: 'leak-provider',
        options: {
          apiKey: secretToken, // Attacker or buggy options trying to inject raw key
        },
      };

      const args = directAdapter.launch({
        isolatedWorker: true,
        model: 'leak-provider/test-model',
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
          selectedSource: sourceWithSecret,
          sourceId: sourceWithSecret.id,
        });
      } catch (_) {}

      const cfgPath = path.join(fakeWorkerRoot, 'opencode.json');
      assert.ok(fs.existsSync(cfgPath), 'opencode.json must exist');
      const rawText = fs.readFileSync(cfgPath, 'utf8');

      // The raw token must never appear anywhere in opencode.json
      assert.equal(
        rawText.includes(secretToken),
        false,
        'literal secret key value must NEVER leak into opencode.json'
      );
      assert.ok(
        rawText.includes('{env:LEAK_TEST_KEY_ENV}'),
        'apiKey must strictly use {env:LEAK_TEST_KEY_ENV}'
      );
    } finally {
      delete process.env.LEAK_TEST_KEY_ENV;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('keyless built-in source deletes literal apiKey from options so none is written to opencode.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-keyless-'));
    try {
      const { fakeHostCwd, fakeWorkerRoot, verdictFile } = makeFakeWorker(tmpDir);
      const directAdapter = getHarness('opencode-direct');
      const runIso = isoMod.getIsolatedLauncher();

      const secretToken = 'literal-keyless-secret-token-12345';

      const keylessSourceWithSecret = {
        id: 'keyless-test-source',
        label: 'Keyless Test Source',
        kind: 'model-source',
        endpoint: 'https://opencode.ai/zen/v1',
        opencodeProvider: 'opencode',
        opencodeBuiltin: true,
        credential: { type: 'none' },
        options: {
          apiKey: secretToken, // Buggy or injected raw key on keyless source
        },
      };

      const args = directAdapter.launch({
        isolatedWorker: true,
        model: 'opencode/test-model',
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
          selectedSource: keylessSourceWithSecret,
          sourceId: keylessSourceWithSecret.id,
        });
      } catch (_) {}

      const cfgPath = path.join(fakeWorkerRoot, 'opencode.json');
      assert.ok(fs.existsSync(cfgPath), 'opencode.json must exist');
      const rawText = fs.readFileSync(cfgPath, 'utf8');
      const cfg = JSON.parse(rawText);

      // The raw token must never appear anywhere in opencode.json
      assert.equal(
        rawText.includes(secretToken),
        false,
        'literal secret key value must NEVER leak into opencode.json on keyless branch'
      );
      assert.equal(
        cfg.provider.opencode.options.apiKey,
        undefined,
        'providerOptions.apiKey must be deleted on keyless branch'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('empty response from opencode produces HARNESS_EMPTY_RESPONSE (not success)', async () => {
    const directAdapter = getHarness('opencode-direct');
    assert.ok(directAdapter);

    // 1. Verify hasHarnessResponse logic
    // Empty stdout
    assert.equal(hasHarnessResponse({ stdout: '' }, directAdapter), false);
    assert.equal(hasHarnessResponse({ stdout: '   \n   ' }, directAdapter), false);

    // Stdout with only build banner lines
    assert.equal(
      hasHarnessResponse(
        { stdout: '> build · building project...\n> build · complete\n' },
        directAdapter
      ),
      false
    );

    // Stdout with empty json events
    assert.equal(
      hasHarnessResponse(
        { stdout: '{"type":"step_start"}\n{"type":"step_finish"}\n' },
        directAdapter
      ),
      false
    );

    // Stdout with valid message text event
    assert.equal(
      hasHarnessResponse(
        {
          stdout:
            '{"type":"step_start"}\n{"type":"text","part":{"text":"391"}}\n{"type":"step_finish"}\n',
        },
        directAdapter
      ),
      true
    );

    // Stdout with tool use event
    assert.equal(
      hasHarnessResponse(
        {
          stdout:
            '{"type":"step_start"}\n{"type":"tool_use","part":{"toolName":"read"}}\n{"type":"step_finish"}\n',
        },
        directAdapter
      ),
      true
    );

    // 2. Verify readSessionId returns HARNESS_EMPTY_RESPONSE when response is empty
    const job = { isolatedWorker: true, model: 'test/m', cwd: 'C:/fake' };
    const emptyRes = {
      exitCode: 0,
      stdout: '> build · done\n',
      completionNonce: 'test-nonce-12345',
      workerRoot: 'C:/fake',
    };

    const emptySession = readSessionId(directAdapter, job, emptyRes);
    assert.equal(emptySession.id, null);
    assert.equal(emptySession.cause, 'HARNESS_EMPTY_RESPONSE');

    // 3. Verify executePlan marks empty response as FAILED with HARNESS_EMPTY_RESPONSE
    const plan = {
      assignments: [
        {
          workItemId: 'FEAT-TEST-EMPTY',
          role: 'IMPLEMENTER',
          branch: 'feat/test',
          offeringId: 'cand-opencode-direct',
          harness: 'opencode-direct',
          isolatedWorker: true,
          cwd: 'C:/fake',
          model: 'test/m',
          prompt: 'test prompt',
        },
      ],
    };

    const routes = {
      'cand-opencode-direct': {
        adapter: directAdapter,
        launchOptions: { isolatedWorker: true },
      },
    };

    const origIso = isoMod.getIsolatedLauncher;
    isoMod.getIsolatedLauncher = () => () => emptyRes;
    try {
      const execResult = await executePlan(plan, {
        routes,
        dryRun: false,
        isolatedWorker: true,
        cwd: 'C:/fake',
        decisionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-exec-')),
      });

      assert.equal(execResult.summary.failed, 1);
      assert.equal(execResult.summary.launched, 0);
      assert.equal(execResult.records[0].outcome, Outcome.FAILED);
      assert.match(execResult.records[0].detail, /^HARNESS_EMPTY_RESPONSE/);
    } finally {
      isoMod.getIsolatedLauncher = origIso;
    }
  });
});
