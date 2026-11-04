'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('node:events');
const { createRuntime, parseReview, reviewUsage } = require('../coordinator-runtime');
const { dispatchCommand } = require('../cli');
const { publicDocuments } = require('../priors-public');

function dispatchRig(flags = {}) {
  const errors = [];
  const result = dispatchCommand(
    { 'dry-run': true, ...flags },
    {
      error: (text) => errors.push(text),
      log: () => {},
      exit: () => {},
      discoveryDataDir: path.resolve('.oc/tmp/missing-fixture'),
    }
  );
  return { errors, result };
}

function temporary(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'task.md'), 'task instructions');
  return dir;
}

function launchRig(t) {
  const dir = temporary(t, 'ai166-launch-');
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  const [stdout, stderr, stdin, child] = [io(), io(), io(), new EventEmitter()];
  Object.assign(child, { pid: 99999, stdout, stderr, stdin, unref: () => {} });
  const runtime = createRuntime({ config: {}, spawn: () => child });
  return {
    runtime,
    child,
    dir,
    finish: () => {
      stdout.emit('end');
      stderr.emit('end');
      child.emit('close', 0);
    },
  };
}

function poolWriterJob(t, prefix, job) {
  const dir = temporary(t, prefix);
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ accountId: 'agy01', cwd: dir, model: 'm', prompt: 'task', ...job })
  );
  return {
    dir,
    file,
    run: (extra) => require('../coordinator-pool-writer').runPoolWriter(file, extra),
  };
}

test('AC-166-01: benchmark sources retain discrete records without column-wise mean and scanner keeps errno', async () => {
  const { mergePriorDocuments } = require('../priors');
  const now = Date.parse('2026-11-02T12:00:00Z');
  const source = (id, score) => ({
    retrievedAt: '2026-11-01T00:00:00Z',
    sources: [{ id, url: `https://${id}.invalid` }],
    models: [{ canonical: 'model-x', benchmarks: { 'SWE-bench Verified': score } }],
  });
  const doc = mergePriorDocuments([source('sb', 72), source('aa', 40)], now, {});
  const row = doc.ranking.find((r) => r.canonical === 'model-x');
  const scores = row.benchmarks.filter((b) => b.name === 'SWE-bench Verified').map((b) => b.score);
  assert.deepEqual(
    [...scores].sort((a, b) => a - b),
    [40, 72]
  );
  await assert.rejects(
    publicDocuments({
      descriptor: { sources: [{ id: 'aa', kind: 'aa', url: 'https://aa.invalid' }] },
      fetch: async () => {
        const error = new Error('token=must-not-print');
        error.cause = { code: 'EPERM' };
        throw error;
      },
    }),
    /PRIORS_PUBLIC_FETCH_FAILED: aa: EPERM/
  );
});

