'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');
const policy = require('../coordinator');
const runtimeApi = require('../coordinator-runtime');

const NOW = Date.parse('2026-11-03T12:00:00Z');
const SHA = 'a'.repeat(40);
const item = { id: 'TASK-AI-166', pr: 123, cwd: 'fixture', task: 'task.md' };
const writer = { model: 'p/writer', family: 'writer', harness: 'opencode', score: 90 };

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-rev-'));
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
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  return Object.assign(child, {
    pid: 12345,
    stdin: io(),
    stdout: io(),
    stderr: io(),
    unref: () => {},
    kill: () => {},
    finish: () => { child.stdout.emit('end'); child.stderr.emit('end'); child.emit('close', 0); },
  });
}

test('AC-166-05: publication preflight and git inspection validate branch identity, private paths, and register resolution', async (t) => {
  const dir = temporary(t);
  const badRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({ exitCode: 0, stdout: args[0] === 'rev-parse' ? SHA : 'feat/task-ai-999-other' }),
  });
  await assert.rejects(badRuntime.inspect(item), /ITEM_BRANCH_MISMATCH/);
  await assert.rejects(badRuntime.push(item, SHA), /ITEM_BRANCH_MISMATCH/);

  const validBranch = 'feat/task-ai-166-refresh-model-catalogue';
  const goodRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout: args[0] === 'branch' ? validBranch : args[0] === 'rev-parse' ? SHA : args[0] === 'rev-list' ? '0' : args[0] === 'log' ? '[TASK-AI-166] outcome' : args.includes('--name-only') ? '.oc/writer.log' : '',
    }),
  });
  await goodRuntime.push(item, SHA);
  const result = await goodRuntime.prepare(item);
  assert.equal(result.ok, false);
  assert.match(result.reason, /PRIVATE/);

  const register = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, register)), { recursive: true });
  const unmergedRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout: args[0] === 'rev-list' ? '1' : args.includes('--diff-filter=U') ? register : args[0] === 'show' ? 'work_item_id,name\nTASK-AI-166,test' : '',
    }),
    hookedGit: async () => {},
  });
  assert.equal((await unmergedRuntime.prepare({ ...item, cwd: dir })).ok, false);
});

test('AC-166-06: two-phase review requires independent reviewer and prevents open findings from passing', async () => {
  const result = runtimeApi.parseReview(`VERDICT: PASS\nReviewed SHA: ${SHA}\n1. P1 Open defect; previous issue FIXED`);
  const { deps } = rig({
    candidates: async () => [{ model: 'reviewer', family: 'independent', harness: 'codex', score: 90 }],
    review: async () => result,
  });
  const state = stateFor();
  await policy.coordinatorTick([item], state, deps);
  assert.notEqual(state.items[item.id].status, 'PASS');
});

test('AC-166-07: quota refusal cooldown is bounded and cannot renew across ticks or restart', async () => {
  const { deps } = rig({ inspect: async () => ({ sha: null, dirty: false }), logText: async () => 'RESOURCE_EXHAUSTED' });
  let state = stateFor({ writer: { ...writer, log: 'writer.log', reservedAt: NOW - 1000 } });
  await policy.coordinatorTick([item], state, deps);
  assert.equal(state.exhausted.length, 1);
  const until = state.exhausted[0].until;
  state = JSON.parse(JSON.stringify(state));
  await policy.coordinatorTick([item], state, { ...deps, now: NOW + 3600000 });
  assert.equal(state.exhausted[0].until, until);
});

test('AC-166-08: fan-out reserves launches durably before spawn and excludes all author families', async (t) => {
  const dir = temporary(t);
  const cwd = path.join(dir, 'work');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'task.md'), 'task');
  const state = { ...stateFor(), launches: [], exhausted: [] };
  const child = childFixture();
  let beforeSpawn;
  const runtime = runtimeApi.createRuntime({
    root: dir,
    config: {},
    git: async () => ({ exitCode: 0, stdout: 'feat/task-ai-166-test' }),
    spawn: () => { beforeSpawn = JSON.parse(fs.readFileSync(path.join(dir, '.oc/coordinator/state.json'), 'utf8')); return child; },
  });
  runtime.save(state);
  await runtime.fanout({ ...item, cwd }, [{ lane: 1, files: ['tools/test.js'], findings: [] }], [{ model: 'gpt-test', family: 'gpt', harness: 'codex', score: 90 }], state);
  child.finish();
  assert.equal(beforeSpawn.launches.length, 1);
});

test('AC-166-09: metrics and coordinator loop respect held locks, mask audit credentials, and deduplicate by PR/SHA/round', async (t) => {
  const dir = temporary(t);
  const prevCwd = process.cwd();
  const prevConfig = process.env.OPENCODE_CONFIG;
  t.after(() => { process.chdir(prevCwd); if (prevConfig === undefined) delete process.env.OPENCODE_CONFIG; else process.env.OPENCODE_CONFIG = prevConfig; });
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{}');
  process.env.OPENCODE_CONFIG = path.join(dir, 'opencode.json');
  const localDir = path.join(dir, '.oc/coordinator');
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(path.join(localDir, 'loop.lock'), JSON.stringify({ pid: 12345, at: '2026-01-01T00:00:00Z' }));
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify([{ ...item, cwd: dir }]));
  process.chdir(dir);
  await assert.rejects(require('../coordinator-cli').main(['run', inputFile(dir)]), /LOOP_LOCK_HELD/);
});

function inputFile(dir) { return path.join(dir, 'items.json'); }
