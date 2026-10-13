'use strict';

/**
 * Ship Dễ — TASK-AI-142 Part H1 Tests:
 * Goal store and Controller contract
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const goals = require('../goals');
const decisions = require('../decisions');
const orchestrate = require('../orchestrate');
const routing = require('../routing');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-test-'));
}

describe('TASK-AI-142 Part H1 — Goal store and Controller contract', () => {
  let tempDir;
  let goalsDir;
  let workItemsDir;
  let registerPath;

  beforeEach(() => {
    tempDir = createTempDir();
    goalsDir = path.join(tempDir, 'data', 'goals');
    workItemsDir = path.join(tempDir, 'docs', 'product-spec', 'work-items');
    registerPath = path.join(
      tempDir,
      'docs',
      'product-spec',
      'docs',
      '10-ai-collaboration',
      'FEATURE-DELIVERY-REGISTER.csv'
    );
    fs.mkdirSync(goalsDir, { recursive: true });
    fs.mkdirSync(workItemsDir, { recursive: true });
    fs.mkdirSync(path.dirname(registerPath), { recursive: true });

    // Seed empty register
    const header = [
      '"delivery_order"',
      '"slice"',
      '"group"',
      '"work_item_id"',
      '"feature_id"',
      '"feature_name"',
      '"key_behavior"',
      '"status"',
      '"dependencies"',
      '"work_item_path"',
      '"branch"',
      '"pr"',
      '"codex_verdict"',
      '"merge_commit"',
    ].join(',');
    fs.writeFileSync(registerPath, header + '\n', 'utf8');
  });

  test('goal-generated author.foundation profiles without proofFloor use NONE', () => {
    const profile = orchestrate.buildTaskProfile(
      { id: 'GOAL-AUTOCLAW-REPOS-1', role: 'author.foundation', proofFloor: null },
      { enforceProofFloors: true }
    );
    assert.equal(profile.proofFloor, 'NONE');

    const candidate = {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'router',
      upstream: 'provider',
      accountId: 'account',
      quotaScope: 'account',
      modelId: 'provider/model-without-work-item-pass',
      quality: 90,
      latencyMs: 500,
      cost: 1,
      capabilities: {},
      evidence: [],
    };
    const ranked = routing.rankForProfile(
      [candidate],
      profile,
      { weightProfile: 'BALANCED' },
      { now: Date.now(), evidenceData: {} }
    );
    assert.ok(
      ranked.ranking.some((entry) => entry.modelId === candidate.modelId),
      'goal-generated author.foundation profile ranks a candidate with no WORK_ITEM_PASS evidence'
    );

    const reviewer = orchestrate.buildTaskProfile(
      { id: 'GOAL-REVIEW-1', role: 'reviewer', proofFloor: null },
      { enforceProofFloors: true }
    );
    assert.equal(reviewer.proofFloor, 'WORK_ITEM_PASS');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('goal start creates data/goals/<goalId>/goal.json and is idempotent per identical open text', () => {
    const goalText = 'Ship autonomous carrier label reprint feature';
    const res1 = goals.startGoal({
      text: goalText,
      rootDir: tempDir,
      goalsDir,
      id: 'G1',
    });

    assert.equal(res1.goalId, 'G1');
    assert.equal(res1.text, goalText);
    assert.equal(res1.status, 'OPEN');
    assert.deepEqual(res1.constraints, []);
    assert.ok(res1.createdAt);

    const goalFile = path.join(goalsDir, 'G1', 'goal.json');
    assert.ok(fs.existsSync(goalFile));
    const onDisk = JSON.parse(fs.readFileSync(goalFile, 'utf8'));
    assert.equal(onDisk.goalId, 'G1');
    assert.equal(onDisk.text, goalText);
    assert.equal(onDisk.status, 'OPEN');

    // Second call with identical text returns the existing goal (idempotent)
    const res2 = goals.startGoal({
      text: goalText,
      rootDir: tempDir,
      goalsDir,
    });
    assert.equal(res2.goalId, 'G1');
    assert.equal(res2.idempotent, true);

    // Missing text is refused
    const resEmpty = goals.startGoal({
      text: '   ',
      rootDir: tempDir,
      goalsDir,
    });
    assert.equal(resEmpty.refusal, true);
    assert.equal(resEmpty.error, 'MISSING_GOAL_TEXT');
  });

  test('goal amend appends to constraints and does not create a new run', () => {
    const res1 = goals.startGoal({
      text: 'Deploy automated reconciliation',
      rootDir: tempDir,
      goalsDir,
      id: 'G2',
    });
    assert.equal(res1.goalId, 'G2');

    const amend1 = goals.amendGoal('G2', {
      text: 'no schema migration',
      rootDir: tempDir,
      goalsDir,
    });
    assert.equal(amend1.goalId, 'G2');
    assert.deepEqual(amend1.constraints, ['no schema migration']);

    const amend2 = goals.amendGoal('G2', {
      text: 'max runtime 5m',
      rootDir: tempDir,
      goalsDir,
    });
    assert.deepEqual(amend2.constraints, ['no schema migration', 'max runtime 5m']);

    const goalFile = path.join(goalsDir, 'G2', 'goal.json');
    const onDisk = JSON.parse(fs.readFileSync(goalFile, 'utf8'));
    assert.deepEqual(onDisk.constraints, ['no schema migration', 'max runtime 5m']);
    assert.equal(onDisk.status, 'OPEN');

    // Amend on non-existent goal is refused
    const amendMissing = goals.amendGoal('NON_EXISTENT', {
      text: 'constraint',
      rootDir: tempDir,
      goalsDir,
    });
    assert.equal(amendMissing.refusal, true);
    assert.equal(amendMissing.error, 'GOAL_NOT_FOUND');
  });

  test('goal plan validates tasks and refuses with BLOCKED when sources, verification or criteria are missing', () => {
    goals.startGoal({
      text: 'Goal for validation testing',
      rootDir: tempDir,
      goalsDir,
      id: 'G3',
    });

    // Plan with missing source refs and missing verification commands
    const badPlanContent = [
      '# Defective Plan',
      '',
      'Goal: Test validation gate',
      '',
      '## Task 1: Untested renderer',
      'Files: `apps/web/src/render.ts`',
      '- Renders output',
      '',
    ].join('\n');

    const badPlanFile = path.join(tempDir, 'bad-plan.md');
    fs.writeFileSync(badPlanFile, badPlanContent, 'utf8');

    const result = goals.planGoal('G3', {
      file: badPlanFile,
      rootDir: tempDir,
      goalsDir,
      registerPath,
    });

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.refusal, true);
    assert.ok(Array.isArray(result.questions));
    assert.ok(result.questions.length >= 2);
    assert.ok(
      result.questions.some((q) => q.includes('missing source references')),
      'Should complain about missing source references'
    );
    assert.ok(
      result.questions.some((q) => q.includes('no test or verification command')),
      'Should complain about missing verification command'
    );

    // Goal on disk should be updated to BLOCKED with questions
    const goalFile = path.join(goalsDir, 'G3', 'goal.json');
    const onDisk = JSON.parse(fs.readFileSync(goalFile, 'utf8'));
    assert.equal(onDisk.status, 'BLOCKED');
    assert.deepEqual(onDisk.questions, result.questions);
  });

  test('goal plan refuses when a cycle or missing dependency is detected', () => {
    goals.startGoal({
      text: 'Cycle detection goal',
      rootDir: tempDir,
      goalsDir,
      id: 'G4',
    });

    const cyclePlanContent = [
      '# Cycle Plan',
      '',
      'Goal: Test cycle detection',
      '',
      '## Task 1: Component A',
      'Sources: `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`',
      'Files: `apps/web/src/a.ts`',
      'Depends on: Task 2',
      '- Do A',
      'Run: `npm test`',
      '',
      '## Task 2: Component B',
      'Sources: `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`',
      'Files: `apps/web/src/b.ts`',
      'Depends on: Task 1',
      '- Do B',
      'Run: `npm test`',
      '',
    ].join('\n');

    const cycleFile = path.join(tempDir, 'cycle-plan.md');
    fs.writeFileSync(cycleFile, cyclePlanContent, 'utf8');

    const result = goals.planGoal('G4', {
      file: cycleFile,
      rootDir: tempDir,
      goalsDir,
      registerPath,
    });

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.refusal, true);
    assert.ok(
      result.questions.some((q) => q.includes('DEPENDENCY_CYCLE') || q.includes('cycle')),
      'Should identify dependency cycle'
    );
  });

  test('goal plan succeeds for valid plan, writing Work Item docs and register rows linked to goalId', () => {
    goals.startGoal({
      text: 'Label reprint pipeline',
      rootDir: tempDir,
      goalsDir,
      id: 'G5',
    });

    const validPlanContent = [
      '# Valid Plan',
      '',
      'Goal: Label reprint pipeline',
      '',
      '## Task 1: Label core renderer',
      'Sources: `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`',
      'Files: `apps/web/src/render.ts`, `apps/web/src/render.test.ts`',
      '- Render valid label snapshot',
      'Run: `node --test apps/web/src/render.test.ts`',
      '',
      '## Task 2: Reprint endpoint',
      'Sources: `docs/product-spec/docs/05-api-integrations/API-CONTRACTS.md`',
      'Files: `apps/web/src/reprint.ts`, `apps/web/src/reprint.test.ts`',
      'Depends on: Task 1',
      '- Expose authenticated endpoint',
      'Run: `node --test apps/web/src/reprint.test.ts`',
      '',
    ].join('\n');

    const validPlanFile = path.join(tempDir, 'valid-plan.md');
    fs.writeFileSync(validPlanFile, validPlanContent, 'utf8');

    const result = goals.planGoal('G5', {
      file: validPlanFile,
      rootDir: tempDir,
      goalsDir,
      registerPath,
    });

    assert.equal(result.status, 'PLANNED');
    assert.equal(result.goalId, 'G5');
    assert.deepEqual(result.items, ['GOAL-G5-1', 'GOAL-G5-2']);

    // Check Work Item docs written
    const doc1 = path.join(workItemsDir, 'GOAL-G5-1.md');
    const doc2 = path.join(workItemsDir, 'GOAL-G5-2.md');
    assert.ok(fs.existsSync(doc1));
    assert.ok(fs.existsSync(doc2));

    const content1 = fs.readFileSync(doc1, 'utf8');
    assert.ok(content1.includes('# GOAL-G5-1 — Label core renderer'));
    assert.ok(content1.includes('`READY_FOR_AUTHOR`'));
    assert.ok(content1.includes('`GOAL-G5`'));

    const content2 = fs.readFileSync(doc2, 'utf8');
    assert.ok(content2.includes('# GOAL-G5-2 — Reprint endpoint'));
    assert.ok(content2.includes('`BACKLOG`'));
    assert.ok(content2.includes('GOAL-G5-1'));

    // Check register rows appended
    const regContent = fs.readFileSync(registerPath, 'utf8');
    assert.ok(regContent.includes('"GOAL-G5-1"'));
    assert.ok(regContent.includes('"GOAL-G5-2"'));
    assert.ok(regContent.includes('"GOAL-G5"'));
    assert.ok(regContent.includes('"READY_FOR_AUTHOR"'));
    assert.ok(regContent.includes('"BACKLOG"'));

    // Check goal-specific register created
    const goalRegPath = path.join(goalsDir, 'G5', 'register.csv');
    assert.ok(fs.existsSync(goalRegPath));
    const goalRegContent = fs.readFileSync(goalRegPath, 'utf8');
    assert.ok(goalRegContent.includes('"GOAL-G5-1"'));
    assert.ok(goalRegContent.includes('"GOAL-G5-2"'));

    // Goal on disk is PLANNED
    const goalFile = path.join(goalsDir, 'G5', 'goal.json');
    const onDisk = JSON.parse(fs.readFileSync(goalFile, 'utf8'));
    assert.equal(onDisk.status, 'PLANNED');
    assert.deepEqual(onDisk.items, ['GOAL-G5-1', 'GOAL-G5-2']);
  });

  test('goal run enforces single instance via lock file and reports running pid on duplicate call', () => {
    goals.startGoal({
      text: 'Run test goal',
      rootDir: tempDir,
      goalsDir,
      id: 'G6',
    });

    const planFile = path.join(tempDir, 'p6.md');
    fs.writeFileSync(
      planFile,
      [
        '# P6',
        '## Task 1: Runner task',
        'Sources: `docs/spec.md`',
        'Files: `src/task.ts`',
        '- Criteria 1',
        'Run: `npm test`',
      ].join('\n')
    );
    goals.planGoal('G6', { file: planFile, rootDir: tempDir, goalsDir, registerPath });

    // First call with mock run
    let alivePids = new Set();
    const mockSpawn = () => {
      const pid = 12345;
      alivePids.add(pid);
      return { pid, unref: () => {} };
    };

    const run1 = goals.runGoal(
      'G6',
      { rootDir: tempDir, goalsDir },
      { spawn: mockSpawn, isPidAlive: (pid) => alivePids.has(pid) }
    );

    assert.equal(run1.status, 'STARTED');
    assert.equal(run1.pid, 12345);

    const lockFile = path.join(goalsDir, 'G6', 'run.lock');
    assert.ok(fs.existsSync(lockFile));
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    assert.equal(lock.pid, 12345);

    // Second call reports running pid, never starts a duplicate
    let secondSpawnCalled = false;
    const run2 = goals.runGoal(
      'G6',
      { rootDir: tempDir, goalsDir },
      {
        spawn: () => {
          secondSpawnCalled = true;
          return { pid: 99999, unref: () => {} };
        },
        isPidAlive: (pid) => alivePids.has(pid),
      }
    );

    assert.equal(run2.status, 'ALREADY_RUNNING');
    assert.equal(run2.pid, 12345);
    assert.equal(run2.running, true);
    assert.equal(secondSpawnCalled, false, 'Duplicate spawn should not be called');
  });

  test('goal status reports per item details: state, candidate key, branch, commit SHA, test result, review verdict, last decision id', () => {
    goals.startGoal({
      text: 'Status test goal',
      rootDir: tempDir,
      goalsDir,
      id: 'G7',
    });

    const planFile = path.join(tempDir, 'p7.md');
    fs.writeFileSync(
      planFile,
      [
        '# P7',
        '## Task 1: Task One',
        'Sources: `docs/spec.md`',
        'Files: `src/one.ts`',
        '- Crit 1',
        'Run: `npm test`',
        '## Task 2: Task Two',
        'Sources: `docs/spec.md`',
        'Files: `src/two.ts`',
        'Depends on: Task 1',
        '- Crit 2',
        'Run: `npm test`',
      ].join('\n')
    );
    goals.planGoal('G7', { file: planFile, rootDir: tempDir, goalsDir, registerPath });

    // Record decision linking goalId -> workItemId -> candidateKey -> session -> commit -> review
    const decisionDir = path.join(tempDir, 'decisions');
    goals.recordGoalDecision(
      {
        stage: decisions.Stage.COMPLETED,
        goalId: 'G7',
        workItemId: 'GOAL-G7-1',
        candidateKey: 'gemini::cli::direct::google::primary::gemini-3.1-pro',
        sessionId: 'session-1234',
        branch: 'feat/goal-g7-1-impl',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        review: 'PASS',
      },
      { dir: decisionDir, now: Date.now() }
    );

    const status = goals.statusGoal(
      'G7',
      { rootDir: tempDir, goalsDir },
      { decisionDir, isPidAlive: () => false }
    );

    assert.equal(status.goalId, 'G7');
    assert.equal(status.items.length, 2);

    const item1 = status.items.find((i) => i.workItemId === 'GOAL-G7-1');
    assert.ok(item1);
    assert.equal(item1.candidateKey, 'gemini::cli::direct::google::primary::gemini-3.1-pro');
    assert.equal(item1.branch, 'feat/goal-g7-1-impl');
    assert.equal(item1.commitSha, 'abcdef1234567890abcdef1234567890abcdef12');
    assert.equal(item1.reviewVerdict, 'PASS');
    assert.ok(item1.lastDecisionId);

    const item2 = status.items.find((i) => i.workItemId === 'GOAL-G7-2');
    assert.ok(item2);
    assert.equal(item2.state, 'BACKLOG');
  });

  test('goal stop terminates running process and writes stop checkpoint; goal resume skips items already PASSED/MERGED', () => {
    goals.startGoal({
      text: 'Stop/resume test goal',
      rootDir: tempDir,
      goalsDir,
      id: 'G8',
    });

    const planFile = path.join(tempDir, 'p8.md');
    fs.writeFileSync(
      planFile,
      [
        '# P8',
        '## Task 1: Step A',
        'Sources: `docs/spec.md`',
        'Files: `src/a.ts`',
        '- Step A',
        'Run: `npm test`',
        '## Task 2: Step B',
        'Sources: `docs/spec.md`',
        'Files: `src/b.ts`',
        'Depends on: Task 1',
        '- Step B',
        'Run: `npm test`',
      ].join('\n')
    );
    goals.planGoal('G8', { file: planFile, rootDir: tempDir, goalsDir, registerPath });

    // Mock active run with pid 45678
    let killedPids = [];
    const lockFile = path.join(goalsDir, 'G8', 'run.lock');
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ pid: 45678, goalId: 'G8', startedAt: new Date().toISOString() })
    );

    const stopRes = goals.stopGoal(
      'G8',
      { rootDir: tempDir, goalsDir },
      {
        isPidAlive: (pid) => pid === 45678,
        killPid: (pid) => killedPids.push(pid),
      }
    );

    assert.equal(stopRes.status, 'STOPPED');
    assert.equal(stopRes.pid, 45678);
    assert.deepEqual(killedPids, [45678]);
    assert.equal(fs.existsSync(lockFile), false);
    assert.ok(fs.existsSync(path.join(goalsDir, 'G8', '.stop')));

    // Simulate Step A being MERGED in register
    const regLines = fs.readFileSync(registerPath, 'utf8').split('\n');
    const updatedLines = regLines.map((l) => {
      if (l.includes('"GOAL-G8-1"')) {
        return l.replace('"READY_FOR_AUTHOR"', '"MERGED"');
      }
      return l;
    });
    fs.writeFileSync(registerPath, updatedLines.join('\n'), 'utf8');

    // Resume should skip GOAL-G8-1 and run GOAL-G8-2
    let spawnedArgs = null;
    const resumeRes = goals.resumeGoal(
      'G8',
      { rootDir: tempDir, goalsDir, externalWorkers: 'agy-pool' },
      {
        isPidAlive: () => false,
        spawn: (_bin, args) => {
          spawnedArgs = args;
          return { pid: 77777, unref: () => {} };
        },
      }
    );

    assert.equal(resumeRes.status, 'RESUMED');
    assert.deepEqual(resumeRes.skipped, ['GOAL-G8-1']);
    assert.deepEqual(resumeRes.remaining, ['GOAL-G8-2']);
    assert.equal(resumeRes.pid, 77777);

    // Verify spawned args passed to next runner (P2 finding fix)
    assert.ok(Array.isArray(spawnedArgs), 'Runner must be spawned with args');
    assert.ok(spawnedArgs.includes('--loop'), 'Runner args must include --loop');
    assert.ok(spawnedArgs.includes('--run'), 'Runner args must include --run');
    assert.equal(spawnedArgs[spawnedArgs.indexOf('--external-workers') + 1], 'agy-pool');
    assert.ok(spawnedArgs.includes('--register'), 'Runner args must include --register');
    const goalRegPath = path.join(goalsDir, 'G8', 'register.csv');
    const regArgIdx = spawnedArgs.indexOf('--register');
    assert.equal(spawnedArgs[regArgIdx + 1], goalRegPath, 'Runner must be passed goal register');

    // Verify goal register on disk is updated: skipped items marked MERGED, remaining items present
    assert.ok(fs.existsSync(goalRegPath), 'Goal register must exist on disk');
    const goalRegContent = fs.readFileSync(goalRegPath, 'utf8');
    assert.ok(
      goalRegContent.includes('"GOAL-G8-1"') && goalRegContent.includes('"MERGED"'),
      'Skipped item GOAL-G8-1 must be marked MERGED in goal register'
    );
    assert.ok(
      !goalRegContent.includes('"GOAL-G8-1","READY_FOR_AUTHOR"'),
      'Skipped item must not remain READY_FOR_AUTHOR in goal register'
    );
    assert.ok(
      goalRegContent.includes('"GOAL-G8-2"'),
      'Remaining item GOAL-G8-2 must be present in goal register'
    );
  });

  test('CLI interface: node tools/ai-brain/cli.js goal start/amend/plan/status outputs JSON on stdout and exit code != 0 on refusal', () => {
    const cliPath = path.resolve(__dirname, '..', 'cli.js');

    // 1. Refusal on missing goal text -> JSON on stdout and non-zero exit code
    const spawnRefusal = spawnSync(process.execPath, [cliPath, 'goal', 'start'], {
      encoding: 'utf8',
      env: process.env,
    });
    assert.notEqual(spawnRefusal.status, 0);
    const parsedRefusal = JSON.parse(spawnRefusal.stdout);
    assert.equal(parsedRefusal.refusal, true);
    assert.equal(parsedRefusal.error, 'MISSING_GOAL_TEXT');

    // 2. Success on valid start -> JSON on stdout and exit code 0
    const spawnStart = spawnSync(
      process.execPath,
      [cliPath, 'goal', 'start', '--text', 'CLI test goal', '--id', 'GCLI', '--root', tempDir],
      { encoding: 'utf8', env: process.env }
    );
    assert.equal(spawnStart.status, 0);
    const parsedStart = JSON.parse(spawnStart.stdout);
    assert.equal(parsedStart.goalId, 'GCLI');
    assert.equal(parsedStart.status, 'OPEN');

    // 3. Amend via CLI
    const spawnAmend = spawnSync(
      process.execPath,
      [cliPath, 'goal', 'amend', 'GCLI', '--text', 'no third-party cloud keys', '--root', tempDir],
      { encoding: 'utf8', env: process.env }
    );
    assert.equal(spawnAmend.status, 0);
    const parsedAmend = JSON.parse(spawnAmend.stdout);
    assert.deepEqual(parsedAmend.constraints, ['no third-party cloud keys']);

    // 4. Status via CLI
    const spawnStatus = spawnSync(
      process.execPath,
      [cliPath, 'goal', 'status', 'GCLI', '--root', tempDir],
      { encoding: 'utf8', env: process.env }
    );
    assert.equal(spawnStatus.status, 0);
    const parsedStatus = JSON.parse(spawnStatus.stdout);
    assert.equal(parsedStatus.goalId, 'GCLI');
    assert.equal(parsedStatus.running, false);

    // 5. Plan via CLI with invalid plan -> exit code != 0 and status BLOCKED
    const badPlan = path.join(tempDir, 'cli-bad.md');
    fs.writeFileSync(badPlan, '# Bad\n## Task 1: No source or verify\nFiles: `src/x.ts`\n');
    const spawnBadPlan = spawnSync(
      process.execPath,
      [cliPath, 'goal', 'plan', 'GCLI', '--file', badPlan, '--root', tempDir],
      { encoding: 'utf8', env: process.env }
    );
    assert.notEqual(spawnBadPlan.status, 0);
    const parsedBadPlan = JSON.parse(spawnBadPlan.stdout);
    assert.equal(parsedBadPlan.status, 'BLOCKED');
    assert.ok(parsedBadPlan.questions.length > 0);

    // 6. Plan via CLI with valid plan -> exit code 0 and status PLANNED
    const goodPlan = path.join(tempDir, 'cli-good.md');
    fs.writeFileSync(
      goodPlan,
      [
        '# Good',
        '## Task 1: CLI Planned Task',
        'Sources: `docs/spec.md`',
        'Files: `src/cli-x.ts`',
        '- Criteria pass',
        'Run: `node --test`',
      ].join('\n')
    );
    const spawnGoodPlan = spawnSync(
      process.execPath,
      [cliPath, 'goal', 'plan', 'GCLI', '--file', goodPlan, '--root', tempDir],
      { encoding: 'utf8', env: process.env }
    );
    assert.equal(spawnGoodPlan.status, 0);
    const parsedGoodPlan = JSON.parse(spawnGoodPlan.stdout);
    assert.equal(parsedGoodPlan.status, 'PLANNED');
    assert.deepEqual(parsedGoodPlan.items, ['GOAL-GCLI-1']);

    // 7. Stop via CLI when not running
    const spawnStop = spawnSync(
      process.execPath,
      [cliPath, 'goal', 'stop', 'GCLI', '--root', tempDir],
      { encoding: 'utf8', env: process.env }
    );
    assert.equal(spawnStop.status, 0);
    const parsedStop = JSON.parse(spawnStop.stdout);
    assert.equal(parsedStop.status, 'STOPPED');
  });

  test('goal resume treats state PASSED as done, updates goal register, and skips it', () => {
    goals.startGoal({
      text: 'Passed state resume goal',
      rootDir: tempDir,
      goalsDir,
      id: 'G9',
    });

    const planFile = path.join(tempDir, 'p9.md');
    fs.writeFileSync(
      planFile,
      [
        '# P9',
        '## Task 1: Step P1',
        'Sources: `docs/spec.md`',
        'Files: `src/p1.ts`',
        '- Step P1',
        'Run: `npm test`',
        '## Task 2: Step P2',
        'Sources: `docs/spec.md`',
        'Files: `src/p2.ts`',
        'Depends on: Task 1',
        '- Step P2',
        'Run: `npm test`',
      ].join('\n')
    );
    goals.planGoal('G9', { file: planFile, rootDir: tempDir, goalsDir, registerPath });

    // Mark Task 1 as PASSED in canonical register (not MERGED)
    const regLines = fs.readFileSync(registerPath, 'utf8').split('\n');
    const updatedLines = regLines.map((l) => {
      if (l.includes('"GOAL-G9-1"')) {
        return l.replace('"READY_FOR_AUTHOR"', '"PASSED"');
      }
      return l;
    });
    fs.writeFileSync(registerPath, updatedLines.join('\n'), 'utf8');

    let spawnedArgs = null;
    const resumeRes = goals.resumeGoal(
      'G9',
      { rootDir: tempDir, goalsDir, registerPath },
      {
        isPidAlive: () => false,
        spawn: (_bin, args) => {
          spawnedArgs = args;
          return { pid: 88888, unref: () => {} };
        },
      }
    );

    assert.equal(resumeRes.status, 'RESUMED');
    assert.deepEqual(resumeRes.skipped, ['GOAL-G9-1']);
    assert.deepEqual(resumeRes.remaining, ['GOAL-G9-2']);
    assert.equal(resumeRes.pid, 88888);

    const goalRegPath = path.join(goalsDir, 'G9', 'register.csv');
    assert.ok(fs.existsSync(goalRegPath));
    const goalRegContent = fs.readFileSync(goalRegPath, 'utf8');
    assert.ok(
      goalRegContent.includes('"GOAL-G9-1"') &&
        (goalRegContent.includes('"PASSED"') || goalRegContent.includes('"MERGED"')),
      'GOAL-G9-1 must be marked done/PASSED/MERGED in goal register'
    );
    assert.ok(
      !goalRegContent.includes('"GOAL-G9-1","READY_FOR_AUTHOR"'),
      'GOAL-G9-1 must not remain READY_FOR_AUTHOR'
    );
    assert.ok(Array.isArray(spawnedArgs));
  });

  test('goal resume propagates refusal/error on spawn failure and CLI exits non-zero', () => {
    goals.startGoal({
      text: 'Resume failure test',
      rootDir: tempDir,
      goalsDir,
      id: 'G10',
    });

    const planFile = path.join(tempDir, 'p10.md');
    fs.writeFileSync(
      planFile,
      [
        '# P10',
        '## Task 1: Step P10',
        'Sources: `docs/spec.md`',
        'Files: `src/p10.ts`',
        '- Step P10',
        'Run: `npm test`',
      ].join('\n')
    );
    goals.planGoal('G10', { file: planFile, rootDir: tempDir, goalsDir, registerPath });

    // Spawn fails (returns null pid)
    const resumeFail = goals.resumeGoal(
      'G10',
      { rootDir: tempDir, goalsDir },
      {
        isPidAlive: () => false,
        spawn: () => ({ pid: null }),
      }
    );

    assert.equal(resumeFail.status, 'RESUME_FAILED');
    assert.equal(resumeFail.refusal, true);
    assert.equal(resumeFail.error, 'SPAWN_FAILED');

    // CLI resume on non-existent goal -> non-zero exit and refusal: true
    const cliPath = path.resolve(__dirname, '..', 'cli.js');
    const spawnRes = spawnSync(
      process.execPath,
      [cliPath, 'goal', 'resume', 'NONEXISTENT', '--root', tempDir],
      { encoding: 'utf8', env: process.env }
    );
    assert.notEqual(spawnRes.status, 0);
    const parsed = JSON.parse(spawnRes.stdout);
    assert.equal(parsed.refusal, true);
    assert.equal(parsed.error, 'GOAL_NOT_FOUND');
  });

  test('goal operations reject invalid goalId containing .. or path separators or invalid chars', () => {
    const invalidIds = [
      '../escape',
      'foo/bar',
      'foo\\bar',
      '..',
      '.',
      'has spaces',
      'special!char',
      'colon:id',
    ];

    for (const badId of invalidIds) {
      assert.equal(goals.isValidGoalId(badId), false, `${badId} must be invalid`);

      // 1. startGoal
      const startRes = goals.startGoal({
        text: 'Valid text',
        rootDir: tempDir,
        goalsDir,
        id: badId,
      });
      assert.equal(startRes.refusal, true, `startGoal should refuse ${badId}`);
      assert.equal(startRes.error, 'INVALID_GOAL_ID');

      // 2. amendGoal
      const amendRes = goals.amendGoal(badId, { text: 'Extra', rootDir: tempDir, goalsDir });
      assert.equal(amendRes.refusal, true, `amendGoal should refuse ${badId}`);
      assert.equal(amendRes.error, 'INVALID_GOAL_ID');

      // 3. planGoal
      const planRes = goals.planGoal(badId, { file: 'p.md', rootDir: tempDir, goalsDir });
      assert.equal(planRes.refusal, true, `planGoal should refuse ${badId}`);
      assert.equal(planRes.error, 'INVALID_GOAL_ID');

      // 4. runGoal
      const runRes = goals.runGoal(badId, { rootDir: tempDir, goalsDir });
      assert.equal(runRes.refusal, true, `runGoal should refuse ${badId}`);
      assert.equal(runRes.error, 'INVALID_GOAL_ID');

      // 5. statusGoal
      const statusRes = goals.statusGoal(badId, { rootDir: tempDir, goalsDir });
      assert.equal(statusRes.refusal, true, `statusGoal should refuse ${badId}`);
      assert.equal(statusRes.error, 'INVALID_GOAL_ID');

      // 6. stopGoal
      const stopRes = goals.stopGoal(badId, { rootDir: tempDir, goalsDir });
      assert.equal(stopRes.refusal, true, `stopGoal should refuse ${badId}`);
      assert.equal(stopRes.error, 'INVALID_GOAL_ID');

      // 7. resumeGoal
      const resumeRes = goals.resumeGoal(badId, { rootDir: tempDir, goalsDir });
      assert.equal(resumeRes.refusal, true, `resumeGoal should refuse ${badId}`);
      assert.equal(resumeRes.error, 'INVALID_GOAL_ID');
    }

    // CLI refusal on bad goalId exits non-zero
    const cliPath = path.resolve(__dirname, '..', 'cli.js');
    const spawnRes = spawnSync(
      process.execPath,
      [cliPath, 'goal', 'status', '../traversal', '--root', tempDir],
      { encoding: 'utf8', env: process.env }
    );
    assert.notEqual(spawnRes.status, 0);
    const parsed = JSON.parse(spawnRes.stdout);
    assert.equal(parsed.refusal, true);
    assert.equal(parsed.error, 'INVALID_GOAL_ID');
  });

  test('fail-closed: goal plan refuses with BLOCKED when criteria, sources, files, or commands are missing, and generateWorkItemDoc refuses defaults', () => {
    goals.startGoal({ text: 'Validation strictness test', rootDir: tempDir, goalsDir, id: 'G11' });

    // Missing criteria
    const noCritFile = path.join(tempDir, 'no-crit.md');
    fs.writeFileSync(
      noCritFile,
      '# P\n## Task 1: Task Without Criteria\nSources: `docs/spec.md`\nFiles: `src/a.ts`\nRun: `npm test`\n'
    );
    const noCritRes = goals.planGoal('G11', {
      file: noCritFile,
      rootDir: tempDir,
      goalsDir,
      registerPath,
    });
    assert.equal(noCritRes.status, 'BLOCKED');
    assert.ok(noCritRes.questions.some((q) => q.includes('acceptance criteria')));

    // Missing sources
    const noSrcFile = path.join(tempDir, 'no-src.md');
    fs.writeFileSync(
      noSrcFile,
      '# P\n## Task 1: Task Without Sources\nFiles: `src/a.ts`\n- Crit 1\nRun: `npm test`\n'
    );
    const noSrcRes = goals.planGoal('G11', {
      file: noSrcFile,
      rootDir: tempDir,
      goalsDir,
      registerPath,
    });
    assert.equal(noSrcRes.status, 'BLOCKED');
    assert.ok(noSrcRes.questions.some((q) => q.includes('source references')));

    // Missing files / allowed paths
    const noFilesFile = path.join(tempDir, 'no-files.md');
    fs.writeFileSync(
      noFilesFile,
      '# P\n## Task 1: Task Without Files\nSources: RULE-AUTH-01\n- Crit 1\nRun: `npm test`\n'
    );
    const noFilesRes = goals.planGoal('G11', {
      file: noFilesFile,
      rootDir: tempDir,
      goalsDir,
      registerPath,
    });
    assert.equal(noFilesRes.status, 'BLOCKED');
    assert.ok(noFilesRes.questions.some((q) => q.includes('allowed paths or files')));

    // Missing verification command
    const noCmdFile = path.join(tempDir, 'no-cmd.md');
    fs.writeFileSync(
      noCmdFile,
      '# P\n## Task 1: Task Without Commands\nSources: `docs/spec.md`\nFiles: `src/a.ts`\n- Crit 1\n'
    );
    const noCmdRes = goals.planGoal('G11', {
      file: noCmdFile,
      rootDir: tempDir,
      goalsDir,
      registerPath,
    });
    assert.equal(noCmdRes.status, 'BLOCKED');
    assert.ok(noCmdRes.questions.some((q) => q.includes('verification command')));

    // Unit test generateWorkItemDoc fails closed without defaults
    assert.throws(
      () =>
        goals.generateWorkItemDoc({
          id: 'X',
          sourceRefs: ['docs/a.md'],
          allowedPaths: ['a.ts'],
          verification: { command: 'test' },
        }),
      /missing acceptance criteria/
    );
    assert.throws(
      () =>
        goals.generateWorkItemDoc({
          id: 'X',
          acceptanceCriteria: ['AC1'],
          allowedPaths: ['a.ts'],
          verification: { command: 'test' },
        }),
      /missing source references/
    );
    assert.throws(
      () =>
        goals.generateWorkItemDoc({
          id: 'X',
          acceptanceCriteria: ['AC1'],
          sourceRefs: ['docs/a.md'],
          verification: { command: 'test' },
        }),
      /missing allowed paths/
    );
    assert.throws(
      () =>
        goals.generateWorkItemDoc({
          id: 'X',
          acceptanceCriteria: ['AC1'],
          sourceRefs: ['docs/a.md'],
          allowedPaths: ['a.ts'],
        }),
      /missing verification command/
    );

    // Valid spec generates doc with proper matrix, no default PASS or tools/ai-brain/*
    const validDoc = goals.generateWorkItemDoc({
      id: 'GOAL-TEST-1',
      title: 'Valid Task Title',
      businessOutcome: 'Real business outcome',
      acceptanceCriteria: ['Condition one met'],
      sourceRefs: ['docs/custom.md'],
      allowedPaths: ['src/custom.ts'],
      verification: { command: 'node --test custom.test.js' },
    });
    assert.ok(validDoc.includes('docs/custom.md'));
    assert.ok(validDoc.includes('src/custom.ts'));
    assert.ok(!validDoc.includes('tools/ai-brain/*'));
    assert.ok(!validDoc.includes('| AC-1 | Condition one met | PASS |'));
    assert.ok(validDoc.includes('node --test custom.test.js'));
  });
});

test('H1-CLI: the cli.js goal dispatcher keeps runGoalCli stdout and exit code (refusal exits non-zero)', () => {
  const { spawnSync } = require('node:child_process');
  const cli = path.resolve(__dirname, '..', 'cli.js');
  const res = spawnSync(process.execPath, [cli, 'goal', 'status', 'no-such-goal-h1cli'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 1);
  const doc = JSON.parse(res.stdout);
  assert.equal(doc.error, 'GOAL_NOT_FOUND');
});
