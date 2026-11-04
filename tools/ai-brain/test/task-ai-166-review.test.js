'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('node:events');
const policy = require('../coordinator');
const runtimeApi = require('../coordinator-runtime');

const NOW = Date.parse('2026-11-03T12:00:00Z');
const SHA = 'a'.repeat(40);
const item = { id: 'TASK-AI-166', pr: 123, cwd: 'fixture', task: 'task.md' };
const writer = { model: 'p/writer', family: 'writer', harness: 'opencode', score: 90 };

function temporary(t) {
  const parent = path.resolve(__dirname, '../../../.oc/tmp');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'ai166-rev-'));
  t.after(() => {
    if (process.cwd() === dir) process.chdir(path.resolve(__dirname, '../../..'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function rig(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      now: NOW,
      configured: new Set([writer.model]),
      pidAlive: () => false,
      logMtime: () => NOW - 1000000,
      inspect: async () => ({ sha: SHA, dirty: false }),
      prepare: async () => ({ ok: true, sha: SHA }),
      push: async () => calls.push('push'),
      ci: async () => ({ state: 'green', sha: SHA }),
      candidates: async () => [writer],
      launch: async () => { calls.push('launch'); return { pid: 12 }; },
      review: async (w, r) => { calls.push(['review', r.family]); return { verdict: 'PASS', sha: SHA, findings: [] }; },
      save: async () => {},
      history: async () => {},
      metrics: async () => {},
      ...overrides,
    },
  };
}

function stateFor(current = {}) {
  return { lastRefreshAt: NOW, items: { [item.id]: { writer: { ...writer }, ...current } } };
}

function childFixture() {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 12345,
    stdin: Object.assign(new EventEmitter(), { end: () => {} }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    unref: () => {},
    kill: () => {},
    finish: () => { child.stdout.emit('end'); child.stderr.emit('end'); child.emit('close', 0); },
  });
  return child;
}

// AC-166-05: Publication preflight and git inspection validate branch identity, private paths, and register resolution
test('AC-166-05: publication preflight and git inspection validate branch identity, private paths, and register resolution', async (t) => {
  const dir = temporary(t);
  const inspector = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({ exitCode: 0, stdout: args[0] === 'branch' ? 'feat/task-ai-1660-other' : '' }),
  });
  await assert.rejects(inspector.inspect(item), /ITEM_BRANCH_MISMATCH/);

  for (const branch of ['', 'feat/task-ai-999-unrelated', 'feat/task-ai-1660-mismatch']) {
    const pushRuntime = runtimeApi.createRuntime({
      config: {},
      git: async (cwd, args) => ({ exitCode: 0, stdout: args[0] === 'rev-parse' ? SHA : branch }),
    });
    await assert.rejects(pushRuntime.push(item, SHA), /ITEM_BRANCH_MISMATCH/);
  }
  const calls = [];
  const validBranch = 'feat/task-ai-166-refresh-model-catalogue';
  const validPush = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => { calls.push(args); return { exitCode: 0, stdout: args[0] === 'rev-parse' ? SHA : validBranch }; },
  });
  await validPush.push(item, SHA);
  assert.deepEqual(calls.at(-1), ['push', 'origin', `${SHA}:refs/heads/${validBranch}`]);

  for (const file of ['.oc/writer.log', '.oc/coordinator/state.json', '.serena/cache', '.oc-codex-task.md']) {
    const preflightRuntime = runtimeApi.createRuntime({
      config: {},
      git: async (cwd, args) => ({
        exitCode: 0,
        stdout: args[0] === 'rev-list' ? '0' : args[0] === 'log' ? '[TASK-AI-166] outcome' : args.includes('--name-only') ? file : args[0] === 'rev-parse' ? SHA : '',
      }),
    });
    const result = await preflightRuntime.prepare(item);
    assert.equal(result.ok, false, file);
    assert.match(result.reason, /PRIVATE/);
  }

  const register = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, register)), { recursive: true });
  let committed = false;
  const unmergedRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout: args[0] === 'rev-list' ? '1' : args.includes('--diff-filter=U') ? register : args[0] === 'show' ? 'work_item_id,name\nTASK-AI-166,test' : '',
    }),
    hookedGit: async () => { committed = true; },
  });
  assert.equal((await unmergedRuntime.prepare({ ...item, cwd: dir })).ok, false);
  assert.equal(committed, false);
});

