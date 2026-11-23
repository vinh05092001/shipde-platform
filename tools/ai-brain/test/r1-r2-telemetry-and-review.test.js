'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const combo = require('../combo');
const comboReader = require('../combo-reader');
const { candidateKey } = require('../candidates');
const { selectCandidateForProfile } = require('../orchestrate/candidate-select');
const { reviewItem } = require('../orchestrate/review-item');
const { runOrchestration } = require('../orchestrate');
const { orchestrateCommand } = require('../cli/commands');

const REGISTRY = {
  dispatch: { nineRouterWriterCombo: 'vinh', comboSource: '9router' },
  sources: [
    {
      id: '9router',
      kind: 'router',
      servesModels: true,
      harness: 'opencode-direct',
      endpoint: 'http://127.0.0.1:20128/v1',
      credential: { type: 'api-key', env: 'NINEROUTER_API_KEY' },
    },
  ],
};

const PRIORS = {
  ranking: [
    {
      canonical: 'glm-5-3',
      codingTier: 'T1',
      reviewTier: 'T1',
      benchmarks: [{ name: 'aaCodingIndex', score: 88 }],
    },
    {
      canonical: 'kimi-3',
      codingTier: 'T1',
      reviewTier: 'T1',
      benchmarks: [{ name: 'aaCodingIndex', score: 85 }],
    },
    {
      canonical: 'claude-4.5',
      codingTier: 'T1',
      reviewTier: 'T1',
      benchmarks: [{ name: 'aaCodingIndex', score: 82 }],
    },
  ],
};

function makeLogOpts(prefix = 'shipde-r1r2-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, now: Date.UTC(2026, 10, 23, 3, 0, 0), runId: 'test-r1r2' };
}

test('R1 telemetry records gate, poolKinds, readState, readStatus, rawCount, eligibleCount without secrets', async () => {
  const env = { NINEROUTER_API_KEY: 'super-secret-token-value' };
  const baseCombo = combo.comboCandidate({ registry: REGISTRY, env }).candidate;
  const logOpts = makeLogOpts();

  const decision = await selectCandidateForProfile(
    { id: 'TASK-TEL-1', complexity: 'standard' },
    [baseCombo],
    [],
    {},
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      readComboConfig: async () => ({
        name: 'vinh',
        members: null,
        state: 'COMBO_CONFIG_UNAVAILABLE',
        status: 503,
      }),
    },
    logOpts,
    logOpts.now,
    {}
  );

  assert.equal(decision.reason, 'combo-only routing');
  assert.deepEqual(decision.decisionRecorded.comboJevFallback, {
    gate: true,
    poolKinds: ['combo'],
    readState: 'COMBO_CONFIG_UNAVAILABLE',
    readStatus: 503,
    rawCount: 0,
    eligibleCount: 0,
  });
  assert.doesNotMatch(JSON.stringify(decision.decisionRecorded), /super-secret-token-value/);
});

test('R1 live-shaped orchestrate replay excludes 402 upstream on attempt 2 and falls back with telemetry when members exhausted', async (t) => {
  const origRead = comboReader.readComboConfig;
  let readCalls = 0;
  comboReader.readComboConfig = async () => {
    readCalls += 1;
    return {
      name: 'vinh',
      state: 'READ',
      status: 200,
      members: ['bzl/glm-5.3', 'llm7/kimi-3', 'ag/claude-4.5'],
    };
  };
  t.after(() => {
    comboReader.readComboConfig = origRead;
  });

  const logOpts = makeLogOpts('replay-r1-');
  const log = await runOrchestration('R1 replay', {
    specs: [
      {
        id: 'TASK-R1',
        objective: 'test R1 retry',
        allowedPaths: ['a.js'],
        acceptanceCriteria: ['ok'],
        verification: { command: 'echo ok' },
      },
    ],
    registry: REGISTRY,
    priors: PRIORS,
    env: { NINEROUTER_API_KEY: 'test-key' },
    decisionDir: logOpts.dir,
    // Matches real CLI wiring in cli/commands.js (no readComboConfig/comboMembers injected)
    comboJevSelect: true,
    run: () => ({
      exitCode: 1,
      stderr:
        'OPENCODE_ERROR: [bazaarlink/glm-5.3] [402]: {"error":{"message":"This request requires more credits","type":"invalid_request_error","code":402}} (reset after 19s) (HTTP 503)',
    }),
  });

  assert.equal(readCalls, 4);
  assert.equal(log.selections.length, 4);
  assert.match(log.selections[0].decision.reason, /^combo-jev:.*\(bzl\/glm-5\.3\)$/);
  assert.match(log.selections[1].decision.reason, /^combo-jev:.*\(llm7\/kimi-3\)$/);
  assert.match(log.selections[2].decision.reason, /^combo-jev:.*\(ag\/claude-4\.5\)$/);
  assert.equal(log.selections[3].decision.reason, 'combo-only routing');
  assert.deepEqual(log.selections[3].decision.decisionRecorded.comboJevFallback, {
    gate: true,
    poolKinds: ['combo', 'comboMember', 'comboMember', 'comboMember'],
    readState: 'READ',
    readStatus: 200,
    rawCount: 3,
    eligibleCount: 0,
  });
});

