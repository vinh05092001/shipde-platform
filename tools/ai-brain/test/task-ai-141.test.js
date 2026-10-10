'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const intake = require('../intake');
const { generateCandidates } = require('../candidates');
const { rankForProfile } = require('../routing');
const sources = require('../sources');
const { candidateKey } = require('../discovery/identity');
const evidence = require('../evidence');
const accountsApi = require('../accounts');

const roots = [];
function fixtureRoot() {
  const upstreamTmp = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
  fs.mkdirSync(upstreamTmp, { recursive: true });
  const root = fs.mkdtempSync(path.join(upstreamTmp, 'task-ai-141-'));
  roots.push(root);
  const workItems = path.join(root, 'docs', 'product-spec', 'work-items');
  fs.mkdirSync(workItems, { recursive: true });
  fs.writeFileSync(
    path.join(workItems, 'FIXTURE-AI-141.md'),
    [
      '# FIXTURE-AI-141',
      '',
      '## Control',
      '| Field | Value |',
      '|---|---|',
      '| Allowed paths | `tools/ai-brain/cli.js` |',
      '',
      '## Business Outcome',
      'Exercise the intake candidate path.',
      '',
      '## Acceptance Matrix',
      '| ID | Scenario | Expected |',
      '|---|---|---|',
      '| AC-1 | Candidate discovery | Pool candidates exist |',
      '',
      '## Verification Commands',
      '- `node --test tools/ai-brain/test/task-ai-141.test.js`',
    ].join('\n')
  );
  return root;
}

function intakeAccounts(root) {
  const accountOptions = {
    registryFile: path.join(root, 'accounts.registry.json'),
    secretsFile: path.join(root, 'accounts.secrets.enc'),
  };
  accountsApi.saveRegistry(
    Array.from({ length: 7 }, (_, index) => ({
      id: 'agy' + String(index + 1).padStart(2, '0'),
      provider: 'agy-pool',
      model: 'gemini-fixture-pro',
      capabilities: { contextWindow: 1000 },
      tier: 1,
      enabled: true,
    })),
    accountOptions
  );
  fs.writeFileSync(accountOptions.secretsFile, '{}');
  return accountOptions;
}

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('intake catalogue and real account registry plus pool discovery produce candidates', async () => {
  const root = fixtureRoot();
  const backendModel = 'gemini-fixture-pro';
  const accountOptions = intakeAccounts(root);
  const result = await intake.runIntake(
    { workItem: 'FIXTURE-AI-141' },
    {
      root,
      baseSha: 'b'.repeat(40),
      readRegisterRow: () => ({ dependencies: '' }),
      readRegisterRows: () => [],
      accountOptions,
      hasAgyPoolQuota: true,
      readHistory: () => [],
      isAncestorOf: () => true,
      read9routerModels: async () => ({ ok: true, models: ['ag/' + backendModel] }),
      readAgyModels: async () => ({ ok: true, models: [] }),
      readEvidenceModels: async () => ({ ok: true, models: [] }),
    }
  );

  assert.deepEqual(result.catalogue, ['ag/' + backendModel]);
  assert.match(result.command, /--external-workers agy-pool/);

  const runsDir = path.join(root, 'pool-runs');
  for (let i = 1; i <= 7; i++) {
    const accountDir = path.join(runsDir, 'agy' + String(i).padStart(2, '0'));
    fs.mkdirSync(accountDir, { recursive: true });
    fs.writeFileSync(path.join(accountDir, 'result.json'), JSON.stringify({ state: 'completed' }));
  }

  const candidates = generateCandidates({
    registry: sources.loadSources(),
    catalogue: JSON.parse(fs.readFileSync(path.join(result.runDir, 'catalogue.json'), 'utf8')),
    accounts: JSON.parse(fs.readFileSync(path.join(result.runDir, 'accounts.json'), 'utf8')),
    externalWorkers: 'agy-pool',
    fakeRunsDir: runsDir,
    platform: 'win32',
    spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
    cacheFile: null,
  });
  const poolCandidates = candidates.filter(
    (candidate) => candidate.source === 'agy-pool' && candidate.modelId === backendModel
  );
  assert.equal(poolCandidates.length, 7, 'the intake model is offered by all seven pool accounts');
  const unknownRejections = [];
  const unknownCandidates = generateCandidates({
    registry: sources.loadSources(),
    catalogue: ['ag/not-a-known-family'],
    accounts: JSON.parse(fs.readFileSync(path.join(result.runDir, 'accounts.json'), 'utf8')),
    externalWorkers: 'agy-pool',
    fakeRunsDir: runsDir,
    platform: 'win32',
    spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
    cacheFile: null,
    candidateGenerationRejections: unknownRejections,
  });
  assert.equal(
    unknownCandidates.filter(
      (candidate) => candidate.source === 'agy-pool' && candidate.modelId === 'not-a-known-family'
    ).length,
    0
  );
  assert.deepEqual(unknownRejections, [
    { modelId: 'not-a-known-family', reasonCode: 'UNKNOWN_MODEL_FAMILY' },
  ]);
  const profile = {
    taskId: 'FIXTURE-AI-141',
    role: 'author.foundation',
    requiredCapabilities: [],
    contextSize: 1,
    proofFloor: 'WORK_ITEM_PASS',
    qualityFloor: 0,
    costCeiling: 1000000,
    currentWorkload: 0,
    resourceCeiling: 4,
    forbiddenFailureDomains: [],
  };
  const decision = rankForProfile(
    poolCandidates,
    profile,
    { weightProfile: 'BALANCED', weights: { latency: 34, quality: 33, cost: 33 } },
    { now: Date.now(), evidenceData: {}, priors: {} }
  );
  const rejectedKeys = new Set(decision.rejected.map((row) => row.candidateKey));
  for (const candidate of poolCandidates) {
    const key = candidateKey(candidate);
    const ranked = decision.ranking.some((row) => row.candidateKey === key);
    const rejected = decision.rejected.find((row) => row.candidateKey === key);
    assert.ok(ranked || rejectedKeys.has(key), 'pool candidate is ranked or rejected');
    if (rejected) assert.ok(rejected.reasonCode, 'rejection carries a named reason');
  }
  assert.equal(decision.rejected.length, 7);
  assert.ok(decision.rejected.every((row) => row.reasonCode.startsWith('PROOF_FLOOR_NOT_MET')));
});