// AC-166-06: Two-phase review requires independent reviewer and prevents open findings from passing
test('AC-166-06: two-phase review requires independent reviewer and prevents open findings from passing', async () => {
  for (const block of [
    '1. P1 Open authorization defect; previous issue FIXED',
    '1. P2 FIXED: old issue\nP1 authorization still missing',
    '1. P1 FIXED: old issue; P1 new bypass remains',
    '1. P1 previous issue FIXED; status ambiguous',
  ]) {
    const result = runtimeApi.parseReview(`VERDICT: PASS\nReviewed SHA: ${SHA}\n${block}`);
    const { deps } = rig({
      candidates: async () => [{ model: 'reviewer', family: 'independent', harness: 'codex', score: 90 }],
      review: async () => result,
    });
    const state = stateFor();
    await policy.coordinatorTick([item], state, deps);
    assert.notEqual(state.items[item.id].status, 'PASS', block);
  }
  const fixed = runtimeApi.parseReview(`VERDICT: PASS\nReviewed SHA: ${SHA}\n1. P1 FIXED: tenant check verified`);
  assert.equal(fixed.findings[0].closed, true);
});

// AC-166-07: Quota refusal cooldown is bounded and cannot renew across ticks or restart
test('AC-166-07: quota refusal cooldown is bounded and cannot renew across ticks or restart', async () => {
  const { calls, deps } = rig({ inspect: async () => ({ sha: null, dirty: false }), logText: async () => 'RESOURCE_EXHAUSTED' });
  let state = stateFor({ writer: { ...writer, log: 'writer.log', reservedAt: NOW - 1000 } });
  await policy.coordinatorTick([item], state, deps);
  assert.equal(state.exhausted.length, 1);
  const until = state.exhausted[0].until;
  state = JSON.parse(JSON.stringify(state));
  await policy.coordinatorTick([item], state, { ...deps, now: NOW + 3600000 });
  assert.equal(state.exhausted.length, 1);
  assert.equal(state.exhausted[0].until, until);
  await policy.coordinatorTick([item], state, { ...deps, now: until });
  assert.equal(calls.filter((call) => call === 'launch').length, 1);
});

// AC-166-08: Fan-out reserves launches durably before spawn and excludes all author families
test('AC-166-08: fan-out reserves launches durably before spawn and excludes all author families', async (t) => {
  const dir = temporary(t);
  const cwd = path.join(dir, 'work');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'task.md'), 'task');
  const state = stateFor();
  state.launches = [];
  state.exhausted = [];
  const child = childFixture();
  let beforeSpawn;
  const runtime = runtimeApi.createRuntime({
    root: dir,
    config: {},
    git: async (work, args) => ({ exitCode: 0, stdout: args[0] === 'rev-parse' ? SHA : 'feat/task-ai-166-test' }),
    spawn: () => {
      beforeSpawn = JSON.parse(fs.readFileSync(path.join(dir, '.oc/coordinator/state.json'), 'utf8'));
      return child;
    },
  });
  runtime.save(state);
  await runtime.fanout({ ...item, cwd }, [{ lane: 1, files: ['tools/test.js'], findings: [] }], [{ model: 'gpt-test', family: 'gpt', harness: 'codex', score: 90 }], state);
  child.finish();
  assert.equal(beforeSpawn.launches.length, 1);
  assert.ok(beforeSpawn.items[item.id].lanes[0].writer.reservedAt);

  const second = { model: 'p/second', family: 'second', harness: 'opencode', score: 99 };
  const independent = { model: 'p/independent', family: 'independent', harness: 'opencode', score: 85 };
  let ci = 'pending';
  const { calls, deps } = rig({
    collectLanes: async () => ({ state: 'merged' }),
    ci: async () => ({ state: ci, sha: SHA }),
    candidates: async () => [writer, second, independent],
    configured: new Set([writer.model, second.model, independent.model]),
  });
  let multiState = stateFor({ lanes: [{ lane: 1, writer }, { lane: 2, writer: second }] });
  await policy.coordinatorTick([item], multiState, deps);
  multiState = JSON.parse(JSON.stringify(multiState));
  ci = 'green';
  await policy.coordinatorTick([item], multiState, deps);
  assert.deepEqual(calls.find((call) => Array.isArray(call)), ['review', 'independent']);
});