test('R2 strictIndependentComboReview refuses opaque-combo writer reuse even across gate-off fallback and reviewerIdentity overrides', async () => {
  const env = { NINEROUTER_API_KEY: 'test-key' };
  const baseCombo = combo.comboCandidate({ registry: REGISTRY, env }).candidate;
  const logOpts = makeLogOpts('strict-r2-');

  // Gate-off fallback (comboJevSelect: false) in strict mode still refuses opaque combo reviewer
  const gateOffRefused = await selectCandidateForProfile(
    {
      id: 'TASK-R2-gateoff-review',
      roleRequirement: { role: 'reviewer' },
      writerCandidateKey: candidateKey(baseCombo),
    },
    [baseCombo],
    [],
    {},
    {
      registry: REGISTRY,
      env,
      comboJevSelect: false,
      strictIndependentComboReview: true,
    },
    logOpts,
    logOpts.now,
    {}
  );
  assert.equal(gateOffRefused.chosen, null);
  assert.equal(gateOffRefused.reason, 'NO_INDEPENDENT_REVIEWER');
  assert.ok(gateOffRefused.result.rejected.length > 0);
  assert.equal(gateOffRefused.decisionRecorded.comboJevFallback.gate, false);

  // reviewItem with explicit reviewerIdentity override still refuses when strictIndependentComboReview is true
  let launchCount = 0;
  const reviewRes = await reviewItem(
    {
      registry: REGISTRY,
      env,
      priors: PRIORS,
      comboMembers: [],
      strictIndependentComboReview: true,
      reviewerIdentity: candidateKey(baseCombo),
      reviewBudget: 1,
      formatCheck: false,
      tests: async () => ({ pass: true, command: 'noop', detail: 'ok' }),
    },
    { id: 'TASK-R2-override', complexity: 'standard', allowedPaths: ['a.js'] },
    {
      candidateKey: candidateKey(baseCombo),
      headSha: 'a'.repeat(40),
      branch: 'feat/task-r2-override',
    },
    { goal: 'test', reviews: [], formatChecks: [], toolGates: [] },
    logOpts,
    async () => {
      launchCount += 1;
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    logOpts.dir,
    logOpts.now,
    [baseCombo],
    {},
    REGISTRY,
    {}
  );
  assert.equal(launchCount, 0);
  assert.notEqual(reviewRes.status, 'PASSED');

  // Legacy behavior preserved outside strictIndependentComboReview
  const legacyAllowed = await selectCandidateForProfile(
    {
      id: 'TASK-R2-legacy-review',
      roleRequirement: { role: 'reviewer' },
      writerCandidateKey: candidateKey(baseCombo),
    },
    [baseCombo],
    [],
    {},
    {
      registry: REGISTRY,
      env,
      comboJevSelect: false,
    },
    logOpts,
    logOpts.now,
    {}
  );
  assert.equal(legacyAllowed.chosen, candidateKey(baseCombo));
  assert.equal(legacyAllowed.reason, 'combo-only routing');
});

test('R2 CLI orchestrateCommand enables strictIndependentComboReview on live isolated runs and keeps it off for injected runs', async () => {
  let capturedOpts = null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-r2-'));
  const specsFile = path.join(dir, 'specs.json');
  fs.writeFileSync(
    specsFile,
    JSON.stringify([
      {
        id: 'TASK-CLI-R2',
        objective: 'test',
        allowedPaths: ['a.js'],
        acceptanceCriteria: ['ok'],
        verification: { command: 'echo ok' },
      },
    ])
  );

  await orchestrateCommand(
    {
      goal: 'test',
      specs: specsFile,
      'isolated-worker': true,
      'decision-dir': dir,
    },
    {
      registry: REGISTRY,
      env: { NINEROUTER_API_KEY: 'k' },
      runOrchestration: async (_goal, opts) => {
        capturedOpts = opts;
        return { status: 'COMPLETED', outcomes: [] };
      },
    }
  );
  assert.equal(capturedOpts.strictIndependentComboReview, true);

  let injectedOpts = null;
  await orchestrateCommand(
    {
      goal: 'test',
      specs: specsFile,
      'isolated-worker': true,
      'decision-dir': dir,
    },
    {
      registry: REGISTRY,
      env: { NINEROUTER_API_KEY: 'k' },
      run: () => ({ exitCode: 0 }),
      runOrchestration: async (_goal, opts) => {
        injectedOpts = opts;
        return { status: 'COMPLETED', outcomes: [] };
      },
    }
  );
  assert.equal(injectedOpts.strictIndependentComboReview, false);
});
