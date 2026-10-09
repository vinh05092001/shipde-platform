'use strict';

/**
 * Ship Dễ — TASK-AI-132: Controller next runner tests.
 *
 * Covers NX-R01 to NX-R05:
 *   - dependency gating;
 *   - BLOCKED skipped;
 *   - claimed skipped;
 *   - the ceiling respected;
 *   - NO_READY_ITEM;
 *   - ALL_LANES_UNAVAILABLE waits until the reset time;
 *   - the stop file.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  findNextWorkItem,
  checkCeiling,
  checkCandidateLanes,
  runNext,
  nextLoop,
  CONCURRENCY_CEILING,
} = require('../next-runner');
const decisions = require('../decisions');
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

    const result = findNextWorkItem({
      registerPath: csvPath,
      decisionDir: path.join(dir, 'decisions'),
    });

    // TASK-DEP-1 is BACKLOG with no deps, so it is actually ready.
    // Let's test where TASK-DEP-1 is IN_PROGRESS (not MERGED) and TASK-DEP-2 depends on it.
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

  test('NX-R02: the ceiling is respected (at most 2 active writers and 2 active reviewers)', async () => {
    const dir = makeTempDir('ceiling-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    const content = [REGISTER_HEADER, row('1', 'TASK-CEIL-1', 'READY_FOR_AUTHOR', '')].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    // Single source of truth check: CONCURRENCY_CEILING exports maxWriters and maxReviewers
    assert.equal(CONCURRENCY_CEILING.maxWriters, 2);
    assert.equal(CONCURRENCY_CEILING.maxReviewers, 2);

    // 1. Simulate 2 active writers
    decisions.recordDecision(
      { stage: decisions.Stage.LAUNCHED, workItemId: 'OTHER-W1', sessionId: 'sw1' },
      { dir: decDir }
    );
    decisions.recordDecision(
      { stage: decisions.Stage.LAUNCHED, workItemId: 'OTHER-W2', sessionId: 'sw2' },
      { dir: decDir }
    );

    let intakeCalled = false;
    const fakeIntake = async () => {
      intakeCalled = true;
      return { ran: true };
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

    // 2. Release writers, simulate 2 active reviewers
    decisions.recordDecision(
      { stage: decisions.Stage.COMPLETED, workItemId: 'OTHER-W1' },
      { dir: decDir }
    );
    decisions.recordDecision(
      { stage: decisions.Stage.COMPLETED, workItemId: 'OTHER-W2' },
      { dir: decDir }
    );

    decisions.recordDecision(
      { stage: decisions.Stage.REVIEW, workItemId: 'REV-1', sessionId: 'sr1', role: 'reviewer' },
      { dir: decDir }
    );
    decisions.recordDecision(
      { stage: decisions.Stage.REVIEW, workItemId: 'REV-2', sessionId: 'sr2', role: 'reviewer' },
      { dir: decDir }
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

  test('NX-R03 & NX-R05: ALL_LANES_UNAVAILABLE waits until the reset time with no busy loop', async () => {
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

    const res = await nextLoop(
      {
        registerPath: csvPath,
        decisionDir: decDir,
        now,
        maxIterations: 1,
        stopOnUnavailable: true,
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
        (r) => r.detail === 'ALL_LANES_UNAVAILABLE' && r.earliestResetTime === resetTime
      ),
      'decision log must record ALL_LANES_UNAVAILABLE with earliestResetTime'
    );
  });

  test('NX-R03 & NX-R05: the stop file stops cleanly', async () => {
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
    assert.ok(
      records.some((r) => r.detail === 'STOP_FILE_EXISTS'),
      'decision log must record STOP_FILE_EXISTS'
    );
  });

  test('NX-R01 CLI dispatch returns first ready item with --run fake intake', async () => {
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
  });
});
