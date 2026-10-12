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
      { rootDir: tempDir, goalsDir },
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
});