test('candidate generation rejects unknown aliased models with a named reason', () => {
  const rejections = [];
  const candidates = generateCandidates({
    registry: sources.loadSources(),
    catalogue: ['ag/not-a-known-family', 'ag/'],
    accounts: [],
    externalWorkers: 'agy-pool',
    discoverPool: false,
    models: ['ag/not-a-known-family', 'ag/'],
    candidateGenerationRejections: rejections,
  });
  assert.equal(candidates.filter((candidate) => candidate.source === 'agy-pool').length, 0);
  assert.deepEqual(rejections, [
    { modelId: 'not-a-known-family', reasonCode: 'UNKNOWN_MODEL_FAMILY' },
    { modelId: '', reasonCode: 'EMPTY_MODEL_ID' },
  ]);
});

test('candidate generation names rejections for unprefixed unknown catalogue models when pool is enabled', () => {
  const rejections = [];
  const candidates = generateCandidates({
    registry: sources.loadSources(),
    catalogue: ['not-a-known-family'],
    accounts: Array.from({ length: 7 }, (_, index) => ({
      id: 'agy' + String(index + 1).padStart(2, '0'),
      provider: 'agy-pool',
      enabled: true,
      model: 'gemini-3.1-pro',
    })),
    externalWorkers: 'agy-pool',
    enablePool: true,
    models: ['gemini-3.1-pro'],
    candidateGenerationRejections: rejections,
  });
  assert.equal(
    candidates.some(
      (candidate) => candidate.source === 'agy-pool' && candidate.modelId === 'not-a-known-family'
    ),
    false
  );
  assert.deepEqual(rejections, [
    { modelId: 'not-a-known-family', reasonCode: 'UNKNOWN_MODEL_FAMILY' },
  ]);
});

