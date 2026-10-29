'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classifyFailure } = require('../failure-classifier');
const { candidateKey } = require('../candidates');
const { selectCandidateForProfile } = require('../orchestrate');

test('agy-pool exit 3 with bare "quota" is an account-scoped quota failure', () => {
  const r = classifyFailure({ exitCode: 3, stderr: 'quota', stdout: '', harness: 'agy-pool' });
  assert.equal(r.cause, 'account_quota_exhausted');
  assert.equal(r.scope, 'account');
  assert.equal(
    classifyFailure({ exitCode: 3, stderr: 'not a quota line', stdout: '' }).cause,
    'unknown'
  );
});

test('an exhausted account blocks its own models only, not the other pool accounts', async () => {
  const mk = (accountId, modelId, quality) => {
    const c = {
      harness: 'agy-pool',
      gateway: 'g',
      upstream: 'antigravity',
      accountId,
      modelId,
      quality,
    };
    c.candidateKey = candidateKey(c);
    return c;
  };
  const a1 = mk('fixture-acct-a', 'claude-opus', 95);
  const a2 = mk('fixture-acct-a', 'claude-sonnet', 94);
  const b1 = mk('fixture-acct-b', 'claude-opus', 93);
  const failedKeys = [a1.candidateKey, 'account-exhausted::agy-pool::fixture-acct-a'];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-quota-'));
  try {
    const decision = await selectCandidateForProfile(
      { id: 'ITEM-ACCT-UNIT', roleRequirement: { role: 'reviewer' }, failedKeys },
      [a1, a2, b1],
      [],
      null,
      {
        registry: { sources: [] },
        jevAsk: async () => {
          throw new Error('no JEV');
        },
      },
      { dir, now: Date.now() },
      Date.now(),
      { failedKeys, decisionDir: dir }
    );
    const chosen = decision.chosen || decision.chosenKey || '';
    assert.equal(chosen, b1.candidateKey, 'the other account is chosen');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('account quota failure path writes exhaustedAccountKey into failedKeys without pre-seeding', async () => {
  const orchestrate = require('../orchestrate');
  const mk = (accountId, modelId, quality) => {
    const c = {
      harness: 'agy-pool',
      gateway: 'g',
      upstream: 'antigravity',
      accountId,
      modelId,
      quality,
    };
    c.candidateKey = candidateKey(c);
    return c;
  };
  const a1 = mk('fixture-acct-fail', 'claude-opus', 95);
  const a2 = mk('fixture-acct-fail', 'claude-sonnet', 94);
  const b1 = mk('fixture-acct-other', 'claude-opus', 93);

  const failedKeys = new Set();
  const item = { id: 'ITEM-ACCT-FAIL', roleRequirement: { role: 'reviewer' }, failedKeys };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-fail-path-'));

  try {
    const decision1 = await selectCandidateForProfile(
      item,
      [a1, a2, b1],
      [],
      null,
      {
        registry: { sources: [] },
        jevAsk: async () => {
          throw new Error('no JEV');
        },
      },
      { dir, now: Date.now() },
      Date.now(),
      { failedKeys, decisionDir: dir }
    );
    assert.equal(decision1.chosen, a1.candidateKey);

    let attempts = 0;
    const fakeLauncher = async (job) => {
      attempts += 1;
      if (job.accountId === 'fixture-acct-fail' || attempts === 1) {
        return { exitCode: 3, stderr: 'quota', stdout: '' };
      }
      if (job.verdictFile) {
        fs.writeFileSync(
          job.verdictFile,
          JSON.stringify({ verdict: 'PASS', pass: true, findings: [] })
        );
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const logObj = { stage: () => {}, formatChecks: [], reviews: [] };
    const session = { headSha: '0123456789012345678901234567890123456789', worktree: dir };

    await orchestrate.reviewItem(
      { cwd: dir, formatCheck: false, isolatedWorker: false, tests: () => ({ pass: true }) },
      item,
      session,
      logObj,
      { dir },
      fakeLauncher,
      path.join(dir, 'usage'),
      Date.now(),
      [a1, a2, b1],
      {},
      { sources: [] },
      { failedKeys, decisionDir: dir }
    );

    const expectedExhaustedMark = 'account-exhausted::agy-pool::fixture-acct-fail';
    assert.ok(
      failedKeys.has(expectedExhaustedMark),
      'failedKeys must contain the account-exhausted mark'
    );

    const decision2 = await selectCandidateForProfile(
      item,
      [a1, a2, b1],
      [],
      null,
      {
        registry: { sources: [] },
        jevAsk: async () => {
          throw new Error('no JEV');
        },
      },
      { dir, now: Date.now() },
      Date.now(),
      { failedKeys, decisionDir: dir }
    );
    assert.equal(
      decision2.chosen,
      b1.candidateKey,
      'subsequent selection isolates the exhausted account'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('OpenCode built-in source yields keyless writers from the live opencode model list', () => {
  const { generateCandidates } = require('../candidates');
  const registry = {
    sources: [
      {
        id: 'opencode-zen',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://opencode.ai/zen/v1',
        opencodeProvider: 'opencode',
        opencodeBuiltin: true,
        credential: { type: 'none' },
      },
    ],
  };
  const out = generateCandidates({
    registry,
    sourceModels: { 'opencode-zen': ['glm-5.3-flash-free', 'big-pickle'] },
  }).filter((c) => c.source === 'opencode-zen');
  assert.deepEqual(
    out.map((c) => c.modelId),
    ['opencode/glm-5.3-flash-free', 'opencode/big-pickle']
  );
  for (const c of out) {
    assert.equal(c.harness, 'opencode-direct');
    assert.equal(c.accountId, 'opencode-zen-keyless');
    assert.notEqual(c.blocked, true);
  }
});

test('agy-pool POOL_TIMEOUT indicts the model, not the upstream', () => {
  const r = classifyFailure({
    exitCode: 1,
    stderr: 'POOL_TIMEOUT',
    stdout: '',
    harness: 'agy-pool',
  });
  assert.equal(r.cause, 'timeout');
  assert.equal(r.scope, 'model');
});

test('writer result is read from the last opencode text event, not the whole JSON stream', () => {
  const { validate } = require('../writer-schema');
  const schema = {
    properties: {
      candidateKey: { enum: ['k'] },
      nonce: { enum: ['n'] },
      status: { enum: ['completed', 'failed', 'blocked'] },
      artifacts: {},
    },
    required: ['candidateKey', 'nonce', 'status', 'artifacts'],
  };
  const answer = JSON.stringify({
    candidateKey: 'k',
    nonce: 'n',
    status: 'completed',
    artifacts: [],
  });
  const stream = [
    JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
    JSON.stringify({
      type: 'tool_use',
      part: { type: 'tool', tool: 'read', state: { input: {} } },
    }),
    JSON.stringify({ type: 'text', part: { type: 'text', text: answer } }),
    JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', tokens: { total: 1 } } }),
  ].join('\n');
  const checked = validate(stream, schema);
  assert.equal(checked.ok, true, checked.reason);
  assert.equal(checked.value.status, 'completed');
});

test("a paid model's credit refusal does not cool down the gateway's free-tier models", () => {
  const rh = require('../route-health');
  const store = {
    version: 1,
    paths: {},
    providers: {},
    events: [],
    accounts: {
      '9router::cl': {
        account: '9router::cl',
        status: 'upstream_credit_exhausted',
        probeCause: 'upstream_credit_exhausted',
        nextCheckAt: new Date(Date.now() + 3600e3).toISOString(),
      },
    },
  };
  const c = (modelId) => ({
    harness: 'hermes',
    gateway: '9router',
    upstream: 'cl',
    accountId: 'acct',
    modelId,
  });
  const opts = { routeHealth: store };
  assert.match(rh.probeCooldown(c('cl/anthropic/claude-opus-5'), opts), /PROBE_COOLDOWN_ACCOUNT/);
  assert.equal(rh.probeCooldown(c('cl/nvidia/nemotron-3-ultra-550b-a55b:free'), opts), null);
  assert.equal(rh.probeCooldown(c('cl/cline-free/minimax-m3.1-flash'), opts), null);
});

test('a source modelsFilter keeps only the listing rows the provider marks free', () => {
  const { modelIds } = require('../source-discovery');
  const body = {
    data: [
      { id: 'minimax-m2.7', tier: 'turbo' },
      { id: 'claude-opus-5', tier: 'pro' },
      { id: 'gpt-oss:20b', tier: 'turbo' },
    ],
  };
  assert.deepEqual(modelIds(body, { tier: 'turbo' }), ['minimax-m2.7', 'gpt-oss:20b']);
  assert.equal(modelIds(body).length, 3);
});

test('an operator weight profile for the role overrides JEV and the Controller preset', async () => {
  const routing = require('../routing');
  const assessment = await routing.assessTask(
    {
      role: 'writer',
      complexity: 'complex',
      weightProfileOverride: 'BENCHMARK_ONLY',
      weightOverride: { quality: 100, latency: 0, cost: 0 },
    },
    { ask: async () => ({ choice: 'BALANCED', confidence: 0.99 }) }
  );
  assert.deepEqual(assessment.weights, { latency: 0, quality: 100, cost: 0 });
  assert.equal(assessment.weightSource, 'operator:BENCHMARK_ONLY');
  assert.ok(assessment.reasonCodes.includes('WEIGHTS_BENCHMARK_ONLY_OPERATOR'));
});

test('TASK-AI-142 Finding 7: readQuotaText does not treat model name Argon as quota text, and models-out.txt filters candidates', () => {
  const poolRuntime = require('../agy-pool-runtime');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-quota-test-'));

  try {
    const accDir = path.join(tempDir, 'agy01');
    fs.mkdirSync(accDir, { recursive: true });

    const quotaOutPath = path.join(accDir, 'quota-out.txt');
    const outPath = path.join(accDir, 'out.txt');

    fs.writeFileSync(quotaOutPath, 'Limit Remaining: 80%');
    // Ensure out.txt is newer but only has model output mention of Argon, not quota text
    const pastTime = new Date(Date.now() - 5000);
    fs.utimesSync(quotaOutPath, pastTime, pastTime);
    fs.writeFileSync(outPath, 'Selected model: gemini-2-Argon running execution steps');

    const result = poolRuntime.readQuotaText('agy01', { runsDir: tempDir });
    // Must NOT return outPath content because Argon is not quota text; must fall back to quotaOutPath
    assert.equal(
      result,
      'Limit Remaining: 80%',
      'readQuotaText must not treat Argon model name as quota text'
    );

    // Test models-out.txt filtering and unknown family exclusion in candidates
    const candidatesApi = require('../candidates');
    fs.writeFileSync(path.join(accDir, 'models-out.txt'), 'gemini-2.5-pro\n');
    const catalog = ['gemini-2.5-pro', 'gemini-2.5-flash', 'unknown-mystery-model'];
    const poolCandidates = candidatesApi.poolAccountCandidates({
      runsDir: tempDir,
      models: catalog,
      allowUnprobedCandidates: true,
      catalogue: catalog,
      registry: {
        sources: [
          {
            id: 'agy-pool',
            kind: 'pool',
            harness: 'agy-pool',
            servesModels: true,
            models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'unknown-mystery-model'],
          },
        ],
      },
    });
    const emittedModels = poolCandidates
      .filter((c) => c.accountId === 'agy01')
      .map((c) => c.modelId);
    assert.ok(
      emittedModels.includes('gemini-2.5-pro'),
      'must emit allowed model from models-out.txt'
    );
    assert.equal(
      emittedModels.includes('gemini-2.5-flash'),
      false,
      'must not emit model absent from models-out.txt'
    );
    assert.equal(
      emittedModels.includes('unknown-mystery-model'),
      false,
      'must not emit unknown family model'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
