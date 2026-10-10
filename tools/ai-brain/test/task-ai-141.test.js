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

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('intake catalogue strings plus --external-workers agy-pool produce pool candidates', async () => {
  const root = fixtureRoot();
  const backendModel = 'gemini-fixture-pro';
  const result = await intake.runIntake(
    { workItem: 'FIXTURE-AI-141' },
    {
      root,
      baseSha: 'b'.repeat(40),
      readRegisterRow: () => ({ dependencies: '' }),
      readRegisterRows: () => [],
      listAccounts: () => [],
      hasAgyPoolQuota: true,
      readHistory: () => [],
      isAncestorOf: () => true,
      read9routerModels: async () => ({ ok: true, models: [backendModel] }),
      readAgyModels: async () => ({ ok: true, models: [] }),
      readEvidenceModels: async () => ({ ok: true, models: [] }),
    }
  );

  assert.deepEqual(result.catalogue, [backendModel]);
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
  evidence.recordProbe(path.join(root, 'evidence'), agCandidate, {
    status: 'failed',
    httpStatus: 429,
    body: 'rate limited on the 9router ag path',
  });
  const proofData = evidence.loadEvidence(path.join(root, 'evidence'));
  assert.equal(evidence.isCandidateBlocked(proofData, agCandidate).blocked, true);

  const result = await intake.runIntake(
    { workItem: 'FIXTURE-AI-141' },
    {
      root,
      baseSha: 'c'.repeat(40),
      readRegisterRow: () => ({ dependencies: '' }),
      readRegisterRows: () => [],
      listAccounts: () => [],
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

  const unknown = Object.assign({}, poolCandidate, {
    modelId: 'unrecognized-route/' + backendModel,
  });
  assert.equal(require('../routing').proofObservedWithSource(proofData, unknown).level, null);
});
