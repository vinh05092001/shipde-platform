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
const promptCompiler = require('../prompt-compiler');
const contextPack = require('../context-pack');
const cli = require('../cli');
const {
  getIsolatedLauncher,
  buildWorkerLaunchScript,
  enforceTokenBudget,
} = require('../isolation-launcher');
const { runHostBrainGate, runOrchestration, rtkPolicyForItem } = require('../orchestrate');
const { DEFAULT_TOKEN_BUDGETS } = require('../intake');
const routing = require('../routing');

const roots = [];
const { spawnSync } = require('node:child_process');
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

test('Part D derives high-risk complexity and enforces the JEV quality floor', async () => {
  const root = fixtureRoot();
  const rows = Array.from(
    { length: 15 },
    (_, i) => `| AC-${i + 1} | Authentication security | Verify session access |`
  );
  fs.writeFileSync(
    path.join(root, 'docs', 'product-spec', 'work-items', 'FIXTURE-AI-141.md'),
    [
      '# MFA fixture',
      '## Control',
      '| Field | Value |',
      '|---|---|',
      '| Allowed paths | `src/api/auth.ts`; `src/ui/login.tsx`; `prisma/schema.prisma` |',
      '| Complexity | standard |',
      '## Business Outcome',
      'Protect user authentication.',
      '## In Scope',
      'Authentication, security, database and API handling.',
      '## Acceptance Matrix',
      '| ID | Scenario | Expected |',
      '|---|---|---|',
      ...rows,
      '## Verification Commands',
      '- `node --test tools/ai-brain/test/task-ai-141.test.js`',
    ].join('\n')
  );
  const derived = intake.deriveSpec({
    id: 'FIXTURE-AI-141',
    workItemText: fs.readFileSync(
      path.join(root, 'docs', 'product-spec', 'work-items', 'FIXTURE-AI-141.md'),
      'utf8'
    ),
    registerItem: { dependencies: '' },
    root,
    deps: {},
  });
  assert.equal(derived.complexity, 'complex');
  assert.deepEqual(derived.riskDomains, ['auth', 'security', 'database ownership']);

  const explicit = intake.deriveSpec({
    id: 'EXPLICIT-AI-141',
    workItemText: [
      '## Control',
      '| Field | Value |',
      '|---|---|',
      '| Complexity | complex |',
      '| Risk Domains | tenant |',
      '## In Scope',
      'Update service behavior.',
      '## Acceptance Matrix',
      '| ID | Scenario | Expected |',
      '|---|---|---|',
      '| AC-1 | Update | Works |',
    ].join('\n'),
    registerItem: { dependencies: '' },
    root,
    deps: {},
  });
  assert.equal(explicit.complexity, 'complex');
  assert.deepEqual(explicit.riskDomains, ['tenant isolation']);

  let question;
  const assessment = await routing.assessTask(
    {
      role: 'writer',
      complexity: derived.complexity,
      riskDomains: ['auth', 'security'],
      latencyPriority: 'normal',
    },
    {
      ask: async (q) => {
        question = q;
        return { outcome: 'DECIDED', choice: 'BALANCED', confidence: 0.9 };
      },
    }
  );
  assert.match(question.prompt, /complex/);
  assert.match(question.prompt, /auth, security/);
  assert.equal(assessment.weightProfile, 'QUALITY_FIRST');
  assert.ok(assessment.reasonCodes.includes('QUALITY_FIRST_RISK_FLOOR_OVERRIDE'));
});

