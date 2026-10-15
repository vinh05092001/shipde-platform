'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stopGoal } = require('../goals');
const { skillFilePath } = require('../hermes-session');
const decisions = require('../decisions');

function fixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-abandon-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const dir = path.join(rootDir, 'data', 'goals', 'goal');
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  write('goal.json', { goalId: 'goal', status: 'RUNNING', items: ['item'] });
  const now = Date.now();
  const options = { rootDir, decisionDir: path.join(rootDir, 'decisions') };
  const deps = {
    fs: Object.create(fs),
    now: () => now,
    env: {},
    isPidAlive: () => false,
    killPid: () => assert.fail('must not kill'),
  };
  return { dir, write, now, options, deps };
}

test('live lock refuses without stop, mutation or kill and records decision', (t) => {
  const f = fixture(t);
  f.write('run.lock', { pid: process.pid });
  f.deps.isPidAlive = () => true;
  assert.equal(stopGoal('goal', f.options, f.deps).error, 'GOAL_RUN_ACTIVE');
  assert.equal(fs.existsSync(path.join(f.dir, '.stop')), false);
  assert.equal(fs.existsSync(path.join(f.dir, 'run.lock')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, 'goal.json'))).status, 'RUNNING');
  const records = decisions.readDecisionsDetailed({
    dir: f.options.decisionDir,
    now: f.now,
  }).records;
  assert.equal(records.length, 1);
  assert.equal(records[0].goalId, 'goal');
  assert.equal(records[0].reasonCode, 'GOAL_RUN_ACTIVE');
});

for (const age of [89, 91]) {
  test(`checkpoint activity ${age} min ago`, (t) => {
    const f = fixture(t);
    f.write('checkpoint.json', {
      liveSteps: { item: { updatedAt: new Date(f.now - age * 60 * 1000).toISOString() } },
    });
    const result = stopGoal('goal', f.options, f.deps);
    assert.equal(
      age === 89 ? result.error : result.status,
      age === 89 ? 'GOAL_RUN_ACTIVE' : 'STOPPED'
    );
    assert.equal(fs.existsSync(path.join(f.dir, '.stop')), age === 91);
  });
}

test('operator bypass stops live run', (t) => {
  const f = fixture(t);
  f.write('run.lock', { pid: process.pid });
  f.deps.isPidAlive = () => true;
  let killed;
  f.deps.killPid = (pid) => {
    killed = pid;
  };
  assert.equal(stopGoal('goal', { ...f.options, operator: true }, f.deps).status, 'STOPPED');
  assert.equal(killed, process.pid);
  assert.equal(fs.existsSync(path.join(f.dir, '.stop')), true);
});

test('configured stale window applies to item intake checkpoint', (t) => {
  const f = fixture(t);
  const intake = path.join(f.options.rootDir, 'tools', 'ai-brain', 'data', 'intake', 'run');
  fs.mkdirSync(intake, { recursive: true });
  fs.writeFileSync(
    path.join(intake, 'checkpoint.json'),
    JSON.stringify({
      liveSteps: { item: { updatedAt: new Date(f.now - 91 * 60 * 1000).toISOString() } },
    })
  );
  f.deps.env.SHIPDE_GOAL_STALE_MIN = '120';
  assert.equal(stopGoal('goal', f.options, f.deps).error, 'GOAL_RUN_ACTIVE');
});

test('Hermes skill contains inactivity rule without operator override', () => {
  const skill = fs.readFileSync(skillFilePath(path.resolve(__dirname, '../../..')), 'utf8');
  assert.ok(
    skill.includes(
      'Never stop, kill or restart a goal run that is in progress; if no log for 90 min, report it and wait.'
    )
  );
  assert.equal(skill.includes('--operator'), false);
});
