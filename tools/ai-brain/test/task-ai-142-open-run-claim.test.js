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
    const opts = { rootDir, intakeDir, decisionDir: path.join(rootDir, 'decisions') };
    const deps = {
      isPidAlive: () => false,
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

for (const ownRunner of [true, false])
  test(`${ownRunner ? 'the selecting runner cannot claim itself through a goal lock' : 'another live goal runner still claims its goal intake'}`, () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-goal-owner-'));
    try {
      const intakeDir = path.join(rootDir, 'intake');
      const runDir = path.join(intakeDir, 'GOAL-FIXTURE-1-2026-10-18T00-00-00-000Z');
      const goalsDir = path.join(rootDir, 'goals');
      const goalDir = path.join(goalsDir, 'FIXTURE');
      fs.mkdirSync(runDir, { recursive: true });
      fs.mkdirSync(goalDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'specs.json'), JSON.stringify([{ id: 'GOAL-FIXTURE-1' }]));
      const ownerPid = ownRunner ? process.pid : process.pid + 1;
      fs.writeFileSync(path.join(goalDir, 'run.lock'), JSON.stringify({ pid: ownerPid }));
      fs.writeFileSync(
        path.join(goalDir, 'goal.json'),
        JSON.stringify({ items: ['GOAL-FIXTURE-1'] })
      );
      const runs = getOpenRuns(
        { rootDir, intakeDir, goalsDir },
        { isPidAlive: (pid) => pid === ownerPid }
      );
      assert.equal(runs.length, ownRunner ? 0 : 1);
      if (!ownRunner) assert.equal(runs[0].pid, ownerPid);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
