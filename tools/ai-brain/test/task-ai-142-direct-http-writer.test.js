'use strict';

/**
 * TASK-AI-142: launcher supports writer direct-http & unsupported harnesses rejected
 *
 * Verifies:
 * 1. hasLauncherWriter dynamically checks launcher registry data without hardcoding.
 * 2. direct-http harness is supported by launcher writer (maps to opencodeDirect / opencode-direct).
 * 3. getHarness('direct-http') resolves to launcher writer adapter without throwing UNKNOWN_HARNESS.
 * 4. resolveRoute maps direct-http to opencode-direct on isolated worker path.
 * 5. Candidate with harness lacking launcher writer (e.g. unknown-xyz) is rejected with HARNESS_WRITER_UNSUPPORTED.
 * 6. Live candidate (direct-http::direct::opencode-provider-inception-options::...::mercury-2.5) resolves and launches without UNKNOWN_HARNESS.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cp = require('node:child_process');

const { candidateKey } = require('../candidates');
const { getHarness, listHarnesses, hasLauncherWriter } = require('../harness');
const { resolveRoute, executePlan, Outcome } = require('../executor');
const { runsOpenCodeHarness } = require('../sources');
const routing = require('../routing');
const { selectCandidateForProfile } = require('../orchestrate');
const isoMod = require('../isolation-launcher');

function directHttpCandidate(extra = {}) {
  const c = {
    harness: 'direct-http',
    accessPath: 'direct',
    gateway: 'direct',
    upstream: 'inception',
    accountId: 'source-inception',
    quotaScope: 'source-inception',
    modelId: 'mercury-2.5',
    capabilities: { tools: true, jsonSchema: true },
    quality: 85,
    cost: 0,
    evidence: [],
    ...extra,
  };
  c.candidateKey = candidateKey(c);
  return c;
}

function unsupportedCandidate(extra = {}) {
  const c = {
    harness: 'unsupported-xyz',
    accessPath: 'direct',
    gateway: 'gateway-xyz',
    upstream: 'upstream-xyz',
    accountId: 'account-xyz',
    quotaScope: 'quota-xyz',
    modelId: 'model-xyz',
    capabilities: { tools: true, jsonSchema: true },
    quality: 99,
    cost: 0,
    evidence: [],
    ...extra,
  };
  c.candidateKey = candidateKey(c);
  return c;
}

function fixtureRegistry() {
  return {
    version: 2,
    sources: [
      {
        id: 'inception',
        label: 'Inception Labs',
        kind: 'model-source',
        endpoint: 'https://api.inceptionlabs.ai/v1',
        credential: { type: 'api-key', env: 'INCEPTION_API_KEY' },
        servesModels: true,
        models: ['mercury-2.5'],
      },
      {
        id: 'opencode-provider-inception-options',
        kind: 'model-source',
        endpoint: 'https://api.inceptionlabs.ai/v1',
        credential: { type: 'api-key', env: 'INCEPTION_API_KEY' },
        servesModels: true,
        models: ['mercury-2.5'],
      },
    ],
    dispatch: { providers: {} },
  };
}

describe('TASK-AI-142: launcher supports writer direct-http', () => {
  test('hasLauncherWriter derives supported harnesses dynamically from launcher data', () => {
    assert.equal(typeof hasLauncherWriter, 'function', 'hasLauncherWriter must be exported');
    assert.equal(hasLauncherWriter('direct-http'), true, 'direct-http has launcher writer');
    assert.equal(hasLauncherWriter('opencode-direct'), true, 'opencode-direct has launcher writer');
    assert.equal(hasLauncherWriter('unknown-xyz'), false, 'unknown harness has no launcher writer');

    for (const h of listHarnesses()) {
      assert.equal(hasLauncherWriter(h), true, `harness ${h} from listHarnesses must be supported`);
    }

    assert.equal(hasLauncherWriter('opencode'), true, 'opencode alias resolves to launcher writer');
  });

  test('hasLauncherWriter rejects test-* prefix harness unless explicitly injected via options', () => {
    // Fail-closed gate: test-* prefix must NOT pass in production without options injection
    assert.equal(
      hasLauncherWriter('test-harness'),
      false,
      'test-* harness must be rejected without injection'
    );
    assert.equal(
      hasLauncherWriter('test-custom-writer', { supportedHarnesses: ['test-custom-writer'] }),
      true,
      'injected supportedHarnesses must be accepted'
    );
  });

  test('hasLauncherWriter surfaces error via options.onError when registry evaluation throws', () => {
    let captured = null;
    const reg = {
      get sources() {
        throw new Error('CORRUPTED_REGISTRY');
      },
    };
    const res = hasLauncherWriter('custom-opencode', {
      registry: reg,
      onError: (err) => {
        captured = err;
      },
    });
    assert.equal(res, false, 'must fail closed on error');
    assert.ok(captured, 'error must be surfaced to onError handler');
    assert.match(captured.message, /CORRUPTED_REGISTRY/);
  });

  test('getHarness resolves direct-http to a writer adapter without throwing UNKNOWN_HARNESS', () => {
    const adapter = getHarness('direct-http');
    assert.ok(adapter, 'adapter for direct-http must exist');
    assert.equal(typeof adapter.launch, 'function', 'adapter must provide a launch function');
    assert.equal(adapter.id, 'opencode-direct', 'direct-http maps to opencode-direct adapter');
  });

  test('runsOpenCodeHarness identifies OpenCode CLI harnesses and preserves direct-http handling', () => {
    // OpenCode CLI harnesses are opencode and paseo; direct-http routes to opencode-direct adapter in launcher
    assert.equal(runsOpenCodeHarness('opencode'), true, 'opencode is OpenCode CLI harness');
    assert.equal(runsOpenCodeHarness('paseo'), true, 'paseo is OpenCode CLI harness');
    assert.equal(
      runsOpenCodeHarness('direct-http'),
      false,
      'direct-http is not an OpenCode CLI harness'
    );
    assert.equal(
      runsOpenCodeHarness('unsupported-xyz'),
      false,
      'unsupported harness must return false'
    );
  });

  test('resolveRoute maps direct-http with gateway direct to opencode-direct carrying endpoint and apiKeyEnv', () => {
    const reg = fixtureRegistry();
    const route = resolveRoute(
      {
        provider: 'inception',
        gateway: 'direct',
        accessPath: 'direct',
        model: 'mercury-2.5',
        harness: 'direct-http',
      },
      { isolatedWorker: true },
      reg
    );

    assert.ok(route, 'route must resolve');
    assert.equal(
      route.harnessName,
      'opencode-direct',
      'must route to opencode-direct for isolated worker'
    );
    assert.equal(
      route.endpoint,
      'https://api.inceptionlabs.ai/v1',
      'route must carry resolved source endpoint'
    );
    assert.equal(
      route.apiKeyEnv,
      'INCEPTION_API_KEY',
      'route must carry resolved credential environment variable'
    );
  });

  test('rankForProfile rejects candidates with unsupported harness from writer ranking', () => {
    const unsupp = unsupportedCandidate();
    const direct = directHttpCandidate();
    const profile = { id: 'GOAL-G-F622511E-1', role: 'writer' };
    const assessment = { weights: { quality: 1, cost: 0, latency: 0 } };
    const rankCtx = { priors: {} };

    const result = routing.rankForProfile([unsupp, direct], profile, assessment, rankCtx);

    assert.equal(
      result.chosen,
      direct.candidateKey,
      'supported direct-http candidate must be chosen'
    );
    assert.equal(result.ranking.length, 1, 'only supported candidate enters ranking');
    const rejected = result.rejected.find((r) => r.candidateKey === unsupp.candidateKey);
    assert.ok(rejected, 'unsupported candidate must be rejected');
    assert.equal(rejected.reasonCode, 'HARNESS_WRITER_UNSUPPORTED');
    assert.match(rejected.reason, /has no launcher writer/i);
  });

  test('selectCandidateForProfile admits direct-http Mercury candidate and blocks unsupported harness', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-select-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const direct = directHttpCandidate({ quality: 85 });
    const unsupp = unsupportedCandidate({ quality: 99 });
    const reg = fixtureRegistry();

    const options = {
      registry: reg,
      env: { INCEPTION_API_KEY: 'test-key' },
      ranking: { priors: {} },
      jevAsk: async () => {
        throw new Error('offline');
      },
    };

    const item = {
      id: 'GOAL-G-F622511E-1',
      roleRequirement: { role: 'writer' },
      requiredCapabilities: ['tools'],
      proofFloor: 'NONE',
    };

    const sel = await selectCandidateForProfile(
      item,
      [direct, unsupp],
      [],
      null,
      options,
      { dir },
      Date.now()
    );

    assert.equal(sel.chosen, direct.candidateKey, 'must choose supported direct-http candidate');
    const rejectedUnsupp = sel.result.rejected.find((r) => r.candidateKey === unsupp.candidateKey);
    assert.ok(rejectedUnsupp, 'unsupported candidate must be rejected in ranking or blocked');
  });

  test('selectCandidateForProfile blocks unsupported harness in orchestrate.js gate when isolatedWorker and refreshWriterModels are true', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-orch-gate-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const direct = directHttpCandidate({ quality: 85 });
    const unsupp = unsupportedCandidate({ quality: 99 });
    const reg = fixtureRegistry();

    const options = {
      registry: reg,
      isolatedWorker: true,
      refreshWriterModels: true,
      env: { INCEPTION_API_KEY: 'test-key' },
      ranking: { priors: {} },
      jevAsk: async () => {
        throw new Error('offline');
      },
    };

    const item = {
      id: 'GOAL-G-F622511E-1',
      roleRequirement: { role: 'writer' },
      requiredCapabilities: ['tools'],
      proofFloor: 'NONE',
    };

    const sel = await selectCandidateForProfile(
      item,
      [direct, unsupp],
      [],
      null,
      options,
      { dir },
      Date.now()
    );

    const rej = sel.result.rejected.find((r) => r.candidateKey === unsupp.candidateKey);
    assert.ok(rej, 'unsupported candidate must be in rejected list');
    assert.equal(
      rej.reason,
      'HARNESS_WRITER_UNSUPPORTED',
      'must be marked blocked by orchestrate.js gate'
    );
    assert.equal(
      rej.reasonCode,
      'CANDIDATE_BLOCKED',
      'must have reasonCode CANDIDATE_BLOCKED from preflight block'
    );
  });

  test('isolation launcher builds opencode provider config for direct-http candidate with gateway direct', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-cfg-direct-'));
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

    const reg = fixtureRegistry();
    const candidate = directHttpCandidate();
    const directAdapter = getHarness('direct-http');
    const runIso = isoMod.getIsolatedLauncher();

    const origKey = process.env.INCEPTION_API_KEY;
    const realSpawn = cp.spawnSync;
    process.env.INCEPTION_API_KEY = 'test-secret-inception-key';

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
        if (cmd === 'powershell.exe' || cmd === 'powershell') {
          return { status: 0, stdout: '' };
        }
        return realSpawn(cmd, cargs, opts);
      };

      const launchArgs = directAdapter.launch({
        isolatedWorker: true,
        model: 'inception/mercury-2.5',
        cwd: fakeWorkerRoot,
        prompt: 'test direct prompt',
      });

      try {
        runIso(directAdapter, launchArgs, {
          cwd: fakeHostCwd,
          workerRoot: fakeWorkerRoot,
          verdictPath: verdictFile,
          getWorkerSid: () => 'TEST-SID',
          verifyBoundary: () => true,
          baseSha: '0123456789012345678901234567890123456789',
          workerTimeoutMs: 1000,
          usageDir: fakeUsageDir,
          candidateKey: candidate.candidateKey,
          registry: reg,
          source: reg.sources[0],
        });
      } catch (_) {}

      const cfgPath = path.join(fakeWorkerRoot, 'opencode.json');
      assert.ok(fs.existsSync(cfgPath), 'opencode.json must be generated');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

      assert.ok(cfg.provider.inception, 'provider must be inception');
      assert.equal(cfg.provider.inception.options.baseURL, 'https://api.inceptionlabs.ai/v1');
      assert.equal(cfg.provider.inception.options.apiKey, '{env:INCEPTION_API_KEY}');
      assert.ok(cfg.provider.inception.models['mercury-2.5'], 'model mercury-2.5 must be mapped');
      assert.equal(cfg.provider.inception.models['mercury-2.5'].id, 'mercury-2.5');
    } finally {
      cp.spawnSync = realSpawn;
      if (origKey !== undefined) {
        process.env.INCEPTION_API_KEY = origKey;
      } else {
        delete process.env.INCEPTION_API_KEY;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('executePlan resolves route for direct-http writer without UNKNOWN_HARNESS refusal', () => {
    const reg = fixtureRegistry();
    const assignment = {
      workItemId: 'GOAL-G-F622511E-1',
      branch: 'fix/goal-1',
      provider: 'inception',
      model: 'mercury-2.5',
      harness: 'direct-http',
      role: 'writer',
    };

    const route = resolveRoute(assignment, { isolatedWorker: true }, reg);
    assert.ok(route, 'route must be resolved');
    const adapter = getHarness(route.harnessName);
    assert.ok(adapter, 'adapter must not be null (no UNKNOWN_HARNESS)');
    assert.equal(adapter.id, 'opencode-direct');
  });

  test('executePlan on non-isolated path fails with OPENCODE_DIRECT_REQUIRES_ISOLATION, not UNKNOWN_HARNESS', () => {
    const reg = fixtureRegistry();
    const assignment = {
      workItemId: 'GOAL-G-F622511E-1',
      branch: 'fix/goal-1',
      provider: 'inception',
      model: 'mercury-2.5',
      harness: 'direct-http',
      role: 'writer',
    };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-non-iso-'));
    try {
      const planResult = executePlan(
        { assignments: [assignment] },
        { isolatedWorker: false, cwd: tmp, registry: reg }
      );
      assert.equal(planResult.records.length, 1);
      assert.equal(planResult.records[0].outcome, Outcome.FAILED);
      assert.equal(planResult.records[0].detail, 'OPENCODE_DIRECT_REQUIRES_ISOLATION');
      assert.notEqual(planResult.records[0].detail, 'UNKNOWN_HARNESS: direct-http');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
