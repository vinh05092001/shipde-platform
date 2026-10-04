'use strict';

/**
 * Ship Dễ — TASK-AI-73: Live JEV and evidence-based candidate selection contract tests.
 *
 * Contract requirements (two proven gaps at base origin/main b573717):
 * (1) JEV is on the call path but the live CLI never supplies `jevAsk`, so
 *     assessTask always returns UNDECIDED/UNREACHABLE. JEV source is data in
 *     tools/ai-brain/sources.json (id 'jev', kind decision-service, endpoint
 *     https://api.typesafe.ai/v1/systemone, credential env TYPESAFE_API_KEY /
 *     store ~/.typesafe-key, minConfidence 0.7, mayWriteCode false, closed questions only).
 * (2) The live profile is too loose (orchestrate.js requiredCapabilities [],
 *     proofFloor 'NONE', qualityFloor 10, useStoredQuota false), quota/headroom/
 *     reservation are not live, and draft PR body says 'Reviewer: unrecorded'.
 *
 * Required architecture:
 *   Work Item -> JEV advises task/weight profile only -> Controller chooses the
 *   full 7-part candidate (harness::accessPath::gateway::upstream::account::quotaScope::modelId)
 *   -> pinned execution -> structured outcome -> Controller decides retry/fallback.
 *
 * All tests here must FAIL at base b573717 and PASS once implemented.
 * Only exported functions and the real CLI entry (spawn node tools/ai-brain/cli.js)
 * are used.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const jev = require('../jev');
const routing = require('../routing');
const orchestrate = require('../orchestrate');
const publisher = require('../publisher');
const candidatesApi = require('../candidates');
const quotaStore = require('../quota-store');
const sourcesApi = require('../sources');
const { candidateKey } = require('../discovery/identity');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(__dirname, '..', 'cli.js');
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'task-ai-73');

/**
 * Temporary directory creation outside the repository.
 */
function makeTempDir(prefix) {
  const base = process.env.TEMP || process.env.TMPDIR || os.tmpdir();
  return fs.mkdtempSync(path.join(base, prefix || 'task-ai-73-'));
}

/**
 * Helper to initialize a clean temporary git repository for publisher tests.
 */
function makeTempRepo(prefix) {
  const dir = makeTempDir(prefix || 'task-ai-73-repo-');
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  git(['init', '-q']);
  git(['config', 'user.email', 'operator@shipde.test']);
  git(['config', 'user.name', 'ShipDe Operator']);
  fs.writeFileSync(path.join(dir, 'test-file.txt'), 'reviewed content\n', 'utf8');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'chore: initial reviewed commit']);
  const sha = git(['rev-parse', 'HEAD']).stdout.trim();
  return { dir, sha };
}

/**
 * Helper to write JSON file with parent directory creation.
 */
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

/**
 * Helper to configure a disposable account registry in home.
 */
function writeAccountRegistry(home, accounts) {
  const regPath = path.join(home, '.shipde', 'accounts.registry.json');
  writeJson(regPath, {
    version: 1,
    accounts: accounts || [
      {
        id: 'acc-test',
        provider: 'oc',
        enabled: true,
        capabilities: { contextWindow: 200000, tools: true, 'workspace-edit': true },
        models: [{ model: 'ninerouter/fast-model', quality: 90 }],
      },
    ],
  });
  return regPath;
}

/**
 * Helper to parse CLI JSON output.
 */