test('AC-166-03: dispatch dry-run enforces catalogue freshness while fixture evidence bypasses it', () => {
  const { errors: err1, result: res1 } = dispatchRig();
  assert.equal(res1.exitCode, 1);
  assert.equal(res1.warning.code, 'STALE_CATALOGUE');
  assert.match(err1[0], /STALE_CATALOGUE/);
  const evidenceDir = path.resolve('.oc/tmp/fixture-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { errors: err2, result: res2 } = dispatchRig({ 'evidence-dir': evidenceDir });
  assert.notEqual(res2?.warning?.code, 'STALE_CATALOGUE');
  assert.equal(err2.filter((e) => /STALE_CATALOGUE/.test(e)).length, 0);
});

test('AC-166-04: writer launch bounds log at MAX_LOG_BYTES, drains streams, and validates pool job identity', async (t) => {
  const rig = launchRig(t);
  const handle = await rig.runtime.launch(
    { id: 'TASK-AI-166', cwd: rig.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  let resolved = false;
  handle.completed.then(() => {
    resolved = true;
  });
  rig.child.stdout.emit('data', 'chunk 1\n[BLOCKED_BY_SANDBOX]');
  rig.child.stderr.emit('data', 'rate limit warning');
  rig.child.emit('close', 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false);
  rig.finish();
  await handle.completed;
  const drained = fs.readFileSync(handle.log, 'utf8');
  assert.ok(drained.includes('[BLOCKED_BY_SANDBOX]') && drained.includes('rate limit warning'));
  const bounded = launchRig(t);
  const capped = await bounded.runtime.launch(
    { id: 'TASK-AI-166', cwd: bounded.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  const gigabyte = ('A'.repeat(1023) + '\n').repeat(1024);
  for (let i = 0; i < 3; i++) bounded.child.stdout.emit('data', gigabyte);
  bounded.finish();
  await capped.completed;
  assert.ok(fs.statSync(capped.log).size <= 2 * 1024 * 1024);
  assert.ok(fs.readFileSync(capped.log, 'utf8').includes('[TRUNCATED: LOG_SIZE_LIMIT_EXCEEDED]'));
  const delegated = poolWriterJob(t, 'ai166-pool-', { prompt: 'task' });
  let submitted;
  const queued = await delegated.run({
    expectedCwd: delegated.dir,
    submitJob: async (lane, job) => {
      submitted = { lane, job };
      return { state: 'quota', exitCode: 1, jobId: 'agy01/fixture' };
    },
  });
  assert.equal(submitted.lane, 'agy01');
  assert.equal(queued.reason, 'RESOURCE_EXHAUSTED');
  const rejected = poolWriterJob(t, 'ai166-pool-bad-', {
    cwd: path.join(os.tmpdir(), 'ai166-bad'),
  });
  await assert.rejects(() => rejected.run({ expectedCwd: rejected.dir }), /INVALID_JOB_CWD/);
  const secJob = poolWriterJob(t, 'ai166-pool-sec-', {});
  const secRes = await secJob.run({
    expectedCwd: secJob.dir,
    submitJob: async () => ({
      state: 'error',
      exitCode: 1,
      reason: 'password="leak" user@tenant.com',
      jobId: 'agy01/test',
    }),
  });
  assert.ok(!secRes.reason.includes('leak'));
});

test('AC-166-05: host commit excludes private paths and merges CSV conflict via row union through hook', async (t) => {
  const dir = temporary(t, 'ai166-runtime-');
  const csv = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, csv)), { recursive: true });
  const calls = [];
  let committed = false;
  let registerAdded = false;
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      if (args[0] === 'add' && args.includes(csv)) registerAdded = true;
      const stdout =
        args[0] === 'status'
          ? committed
            ? ''
            : ' M tools/ai-brain/x.js\n'
          : args[0] === 'rev-list'
            ? '1'
            : args.includes('--diff-filter=U')
              ? registerAdded
                ? ''
                : csv
              : args[0] === 'show'
                ? '"work_item_id","name"\n' + (args[1].startsWith(':2') ? '"A","one"' : '"B","two"')
                : args[0] === 'log'
                  ? '[TASK-AI-166] outcome'
                  : args[0] === 'rev-parse'
                    ? 'a'.repeat(40)
                    : '';
      return { exitCode: args[0] === 'merge' ? 1 : 0, stdout };
    },
    hookedGit: async (cwd, args) => {
      committed = true;
      calls.push(['hooked', ...args]);
    },
  });
  await runtime.commit({ id: 'TASK-AI-166', cwd: dir }, { model: 'gpt-test' });
  const add = calls.find((call) => call[0] === 'add');
  for (const excluded of ['.oc', '.serena', '.oc-codex-task.md']) {
    assert.ok(add.includes(':(exclude)' + excluded));
  }
  assert.ok(calls.some((c) => c[0] === 'hooked' && c[1] === 'commit'));
  assert.equal((await runtime.prepare({ cwd: dir, id: 'TASK-AI-166' })).ok, true);
  assert.ok(fs.readFileSync(path.join(dir, csv), 'utf8').includes('"A","one"'));
});

test('AC-166-06: structured review output includes parsed verdict and measured token usage', () => {
  const log = [
    JSON.stringify({
      type: 'text',
      part: { text: 'VERDICT: PASS\nReviewed SHA: ' + 'a'.repeat(40) },
    }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 4 } } }),
  ].join('\n');
  assert.equal(reviewUsage(log).tokens, 14);
  assert.equal(parseReview(reviewUsage(log).text).verdict, 'PASS');
  assert.equal(reviewUsage('plain answer').tokens, null);
});

test('AC-166-08: fan-out merges lanes in numerical order and aborts on conflict', async () => {
  const lanes = (ns) =>
    ns.map((lane) => ({
      lane,
      cwd: '/fixture/lane' + lane,
      branch: 'lane' + lane,
      base: 'a'.repeat(40),
      files: ['apps/file' + lane + '.js'],
      writer: { model: 'gpt-test' },
    }));
  const order = [];
  const gitMock = (failMerge) => async (cwd, args) => {
    order.push(args);
    return {
      exitCode: failMerge && args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'diff' && args.includes('--name-only') && !args.includes('--cached')
          ? 'apps/file' + cwd.slice(-1) + '.js'
          : '',
    };
  };
  const main = { id: 'TASK-AI-166', cwd: '/fixture/main' };
  const ordered = createRuntime({
    config: {},
    git: gitMock(false),
    hookedGit: async (cwd, args) => order.push(['hooked', ...args]),
  });
  assert.equal((await ordered.collectLanes(main, lanes([2, 1]))).state, 'merged');
  assert.deepEqual(
    order.filter((call) => call[0] === 'merge').map((call) => call.at(-1)),
    ['lane1', 'lane2']
  );
  const failing = createRuntime({ config: {}, git: gitMock(true), hookedGit: async () => {} });
  order.length = 0;
  assert.equal((await failing.collectLanes(main, lanes([1, 2]))).state, 'conflict');
  assert.ok(order.some((call) => call.join(' ') === 'merge --abort'));
});