// AC-166-09: Metrics and coordinator loop respect held locks, mask audit credentials, and deduplicate by PR/SHA/round
test('AC-166-09: metrics and coordinator loop respect held locks, mask audit credentials, and deduplicate by PR/SHA/round', async (t) => {
  const dir = temporary(t);
  const previousCwd = process.cwd();
  const previousConfig = process.env.OPENCODE_CONFIG;
  t.after(() => {
    process.chdir(previousCwd);
    if (previousConfig === undefined) delete process.env.OPENCODE_CONFIG;
    else process.env.OPENCODE_CONFIG = previousConfig;
  });
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{}');
  process.env.OPENCODE_CONFIG = path.join(dir, 'opencode.json');
  const localDir = path.join(dir, '.oc/coordinator');
  fs.mkdirSync(localDir, { recursive: true });
  const lock = path.join(localDir, 'loop.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 12345, at: '2026-01-01T00:00:00Z' }));
  const input = path.join(dir, 'items.json');
  fs.writeFileSync(input, JSON.stringify([{ ...item, cwd: dir }, { ...item, id: 'GOAL-AUTOCLAW-REPOS-1', cwd: dir }]));
  process.chdir(dir);
  const before = fs.readFileSync(lock, 'utf8');
  await assert.rejects(require('../coordinator-cli').main(['run', input]), /LOOP_LOCK_HELD.*PID 12345.*age.*inspect/i);
  assert.equal(fs.readFileSync(lock, 'utf8'), before);

  const file = path.join(dir, 'metrics.jsonl');
  const row = { item: item.id, pr: 123, sha: SHA, round: 1, verdict: 'PASS', tokens: 4 };
  fs.writeFileSync(file, [JSON.stringify(row), JSON.stringify({ ...row, item: 'legacy' }), '{"bad":', JSON.stringify({ ...row, tokens: -1 })].join('\n'));
  t.mock.method(require('../discovery/spawn'), 'runCommand', async () => ({ exitCode: 0, stdout: '{"state":"MERGED"}' }));
  const summary = await require('../coordinator-cli').main(['metrics', file]);
  assert.equal(summary.reviews, 1);
  assert.equal(summary.malformedRowsSkipped, 2);

  const runtime = runtimeApi.createRuntime({ config: {}, root: dir });
  const metadata = { round: 1, sha: SHA, verdict: 'PASS', writer: 'person@tenant.test', text: 'checked' };
  await runtime.history({ ...item, cwd: dir }, metadata);
  await runtime.metrics({ ...metadata, item: item.id, pr: item.pr, tokens: 4 });
  for (const f of [path.join(dir, '.oc/history.md'), runtime.metricsFile]) {
    assert.equal(fs.readFileSync(f, 'utf8').includes('person@tenant.test'), false);
  }
  for (const value of ['sk-secretval', 'https://login:secretval@host.test/path?token=secretval']) {
    assert.equal(runtimeApi.safeText(value).includes('secretval'), false);
  }
});
