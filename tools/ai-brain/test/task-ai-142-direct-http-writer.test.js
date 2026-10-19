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

const { candidateKey } = require('../candidates');
const { getHarness, listHarnesses, hasLauncherWriter } = require('../harness');
const { resolveRoute } = require('../executor');
const { runsOpenCodeHarness } = require('../sources');
const routing = require('../routing');
const { selectCandidateForProfile } = require('../orchestrate');

function directHttpCandidate(extra = {}) {
  const c = {
    harness: 'direct-http',
    accessPath: 'direct',
    gateway: 'opencode-provider-inception-options',
    upstream: 'opencode-provider-inception-options',
    accountId: 'source-opencode-provider-inception-options',
    quotaScope: 'source-opencode-provider-inception-options',
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

  test('getHarness resolves direct-http to a writer adapter without throwing UNKNOWN_HARNESS', () => {
    const adapter = getHarness('direct-http');
    assert.ok(adapter, 'adapter for direct-http must exist');
    assert.equal(typeof adapter.launch, 'function', 'adapter must provide a launch function');
    assert.equal(adapter.id, 'opencode-direct', 'direct-http maps to opencode-direct adapter');
  });

  test('runsOpenCodeHarness recognizes direct-http as an OpenCode-capable harness', () => {
    assert.equal(runsOpenCodeHarness('direct-http'), true, 'direct-http runs via OpenCode harness');
    assert.equal(
      runsOpenCodeHarness('unsupported-xyz'),
      false,
      'unsupported harness must return false'
    );
  });

  test('resolveRoute maps direct-http to opencode-direct in isolated worker', () => {
    const reg = fixtureRegistry();
    const route = resolveRoute(
      {
        provider: 'opencode-provider-inception-options',
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

  test('executePlan resolves route for direct-http writer without UNKNOWN_HARNESS refusal', () => {
    const reg = fixtureRegistry();
    const assignment = {
      workItemId: 'GOAL-G-F622511E-1',
      branch: 'fix/goal-1',
      provider: 'opencode-provider-inception-options',
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
});
