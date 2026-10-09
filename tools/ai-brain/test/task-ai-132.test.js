'use strict';

/**
 * Ship Dễ — TASK-AI-132: Controller next runner tests.
 *
 * Covers NX-R01 to NX-R05:
 *   - dependency gating;
 *   - BLOCKED skipped;
 *   - claimed skipped (including per-run intake decision dirs);
 *   - the ceiling respected (read from existing ceiling data, governed clamp);
 *   - NO_READY_ITEM;
 *   - ALL_LANES_UNAVAILABLE waits until reset time and stops cleanly in plain --loop;
 *   - the stop file uses decisions.Stage;
 *   - real checkCandidateLanes & getEarliestResetTime;
 *   - CLI arg mapping via nextCommand & parseArgs;
 *   - next --run without --loop awaits child & records terminal decision;
 *   - terminal loop states (refused, blocked, failed) handled without busy looping;
 *   - polling interval taken from config.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  findNextWorkItem,
  checkCeiling,
  checkCandidateLanes,
  getEarliestResetTime,
  runNext,
  nextLoop,
  nextCommand,
  CONCURRENCY_CEILING,
  getPollingInterval,
  getAllDecisionDirs,
  collectAllDecisionRecords,
  getOpenRuns,
  isOpenRun,
} = require('../next-runner');
const decisions = require('../decisions');
const { DEFAULTS } = require('../scheduler');
const { parseArgs } = require('../cli');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const UPSTREAM_DIR = path.join(REPO_ROOT, '.upstream-tmp');

function makeTempDir(prefix) {
  fs.mkdirSync(UPSTREAM_DIR, { recursive: true });
  return fs.mkdtempSync(path.join(UPSTREAM_DIR, prefix || 'task-132-'));
}

const REGISTER_HEADER =
  '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"';

function row(order, id, status, deps) {
  return [
    `"${order}"`,
    '"S00"',
    '"AI workflow"',
    `"${id}"`,
    '""',
    `"Feature ${id}"`,
    '"behavior"',
    `"${status}"`,
    `"${deps || ''}"`,
    `"docs/product-spec/work-items/${id}.md"`,
    `"feat/${id.toLowerCase()}"`,
    '""',
    '""',
    '""',
  ].join(',');
}

describe('TASK-AI-132: Controller next runner', () => {
  test('NX-R01: dependency gating skips items with unmerged dependencies', () => {
    const dir = makeTempDir('dep-gate-');
    const csvPath = path.join(dir, 'register.csv');
    const content = [
      REGISTER_HEADER,
      row('1', 'TASK-DEP-1', 'BACKLOG', ''),
      row('2', 'TASK-DEP-2', 'READY_FOR_AUTHOR', 'TASK-DEP-1'),
      row('3', 'TASK-DEP-3', 'READY_FOR_AUTHOR', ''),
    ].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    // TASK-DEP-1 is BACKLOG with no deps, so it is ready and selected first.
    const result = findNextWorkItem({
      registerPath: csvPath,
      decisionDir: path.join(dir, 'decisions'),
    });
    assert.ok(result.item, 'must select TASK-DEP-1 when it has no unmerged deps');
    assert.equal(result.item.work_item_id, 'TASK-DEP-1');

    // When TASK-DEP-1 is IN_PROGRESS (not MERGED) and TASK-DEP-2 depends on it:
    const content2 = [
      REGISTER_HEADER,
      row('1', 'TASK-DEP-1', 'IN_PROGRESS', ''),
      row('2', 'TASK-DEP-2', 'READY_FOR_AUTHOR', 'TASK-DEP-1'),
      row('3', 'TASK-DEP-3', 'READY_FOR_AUTHOR', ''),
    ].join('\n');
    fs.writeFileSync(csvPath, content2, 'utf8');

    const result2 = findNextWorkItem({
      registerPath: csvPath,
      decisionDir: path.join(dir, 'decisions'),
    });

    assert.ok(result2.item, 'must select a ready item');
    assert.equal(result2.item.work_item_id, 'TASK-DEP-3');
    assert.ok(
      result2.skipped.some(
        (s) => s.id === 'TASK-DEP-2' && s.reason.includes('dependency not merged')
      ),
      'TASK-DEP-2 must be skipped because TASK-DEP-1 is not MERGED'
    );
  });

  test('NX-R01 & NX-R04: BLOCKED items are never picked and skipped with reason', () => {
    const dir = makeTempDir('blocked-');
    const csvPath = path.join(dir, 'register.csv');
    const content = [
      REGISTER_HEADER,
      row('1', 'TASK-BLK-1', 'BLOCKED: human decision needed', ''),
      row('2', 'TASK-BLK-2', 'BLOCKED_DEPENDENCY', ''),
      row('3', 'TASK-BLK-3', 'READY_FOR_AUTHOR', ''),
    ].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    const result = findNextWorkItem({
      registerPath: csvPath,
      decisionDir: path.join(dir, 'decisions'),
    });

    assert.ok(result.item);
    assert.equal(result.item.work_item_id, 'TASK-BLK-3');
    const blk1 = result.skipped.find((s) => s.id === 'TASK-BLK-1');
    assert.ok(blk1, 'TASK-BLK-1 must be recorded in skipped');
    assert.match(blk1.reason, /BLOCKED with reason/);
    const blk2 = result.skipped.find((s) => s.id === 'TASK-BLK-2');
    assert.ok(blk2, 'TASK-BLK-2 must be recorded in skipped');
    assert.match(blk2.reason, /BLOCKED with reason/);
  });

  test('NX-R01: claimed items are skipped', () => {
    const dir = makeTempDir('claimed-');
    const csvPath = path.join(dir, 'register.csv');
    const decDir = path.join(dir, 'decisions');
    const content = [
      REGISTER_HEADER,
      row('1', 'TASK-CLM-1', 'READY_FOR_AUTHOR', ''),
      row('2', 'TASK-CLM-2', 'READY_FOR_AUTHOR', ''),
    ].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    // Claim TASK-CLM-1 in decision log
    decisions.recordDecision(
      {
        stage: decisions.Stage.LAUNCHED,
        workItemId: 'TASK-CLM-1',
        sessionId: 'test-sess-99',
        branch: 'feat/task-clm-1',
      },
      { dir: decDir }
    );

    const result = findNextWorkItem({
      registerPath: csvPath,
      decisionDir: decDir,
    });

    assert.ok(result.item);
    assert.equal(result.item.work_item_id, 'TASK-CLM-2');
    const clm1 = result.skipped.find((s) => s.id === 'TASK-CLM-1');
    assert.ok(clm1, 'TASK-CLM-1 must be skipped');
    assert.match(clm1.reason, /claimed by session test-sess-99/);
  });

  test('NX-R01: claims and ceiling read from per-run intake decisions directories', () => {
    const dir = makeTempDir('shared-intake-');
    const csvPath = path.join(dir, 'register.csv');
    const primaryDecDir = path.join(dir, 'primary-decisions');
    const intakeBase = path.join(dir, 'tools', 'ai-brain', 'data', 'intake');
    const runDecDir = path.join(intakeBase, 'TASK-SHR-1-2026-10-09', 'decisions');
    fs.mkdirSync(runDecDir, { recursive: true });

    const content = [
      REGISTER_HEADER,
      row('1', 'TASK-SHR-1', 'READY_FOR_AUTHOR', ''),
      row('2', 'TASK-SHR-2', 'READY_FOR_AUTHOR', ''),
    ].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    // Write claim in per-run intake decisions directory (where orchestrate puts it)
    decisions.recordDecision(
      {
        stage: decisions.Stage.LAUNCHED,
        workItemId: 'TASK-SHR-1',
        sessionId: 'intake-run-sess-01',
      },
      { dir: runDecDir }
    );

    const result = findNextWorkItem({
      rootDir: dir,
      registerPath: csvPath,
      decisionDir: primaryDecDir,
      intakeDir: intakeBase,
    });

    assert.ok(result.item, 'must pick unheld item');
    assert.equal(result.item.work_item_id, 'TASK-SHR-2');
    const shr1 = result.skipped.find((s) => s.id === 'TASK-SHR-1');
    assert.ok(shr1, 'TASK-SHR-1 must be skipped as claimed');
    assert.match(shr1.reason, /claimed by session intake-run-sess-01/);

    // Ceiling also sees the active writer from the intake run directory
    const ceil = checkCeiling({
      rootDir: dir,
      decisionDir: primaryDecDir,
      intakeDir: intakeBase,
    });
    assert.equal(ceil.allowed, false, 'must reach default writer ceiling of 1');
    assert.equal(ceil.reason, 'WRITER_CEILING_REACHED');
  });

  test('NX-R01: isOpenRun detects active on-disk intake runs and gates items and ceiling', () => {
    const dir = makeTempDir('open-run-disk-');
    const csvPath = path.join(dir, 'register.csv');
    const primaryDecDir = path.join(dir, 'primary-decisions');
    const intakeBase = path.join(dir, 'tools', 'ai-brain', 'data', 'intake');
    const runDir = path.join(intakeBase, 'TASK-OPEN-1-2026-10-09T12-00-00-000Z');
    fs.mkdirSync(runDir, { recursive: true });

    // Place specs.json to identify the open run
    fs.writeFileSync(
      path.join(runDir, 'specs.json'),
      JSON.stringify([{ id: 'TASK-OPEN-1' }], null, 2),
      'utf8'
    );

    const content = [
      REGISTER_HEADER,
      row('1', 'TASK-OPEN-1', 'READY_FOR_AUTHOR', ''),
      row('2', 'TASK-OPEN-2', 'READY_FOR_AUTHOR', ''),
    ].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    // 1. Direct isOpenRun check
    assert.equal(
      isOpenRun('TASK-OPEN-1', { rootDir: dir, intakeDir: intakeBase }),
      true,
      'must detect open run on disk'
    );
    assert.equal(
      isOpenRun('TASK-OPEN-2', { rootDir: dir, intakeDir: intakeBase }),
      false,
      'must not flag unstarted item'
    );

    // 2. findNextWorkItem skips TASK-OPEN-1 with reason claimed by open run
    const result = findNextWorkItem({
      rootDir: dir,
      registerPath: csvPath,
      decisionDir: primaryDecDir,
      intakeDir: intakeBase,
    });
    assert.ok(result.item);
    assert.equal(result.item.work_item_id, 'TASK-OPEN-2');
    const skippedOpen = result.skipped.find((s) => s.id === 'TASK-OPEN-1');
    assert.ok(skippedOpen);
    assert.equal(skippedOpen.reason, 'claimed by open run');

    // 3. checkCeiling counts active open run against writer ceiling
    const ceil = checkCeiling({
      rootDir: dir,
      decisionDir: primaryDecDir,
      intakeDir: intakeBase,
    });
    assert.equal(ceil.allowed, false, 'active open run must count against writer ceiling');
    assert.equal(ceil.reason, 'WRITER_CEILING_REACHED');

    // 4. Once run reaches terminal state, it is no longer an open run
    fs.writeFileSync(
      path.join(runDir, 'checkpoint.json'),
      JSON.stringify({ status: 'completed' }, null, 2),
      'utf8'
    );
    assert.equal(
      isOpenRun('TASK-OPEN-1', { rootDir: dir, intakeDir: intakeBase }),
      false,
      'completed run must no longer be open'
    );
  });

  test('NX-R02: the ceiling is read from existing ceiling data with governed decision clamp', async () => {
    const dir = makeTempDir('ceiling-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    const content = [REGISTER_HEADER, row('1', 'TASK-CEIL-1', 'READY_FOR_AUTHOR', '')].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    // CONCURRENCY_CEILING reads DEFAULTS, never hard-coded 2
    assert.equal(CONCURRENCY_CEILING.maxWriters, DEFAULTS.maxImplementationAgents);
    assert.equal(CONCURRENCY_CEILING.maxReviewers, DEFAULTS.maxReviewAgents);
    assert.equal(DEFAULTS.maxImplementationAgents, 1);
    assert.equal(DEFAULTS.maxReviewAgents, 2);

    // 1. Simulate 1 active writer (default ceiling is 1)
    decisions.recordDecision(
      { stage: decisions.Stage.LAUNCHED, workItemId: 'OTHER-W1', sessionId: 'sw1' },
      { dir: decDir }
    );

    let intakeCalled = false;
    const fakeIntake = async () => {
      intakeCalled = true;
      return { ran: true, status: 'launched' };
    };

    const resWriterCeil = await runNext(
      {
        registerPath: csvPath,
        decisionDir: decDir,
        run: true,
      },
      {
        runIntake: fakeIntake,
      }
    );

    assert.equal(intakeCalled, false, 'must not launch intake when writer ceiling is reached');
    assert.equal(resWriterCeil.run, false);
    assert.equal(resWriterCeil.reason, 'WRITER_CEILING_REACHED');

    // 2. Unvetted ceiling setting > 1 without valid governed decision is clamped to 1
    const unvettedCeil = checkCeiling({
      decisionDir: decDir,
      ceiling: { maxWriters: 2 },
    });
    assert.equal(unvettedCeil.allowed, false, 'unvetted setting > 1 must be clamped to 1');
    assert.equal(unvettedCeil.reason, 'WRITER_CEILING_REACHED');

    // 3. Valid governed decision raises writer ceiling to 2
    const governedCeil = checkCeiling({
      decisionDir: decDir,
      governedDecision: 'DEC-017',
      ceiling: { maxWriters: 2 },
    });
    assert.equal(governedCeil.allowed, true, 'valid governed decision allows 2 writers');
    assert.equal(governedCeil.maxWriters, 2);

    // 4. Release writer, simulate 2 active reviewers (including concurrent sessions)
    decisions.recordDecision(
      { stage: decisions.Stage.COMPLETED, workItemId: 'OTHER-W1' },
      { dir: decDir }
    );

    decisions.recordDecision(
      {
        stage: decisions.Stage.REVIEW,
        workItemId: 'REV-1',
        sessionId: 'sr1',
        role: 'reviewer.primary',
      },
      { dir: decDir }
    );
    decisions.recordDecision(
      {
        stage: decisions.Stage.REVIEW,
        workItemId: 'REV-1',
        sessionId: 'sr2',
        role: 'reviewer.fallback',
      },
      { dir: decDir }
    );

    // openReviewersDetailed keys by composite session key, preserving both concurrent reviewers
    const revDetailed = decisions.openReviewersDetailed({ dir: decDir });
    assert.equal(
      revDetailed.reviewers.length,
      2,
      'concurrent reviewers on same item must not collapse'
    );

    const resReviewerCeil = await runNext(
      {
        registerPath: csvPath,
        decisionDir: decDir,
        run: true,
      },
      {
        runIntake: fakeIntake,
      }
    );

    assert.equal(intakeCalled, false, 'must not launch intake when reviewer ceiling is reached');
    assert.equal(resReviewerCeil.run, false);
    assert.equal(resReviewerCeil.reason, 'REVIEWER_CEILING_REACHED');
  });

  test('NX-R03: NO_READY_ITEM stops cleanly and records decision', async () => {
    const dir = makeTempDir('no-ready-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    // All items are MERGED or BLOCKED
    const content = [
      REGISTER_HEADER,
      row('1', 'TASK-DONE-1', 'MERGED', ''),
      row('2', 'TASK-BLK-1', 'BLOCKED: waiting', ''),
    ].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    const res = await runNext({
      registerPath: csvPath,
      decisionDir: decDir,
      run: true,
    });

    assert.equal(res.item, null);
    assert.equal(res.reason, 'NO_READY_ITEM');

    const records = decisions.readDecisions({ dir: decDir });
    assert.ok(
      records.some((r) => r.detail === 'NO_READY_ITEM'),
      'decision log must record NO_READY_ITEM'
    );
  });

  test('NX-R03 & NX-R05: ALL_LANES_UNAVAILABLE waits until reset time and stops cleanly in plain --loop', async () => {
    const dir = makeTempDir('lanes-unavail-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    const content = [REGISTER_HEADER, row('1', 'TASK-READY-1', 'READY_FOR_AUTHOR', '')].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    const now = 1700000000000;
    const resetTime = now + 45000;

    let sleepCalledWith = null;
    const fakeSleep = async (ms) => {
      sleepCalledWith = ms;
    };

    // Plain --loop (no stopOnUnavailable, no maxIterations: 1) must stop cleanly
    const res = await nextLoop(
      {
        registerPath: csvPath,
        decisionDir: decDir,
        now,
      },
      {
        now: () => now,
        sleep: fakeSleep,
        checkCandidateLanes: () => ({
          available: false,
          reason: 'ALL_LANES_UNAVAILABLE',
          earliestResetTime: resetTime,
        }),
      }
    );

    assert.equal(res.stopped, true);
    assert.equal(res.reason, 'ALL_LANES_UNAVAILABLE');
    assert.equal(res.earliestResetTime, resetTime);
    assert.equal(sleepCalledWith, 45000, 'must wait until earliest reset time');

    const records = decisions.readDecisions({ dir: decDir, now });
    assert.ok(
      records.some(
        (r) =>
          r.stage === decisions.Stage.COOLED &&
          r.detail === 'ALL_LANES_UNAVAILABLE' &&
          r.earliestResetTime === resetTime
      ),
      'decision log must record ALL_LANES_UNAVAILABLE with COOLED stage'
    );
  });

  test('NX-R03 & NX-R05: the stop file stops cleanly and uses decisions.Stage', async () => {
    const dir = makeTempDir('stop-file-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    const stopFile = path.join(dir, '.stop');
    const content = [REGISTER_HEADER, row('1', 'TASK-STOP-1', 'READY_FOR_AUTHOR', '')].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');
    fs.writeFileSync(stopFile, 'stop now', 'utf8');

    const res = await runNext({
      rootDir: dir,
      registerPath: csvPath,
      decisionDir: decDir,
      stopFile: '.stop',
      run: true,
    });

    assert.equal(res.stopped, true);
    assert.equal(res.reason, 'STOP_FILE_EXISTS');

    const records = decisions.readDecisions({ dir: decDir });
    const stopRec = records.find((r) => r.detail === 'STOP_FILE_EXISTS');
    assert.ok(stopRec, 'decision log must record STOP_FILE_EXISTS');
    assert.equal(
      stopRec.stage,
      decisions.Stage.REFUSED,
      'stop file stage must be in decisions.Stage enum'
    );
  });

  test('NX-R01 & NX-R02 CLI dispatch returns first ready item with --run fake intake', async () => {
    const dir = makeTempDir('cli-next-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    const content = [REGISTER_HEADER, row('1', 'TASK-OK-1', 'READY_FOR_AUTHOR', '')].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    let fakeRan = false;
    const fakeIntake = async (opts) => {
      fakeRan = true;
      return { id: opts.workItem, ran: true, status: 'published' };
    };

    const res = await runNext(
      {
        registerPath: csvPath,
        decisionDir: decDir,
        run: true,
      },
      {
        runIntake: fakeIntake,
      }
    );

    assert.equal(fakeRan, true);
    assert.equal(res.ran, true);
    assert.equal(res.item.work_item_id, 'TASK-OK-1');
    assert.equal(res.status, 'published');
  });

  test('NX-R02 & NX-R03: next --run without --loop awaits child and records terminal decision', async () => {
    const dir = makeTempDir('await-child-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    const content = [REGISTER_HEADER, row('1', 'TASK-CHILD-1', 'READY_FOR_AUTHOR', '')].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    const mockChild = new EventEmitter();
    let childAwaited = false;

    const fakeIntake = async (opts) => {
      setTimeout(() => {
        childAwaited = true;
        mockChild.emit('close', 0);
      }, 20);
      return { id: opts.workItem, ran: true, status: 'launched', child: mockChild };
    };

    const res = await runNext(
      {
        registerPath: csvPath,
        decisionDir: decDir,
        run: true,
      },
      {
        runIntake: fakeIntake,
      }
    );

    assert.equal(childAwaited, true, 'must await child process close');
    assert.equal(res.status, 'completed');
    assert.equal(res.exitCode, 0);

    const records = decisions.readDecisions({ dir: decDir });
    assert.ok(
      records.some((r) => r.stage === decisions.Stage.COMPLETED && r.workItemId === 'TASK-CHILD-1'),
      'terminal COMPLETED decision must be recorded'
    );
  });

  test('NX-R03: --loop honors refused and failed terminal states without busy looping', async () => {
    const dir = makeTempDir('loop-terminal-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    const content = [
      REGISTER_HEADER,
      row('1', 'TASK-FAIL-1', 'READY_FOR_AUTHOR', ''),
      row('2', 'TASK-OK-2', 'READY_FOR_AUTHOR', ''),
    ].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    let runsCount = 0;
    const attemptedItems = [];

    const fakeIntake = async (opts) => {
      runsCount += 1;
      attemptedItems.push(opts.workItem);
      if (opts.workItem === 'TASK-FAIL-1') {
        const err = new Error('INTAKE_INCOMPLETE: work item invalid');
        err.code = 'INTAKE_INCOMPLETE';
        throw err;
      }
      return { id: opts.workItem, ran: true, status: 'completed' };
    };

    const res = await nextLoop(
      {
        registerPath: csvPath,
        decisionDir: decDir,
        maxIterations: 5,
      },
      {
        runIntake: fakeIntake,
        sleep: async () => {},
      }
    );

    // Iteration 1 attempts TASK-FAIL-1, catches refusal, marks terminal;
    // Iteration 2 does NOT re-pick TASK-FAIL-1; it picks TASK-OK-2 and succeeds;
    // Iteration 3 sees both done/terminal and stops cleanly on NO_READY_ITEM.
    assert.equal(runsCount, 2, 'must not busy loop on failed item');
    assert.deepEqual(attemptedItems, ['TASK-FAIL-1', 'TASK-OK-2']);
    assert.equal(res.stopped, true);
    assert.equal(res.reason, 'NO_READY_ITEM');

    const records = decisions.readDecisions({ dir: decDir });
    assert.ok(
      records.some((r) => r.stage === decisions.Stage.REFUSED && r.workItemId === 'TASK-FAIL-1'),
      'refusal must be recorded as Stage.REFUSED'
    );
    assert.ok(
      records.some((r) => r.stage === decisions.Stage.COMPLETED && r.workItemId === 'TASK-OK-2'),
      'success must be recorded as Stage.COMPLETED'
    );
  });

  test('NX-R05: real checkCandidateLanes and getEarliestResetTime with real evidence cooldowns', () => {
    const now = 1700000000000;
    const resetTime = now + 90000;
    const candidateA = 'claude-cli::direct::claude::anthropic::acc-1::sub::claude-3-7-sonnet';
    const candidateB = 'agy::pool::agy::google::acc-2::pool::gemini-2.5-pro';

    const evidenceData = {
      cooldowns: {
        [candidateA]: {
          status: 'blocked',
          lastStatus: 'blocked',
          blockedAt: new Date(now).toISOString(),
          cooldownMs: 90000,
          resetTime,
          blockReason: 'rate limit',
        },
        [candidateB]: {
          status: 'blocked',
          lastStatus: 'blocked',
          blockedAt: new Date(now).toISOString(),
          cooldownMs: 90000,
          resetTime,
          blockReason: 'rate limit',
        },
      },
    };

    // 1. Direct getEarliestResetTime test
    const computedReset = getEarliestResetTime(evidenceData, now);
    assert.equal(computedReset, resetTime);

    // 2. Direct real checkCandidateLanes test (no fake injected)
    const laneStatus = checkCandidateLanes({
      candidates: [candidateA, candidateB],
      evidenceData,
      now,
    });

    assert.equal(laneStatus.available, false);
    assert.equal(laneStatus.reason, 'ALL_LANES_UNAVAILABLE');
    assert.equal(laneStatus.earliestResetTime, resetTime);

    // When one candidate is unblocked
    const unblockedLane = checkCandidateLanes({
      candidates: ['free-worker::direct::free::free::acc-3::free::free-model'],
      evidenceData,
      now,
    });
    assert.equal(unblockedLane.available, true);
  });

  test('NX-R05: nextCommand CLI arg mapping via parseArgs', async () => {
    const dir = makeTempDir('cli-args-');
    const csvPath = path.join(dir, 'register.csv');
    const content = [REGISTER_HEADER, row('1', 'TASK-ARG-1', 'READY_FOR_AUTHOR', '')].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    const rawArgv = [
      'node',
      'cli.js',
      'next',
      '--root',
      dir,
      '--csv',
      csvPath,
      '--stop-file',
      path.join(dir, '.stop'),
      '--decision-dir',
      path.join(dir, 'decisions'),
      '--json',
    ];

    const parsed = parseArgs(rawArgv);
    assert.equal(parsed.root, dir);
    assert.equal(parsed.csv, csvPath);
    assert.equal(parsed['stop-file'], path.join(dir, '.stop'));
    assert.equal(parsed['decision-dir'], path.join(dir, 'decisions'));
    assert.equal(parsed.json, true);

    const res = await nextCommand(parsed);
    assert.ok(res.item, 'nextCommand must return ready item');
    assert.equal(res.item.work_item_id, 'TASK-ARG-1');
  });

  test('NX-R03: polling interval is taken from config', async () => {
    // 1. Direct getPollingInterval test
    const intervalFromConfig = getPollingInterval({}, { config: { pollIntervalMs: 12345 } });
    assert.equal(intervalFromConfig, 12345);

    const defaultInterval = getPollingInterval({}, {});
    assert.equal(defaultInterval, 5000);

    // 2. Loop test verifying configured sleep duration
    const dir = makeTempDir('config-poll-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    const content = [
      REGISTER_HEADER,
      row('1', 'TASK-CFG-1', 'READY_FOR_AUTHOR', ''),
      row('2', 'TASK-CFG-2', 'READY_FOR_AUTHOR', ''),
    ].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    let sleptDuration = null;
    const fakeSleep = async (ms) => {
      sleptDuration = ms;
    };

    await nextLoop(
      {
        registerPath: csvPath,
        decisionDir: decDir,
        maxIterations: 2,
      },
      {
        config: { pollIntervalMs: 8888 },
        sleep: fakeSleep,
        runIntake: async (opts) => ({ id: opts.workItem, ran: true, status: 'completed' }),
      }
    );

    assert.equal(sleptDuration, 8888, 'loop must sleep with configured polling interval');
  });
});