function parseJsonOutput(text) {
  const trimmed = String(text || '').trim();
  const jsonStart = trimmed.indexOf('\n{\n');
  const raw = trimmed.startsWith('{')
    ? trimmed
    : jsonStart >= 0
      ? trimmed.slice(jsonStart + 1)
      : '';
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function spawnCli(args, options) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI].concat(args), {
      cwd: (options && options.cwd) || REPO_ROOT,
      env: (options && options.env) || process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeoutMs = (options && options.timeout) || 10000;
    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function systemOneChoice(choice, confidence, probabilities) {
  return {
    model: 'jev-latest',
    answers: {
      weightProfile: {
        type: 'choice',
        choice,
        confidence,
        probabilities:
          probabilities ||
          (choice === 'LATENCY_FIRST'
            ? { LATENCY_FIRST: confidence, BALANCED: 0.03, QUALITY_FIRST: 0.02 }
            : { LATENCY_FIRST: 0.02, BALANCED: confidence, QUALITY_FIRST: 0.01 }),
      },
    },
    usage: { input_tokens: 120, output_tokens: 8 },
  };
}

function assertSystemOneRequest(body) {
  assert.equal(body.model, 'jev-latest', 'JEV model must come from source data');
  assert.ok(body.state, 'TypeSafe request must include state');
  assert.ok(body.questions && body.questions.weightProfile, 'request must include named question');
  assert.equal(body.questions.weightProfile.type, 'choice');
  assert.ok(body.questions.weightProfile.instructions, 'choice question must include instructions');
  assert.deepEqual(
    Object.keys(body.questions.weightProfile.criteria).sort(),
    ['BALANCED', 'LATENCY_FIRST', 'QUALITY_FIRST'].sort(),
    'criteria must carry exactly the closed weighting-profile choices'
  );
  assert.equal(body.kind, undefined, 'legacy kind field must not be sent');
  assert.equal(body.prompt, undefined, 'legacy prompt field must not be sent');
  assert.equal(body.evidence, undefined, 'legacy evidence field must not be sent');
  assert.equal(body.options, undefined, 'legacy options field must not be sent');
}

describe('TASK-AI-73: Live JEV and evidence-based candidate selection', () => {
  // =========================================================================
  // Test 1: live CLI really supplies a jevAsk adapter
  // =========================================================================
  test('1 live CLI really supplies a jevAsk adapter (inject a fake JEV HTTP/transport seam; no network)', async () => {
    // Expected contract:
    // 1. jev.js must export `buildJevAsk(source, options)` which returns an async ask(question) function.
    // 2. The live CLI (e.g. `node tools/ai-brain/cli.js dispatch --profile ...` or `orchestrate`)
    //    must construct a real jevAsk adapter from the 'jev' source definition in sources.json.
    // 3. When an endpoint or JEV_ENDPOINT seam is supplied, the CLI communicates with the fake HTTP service.
    // 4. Secret keys (e.g. TYPESAFE_API_KEY) must NOT appear in output logs.

    assert.equal(
      typeof jev.buildJevAsk,
      'function',
      'jev.js must export buildJevAsk(source, options) factory function'
    );

    let serverRequests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        serverRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body ? JSON.parse(body) : null,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(systemOneChoice('LATENCY_FIRST', 0.95)));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const testSecret = 'typesafe-secret-key-probe-73';

    try {
      const tempHome = makeTempDir('home-jev-cli-');
      writeAccountRegistry(tempHome);
      const profilePath = path.join(FIXTURES_DIR, 'sample-task-profile.json');

      const env = Object.assign({}, process.env, {
        HOME: tempHome,
        USERPROFILE: tempHome,
        TYPESAFE_API_KEY: testSecret,
        JEV_ENDPOINT: `http://127.0.0.1:${port}/v1/systemone`,
      });

      const res = await spawnCli(['dispatch', '--profile', profilePath, '--json'], {
        cwd: REPO_ROOT,
        env,
        timeout: 10000,
      });

      const outText = (res.stdout || '') + (res.stderr || '');
      assert.ok(!outText.includes(testSecret), 'CLI must not log the TYPESAFE_API_KEY credential');

      assert.ok(
        serverRequests.length > 0,
        'Expected mock JEV server to be called by live CLI, but received 0 requests (live CLI did not supply jevAsk)'
      );
      assertSystemOneRequest(serverRequests[0].body);

      const parsed = parseJsonOutput(res.stdout);
      assert.ok(parsed && parsed.assessment, 'CLI must output assessment in JSON');
      assert.equal(
        parsed.assessment.jevOutcome,
        'DECIDED',
        'Live CLI must obtain a DECIDED advisory from the injected JEV service'
      );
      assert.equal(
        parsed.assessment.decidedBy,
        'jev',
        'Assessment must be recorded as decidedBy jev'
      );
      assert.equal(
        parsed.assessment.weightProfile,
        'LATENCY_FIRST',
        'Assessment must reflect JEV advisory LATENCY_FIRST'
      );
      assert.equal(parsed.assessment.jevModel, 'jev-latest');
      assert.ok(parsed.assessment.probabilities, 'decision must retain JEV probabilities');
    } finally {
      server.close();
    }
  });

  // =========================================================================
  // Test 2: no JEV / timeout -> UNDECIDED -> Controller fallback
  // =========================================================================
  test('2 no JEV / timeout -> UNDECIDED -> Controller fallback', async () => {
    // Expected contract:
    // When JEV times out or is unreachable, assessTask must return:
    // - jevOutcome: 'UNDECIDED'
    // - decidedBy: 'controller'
    // - reasonCodes containing 'JEV_UNDECIDED:TIMEOUT' (or UNREACHABLE if server unreachable)
    // - weightProfile matching Controller deterministic fallback (ROLE_FALLBACK_PROFILE[role])

    assert.equal(
      typeof jev.buildJevAsk,
      'function',
      'jev.js must export buildJevAsk(source, options) with timeout support'
    );

    // Create a server that delays response longer than the timeout threshold
    const server = http.createServer((req, res) => {
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(systemOneChoice('LATENCY_FIRST', 0.95)));
        }
      }, 2000);
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const jevSource = {
        id: 'jev',
        kind: 'decision-service',
        endpoint: `http://127.0.0.1:${port}/v1/systemone`,
        model: 'jev-latest',
        credential: { type: 'api-key', env: 'TYPESAFE_API_KEY' },
        minConfidence: 0.7,
      };

      const askWithTimeout = jev.buildJevAsk(jevSource, {
        timeoutMs: 50,
        env: { TYPESAFE_API_KEY: 'test-key' },
      });

      const profile = {
        taskId: 'TASK-AI-73-TIMEOUT',
        role: 'reviewer',
        complexity: 'standard',
        requiredCapabilities: [],
        proofFloor: 'NONE',
        contextSize: 4000,
        expectedDuration: 30000,
        latencyPriority: 'normal',
        qualityFloor: 10,
        costCeiling: 1000,
        requiredHarness: null,
        forbiddenFailureDomains: [],
        resourceCeiling: 10,
        currentWorkload: 0,
      };

      const assessment = await routing.assessTask(profile, { ask: askWithTimeout });

      assert.equal(
        assessment.jevOutcome,
        'UNDECIDED',
        'Timeout must result in jevOutcome: UNDECIDED'
      );
      assert.equal(
        assessment.decidedBy,
        'controller',
        'Timeout must hand decision to the Controller'
      );
      assert.ok(
        assessment.reasonCodes.some((code) => code.includes('TIMEOUT')),
        'reasonCodes must include a TIMEOUT code: ' + JSON.stringify(assessment.reasonCodes)
      );
      assert.equal(
        assessment.weightProfile,
        routing.ROLE_FALLBACK_PROFILE.reviewer,
        'Controller fallback profile must be applied upon timeout'
      );
    } finally {
      server.close();
    }
  });

  // =========================================================================
  // Test 3: valid JEV advisory changes the weight profile and ranking order
  // =========================================================================
  test('3 valid JEV advisory changes the weight profile and ranking order', async () => {
    // Expected contract:
    // In live CLI dispatch, a valid JEV advisory returned over the live path
    // must change the weightProfile (e.g. from default QUALITY_FIRST to LATENCY_FIRST for reviewer)
    // and flip the candidate ranking order so that Candidate Fast outranks Candidate Quality.
    // At base, live CLI does not supply jevAsk, so assessment is always UNDECIDED
    // and weightProfile remains the default fallback (QUALITY_FIRST for reviewer).

    const serverRequests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        serverRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body ? JSON.parse(body) : null,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(systemOneChoice('LATENCY_FIRST', 0.95)));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const tempHome = makeTempDir('home-jev-advise-');
      writeAccountRegistry(tempHome, [
        {
          id: 'acc-dual',
          provider: 'oc',
          enabled: true,
          capabilities: { contextWindow: 200000, tools: true, 'workspace-edit': true },
          models: [
            { model: 'ninerouter/fast-model', quality: 60, latencyMs: 50 },
            { model: 'ninerouter/quality-model', quality: 95, latencyMs: 2000 },
          ],
        },
      ]);

      const profileFile = path.join(tempHome, 'profile.json');
      writeJson(profileFile, {
        taskId: 'TASK-AI-73-REV-ORDER',
        role: 'reviewer',
        complexity: 'standard',
        requiredCapabilities: [],
        proofFloor: 'NONE',
        contextSize: 4000,
        expectedDuration: 30000,
        latencyPriority: 'normal',
        qualityFloor: 0,
        costCeiling: 1000,
        requiredHarness: null,
        forbiddenFailureDomains: [],
        resourceCeiling: 10,
        currentWorkload: 0,
      });

      const env = Object.assign({}, process.env, {
        HOME: tempHome,
        USERPROFILE: tempHome,
        TYPESAFE_API_KEY: 'test-key',
        JEV_ENDPOINT: `http://127.0.0.1:${port}/v1/systemone`,
      });

      const res = await spawnCli(['dispatch', '--profile', profileFile, '--json'], {
        cwd: REPO_ROOT,
        env,
        timeout: 10000,
      });

      assert.ok(
        serverRequests.length > 0,
        'Expected mock JEV server to be called by live CLI in Test 3'
      );
      assertSystemOneRequest(serverRequests[0].body);

      const parsed = parseJsonOutput(res.stdout);
      assert.ok(parsed && parsed.assessment, 'Live CLI must return JSON assessment');
      assert.equal(
        parsed.assessment.weightProfile,
        'LATENCY_FIRST',
        'Valid JEV advisory must change weightProfile to LATENCY_FIRST in live CLI output'
      );
      assert.equal(
        parsed.assessment.decidedBy,
        'jev',
        'decidedBy must be jev when advisory is valid'
      );
      assert.ok(
        parsed.pinned && parsed.pinned.includes('fast-model'),
        'Candidate Fast must be pinned when JEV advises LATENCY_FIRST, got: ' + parsed.pinned
      );
    } finally {
      server.close();
    }
  });

  // =========================================================================
  // Test 4: JEV answer naming a model/provider/account is rejected
  // =========================================================================
  test('4 JEV answer naming a model/provider/account is rejected', async () => {
    // Expected contract:
    // JEV advises task/weight profile only. JEV never picks model/provider/account/gateway.
    // If JEV response attempts to name a model, provider, account, or gateway:
    // routing.assessTask must refuse it:
    // - jevOutcome: 'UNDECIDED'
    // - decidedBy: 'controller'
    // - reasonCodes records refusal reason (e.g. MALFORMED_OUTPUT or IDENTITY_PROHIBITED)

    const profile = {
      taskId: 'TASK-AI-73-FORBIDDEN-JEV',
      role: 'writer',
      complexity: 'standard',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      contextSize: 4000,
      expectedDuration: 30000,
      latencyPriority: 'normal',
      qualityFloor: 10,
      costCeiling: 1000,
      requiredHarness: null,
      forbiddenFailureDomains: [],
      resourceCeiling: 10,
      currentWorkload: 0,
    };

    // Subcase A: JEV response returns a model name as choice
    const askModelChoice = async () => ({
      choice: 'openai/gpt-4o',
      confidence: 0.95,
      reason: 'best model',
    });

    const assessModelChoice = await routing.assessTask(profile, { ask: askModelChoice });
    assert.equal(
      assessModelChoice.jevOutcome,
      'UNDECIDED',
      'JEV returning a model name as choice must be rejected with UNDECIDED'
    );
    assert.equal(assessModelChoice.decidedBy, 'controller');

    // Subcase B: JEV response returns valid choice but attaches model/provider fields
    const askWithIdentityFields = async () => ({
      choice: 'BALANCED',
      confidence: 0.95,
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
    });

    const assessWithIdentity = await routing.assessTask(profile, { ask: askWithIdentityFields });
    assert.equal(
      assessWithIdentity.jevOutcome,
      'UNDECIDED',
      'JEV advisory containing model or provider fields must be rejected with UNDECIDED'
    );
    assert.equal(
      assessWithIdentity.decidedBy,
      'controller',
      'Controller must take over decision when JEV includes prohibited identity fields'
    );
    assert.ok(
      assessWithIdentity.reasonCodes.some(
        (code) => code.includes('MALFORMED_OUTPUT') || code.includes('IDENTITY_PROHIBITED')
      ),
      'Refusal reason must be recorded in reasonCodes: ' +
        JSON.stringify(assessWithIdentity.reasonCodes)
    );
  });

  // =========================================================================
  // Test 5: a complex Work Item yields a profile with capabilities and proof floor WORK_ITEM_PASS
  // =========================================================================
  test('5 a complex Work Item yields a profile with capabilities and proof floor WORK_ITEM_PASS', () => {
    // Expected contract:
    // Deriving a task profile from a Work Item must not hard-code loose defaults
    // (proofFloor 'NONE', requiredCapabilities [], qualityFloor 10).
    // For coding/review roles (e.g. role 'writer'):
    // - proofFloor must be WORK_ITEM_PASS
    // - requiredCapabilities must be derived from Work Item requirements
    // - qualityFloor must match Work Item standards
    // For exploration items:
    // - proofFloor may be HARNESS_PASS

    const complexItem = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, 'complex-work-item.json'), 'utf8')
    );

    // orchestrate must export buildTaskProfile(item, options)
    assert.equal(
      typeof orchestrate.buildTaskProfile,
      'function',
      'orchestrate.js must export buildTaskProfile(item, options)'
    );

    const profile = orchestrate.buildTaskProfile(complexItem);

    assert.equal(
      profile.proofFloor,
      'WORK_ITEM_PASS',
      'A complex coding work item must yield proofFloor WORK_ITEM_PASS'
    );
    assert.deepEqual(
      profile.requiredCapabilities.sort(),
      ['tools', 'workspace-edit'].sort(),
      'Profile must inherit required capabilities from the Work Item'
    );
    assert.ok(
      profile.qualityFloor >= 80,
      'Complex coding work item must have quality floor >= 80, got ' + profile.qualityFloor
    );

    // Exploration item check
    const exploreItem = {
      id: 'TASK-EXPLORATION-01',
      roleRequirement: { role: 'researcher' },
      complexity: 'standard',
      exploration: true,
    };
    const exploreProfile = orchestrate.buildTaskProfile(exploreItem);
    assert.equal(
      exploreProfile.proofFloor,
      'HARNESS_PASS',
      'An exploration work item may have proofFloor HARNESS_PASS'
    );
  });

  // =========================================================================
  // Test 6: CATALOG_ONLY or API_PASS candidate is never a coding worker
  // =========================================================================
  test('6 CATALOG_ONLY or API_PASS candidate is never a coding worker', async () => {
    // Expected contract:
    // When selecting a coding worker (role: writer):
    // Candidates with CATALOG_ONLY or API_PASS proof level must NEVER be selected.
    // They must be rejected with PROOF_FLOOR_NOT_MET reason code, even if their
    // speed/quality scores are high.

    const candApiPass = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router1',
      upstream: 'up1',
      accountId: 'acc1',
      quotaScope: 'scope1',
      modelId: 'vendor/api-pass-model',
      latencyMs: 50,
      quality: 99,
      capabilities: { tools: true, 'workspace-edit': true },
      evidence: [{ status: 'passed', level: 'api', proofLevel: 'API_PASS' }],
    };

    const candCatalogOnly = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router2',
      upstream: 'up2',
      accountId: 'acc2',
      quotaScope: 'scope2',
      modelId: 'vendor/catalog-only-model',
      latencyMs: 40,
      quality: 98,
      capabilities: { tools: true, 'workspace-edit': true },
      evidence: [],
    };

    const candWorkItemPass = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router3',
      upstream: 'up3',
      accountId: 'acc3',
      quotaScope: 'scope3',
      modelId: 'vendor/work-item-pass-model',
      latencyMs: 800,
      quality: 75,
      capabilities: { tools: true, 'workspace-edit': true },
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const item = {
      id: 'TASK-AI-73-WRITER',
      roleRequirement: { role: 'writer' },
      complexity: 'complex',
      capabilities: ['tools', 'workspace-edit'],
    };

    const evidenceData = {
      [candidateKey(candApiPass)]: candApiPass.evidence,
      [candidateKey(candWorkItemPass)]: candWorkItemPass.evidence,
    };

    const candidates = [candApiPass, candCatalogOnly, candWorkItemPass];
    const decisionDir = makeTempDir('decision-coding-worker-');

    const decision = await orchestrate.selectCandidateForProfile(
      item,
      candidates,
      [],
      evidenceData,
      { decisionDir },
      { dir: decisionDir },
      Date.now()
    );

    assert.notEqual(
      decision.chosen,
      candidateKey(candApiPass),
      'Candidate with only API_PASS must not be chosen as coding worker'
    );
    assert.notEqual(
      decision.chosen,
      candidateKey(candCatalogOnly),
      'Candidate with only CATALOG_ONLY must not be chosen as coding worker'
    );
    assert.equal(
      decision.chosen,
      candidateKey(candWorkItemPass),
      'Candidate with WORK_ITEM_PASS must be chosen as coding worker'
    );

    const rejectedCodes = (decision.result.rejected || []).map((r) => r.reasonCode);
    assert.ok(
      rejectedCodes.some((code) => code.includes('PROOF_FLOOR_NOT_MET')),
      'Rejection reasons must record PROOF_FLOOR_NOT_MET: ' + JSON.stringify(rejectedCodes)
    );
  });

  // =========================================================================
  // Test 7: quota exhausted/cooldown excluded
  // =========================================================================
  test('7 quota exhausted/cooldown excluded', async () => {
    // Expected contract:
    // The live path must use Controller quota store (useStoredQuota: true).
    // An account marked exhausted or cooling down in the quota store must be excluded
    // with reason QUOTA_EXHAUSTED or COOLDOWN_ACTIVE.

    const tempHome = makeTempDir('home-quota-store-');
    const storeFile = quotaStore.storePath({ home: tempHome });

    // Mark acc-exhausted as exhausted in store file
    writeJson(storeFile, {
      version: 1,
      accounts: {
        'acc-exhausted': {
          status: 'exhausted',
          quotaScope: 'scope-exhausted',
          updatedAt: Date.now(),
        },
        'acc-healthy': {
          status: 'green',
          quotaScope: 'scope-healthy',
          updatedAt: Date.now(),
        },
      },
      reservations: [],
    });

    const candExhausted = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router1',
      upstream: 'up1',
      accountId: 'acc-exhausted',
      quotaScope: 'scope-exhausted',
      modelId: 'vendor/model-exhausted',
      latencyMs: 100,
      quality: 90,
      capabilities: {},
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const candHealthy = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router2',
      upstream: 'up2',
      accountId: 'acc-healthy',
      quotaScope: 'scope-healthy',
      modelId: 'vendor/model-healthy',
      latencyMs: 200,
      quality: 85,
      capabilities: {},
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const item = {
      id: 'TASK-AI-73-QUOTA',
      roleRequirement: { role: 'writer' },
      complexity: 'standard',
    };

    const evidenceData = {
      [candidateKey(candExhausted)]: candExhausted.evidence,
      [candidateKey(candHealthy)]: candHealthy.evidence,
    };

    const decisionDir = makeTempDir('decision-quota-');
    const decision = await orchestrate.selectCandidateForProfile(
      item,
      [candExhausted, candHealthy],
      [],
      evidenceData,
      {
        decisionDir,
        home: tempHome,
      },
      { dir: decisionDir },
      Date.now()
    );

    assert.equal(
      decision.chosen,
      candidateKey(candHealthy),
      'Healthy candidate must be chosen over exhausted candidate'
    );

    const rejectedReasons = (decision.result.rejected || []).map((r) => r.reasonCode);
    assert.ok(
      rejectedReasons.includes('QUOTA_EXHAUSTED'),
      'Exhausted candidate must be rejected with QUOTA_EXHAUSTED: ' +
        JSON.stringify(rejectedReasons)
    );
  });

  // =========================================================================
  // Test 8: reservation/current load changes ranking
  // =========================================================================
  test('8 reservation/current load changes ranking', async () => {
    // Expected contract:
    // Candidate A has higher initial score (85) than Candidate B (75).
    // In the live quota store, Candidate A holds 2 active reservations from other tasks.
    // Penalty is 20 per reservation (total 40 penalty points), bringing Candidate A to 45.
    // Candidate B (score 75) outscores Candidate A and ranks #1.
    // The live orchestrate selection must load reservations from the quota store.

    const tempHome = makeTempDir('home-reservation-');
    const storeFile = quotaStore.storePath({ home: tempHome });

    const keyA = 'paseo::cli::router1::up1::acc-a::scope-a::vendor/model-a';
    const keyB = 'paseo::cli::router2::up2::acc-b::scope-b::vendor/model-b';

    const candA = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router1',
      upstream: 'up1',
      accountId: 'acc-a',
      quotaScope: 'scope-a',
      modelId: 'vendor/model-a',
      latencyMs: 100,
      quality: 85,
      capabilities: {},
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const candB = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router2',
      upstream: 'up2',
      accountId: 'acc-b',
      quotaScope: 'scope-b',
      modelId: 'vendor/model-b',
      latencyMs: 120,
      quality: 75,
      capabilities: {},
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    // Record two reservations for Candidate A in quota store
    quotaStore.recordReservation('TASK-OTHER-1', 'writer', 'acc-a', keyA, 50000, {
      home: tempHome,
      path: storeFile,
      now: Date.now(),
    });
    quotaStore.recordReservation('TASK-OTHER-2', 'writer', 'acc-a', keyA, 50000, {
      home: tempHome,
      path: storeFile,
      now: Date.now(),
    });

    const item = {
      id: 'TASK-AI-73-BUSY',
      roleRequirement: { role: 'writer' },
      complexity: 'standard',
    };

    const evidenceData = {
      [keyA]: candA.evidence,
      [keyB]: candB.evidence,
    };

    const decisionDir = makeTempDir('decision-busy-');
    const decision = await orchestrate.selectCandidateForProfile(
      item,
      [candA, candB],
      [],
      evidenceData,
      {
        decisionDir,
        home: tempHome,
      },
      { dir: decisionDir },
      Date.now()
    );

    assert.equal(
      decision.chosen,
      keyB,
      'Active reservations held by Candidate A in quota-store must penalize it so Candidate B ranks first'
    );
    const rankedA = decision.result.ranking.find((c) => c.candidateKey === keyA);
    assert.ok(rankedA, 'Candidate A must be in ranking');
    assert.equal(
      rankedA.reservationsHeld,
      2,
      'Candidate A must reflect 2 reservations held from the quota store'
    );
  });

  // =========================================================================
  // Test 9: strongest eligible candidate ranks first
  // =========================================================================
  test('9 strongest eligible candidate ranks first', async () => {
    // Expected contract:
    // Candidate 1: Fast (latency 80ms) but only API_PASS proof (ineligible).
    // Candidate 2: Strongest eligible (meets WORK_ITEM_PASS, quality 90, latency 400ms).
    // Candidate 3: Eligible but lower score (WORK_ITEM_PASS, quality 70, latency 800ms).
    // Candidate 2 must rank first and be chosen with full 7-part key.

    const candIneligible = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router1',
      upstream: 'up1',
      accountId: 'acc1',
      quotaScope: 'scope1',
      modelId: 'vendor/model-fast-unproven',
      latencyMs: 80,
      quality: 95,
      capabilities: { tools: true, 'workspace-edit': true },
      evidence: [{ status: 'passed', level: 'api', proofLevel: 'API_PASS' }],
    };

    const candStrongestEligible = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router2',
      upstream: 'up2',
      accountId: 'acc2',
      quotaScope: 'scope2',
      modelId: 'vendor/model-strong-eligible',
      latencyMs: 400,
      quality: 90,
      capabilities: { tools: true, 'workspace-edit': true },
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const candEligibleLower = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router3',
      upstream: 'up3',
      accountId: 'acc3',
      quotaScope: 'scope3',
      modelId: 'vendor/model-lower-eligible',
      latencyMs: 800,
      quality: 70,
      capabilities: { tools: true, 'workspace-edit': true },
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const item = {
      id: 'TASK-AI-73-STRONGEST',
      roleRequirement: { role: 'writer' },
      complexity: 'complex',
      capabilities: ['tools', 'workspace-edit'],
    };

    const evidenceData = {
      [candidateKey(candIneligible)]: candIneligible.evidence,
      [candidateKey(candStrongestEligible)]: candStrongestEligible.evidence,
      [candidateKey(candEligibleLower)]: candEligibleLower.evidence,
    };

    const decisionDir = makeTempDir('decision-strongest-');
    const decision = await orchestrate.selectCandidateForProfile(
      item,
      [candIneligible, candStrongestEligible, candEligibleLower],
      [],
      evidenceData,
      { decisionDir },
      { dir: decisionDir },
      Date.now()
    );

    assert.equal(
      decision.chosen,
      candidateKey(candStrongestEligible),
      'Strongest eligible candidate meeting proof and quality floors must be chosen'
    );
    assert.match(
      decision.chosen,
      /^([^:]+::){6}[^:]+$/,
      'Chosen candidate must be a full 7-part key'
    );
  });

  // =========================================================================
  // Test 10: reviewer differs from writer and failure domain
  // =========================================================================
  test('10 reviewer differs from writer and failure domain', async () => {
    // Expected contract:
    // Writer candidate: paseo::cli::router-a::upstream-alpha::acc-w::scope-w::model-writer
    // Writer failure domain: router-a/upstream-alpha
    // Reviewer candidates:
    // - R1 (same key as writer): rejected with REVIEWER_EQUALS_WRITER
    // - R2 (same failure domain router-a/upstream-alpha): rejected with FORBIDDEN_FAILURE_DOMAIN
    // - R3 (distinct failure domain router-b/upstream-beta): chosen as reviewer

    const writerKey = 'paseo::cli::router-a::upstream-alpha::acc-w::scope-w::model-writer';

    const candR1 = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router-a',
      upstream: 'upstream-alpha',
      accountId: 'acc-w',
      quotaScope: 'scope-w',
      modelId: 'model-writer',
      quality: 95,
      latencyMs: 100,
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const candR2 = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router-a',
      upstream: 'upstream-alpha',
      accountId: 'acc-other',
      quotaScope: 'scope-other',
      modelId: 'model-r2',
      quality: 92,
      latencyMs: 110,
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const candR3 = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router-b',
      upstream: 'upstream-beta',
      accountId: 'acc-r3',
      quotaScope: 'scope-r3',
      modelId: 'model-r3',
      quality: 88,
      latencyMs: 150,
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const item = {
      id: 'TASK-AI-73-REVIEW',
      roleRequirement: { role: 'reviewer' },
      complexity: 'standard',
      writerCandidateKey: writerKey,
    };

    const evidenceData = {
      [candidateKey(candR1)]: candR1.evidence,
      [candidateKey(candR2)]: candR2.evidence,
      [candidateKey(candR3)]: candR3.evidence,
    };

    const decisionDir = makeTempDir('decision-reviewer-domain-');
    // Forbidden domain for reviewer includes the writer composite failure domain
    const forbiddenDomains = ['router-a/upstream-alpha'];

    const decision = await orchestrate.selectCandidateForProfile(
      item,
      [candR1, candR2, candR3],
      forbiddenDomains,
      evidenceData,
      { decisionDir },
      { dir: decisionDir },
      Date.now()
    );

    assert.notEqual(
      decision.chosen,
      writerKey,
      'Reviewer candidate must not equal writer candidate'
    );
    assert.notEqual(
      decision.chosen,
      candidateKey(candR2),
      'Reviewer candidate must not share failure domain with writer'
    );
    assert.equal(
      decision.chosen,
      candidateKey(candR3),
      'Reviewer with separate failure domain must be selected'
    );

    const rejections = decision.result.rejected || [];
    const r1Rej = rejections.find((r) => r.candidateKey === writerKey);
    assert.ok(r1Rej, 'Writer candidate must be in rejections');
    assert.equal(r1Rej.reasonCode, 'REVIEWER_EQUALS_WRITER');

    const r2Rej = rejections.find((r) => r.candidateKey === candidateKey(candR2));
    assert.ok(r2Rej, 'Same-failure-domain candidate R2 must be in rejections');
    assert.equal(r2Rej.reasonCode, 'FORBIDDEN_FAILURE_DOMAIN');
  });

  // =========================================================================
  // Test 11: reviewer missing identity/artifact -> publisher refuses
  // =========================================================================
  test('11 reviewer missing identity/artifact -> publisher refuses', () => {
    // Expected contract:
    // Publisher must fail closed without:
    // - reviewed SHA
    // - reviewer candidate key
    // - review artifact
    // - PASS on that SHA
    // - failure-domain separation between writer and reviewer
    // - valid approval

    const repo = makeTempRepo('pub-refuse-');
    const dummyApprId = 'APPR-TASK-73-01';

    const baseOpts = {
      cwd: repo.dir,
      reviewedSha: repo.sha,
      approvalId: dummyApprId,
      expiry: Date.now() + 600000,
      verdict: 'PASS',
      remoteUrl: 'https://github.com/shipde/platform.git',
      branch: 'feat/task-ai-73',
      testMode: true,
    };

    // Subcase A: Missing reviewer candidate key
    assert.throws(
      () => publisher.publish(Object.assign({}, baseOpts, { reviewerCandidateKey: null })),
      /PUBLISH_REFUSED.*reviewer/i,
      'Publisher must refuse when reviewer candidate key is missing'
    );

    // Subcase B: Missing review artifact
    assert.throws(
      () =>
        publisher.publish(
          Object.assign({}, baseOpts, {
            reviewerCandidateKey: 'paseo::cli::gw2::up2::acc2::scope2::model2',
            reviewArtifact: null,
          })
        ),
      /PUBLISH_REFUSED.*review.*artifact/i,
      'Publisher must refuse when review artifact is missing'
    );

    // Subcase C: Non-existent review artifact path
    assert.throws(
      () =>
        publisher.publish(
          Object.assign({}, baseOpts, {
            reviewerCandidateKey: 'paseo::cli::gw2::up2::acc2::scope2::model2',
            reviewArtifact: path.join(repo.dir, 'non-existent-review-artifact.json'),
          })
        ),
      /PUBLISH_REFUSED.*review.*artifact/i,
      'Publisher must refuse when review artifact does not exist on disk'
    );

    // Subcase D: Reviewer shares failure domain with writer
    assert.throws(
      () =>
        publisher.publish(
          Object.assign({}, baseOpts, {
            reviewerCandidateKey: 'paseo::cli::gw1::up1::acc-rev::scope-rev::model-rev',
            writerCandidateKey: 'paseo::cli::gw1::up1::acc-w::scope-w::model-w',
            reviewArtifact: __filename,
          })
        ),
      /PUBLISH_REFUSED.*failure.*domain/i,
      'Publisher must refuse when reviewer shares failure domain with writer'
    );
  });

  // =========================================================================
  // Test 12: decision log has top 3 keys, scores, breakdown, rejection reasons
  // =========================================================================
  test('12 decision log has top 3 keys, scores, breakdown, rejection reasons', async () => {
    // Expected contract:
    // Every selection decision log entry must durably record:
    // - workItemId
    // - task profile
    // - top 3 full keys with score and breakdown: entry.top3 = [{ candidateKey, score, breakdown: { latency, quality, cost } }, ...]
    // - selected: 7-part candidate key
    // - firstChoice: 7-part candidate key
    // - rejected: array of { candidateKey, reasonCode }
    // - weightProfile: e.g. 'BALANCED' | 'QUALITY_FIRST' | 'LATENCY_FIRST'
    // - proof level / evidence

    const cand1 = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router1',
      upstream: 'up1',
      accountId: 'acc1',
      quotaScope: 'scope1',
      modelId: 'vendor/model-1',
      quality: 85,
      latencyMs: 200,
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const cand2 = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router2',
      upstream: 'up2',
      accountId: 'acc2',
      quotaScope: 'scope2',
      modelId: 'vendor/model-2',
      quality: 80,
      latencyMs: 300,
      evidence: [{ status: 'passed', level: 'work-item', proofLevel: 'WORK_ITEM_PASS' }],
    };

    const candRejected = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router3',
      upstream: 'up3',
      accountId: 'acc3',
      quotaScope: 'scope3',
      modelId: 'vendor/model-rejected',
      quality: 10,
      latencyMs: 500,
      evidence: [],
    };

    const item = {
      id: 'TASK-AI-73-DECISION-LOG',
      roleRequirement: { role: 'writer' },
      complexity: 'complex',
    };

    const evidenceData = {
      [candidateKey(cand1)]: cand1.evidence,
      [candidateKey(cand2)]: cand2.evidence,
    };

    const decisionDir = makeTempDir('decision-log-check-');

    await orchestrate.selectCandidateForProfile(
      item,
      [cand1, cand2, candRejected],
      [],
      evidenceData,
      {
        decisionDir,
        jevAsk: async () => ({
          choice: 'QUALITY_FIRST',
          confidence: 0.95,
          probabilities: { QUALITY_FIRST: 0.95, BALANCED: 0.05 },
          jevModel: 'jev-latest',
        }),
      },
      { dir: decisionDir },
      Date.now()
    );

    // Read the recorded decision log file
    const files = fs
      .readdirSync(decisionDir)
      .filter((f) => f.endsWith('.jsonl') || f.endsWith('.json'));
    assert.ok(files.length > 0, 'Decision log file must be created');

    const content = fs.readFileSync(path.join(decisionDir, files[0]), 'utf8').trim();
    const lines = content.split('\n').filter(Boolean);
    const entry = JSON.parse(lines[lines.length - 1]);

    assert.equal(entry.workItemId, 'TASK-AI-73-DECISION-LOG');
    assert.ok(entry.taskProfile, 'Decision log must record taskProfile');
    assert.strictEqual(entry.jevModel, 'jev-latest', 'Decision log must record JEV model');
    assert.strictEqual(entry.confidence, 0.95, 'Decision log must record JEV confidence');
    assert.deepStrictEqual(
      entry.probabilities,
      { QUALITY_FIRST: 0.95, BALANCED: 0.05 },
      'Decision log must record JEV probabilities'
    );
    assert.ok(entry.jev, 'Decision log must record jev assessment');
    assert.strictEqual(entry.jev.jevModel, 'jev-latest');
    assert.deepStrictEqual(entry.jev.probabilities, { QUALITY_FIRST: 0.95, BALANCED: 0.05 });

    // top3 contract check
    assert.ok(
      Array.isArray(entry.top3) && entry.top3.length > 0,
      'Decision log entry must contain top3 array with candidate entries'
    );
    for (const topItem of entry.top3) {
      assert.match(
        topItem.candidateKey,
        /^([^:]+::){6}[^:]+$/,
        'top3 entry must contain full 7-part candidateKey'
      );
      assert.ok(Number.isFinite(Number(topItem.score)), 'top3 entry must contain numeric score');
      const breakdown = topItem.scoreBreakdown || topItem.breakdown;
      assert.ok(
        breakdown && typeof breakdown === 'object',
        'top3 entry must contain score breakdown'
      );
    }

    assert.ok(entry.selected || entry.chosen, 'Decision log entry must record selected candidate');
    assert.ok(entry.firstChoice, 'Decision log entry must record firstChoice candidate');

    assert.ok(Array.isArray(entry.rejected), 'Decision log entry must record rejected array');
    for (const rej of entry.rejected) {
      assert.ok(rej.candidateKey, 'Rejected item must have candidateKey');
      assert.ok(rej.reasonCode, 'Rejected item must have reasonCode');
    }

    assert.ok(entry.weightProfile, 'Decision log entry must record weightProfile');
  });

  // =========================================================================
  // Test 13: a new source/model added by data only is ranked without code changes
  // =========================================================================
  test('13 a new source/model added by data only is ranked without code changes', () => {
    // Expected contract:
    // Adding a new source/model is a DATA CHANGE ONLY.
    // When a new source (e.g. 'aurora') is added in sources.json and accounts in accounts.json:
    // 1. Candidate generator produces valid candidate with 7-part key for the new model.
    // 2. The new candidate is evaluated and ranked by the Controller ranking logic without code changes.

    const customSourcesPath = path.join(FIXTURES_DIR, 'sources-new-provider.json');
    const customAccountsPath = path.join(FIXTURES_DIR, 'accounts-new-provider.json');
    const customCataloguePath = path.join(FIXTURES_DIR, 'catalogue-new-provider.jsonl');

    const sourcesRegistry = sourcesApi.loadSources({ file: customSourcesPath });
    assert.ok(
      sourcesRegistry.sources.some((s) => s.id === 'aurora'),
      'Fixture registry must contain new source aurora'
    );

    const accountsData = JSON.parse(fs.readFileSync(customAccountsPath, 'utf8')).accounts;
    const catalogueLines = fs
      .readFileSync(customCataloguePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const catalogueModels = catalogueLines.map((c) => c.modelId);

    // Generate candidates from data
    const candidates = candidatesApi.generateCandidates({
      registry: sourcesRegistry,
      accounts: accountsData,
      catalogue: catalogueModels,
    });

    const auroraCandidate = candidates.find((c) => c.modelId === 'aurora/aurora-coder-xl');

    assert.ok(
      auroraCandidate,
      'Candidate generator must produce candidate for new source/model aurora/aurora-coder-xl from data only'
    );

    const profile = {
      taskId: 'TASK-AI-73-DATA-ONLY',
      role: 'writer',
      complexity: 'standard',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      contextSize: 4000,
      expectedDuration: 30000,
      latencyPriority: 'normal',
      qualityFloor: 10,
      costCeiling: 1000,
      requiredHarness: null,
      forbiddenFailureDomains: [],
      resourceCeiling: 10,
      currentWorkload: 0,
    };

    const assessment = {
      jevOutcome: 'UNDECIDED',
      decidedBy: 'controller',
      weightProfile: 'BALANCED',
      weights: { latency: 34, quality: 33, cost: 33 },
    };

    const rankResult = routing.rankForProfile([auroraCandidate], profile, assessment, {
      now: Date.now(),
    });

    assert.ok(
      rankResult.chosen,
      'New model added by data only must be eligible and rankable by Controller without code changes'
    );
    assert.equal(rankResult.chosen, candidateKey(auroraCandidate));
  });

  // =========================================================================
  // Test 14: JEV adapter follows TypeSafe OpenAPI contract and never sends legacy shape
  // =========================================================================
  test('14 JEV adapter follows TypeSafe OpenAPI contract and never sends legacy shape {kind, prompt, evidence, options}', async () => {
    // Expected contract:
    // 1. JEV model name must come from data (source.model), returning null if missing.
    // 2. HTTP POST is to /v1/systemone with { model, state, questions: { weightProfile: { type: 'choice', instructions, criteria } } }.
    // 3. Legacy fields (kind, prompt, evidence, options) are never sent.
    // 4. Response parsing extracts choice, confidence, probabilities, jevModel, usage.

    // Part 1: source without model returns null
    const noModelSource = {
      id: 'jev',
      kind: 'decision-service',
      endpoint: 'https://api.typesafe.ai/v1/systemone',
      credential: { type: 'api-key', env: 'TYPESAFE_API_KEY' },
    };
    assert.strictEqual(
      jev.buildJevAsk(noModelSource, { env: { TYPESAFE_API_KEY: 'test-key' } }),
      null,
      'buildJevAsk must return null if source.model is not specified in data'
    );

    // Part 2: real contract mock server
    const serverRequests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const parsedBody = body ? JSON.parse(body) : {};
        serverRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: parsedBody,
        });

        // If legacy fields are posted, simulate api.typesafe.ai HTTP 400 Invalid request
        if (parsedBody.kind || parsedBody.prompt || parsedBody.options) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request: legacy fields not allowed' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            model: 'jev-latest',
            answers: {
              weightProfile: {
                type: 'choice',
                choice: 'BALANCED',
                confidence: 0.97,
                probabilities: {
                  BALANCED: 0.97,
                  LATENCY_FIRST: 0.02,
                  QUALITY_FIRST: 0.01,
                },
              },
            },
            usage: { input_tokens: 120, output_tokens: 8 },
          })
        );
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const source = {
        id: 'jev',
        kind: 'decision-service',
        endpoint: `http://127.0.0.1:${port}/v1/systemone`,
        model: 'jev-latest',
        credential: { type: 'api-key', env: 'TYPESAFE_API_KEY' },
        minConfidence: 0.7,
      };

      const ask = jev.buildJevAsk(source, { env: { TYPESAFE_API_KEY: 'test-key-123' } });
      assert.strictEqual(typeof ask, 'function', 'buildJevAsk must return an async ask function');

      const question = {
        kind: 'advisory',
        prompt: 'Choose the optimal weighting profile for this task.',
        evidence: JSON.stringify({ taskId: 'TASK-AI-73-PROBE', complexity: 'standard' }),
        options: ['BALANCED', 'LATENCY_FIRST', 'QUALITY_FIRST'],
      };

      const advice = await ask(question);
      assert.strictEqual(advice.choice, 'BALANCED');
      assert.strictEqual(advice.confidence, 0.97);
      assert.deepStrictEqual(advice.probabilities, {
        BALANCED: 0.97,
        LATENCY_FIRST: 0.02,
        QUALITY_FIRST: 0.01,
      });
      assert.strictEqual(advice.jevModel, 'jev-latest');
      assert.deepStrictEqual(advice.usage, { input_tokens: 120, output_tokens: 8 });

      // Verify the recorded HTTP request strictly satisfies the OpenAPI contract
      assert.strictEqual(serverRequests.length, 1);
      const req = serverRequests[0];
      assert.strictEqual(req.method, 'POST');
      assert.strictEqual(req.url, '/v1/systemone');
      assert.strictEqual(req.headers.authorization, 'Bearer test-key-123');

      const reqBody = req.body;
      assert.strictEqual(reqBody.model, 'jev-latest');
      assert.strictEqual(reqBody.state, question.evidence);
      assert.ok(reqBody.questions && reqBody.questions.weightProfile);
      assert.strictEqual(reqBody.questions.weightProfile.type, 'choice');
      assert.strictEqual(reqBody.questions.weightProfile.instructions, question.prompt);
      assert.deepStrictEqual(
        Object.keys(reqBody.questions.weightProfile.criteria).sort(),
        ['BALANCED', 'LATENCY_FIRST', 'QUALITY_FIRST'].sort()
      );

      // Explicit assertions that old shape is NOT sent
      assert.strictEqual(reqBody.kind, undefined, 'legacy field kind must not be sent');
      assert.strictEqual(reqBody.prompt, undefined, 'legacy field prompt must not be sent');
      assert.strictEqual(reqBody.evidence, undefined, 'legacy field evidence must not be sent');
      assert.strictEqual(reqBody.options, undefined, 'legacy field options must not be sent');
    } finally {
      server.close();
    }
  });

  // =========================================================================
  // Test 15: capability evidence is read from bound accounts and minContext sets contextSize
  // =========================================================================
  test('15 capability evidence is read from bound accounts and minContext sets contextSize', async () => {
    // Problem 2 contract:
    // 1. minContext is not a boolean capability; it sets profile.contextSize and is excluded from requiredCapabilities.
    // 2. Candidate generation reads capabilities declared on bound accounts.
    // 3. Candidates with declared capabilities pass the capability filter and do not reject with CAPABILITY_MISSING:jsonSchema.

    const workItem = {
      id: 'TASK-AI-73-CAP-TEST',
      roleRequirement: {
        role: 'author.foundation',
        requires: {
          jsonSchema: true,
          tools: true,
          minContext: 200000,
        },
      },
      complexity: 'standard',
    };

    // 1. buildTaskProfile sets contextSize to 200000 and excludes minContext from requiredCapabilities
    const profile = orchestrate.buildTaskProfile(workItem);
    assert.strictEqual(
      profile.contextSize,
      200000,
      'contextSize must be derived from roleCaps.minContext'
    );
    assert.ok(
      !profile.requiredCapabilities.includes('minContext'),
      'minContext must NOT appear in requiredCapabilities'
    );
    assert.ok(
      profile.requiredCapabilities.includes('jsonSchema'),
      'jsonSchema must be in requiredCapabilities'
    );
    assert.ok(
      profile.requiredCapabilities.includes('tools'),
      'tools must be in requiredCapabilities'
    );

    // 2. Candidate generation reads capabilities from bound accounts
    const fakeRegistry = {
      sources: [
        {
          id: '9router',
          kind: 'router',
          harness: 'hermes',
          accessPath: 'http://127.0.0.1:20128/v1',
          servesModels: true,
        },
      ],
      dispatch: {
        providers: {
          ninerouter: { harness: 'hermes', accessPath: 'http://127.0.0.1:20128/v1' },
        },
      },
    };

    const fakeAccounts = [
      {
        id: 'ninerouter',
        provider: '9router',
        enabled: true,
        capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
        cost: { inputPerMillion: 1, outputPerMillion: 2 },
      },
    ];

    const generated = candidatesApi.generateCandidates({
      registry: fakeRegistry,
      accounts: fakeAccounts,
      catalogue: ['xmtp/mimo-v2.6-pro'],
    });

    assert.ok(generated.length > 0, 'Candidates must be generated for xmtp/mimo-v2.6-pro');
    const candObj = generated[0];
    assert.strictEqual(
      candObj.capabilities.jsonSchema,
      true,
      'candidate must retain jsonSchema capability'
    );
    assert.strictEqual(candObj.capabilities.tools, true, 'candidate must retain tools capability');
    assert.strictEqual(
      candObj.capabilities.contextWindow,
      200000,
      'candidate must retain contextWindow'
    );

    // 3. Candidate evaluation against profile
    const assessment = {
      jevOutcome: 'UNDECIDED',
      decidedBy: 'controller',
      weightProfile: 'BALANCED',
      weights: { latency: 34, quality: 33, cost: 33 },
    };

    const rankResult = routing.rankForProfile([candObj], profile, assessment, {
      now: Date.now(),
      evidenceData: {},
    });

    // The candidate MUST NOT be rejected for CAPABILITY_MISSING:jsonSchema or CONTEXT_TOO_SMALL
    const capabilityRejections = rankResult.rejected.filter(
      (r) => r.reasonCode.startsWith('CAPABILITY_MISSING') || r.reasonCode === 'CONTEXT_TOO_SMALL'
    );
    assert.strictEqual(
      capabilityRejections.length,
      0,
      'Candidate must pass capability floor; rejected reasons: ' +
        JSON.stringify(rankResult.rejected)
    );

    // Because profile has proofFloor WORK_ITEM_PASS and evidenceData is empty, the honest refusal is PROOF_FLOOR_NOT_MET:NONE
    assert.strictEqual(
      rankResult.rejected[0].reasonCode,
      'PROOF_FLOOR_NOT_MET:NONE',
      'Refusal must strictly be due to missing WORK_ITEM_PASS evidence'
    );
  });
});