test('Part D keeps a docs-only item standard with no risk domains', () => {
  const text = [
    '## Control',
    '| Field | Value |',
    '|---|---|',
    '| Allowed paths | `docs/guide.md` |',
    '## Business Outcome',
    'Clarify the onboarding guide.',
    '## In Scope',
    'Update wording and examples in the guide.',
    '## Acceptance Matrix',
    '| ID | Scenario | Expected |',
    '|---|---|---|',
    '| AC-1 | Read guide | Clear |',
  ].join('\n');
  const derived = intake.deriveSpec({
    id: 'DOCS-1',
    workItemText: text,
    registerItem: { dependencies: '' },
    root: process.cwd(),
    deps: {},
  });
  assert.equal(derived.complexity, 'standard');
  assert.deepEqual(derived.riskDomains, []);
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

  const derivation = JSON.parse(
    fs.readFileSync(path.join(result.runDir, 'derivation.json'), 'utf8')
  );
  assert.equal(derivation.complexity, 'standard');
  assert.deepEqual(derivation.riskDomains, []);
  assert.equal(derivation.acceptanceCriteriaCount, 1);

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
  cause: 'QUOTA_EXHAUSTED',
  scope: 'UPSTREAM',
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

test('classifier enum values recognize infrastructure and preserve model failures', () => {
  const routing = require('../routing');
  const source = agSourcePath('-classification');
  const target = poolTargetPath();
  const passed = { status: 'passed', proofLevel: 'WORK_ITEM_PASS' };

  for (const [cause, scope] of [
    ['TIMEOUT', 'UPSTREAM'],
    ['LAUNCH_CONFIG', 'LOCAL'],
    ['HARNESS_FAILED', 'HARNESS'],
  ]) {
    const data = {
      combinations: [
        {
          ...source,
          evidence: [passed, { status: 'failed', cause, scope }],
        },
      ],
    };
    const proof = routing.proofObservedWithSource(data, target);
    assert.equal(proof.level, 'WORK_ITEM_PASS', `${cause}/${scope} should retain source proof`);
    assert.equal(proof.transferred, true);
  }

  const modelFailure = {
    combinations: [
      {
        ...source,
        evidence: [passed, { status: 'failed', cause: 'MODEL_UNSUPPORTED', scope: 'MODEL' }],
      },
    ],
  };
  assert.equal(routing.proofObservedWithSource(modelFailure, target).level, null);
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

test('Part H: worker prompt requests focused concise tests and host-side full-suite gating', () => {
  const prompt = promptCompiler.compilePrompt(
    {
      id: 'FIXTURE-AI-141',
      allowedPaths: ['tools/ai-brain/cli.js'],
      acceptanceCriteria: [],
    },
    { focusedTestsOnly: true, contextPack: '.shipde/context.md' }
  );
  assert.match(prompt, /Run only focused tests/);
  assert.match(prompt, /grep -E/);
  assert.match(prompt, /Controller runs that host-side gate/);
  assert.match(prompt, /\.shipde\/context\.md/);
});

test('Part H: intake enables RTK for low risk and suppresses it for risk domains', async () => {
  const root = fixtureRoot();
  const low = await intake.runIntake(
    { workItem: 'FIXTURE-AI-141' },
    {
      root,
      baseSha: 'e'.repeat(40),
      readRegisterRow: () => ({ dependencies: '' }),
      readRegisterRows: () => [],
      listAccounts: () => [],
      read9routerModels: async () => ({ ok: true, models: ['gemini-fixture-pro'] }),
      hasAgyPoolQuota: false,
      readHistory: () => [],
      isAncestorOf: () => true,
    }
  );
  assert.equal(low.rtk.enabled, true);
  assert.ok(low.argv.includes('--rtk'));
  const riskRoot = fixtureRoot();
  fs.writeFileSync(
    path.join(riskRoot, 'docs', 'product-spec', 'work-items', 'FIXTURE-AI-141.md'),
    [
      '# FIXTURE-AI-141',
      '',
      '## Control',
      '| Field | Value |',
      '|---|---|',
      '| Allowed paths | `tools/ai-brain/cli.js` |',
      '',
      '## Business Outcome',
      'Authentication and security behavior.',
      '',
      '## Acceptance Matrix',
      '| ID | Scenario | Expected |',
      '|---|---|---|',
      '| AC-1 | auth | protected |',
      '',
      '## Verification Commands',
      '- `node --test tools/ai-brain/test/task-ai-141.test.js`',
    ].join('\n')
  );
  const high = await intake.runIntake(
    { workItem: 'FIXTURE-AI-141' },
    {
      root: riskRoot,
      baseSha: 'f'.repeat(40),
      readRegisterRow: () => ({ dependencies: '' }),
      readRegisterRows: () => [],
      listAccounts: () => [],
      read9routerModels: async () => ({ ok: true, models: ['gemini-fixture-pro'] }),
      hasAgyPoolQuota: false,
      readHistory: () => [],
      isAncestorOf: () => true,
    }
  );
  assert.deepEqual(high.spec.riskDomains, ['auth', 'security']);
  assert.equal(high.rtk.enabled, false);
  assert.equal(high.argv.includes('--rtk'), false);
});

test('Part H: intake detects risk declared in Control and other sections before enabling RTK', async () => {
  const root = fixtureRoot();
  const file = path.join(root, 'docs', 'product-spec', 'work-items', 'FIXTURE-AI-141.md');
  fs.writeFileSync(
    file,
    [
      '# FIXTURE-AI-141',
      '',
      '## Control',
      '| Field | Value |',
      '|---|---|',
      '| Allowed paths | `tools/ai-brain/cli.js` |',
      '| Risk domains | money, PII, tenant isolation |',
      '',
      '## Business Outcome',
      'Safely update persisted records.',
      '',
      '## Scope',
      'Update persisted records.',
      '',
      '## Acceptance Matrix',
      '| ID | Scenario | Expected |',
      '|---|---|---|',
      '| AC-1 | update | saved |',
      '',
      '## Verification Commands',
      '- `node --test tools/ai-brain/test/task-ai-141.test.js`',
    ].join('\n')
  );
  const result = await intake.runIntake(
    { workItem: 'FIXTURE-AI-141' },
    {
      root,
      baseSha: 'd'.repeat(40),
      readRegisterRow: () => ({ dependencies: '' }),
      readRegisterRows: () => [],
      listAccounts: () => [],
      read9routerModels: async () => ({ ok: true, models: ['gemini-fixture-pro'] }),
      hasAgyPoolQuota: false,
      readHistory: () => [],
      isAncestorOf: () => true,
    }
  );
  assert.deepEqual(result.spec.riskDomains, ['money', 'pii', 'tenant isolation']);
  assert.equal(result.rtk.enabled, false);
  assert.equal(result.argv.includes('--rtk'), false);
});

test('Part H: derived risk labels all block RTK and the exported detector is the live implementation', () => {
  for (const [phrase, expected] of [
    ['carrier create shipment', 'carrier side effects'],
    ['PII recipient data', 'pii'],
    ['database ownership and migration', 'database ownership'],
  ]) {
    const derived = intake.deriveRiskDomains('## Scope\n' + phrase);
    assert.ok(derived.includes(expected), phrase + ' derives the expected policy label');
    assert.ok(intake.RTK_RISK_DOMAINS.includes(expected), expected + ' blocks RTK');
  }
});

test('Part H: orchestration records RTK enablement and risk-domain denial in decision log', async () => {
  const root = fixtureRoot();
  const decisionDir = path.join(root, 'decisions');
  const observed = [];
  const spec = { id: 'FIXTURE-AI-141', files: ['a.js'], riskDomains: ['security'] };
  const candidates = [
    {
      upstream: 'up-a',
      gateway: 'gw-a',
      accountId: 'acct-a',
      modelId: 'm',
      harness: 'opencode',
      source: 'up-a',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 999999 },
    },
  ];
  await runOrchestration('fixture', {
    specs: [spec],
    candidates,
    decisionDir,
    cwd: root,
    rtk: true,
    run: (job) => {
      observed.push(job);
      return { exitCode: 1, stderr: 'fixture stop' };
    },
    now: Date.now(),
  });
  assert.equal(observed[0].rtk.enabled, false);
  const records = fs
    .readFileSync(path.join(decisionDir, new Date().toISOString().slice(0, 10) + '.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(records.some((entry) => entry.warning === 'RTK_POLICY' && entry.enabled === false));
  assert.ok(
    records.some(
      (entry) =>
        entry.warning === 'RTK_POLICY' &&
        entry.enabled === false &&
        entry.detail === 'risk_domains_block_rtk'
    ),
    'the risk-domain policy denial is recorded in the decision log'
  );
});

test('Part H: RTK permission is computed independently for each work item', async () => {
  assert.deepEqual(rtkPolicyForItem(true, [], false), {
    enabled: true,
    reason: 'low_risk_item',
    riskDomains: [],
  });
  assert.deepEqual(rtkPolicyForItem(true, ['pii'], false), {
    enabled: false,
    reason: 'risk_domains_block_rtk',
    riskDomains: ['pii'],
  });
  assert.equal(rtkPolicyForItem(true, [], true).reason, 'injected_run_blocks_rtk');
});

test('Part H: a stalled live session is stopped, recorded and checkpointed for recovery', async () => {
  const root = fixtureRoot();
  const decisionDir = path.join(root, 'stall-decisions');
  const candidates = [
    {
      upstream: 'up-a',
      gateway: 'gw-a',
      accountId: 'acct-a',
      modelId: 'model-a',
      harness: 'paseo',
      source: 'up-a',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 999999 },
    },
    {
      upstream: 'up-b',
      gateway: 'gw-b',
      accountId: 'acct-b',
      modelId: 'model-b',
      harness: 'paseo',
      source: 'up-b',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 999999 },
    },
  ];
  const calls = [];
  const result = await runOrchestration('fixture', {
    specs: [{ id: 'FIXTURE-AI-141', files: ['a.js'], acceptanceCriteria: ['works'] }],
    candidates,
    registry: { sources: [] },
    decisionDir,
    cwd: root,
    now: Date.now(),
    checkpointFile: path.join(root, 'stall-checkpoint.json'),
    progressTimeoutMs: 1000,
    stallMs: 1000,
    run: (job) => {
      calls.push(job);
      return calls.length === 1
        ? {
            exitCode: 1,
            failureReason: 'STALLED_NO_PROGRESS',
            stderr: 'launcher stopped stalled worker',
          }
        : { exitCode: 1, stderr: 'bounded fallback stopped' };
    },
  });
  assert.equal(calls.length, 2, 'a launcher-stopped session uses one bounded alternate');
  assert.ok(result.launches.some((launch) => launch.fallbackReason === 'STALLED_NO_PROGRESS'));
  assert.ok(fs.existsSync(path.join(root, 'stall-checkpoint.json')));
  const day = new Date().toISOString().slice(0, 10);
  const records = fs
    .readFileSync(path.join(decisionDir, day + '.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(records.some((entry) => entry.cause === 'STALLED_NO_PROGRESS'));
});

test('Part H: token budget overrun stops the session and records the fallback cause', async () => {
  const root = fixtureRoot();
  const candidates = [
    {
      upstream: 'up-a',
      gateway: 'gw-a',
      accountId: 'acct-a',
      modelId: 'model-a',
      harness: 'paseo',
      source: 'up-a',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 999999 },
    },
    {
      upstream: 'up-b',
      gateway: 'gw-b',
      accountId: 'acct-b',
      modelId: 'model-b',
      harness: 'paseo',
      source: 'up-b',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 999999 },
    },
  ];
  const calls = [];
  const result = await runOrchestration('fixture', {
    specs: [{ id: 'FIXTURE-AI-141', files: ['a.js'], acceptanceCriteria: ['works'] }],
    candidates,
    registry: { sources: [] },
    decisionDir: path.join(root, 'budget-decisions'),
    cwd: root,
    tokenBudgets: { default: { maxTokens: 5 } },
    now: Date.now(),
    maxRepairs: 0,
    run: (job) => {
      calls.push(job);
      return calls.length === 1
        ? { exitCode: 1, failureReason: 'TOKEN_BUDGET_EXCEEDED', stderr: 'budget' }
        : { exitCode: 1, stderr: 'bounded fallback stopped' };
    },
  });
  assert.ok(calls.length >= 1);
  assert.ok(result.launches.some((launch) => launch.fallbackReason === 'TOKEN_BUDGET_EXCEEDED'));
  assert.ok(result.launches.some((launch) => launch.fallbackReason === 'TOKEN_BUDGET_EXCEEDED'));
});

test('Part H: context pack includes allowed source files and rejects traversal', () => {
  const root = fixtureRoot();
  fs.mkdirSync(path.join(root, 'tools', 'ai-brain'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'ai-brain', 'cli.js'), 'fixture source');
  const result = contextPack.createContextPack(
    [{ allowedPaths: ['tools/ai-brain/cli.js', '../outside.txt'] }],
    {
      root,
      outputDir: path.join(root, 'pack-out'),
    }
  );
  assert.deepEqual(result.files, ['tools/ai-brain/cli.js']);
  assert.match(result.content, /fixture source/);
  assert.equal(fs.existsSync(result.path), true);
});

test('Part H: context pack manifest records output path and included source allowlist', async () => {
  const root = fixtureRoot();
  fs.mkdirSync(path.join(root, 'tools', 'ai-brain'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'ai-brain', 'cli.js'), 'fixture cli source');
  const manifestPath = path.join(root, 'run', 'manifest.json');
  const decisionsDir = path.join(root, 'decisions');
  const spec = {
    id: 'FIXTURE-AI-141',
    allowedPaths: ['tools/ai-brain/cli.js'],
    acceptanceCriteria: ['test path'],
  };
  const result = runOrchestration('fixture', {
    specs: [spec],
    candidates: [],
    decisionDir: decisionsDir,
    cwd: root,
    isolatedWorker: true,
    enableContextPack: true,
    contextManifest: manifestPath,
  });
  await result;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(manifest.path);
  assert.deepEqual(manifest.files, ['tools/ai-brain/cli.js']);
});

test('Part H: token usage report groups input, cache-read and output by model and Work Item', () => {
  const root = fixtureRoot();
  const usageDir = path.join(root, 'usage');
  fs.mkdirSync(usageDir, { recursive: true });
  fs.writeFileSync(
    path.join(usageDir, 'session.json'),
    JSON.stringify({
      workItemId: 'TASK-AI-X',
      model: 'model-x',
      usage: { input_tokens: 10, cache_read_tokens: 20, output_tokens: 3 },
    })
  );
  const result = cli.tokenReportCommand({ dir: usageDir }, { log: () => {} });
  assert.equal(result.records, 1);
  assert.deepEqual(
    result.totals.map((row) => [row.key, row.input, row.cacheRead, row.output]),
    [
      ['model-x', 10, 20, 3],
      ['TASK-AI-X', 10, 20, 3],
    ]
  );
});

test('Part H: launcher enforces per-session token budget live and preserves bounded timeout', () => {
  const script = buildWorkerLaunchScript({
    credPath: 'credential',
    workerRoot: 'C:\\worker',
    exeFile: 'agent.exe',
    payloadArgsPath: 'args.json',
    launchResultPath: 'result.json',
    workerTimeoutMs: 90000,
    tokenBudget: { maxTokens: 12000 },
    progressTimeoutMs: 60000,
  });
  assert.match(script, /\$timeoutMs = 90000/);
  assert.match(script, /\$tokenBudgetJson/);
  assert.match(script, /Read-UsageTotal/);
  assert.match(script, /Stop-WorkerTree/);
  assert.match(script, /12000/);
});

test('Part H: missing, empty, or malformed usage telemetry fails closed when a budget is configured', () => {
  const root = fixtureRoot();
  const missing = enforceTokenBudget({ exitCode: 0, stderr: '' }, { maxTokens: 100 }, null);
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.failureReason, 'TOKEN_BUDGET_UNVERIFIED');

  const usageFile = path.join(root, 'usage.json');
  fs.writeFileSync(usageFile, '');
  const empty = enforceTokenBudget({ exitCode: 0, stderr: '' }, { maxTokens: 100 }, usageFile);
  assert.equal(empty.exitCode, 1);
  assert.equal(empty.failureReason, 'TOKEN_BUDGET_UNVERIFIED');

  fs.writeFileSync(usageFile, JSON.stringify({}));
  const noUsage = enforceTokenBudget({ exitCode: 0, stderr: '' }, { maxTokens: 100 }, usageFile);
  assert.equal(noUsage.exitCode, 1);
  assert.equal(noUsage.failureReason, 'TOKEN_BUDGET_UNVERIFIED');

  fs.writeFileSync(usageFile, JSON.stringify({ usage: { input_tokens: 80, output_tokens: 30 } }));
  const over = enforceTokenBudget({ exitCode: 0, stderr: '' }, { maxTokens: 100 }, usageFile);
  assert.equal(over.failureReason, 'TOKEN_BUDGET_EXCEEDED');

  fs.writeFileSync(usageFile, JSON.stringify({ usage: { input_tokens: 20, output_tokens: 30 } }));
  const within = enforceTokenBudget({ exitCode: 0, stderr: '' }, { maxTokens: 100 }, usageFile);
  assert.equal(within.exitCode, 0);
  assert.equal(within.failureReason, undefined);
});

test('Part H: host brain gate expands suite files, hides output and returns only failures', () => {
  let capturedEnv;
  const result = runHostBrainGate(
    {},
    {
      spawnSync: (_node, args, opts) => {
        capturedEnv = opts.env;
        assert.ok(args.length > 2);
        assert.equal(args[0], '--test');
        assert.ok(args.slice(1).includes('tools/ai-brain/test/task-ai-141.test.js'));
        assert.ok(args.slice(1).every((file) => !file.includes('*')));
        return {
          status: 1,
          stdout: 'not ok 1 - fixture failure\n  noisy detail\nℹ pass 9\nℹ fail 1\n',
          stderr: '',
        };
      },
    }
  );
  assert.equal(capturedEnv.NINEROUTER_API_KEY, undefined);
  assert.deepEqual(result.failures, ['fixture failure']);
  assert.deepEqual(result.summary, ['ℹ pass 9', 'ℹ fail 1']);
});

test('Part H: isolated runs receive role and complexity token caps from policy config', () => {
  assert.equal(DEFAULT_TOKEN_BUDGETS.byComplexity.simple.maxTokens, 60000);
  assert.equal(DEFAULT_TOKEN_BUDGETS.byComplexity.standard.maxTokens, 150000);
  assert.equal(DEFAULT_TOKEN_BUDGETS.byComplexity.complex.maxTokens, 300000);
  assert.equal(DEFAULT_TOKEN_BUDGETS.byRole.reviewer.maxTurns, 60);
  const source = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
  assert.match(source, /DEFAULT_TOKEN_BUDGETS/);
});

test('Part H: repeated quota failures reach a bounded fallback threshold', () => {
  assert.equal(DEFAULT_TOKEN_BUDGETS.byRole['author.foundation'].repeatedQuotaFailures, 3);
});
