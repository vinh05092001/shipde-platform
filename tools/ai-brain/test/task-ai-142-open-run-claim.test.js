const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getOpenRuns, findNextWorkItem, checkCeiling } = require('../next-runner');

test('abandoned intake without pid does not claim a ready item or consume ceiling', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unowned-intake-'));
  try {
    const intakeDir = path.join(rootDir, 'intake');
    const runDir = path.join(intakeDir, 'TASK-FIXTURE-1-2026-10-18T00-00-00-000Z');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'specs.json'), JSON.stringify([{ id: 'TASK-FIXTURE-1' }]));
    const stat = fs.statSync(runDir);
    const opts = { rootDir, intakeDir, decisionDir: path.join(rootDir, 'decisions') };
    const deps = {
      isPidAlive: () => false,
      now: () => stat.mtimeMs + 200000,
      items: [{ work_item_id: 'TASK-FIXTURE-1', status: 'READY_FOR_AUTHOR' }],
      writerFor: () => null,
    };
    assert.deepEqual(getOpenRuns(opts, deps), []);
    assert.equal(findNextWorkItem(opts, deps).item.work_item_id, 'TASK-FIXTURE-1');
    assert.equal(checkCeiling(opts, deps).allowed, true);
    assert.ok(fs.existsSync(runDir), 'recovery artifacts are preserved');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('fresh intake without pid inside startup grace window claims item and consumes ceiling', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-intake-'));
  try {
    const intakeDir = path.join(rootDir, 'intake');
    const runDir = path.join(intakeDir, 'TASK-STARTUP-1-2026-10-19T10-00-00-000Z');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'specs.json'), JSON.stringify([{ id: 'TASK-STARTUP-1' }]));
    const stat = fs.statSync(runDir);
    const opts = { rootDir, intakeDir, decisionDir: path.join(rootDir, 'decisions') };
    const deps = {
      isPidAlive: () => false,
      now: () => stat.mtimeMs + 1000,
      items: [{ work_item_id: 'TASK-STARTUP-1', status: 'READY_FOR_AUTHOR' }],
      writerFor: () => null,
    };
    const openRuns = getOpenRuns(opts, deps);
    assert.equal(openRuns.length, 1, 'fresh intake within startup grace window must be open');
    assert.equal(openRuns[0].workItemId, 'TASK-STARTUP-1');
    const next = findNextWorkItem(opts, deps);
    assert.equal(next.item, null, 'ready item must be skipped when fresh intake claims it');
    assert.equal(next.skipped[0].reason, 'claimed by open run');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('the selecting runner cannot claim itself through a goal lock for an older abandoned intake', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-goal-abandoned-'));
  try {
    const intakeDir = path.join(rootDir, 'intake');
    const runDir = path.join(intakeDir, 'GOAL-FIXTURE-1-2026-10-18T00-00-00-000Z');
    const goalsDir = path.join(rootDir, 'goals');
    const goalDir = path.join(goalsDir, 'FIXTURE');
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(goalDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'specs.json'), JSON.stringify([{ id: 'GOAL-FIXTURE-1' }]));
    fs.writeFileSync(
      path.join(goalDir, 'run.lock'),
      JSON.stringify({ pid: process.pid, startedAt: '2026-10-19T00:00:00.000Z' })
    );
    fs.writeFileSync(
      path.join(goalDir, 'goal.json'),
      JSON.stringify({ items: ['GOAL-FIXTURE-1'] })
    );
    const runs = getOpenRuns(
      { rootDir, intakeDir, goalsDir },
      { isPidAlive: (pid) => pid === process.pid }
    );
    assert.equal(runs.length, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('the selecting runner counts its own active in-flight intake created after the goal lock', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-goal-inflight-'));
  try {
    const intakeDir = path.join(rootDir, 'intake');
    const runDir = path.join(intakeDir, 'GOAL-FIXTURE-2-2026-10-19T01-00-00-000Z');
    const goalsDir = path.join(rootDir, 'goals');
    const goalDir = path.join(goalsDir, 'FIXTURE');
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(goalDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'specs.json'), JSON.stringify([{ id: 'GOAL-FIXTURE-2' }]));
    fs.writeFileSync(
      path.join(goalDir, 'run.lock'),
      JSON.stringify({ pid: process.pid, startedAt: '2026-10-19T00:00:00.000Z' })
    );
    fs.writeFileSync(
      path.join(goalDir, 'goal.json'),
      JSON.stringify({ items: ['GOAL-FIXTURE-2'] })
    );
    const runs = getOpenRuns(
      { rootDir, intakeDir, goalsDir },
      { isPidAlive: (pid) => pid === process.pid }
    );
    assert.equal(
      runs.length,
      1,
      'in-flight intake created after lock start must be counted by runner'
    );
    assert.equal(runs[0].pid, process.pid);
    assert.equal(runs[0].workItemId, 'GOAL-FIXTURE-2');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('another live goal runner still claims its goal intake', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-goal-other-'));
  try {
    const intakeDir = path.join(rootDir, 'intake');
    const runDir = path.join(intakeDir, 'GOAL-FIXTURE-1-2026-10-18T00-00-00-000Z');
    const goalsDir = path.join(rootDir, 'goals');
    const goalDir = path.join(goalsDir, 'FIXTURE');
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(goalDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'specs.json'), JSON.stringify([{ id: 'GOAL-FIXTURE-1' }]));
    const otherPid = process.pid + 1;
    fs.writeFileSync(path.join(goalDir, 'run.lock'), JSON.stringify({ pid: otherPid }));
    fs.writeFileSync(
      path.join(goalDir, 'goal.json'),
      JSON.stringify({ items: ['GOAL-FIXTURE-1'] })
    );
    const runs = getOpenRuns(
      { rootDir, intakeDir, goalsDir },
      { isPidAlive: (pid) => pid === otherPid }
    );
    assert.equal(runs.length, 1);
    assert.equal(runs[0].pid, otherPid);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
