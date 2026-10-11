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
const harnesses = require('../harness');
const isolation = require('../isolation-launcher');
const routing = require('../routing');

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

test('Codex harness and launcher require the fresh CLOSED verdict', () => {
  const codex = harnesses.getHarness('codex');
  assert.throws(() => codex.launch({ cwd: process.cwd() }), /CODEX_REQUIRES_ISOLATION/);
  for (const invalid of [1, null, [], 'not-json', '{']) {
    assert.throws(
      () =>
        codex.launch({
          cwd: 'C:\\ShipDeWorker\\task',
          isolatedWorker: true,
          isolationVerdict: invalid,
        }),
      /CODEX_REQUIRES_ISOLATION/
    );
  }
  const root = fixtureRoot();
  const verdictPath = path.join(root, 'ShipDe', 'isolation-verdict.json');
  fs.mkdirSync(path.dirname(verdictPath), { recursive: true });
  fs.writeFileSync(verdictPath, JSON.stringify({ verdict: 'CLOSED' }));
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  try {
    assert.deepEqual(
      codex.launch({
        cwd: path.join('C:\\ShipDeWorker', 'task-ai-141'),
        isolatedWorker: true,
        isolationVerdict: { verdict: 'CLOSED' },
        isolationVerdictPath: verdictPath,
        prompt: 'task',
      }),
      ['exec', '--dangerously-bypass-approvals-and-sandbox', 'task']
    );
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
  }
  const regular = isolation.buildWorkerLaunchScript({
    credPath: 'worker.cred',
    workerRoot: 'C:\\worker',
    exeFile: 'paseo.exe',
    payloadArgsPath: 'args.json',
    launchResultPath: 'result.json',
    workerTimeoutMs: 1000,
    adapterId: 'paseo',
    runAsCurrentUser: true,
  });
  const worker = isolation.buildWorkerLaunchScript({
    credPath: 'worker.cred',
    workerRoot: 'C:\\worker',
    exeFile: 'codex.exe',
    payloadArgsPath: 'args.json',
    launchResultPath: 'result.json',
    workerTimeoutMs: 1000,
    adapterId: 'codex',
    isolationVerdict: { verdict: 'CLOSED' },
    runAsCurrentUser: true,
  });
  assert.doesNotMatch(regular, /dangerously-bypass-approvals-and-sandbox|login status/);
  assert.match(worker, /login status/);
  assert.match(worker, /CODEX_NOT_LOGGED_IN/);
  assert.match(worker, /`\$env:HOME = "C:\\worker"/);
  assert.match(worker, /`\$env:USERPROFILE = "C:\\worker"/);
});

test('Codex harness runs the fake CLI with the isolated worker arguments', () => {
  const codex = harnesses.getHarness('codex');
  const temp = fs.mkdtempSync(path.join(__dirname, 'codex-fake-'));
  roots.push(temp);
  const executable = path.join(temp, 'codex.js');
  fs.writeFileSync(executable, "process.stdout.write(process.argv.slice(2).join(' '));\n");
  const root = fixtureRoot();
  const verdictPath = path.join(root, 'ShipDe', 'isolation-verdict.json');
  fs.mkdirSync(path.dirname(verdictPath), { recursive: true });
  fs.writeFileSync(verdictPath, JSON.stringify({ verdict: 'CLOSED' }));
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  try {
    const args = codex.launch({
      cwd: path.join('C:\\ShipDeWorker', 'task-ai-141'),
      isolatedWorker: true,
      isolationVerdict: { verdict: 'CLOSED' },
      isolationVerdictPath: verdictPath,
      model: 'codex-fixture-model',
      prompt: 'fake prompt',
    });
    const result = require('node:child_process').spawnSync(
      process.execPath,
      [executable, ...args],
      {
        encoding: 'utf8',
      }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /exec --dangerously-bypass-approvals-and-sandbox --model codex-fixture-model fake prompt/
    );
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
  }
});

test('Codex login failure is returned as a local failure so execution can continue', () => {
  const resultPath = path.join(fixtureRoot(), 'launch-result.json');
  fs.writeFileSync(
    resultPath,
    JSON.stringify({
      completionNonce: 'nonce',
      completed: true,
      exitCode: 0,
      localFailure: 'CODEX_NOT_LOGGED_IN',
    })
  );
  const result = isolation.readLaunchResult(resultPath, 'nonce', { status: 0 });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /CODEX_NOT_LOGGED_IN/);
});

test('Codex worker script runs after fake login succeeds and stops locally when login fails', () => {
  const root = fixtureRoot();
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const codexPath = path.join(bin, 'codex.exe');
  const payloadPath = path.join(root, 'args.json');
  const resultPath = path.join(root, 'result.json');
  const markerPath = path.join(root, 'marker.json');
  fs.writeFileSync(
    payloadPath,
    JSON.stringify(['exec', '--dangerously-bypass-approvals-and-sandbox'])
  );

  const script = isolation.buildWorkerLaunchScript({
    credPath: 'worker.cred',
    workerRoot: root,
    exeFile: codexPath,
    payloadArgsPath: payloadPath,
    launchResultPath: resultPath,
    markerPath,
    completionNonce: 'codex-test-nonce',
    workerTimeoutMs: 1000,
    adapterId: 'codex',
    isolationVerdict: { verdict: 'CLOSED' },
    runAsCurrentUser: true,
  });
  assert.match(script, /login status/);
  assert.match(script, /localFailure = "CODEX_NOT_LOGGED_IN"/);
  assert.doesNotMatch(script, /\.codex.*credentials|credentials.*\.codex/i);
  assert.ok(script.indexOf('login status') < script.indexOf('@payloadArgs'));
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