test('intake pool writer inherits backend WORK_ITEM_PASS from blocked 9router ag path', async () => {
  const root = fixtureRoot();
  const backendModel = 'gemini-3.1-pro-low';
  const agCandidate = {
    harness: 'paseo',
    accessPath: 'http',
    gateway: '9router',
    upstream: 'ag',
    accountId: 'ninerouter-gemini',
    quotaScope: 'ninerouter-gemini',
    modelId: 'ag/' + backendModel,
    source: '9router',
  };
  const runsDir = path.join(root, 'pool-runs');
  const accountDir = path.join(runsDir, 'agy01');
  fs.mkdirSync(accountDir, { recursive: true });
  fs.writeFileSync(path.join(accountDir, 'result.json'), JSON.stringify({ state: 'completed' }));
  fs.writeFileSync(
    path.join(accountDir, 'out.txt'),
    'Gemini Models\tWeekly Limit Remaining\t80%\nGemini Models\tFive Hour Limit Remaining\t80%\n'
  );
  evidence.recordProbe(path.join(root, 'evidence'), agCandidate, {
    status: 'passed',
    proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
    workItemId: 'FIXTURE-AI-141',
  });
  const proofData = evidence.loadEvidence(path.join(root, 'evidence'));

  const result = await intake.runIntake(
    { workItem: 'FIXTURE-AI-141' },
    {
      root,
      baseSha: 'c'.repeat(40),
      readRegisterRow: () => ({ dependencies: '' }),
      readRegisterRows: () => [],
      accountOptions: intakeAccounts(root),
      hasAgyPoolQuota: true,
      readHistory: () => [],
      isAncestorOf: () => true,
      read9routerModels: async () => ({ ok: true, models: [backendModel] }),
      readAgyModels: async () => ({ ok: true, models: [] }),
      readEvidenceModels: async () => ({ ok: true, models: [] }),
    }
  );
  const candidates = generateCandidates({
    registry: sources.loadSources(),
    catalogue: JSON.parse(fs.readFileSync(path.join(result.runDir, 'catalogue.json'), 'utf8')),
    accounts: JSON.parse(fs.readFileSync(path.join(result.runDir, 'accounts.json'), 'utf8')),
    externalWorkers: 'agy-pool',
    fakeRunsDir: runsDir,
    platform: 'win32',
    spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
    cacheFile: null,
    evidenceData: proofData,
  });
  const poolCandidate = candidates.find(
    (candidate) => candidate.source === 'agy-pool' && candidate.modelId === backendModel
  );
  assert.ok(poolCandidate, 'intake discovered the pool backend model');
  const profile = {
    taskId: 'FIXTURE-AI-141',
    role: 'writer',
    complexity: 'standard',
    expectedDuration: 60000,
    latencyPriority: 'normal',
    requiredCapabilities: [],
    contextSize: 1,
    proofFloor: 'WORK_ITEM_PASS',
    qualityFloor: 0,
    costCeiling: 1000000,
    currentWorkload: 0,
    resourceCeiling: 4,
    forbiddenFailureDomains: [],
  };
  const decision = rankForProfile(
    [poolCandidate],
    profile,
    { weightProfile: 'BALANCED', weights: { latency: 34, quality: 33, cost: 33 } },
    {
      now: Date.now(),
      evidenceData: proofData,
      priors: {},
      headrooms: { agy01: { status: 'available' } },
      useStoredQuota: false,
    }
  );

  assert.equal(decision.chosen, candidateKey(poolCandidate));
  assert.equal(decision.ranking[0].source, 'agy-pool');
  const proof = require('../routing').proofObservedWithSource(proofData, poolCandidate);
  assert.equal(proof.level, 'WORK_ITEM_PASS');
  assert.equal(proof.transferred, true);
  assert.equal(proof.source, candidateKey(agCandidate));
  assert.equal(proof.sourceModel, 'ag/' + backendModel);

  const profileFile = path.join(root, 'profile.json');
  const decisionDir = path.join(root, 'decisions');
  fs.mkdirSync(decisionDir, { recursive: true });
  fs.writeFileSync(profileFile, JSON.stringify(profile));
  const { runProfileDispatch } = require('../routing');
  const dispatched = await runProfileDispatch(
    { profile: profileFile, root, 'decision-dir': decisionDir },
    {
      rootDir: root,
      candidates: [poolCandidate],
      evidenceDir: path.join(root, 'evidence'),
      decisionDir,
      now: Date.now(),
      priors: {},
      headrooms: { agy01: { status: 'open' } },
      useStoredQuota: false,
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );
  assert.equal(dispatched.pinnedCandidateKey, candidateKey(poolCandidate));
  const logFile = fs.readdirSync(decisionDir).find((file) => file.endsWith('.jsonl'));
  const logRow = JSON.parse(fs.readFileSync(path.join(decisionDir, logFile), 'utf8').trim());
  const selectedRow = logRow.ranking.find(
    (row) => row.candidateKey === candidateKey(poolCandidate)
  );
  assert.deepEqual(selectedRow.proofSource, {
    candidateKey: candidateKey(agCandidate),
    modelId: 'ag/' + backendModel,
  });

  const failedTarget = Object.assign({}, poolCandidate, { headroomStatus: 'open' });
  evidence.recordProbe(path.join(root, 'evidence'), failedTarget, {
    status: 'failed',
    httpStatus: 429,
    body: 'pool path rate limited',
  });
  const failedData = evidence.loadEvidence(path.join(root, 'evidence'));
  assert.equal(require('../routing').proofObservedWithSource(failedData, failedTarget).level, null);
  const exhaustedTarget = Object.assign({}, poolCandidate, { headroomStatus: 'exhausted' });
  assert.equal(
    require('../routing').proofObservedWithSource(proofData, exhaustedTarget).level,
    null
  );
  const blockedRank = rankForProfile(
    [Object.assign({}, poolCandidate)],
    profile,
    { weightProfile: 'BALANCED', weights: { latency: 34, quality: 33, cost: 33 } },
    {
      now: Date.now(),
      evidenceData: failedData,
      priors: {},
      headrooms: { agy01: { status: 'open' } },
      useStoredQuota: false,
    }
  );
  assert.equal(blockedRank.ranking.length, 0);
  assert.equal(blockedRank.rejected[0].reasonCode, 'COOLDOWN_ACTIVE');

  const unknown = Object.assign({}, poolCandidate, {
    modelId: 'unrecognized-route/' + backendModel,
  });
  assert.equal(require('../routing').proofObservedWithSource(proofData, unknown).level, null);

  const directProof = Object.assign({}, poolCandidate, {
    evidence: [{ status: 'passed', proofLevel: 'WORK_ITEM_PASS' }],
  });
  assert.equal(
    require('../routing').proofObservedWithSource(proofData, directProof).level,
    'WORK_ITEM_PASS'
  );
  assert.equal(
    require('../routing').proofObservedWithSource(proofData, {
      ...directProof,
      headroomStatus: 'exhausted',
    }).level,
    null
  );
  const blockedDirect = { ...directProof, accountId: 'agy-blocked', quotaScope: 'agy-blocked' };
  const blockedData = {
    combinations: [
      {
        ...blockedDirect,
        evidence: [
          { status: 'passed', proofLevel: 'WORK_ITEM_PASS' },
          { status: 'failed', httpStatus: 429 },
        ],
      },
    ],
  };
  assert.equal(
    require('../routing').proofObservedWithSource(blockedData, blockedDirect).level,
    null
  );
});

test('proof transfer requires exact normalized backend identity', () => {
  const source = {
    harness: 'paseo',
    accessPath: 'http',
    gateway: '9router',
    upstream: 'ag',
    accountId: 'router-one',
    quotaScope: 'router-one',
    modelId: 'ag/gemini-model-2026-10-10',
  };
  const data = {
    combinations: [{ ...source, evidence: [{ status: 'passed', proofLevel: 'WORK_ITEM_PASS' }] }],
  };
  const distinct = {
    harness: 'agy-pool',
    accessPath: 'cli',
    gateway: '',
    upstream: 'antigravity',
    accountId: 'agy01',
    quotaScope: 'agy01:gemini',
    modelId: 'gemini-model-2026-10-11',
  };
  assert.equal(require('../routing').proofObservedWithSource(data, distinct).level, null);
  const ambiguous = { ...source, modelId: 'ag/unknown/gemini-model' };
  const ambiguousData = {
    combinations: [
      { ...ambiguous, evidence: [{ status: 'passed', proofLevel: 'WORK_ITEM_PASS' }] },
    ],
  };
  const target = { ...distinct, modelId: 'unknown/gemini-model' };
  assert.equal(require('../routing').proofObservedWithSource(ambiguousData, target).level, null);
});

const proofModel = 'gemini-3.1-pro-low';

/** The 9router ag path that earned the WORK_ITEM_PASS for the backend model. */
function agSourcePath(suffix) {
  const accountId = 'ninerouter-gemini' + (suffix || '');
  return {
    harness: 'paseo',
    accessPath: 'http',
    gateway: '9router',
    upstream: 'ag',
    accountId,
    quotaScope: accountId,
    modelId: 'ag/' + proofModel,
    source: '9router',
  };
}

/** One agy-pool writer that reaches the same backend model by a different route. */
function poolTargetPath() {
  return {
    harness: 'agy-pool',
    accessPath: 'ShipDe\\ShipDe-agy01',
    gateway: '',
    upstream: 'antigravity',
    accountId: 'agy01',
    quotaScope: 'agy01:gemini',
    modelId: proofModel,
    source: 'agy-pool',
    kind: 'agent-cli',
  };
}

/** A source path carrying a WORK_ITEM_PASS plus one quota timeout today. */
function evidenceStore(root, source, failedItem) {
  const dir = path.join(root, 'evidence');
  evidence.recordProbe(dir, source, {
    status: 'passed',
    proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
    workItemId: 'FIXTURE-AI-141',
  });
  evidence.recordProbe(dir, source, failedItem);
  return evidence.loadEvidence(dir);
}

const QUOTA_TIMEOUT_TODAY = {
  status: 'failed',
  httpStatus: 429,
  body: 'weekly quota exhausted, request timed out',
};

test('a source path blocked by quota plus a timeout failure still transfers the proof', () => {
  const root = fixtureRoot();
  const source = agSourcePath();
  const target = poolTargetPath();
  const data = evidenceStore(root, source, QUOTA_TIMEOUT_TODAY);

  const block = evidence.isCandidateBlocked(data, source);
  assert.equal(block.blocked, true, 'the source path is really blocked today');
  assert.match(String(block.reason), /quota/i);

  const proof = require('../routing').proofObservedWithSource(data, target);
  assert.equal(proof.level, 'WORK_ITEM_PASS');
  assert.equal(proof.transferred, true);
  assert.equal(proof.source, candidateKey(source));
  assert.equal(proof.sourceModel, 'ag/' + proofModel);
});

test('a model-quality failure on the source path disqualifies the proof transfer', () => {
  const target = poolTargetPath();

  // Control: the identical source whose only failure is infrastructure still
  // lends its proof. This is the behaviour this task changes, so without it
  // the quality assertion below cannot be told apart from origin/main.
  const controlRoot = fixtureRoot();
  const control = evidenceStore(controlRoot, agSourcePath('-control'), QUOTA_TIMEOUT_TODAY);
  assert.equal(
    require('../routing').proofObservedWithSource(control, target).transferred,
    true,
    'control: an infrastructure failure alone does not stop the transfer'
  );

  // A model-scope failure: the model itself did not serve, on a healthy path.
  const modelRoot = fixtureRoot();
  const modelData = evidenceStore(modelRoot, agSourcePath('-model'), {
    status: 'failed',
    httpStatus: 400,
    body: 'model not supported',
  });
  const modelProof = require('../routing').proofObservedWithSource(modelData, target);
  assert.equal(modelProof.level, null);
  assert.equal(modelProof.transferred, false);

  // A review verdict of CHANGES_REQUIRED is a quality failure even though the
  // route itself answered.
  const reviewRoot = fixtureRoot();
  const reviewData = evidenceStore(reviewRoot, agSourcePath('-review'), {
    status: 'failed',
    verdict: 'CHANGES_REQUIRED',
    body: 'review refused the work item',
  });
  const reviewProof = require('../routing').proofObservedWithSource(reviewData, target);
  assert.equal(reviewProof.level, null);
  assert.equal(reviewProof.transferred, false);
});

test('an exhausted target path never inherits the transferred proof', () => {
  const root = fixtureRoot();
  const source = agSourcePath();
  const target = poolTargetPath();
  const data = evidenceStore(root, source, QUOTA_TIMEOUT_TODAY);

  // Control: the same source and the same target, before the headroom runs out.
  assert.equal(
    require('../routing').proofObservedWithSource(data, target).transferred,
    true,
    'control: the healthy target inherits the proof'
  );

  const exhausted = Object.assign({}, target, { headroomStatus: 'exhausted' });
  const proof = require('../routing').proofObservedWithSource(data, exhausted);
  assert.equal(proof.level, null);
  assert.equal(proof.transferred, false);
});

test('intake supplies empty account options when none are configured', async () => {
  const root = fixtureRoot();
  let receivedOptions;
  let catalogueBuilds = 0;
  await intake.runIntake(
    { workItem: 'FIXTURE-AI-141' },
    {
      root,
      baseSha: 'd'.repeat(40),
      readRegisterRow: () => ({ dependencies: '' }),
      readRegisterRows: () => [],
      listAccounts: (options) => {
        receivedOptions = options;
        return [];
      },
      buildCatalogue: async () => {
        catalogueBuilds += 1;
        return ['ag/gemini-fixture-pro'];
      },
      read9routerModels: async () => {
        throw new Error('live 9router listing must not be used by this test');
      },
      readAgyModels: async () => {
        throw new Error('live agy listing must not be used by this test');
      },
      readEvidenceModels: async () => {
        throw new Error('live evidence listing must not be used by this test');
      },
      hasAgyPoolQuota: false,
      readHistory: () => [],
      isAncestorOf: () => true,
    }
  );
  assert.equal(catalogueBuilds, 1, 'the injected catalogue builder replaces the live listing');
  assert.deepEqual(receivedOptions, {});
});
