'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runOrchestration, ItemStatus } = require('../orchestrate');
const { resumeGoal } = require('../goals');
const { getDispatchConfig } = require('../sources');
const { candidateKey } = require('../candidates');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'task-ai-142-sat-'));
}

function makeTempRepo() {
  const dir = tmpDir('repo-');
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  git(['init', '-q']);
  git(['config', 'user.email', 'worker@shipde.test']);
  git(['config', 'user.name', 'Worker']);
  fs.writeFileSync(path.join(dir, 'payload.txt'), 'base content\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return { dir, sha: git(['rev-parse', 'HEAD']).stdout.trim() };
}

function addCommit(repoDir, relPath, content, message) {
  const full = path.join(repoDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  const git = (args) =>
    spawnSync('git', args, { cwd: repoDir, encoding: 'utf8', windowsHide: true });
  git(['add', '.']);
  git(['commit', '-q', '-m', message || 'add ' + relPath]);
  return git(['rev-parse', 'HEAD']).stdout.trim();
}

function sampleCandidate(overrides) {
  const c = Object.assign(
    {
      harness: 'opencode',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/ag/gemini-3.1-pro-low',
      source: 'oc',
      kind: 'agent-cli',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 64000 },
      evidence: [{ status: 'passed', kind: 'WORK_ITEM_PASS', proofLevel: 'WORK_ITEM_PASS' }],
      quality: 99,
      cost: 1,
    },
    overrides || {}
  );
  c.candidateKey = candidateKey(c);
  return c;
}

function sampleRegistry() {
  return {
    sources: [
      {
        id: '9router',
        endpoint: 'https://gateway.example/v1',
        credential: { env: 'NINEROUTER_API_KEY' },
      },
    ],
    dispatch: {
      providers: {
        oc: { harness: 'opencode-direct', provider: 'opencode' },
      },
    },
  };
}

test('TASK-AI-142: test nghiem thu da XANH tren base -> khong goi writer, ket thuc ALREADY_SATISFIED_ON_BASE', async (t) => {
  const host = makeTempRepo();
  const worker = makeTempRepo();

  // Acceptance test is committed on base and passes
  const testRelPath = 'tools/ai-brain/test/fixture-sat.test.js';
  const testCode = [
    "'use strict';",
    "const { test } = require('node:test');",
    "const assert = require('node:assert/strict');",
    "test('already passing acceptance test', () => {",
    '  assert.equal(1, 1);',
    '});',
  ].join('\n');

  const baseSha = addCommit(host.dir, testRelPath, testCode, 'add passing acceptance test');
  addCommit(worker.dir, testRelPath, testCode, 'sync passing acceptance test');

  const checkpointFile = path.join(tmpDir(), 'checkpoint.json');
  const decisionDir = tmpDir('decisions-');
  const evidenceDir = tmpDir('evidence-');

  let writerLaunches = 0;
  const dispatchConfig = getDispatchConfig();
  const expectedStatus = dispatchConfig.alreadySatisfiedStatus || 'ALREADY_SATISFIED_ON_BASE';

  const spec = {
    id: 'TASK-SAT-1',
    files: [testRelPath],
    verification: {
      command: `node --test ${testRelPath}`,
    },
    acceptanceCriteria: ['passes acceptance test'],
  };

  const options = {
    isolatedWorker: true,
    cwd: host.dir,
    workerRoot: worker.dir,
    baseSha,
    checkpointFile,
    decisionDir,
    evidenceDir,
    candidates: [sampleCandidate()],
    registry: sampleRegistry(),
    specs: [spec],
    routeProbe: async () => ({ ok: true, status: 200 }),
    run: (job) => {
      writerLaunches++;
      return { exitCode: 0, sessionId: 'ses-writer' };
    },
  };

  const result = await runOrchestration('sat goal', options);

  assert.equal(writerLaunches, 0, 'writer must not be launched when already satisfied on base');
  assert.ok(
    result.reconciliation.completed.includes('TASK-SAT-1'),
    'item must be recorded as completed'
  );

  const itemOutcome = result.outcomes.find((o) => o.workItemId === 'TASK-SAT-1');
  assert.ok(itemOutcome, 'outcome must exist for item');
  assert.equal(
    itemOutcome.status,
    expectedStatus,
    'outcome status must match alreadySatisfiedStatus'
  );
  assert.equal(itemOutcome.baseSha, baseSha, 'outcome must carry baseSha');
  assert.equal(itemOutcome.exitCode, 0, 'outcome exitCode must be 0');
  assert.ok(itemOutcome.command.includes(testRelPath), 'outcome must record verification command');
  assert.ok(itemOutcome.output !== undefined, 'outcome must record output');

  // Decision log verification
  const decisionFiles = fs.readdirSync(decisionDir).filter((f) => f.endsWith('.jsonl'));
  const records = decisionFiles.flatMap((f) =>
    fs
      .readFileSync(path.join(decisionDir, f), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
  );
  const satDecision = records.find(
    (r) =>
      r.workItemId === 'TASK-SAT-1' &&
      (r.status === expectedStatus ||
        r.stage === expectedStatus ||
        r.detail?.includes(expectedStatus))
  );
  assert.ok(satDecision, 'decision log must contain already-satisfied record');
  assert.equal(satDecision.exitCode, 0);
  assert.equal(satDecision.baseSha, baseSha);

  // Checkpoint verification
  assert.ok(fs.existsSync(checkpointFile), 'checkpoint must be written');
  const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  const step = checkpoint.liveSteps['TASK-SAT-1'];
  assert.ok(step, 'checkpoint must record step for item');
  assert.equal(step.status, expectedStatus);
  assert.equal(step.exitCode, 0);
  assert.equal(step.baseSha, baseSha);
});

test('TASK-AI-142: test nghiem thu DO tren base -> van goi writer nhu cu', async (t) => {
  const host = makeTempRepo();
  const worker = makeTempRepo();

  // Acceptance test is committed on base but fails
  const testRelPath = 'tools/ai-brain/test/fixture-red.test.js';
  const testCode = [
    "'use strict';",
    "const { test } = require('node:test');",
    "const assert = require('node:assert/strict');",
    "test('failing acceptance test on base', () => {",
    '  assert.equal(1, 2);',
    '});',
  ].join('\n');

  const baseSha = addCommit(host.dir, testRelPath, testCode, 'add failing acceptance test');
  addCommit(worker.dir, testRelPath, testCode, 'sync failing acceptance test');

  const checkpointFile = path.join(tmpDir(), 'checkpoint.json');
  const decisionDir = tmpDir('decisions-');
  const evidenceDir = tmpDir('evidence-');

  let writerLaunches = 0;

  const spec = {
    id: 'TASK-RED-1',
    files: [testRelPath],
    verification: {
      command: `node --test ${testRelPath}`,
    },
    acceptanceCriteria: ['passes acceptance test'],
  };

  const options = {
    isolatedWorker: true,
    cwd: host.dir,
    workerRoot: worker.dir,
    baseSha,
    checkpointFile,
    decisionDir,
    evidenceDir,
    candidates: [sampleCandidate()],
    registry: sampleRegistry(),
    specs: [spec],
    routeProbe: async () => ({ ok: true, status: 200 }),
    run: (job) => {
      writerLaunches++;
      return { exitCode: 0, sessionId: 'ses-writer' };
    },
  };

  await runOrchestration('red goal', options);

  assert.equal(writerLaunches, 1, 'writer must be called when acceptance test is red on base');
});

test('TASK-AI-142: goal resume khong mo lai item da ALREADY_SATISFIED_ON_BASE; goal het item mo -> COMPLETED', (t) => {
  const rootDir = tmpDir('root-');
  const goalsDir = path.join(rootDir, 'data', 'goals');
  const goalId = 'G-SATISFIED01';
  const goalDir = path.join(goalsDir, goalId);
  fs.mkdirSync(goalDir, { recursive: true });

  const goalFile = path.join(goalDir, 'goal.json');
  fs.writeFileSync(
    goalFile,
    JSON.stringify({
      id: goalId,
      status: 'RUNNING',
      items: ['GOAL-SAT-1'],
    }),
    'utf8'
  );

  // Checkpoint records item as ALREADY_SATISFIED_ON_BASE
  const ckptFile = path.join(goalDir, 'checkpoint.json');
  fs.writeFileSync(
    ckptFile,
    JSON.stringify({
      schemaVersion: 1,
      items: {
        'GOAL-SAT-1': {
          state: 'ALREADY_SATISFIED_ON_BASE',
          testResult: { pass: true },
        },
      },
      alreadySatisfied: ['GOAL-SAT-1'],
    }),
    'utf8'
  );

  const res = resumeGoal(goalId, { root: rootDir, goalsDir });
  assert.equal(res.status, 'COMPLETED', 'goal with all items satisfied must finish COMPLETED');
  assert.deepEqual(res.skipped, ['GOAL-SAT-1'], 'satisfied item must be skipped');
  assert.deepEqual(res.remaining, [], 'no remaining items to run');

  const updatedGoal = JSON.parse(fs.readFileSync(goalFile, 'utf8'));
  assert.equal(updatedGoal.status, 'COMPLETED');
});

test('TASK-AI-142: goal resume nhan dien dependency da ALREADY_SATISFIED_ON_BASE de mo item tiep theo', (t) => {
  const rootDir = tmpDir('root-');
  const goalsDir = path.join(rootDir, 'data', 'goals');
  const goalId = 'G-SATISFIED02';
  const goalDir = path.join(goalsDir, goalId);
  fs.mkdirSync(goalDir, { recursive: true });

  const goalFile = path.join(goalDir, 'goal.json');
  fs.writeFileSync(
    goalFile,
    JSON.stringify({
      id: goalId,
      status: 'RUNNING',
      items: ['GOAL-SAT-1', 'GOAL-DEP-2'],
    }),
    'utf8'
  );

  const docFile = path.join(rootDir, 'docs', 'TASK-DEP-2.md');
  fs.mkdirSync(path.dirname(docFile), { recursive: true });
  fs.writeFileSync(docFile, '# Spec', 'utf8');

  const regFile = path.join(goalDir, 'register.csv');
  const regRows = [
    [
      'Index',
      'Epic',
      'Feature',
      'Work Item ID',
      'Title',
      'Role',
      'Harness',
      'Status',
      'Dependencies',
      'Work Item File',
      'Branch',
      'PR',
      'Review',
      'Commit',
    ],
    [
      '1',
      'E1',
      'F1',
      'GOAL-SAT-1',
      'Sat 1',
      'author',
      'opencode',
      'ALREADY_SATISFIED_ON_BASE',
      '',
      'docs/TASK-SAT-1.md',
      'feat/sat-1',
      '',
      '',
      '',
    ],
    [
      '2',
      'E1',
      'F1',
      'GOAL-DEP-2',
      'Dep 2',
      'author',
      'opencode',
      'BACKLOG',
      'GOAL-SAT-1',
      'docs/TASK-DEP-2.md',
      'feat/dep-2',
      '',
      '',
      '',
    ],
  ];
  fs.writeFileSync(
    regFile,
    regRows.map((r) => r.map((c) => JSON.stringify(c)).join(',')).join('\n') + '\n',
    'utf8'
  );

  let runnerCalled = false;
  const res = resumeGoal(
    goalId,
    { root: rootDir, goalsDir, registerPath: regFile },
    {
      isPidAlive: () => false,
      spawn: () => {
        runnerCalled = true;
        return { pid: 99999, unref() {} };
      },
    }
  );

  assert.equal(res.status, 'RESUMED');
  assert.deepEqual(res.skipped, ['GOAL-SAT-1']);
  assert.deepEqual(res.remaining, ['GOAL-DEP-2']);
  assert.ok(runnerCalled, 'runner must be launched for remaining dependent item');

  const updatedRows = fs
    .readFileSync(regFile, 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split(',').map((c) => JSON.parse(c)));
  const depRow = updatedRows.find((r) => r[3] === 'GOAL-DEP-2');
  assert.equal(
    depRow[7],
    'READY_FOR_AUTHOR',
    'dependent item must be promoted to READY_FOR_AUTHOR'
  );
});
