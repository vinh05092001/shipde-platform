'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createRuntime, safeText, parseReview, reviewUsage } = require('../coordinator-runtime');
const { dispatchCommand } = require('../cli');
const { publicDocuments } = require('../priors-public');
const { runCommand } = require('../discovery/spawn');
const { EventEmitter } = require('node:events');

test('dispatch dry-run fails before selection when freshness is absent', () => {
  const errors = [];
  const result = dispatchCommand(
    { 'dry-run': true },
    { error: (text) => errors.push(text), log: () => {}, discoveryDataDir: '/missing-fixture' }
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.warning.code, 'STALE_CATALOGUE');
  assert.match(errors[0], /STALE_CATALOGUE/);
});
test('AA Flight semicolon retains independently sourced intelligence/coding scores', async () => {
  const row = { name: 'Model X', intelligenceIndex: 88, aaCodingIndex: 81, aaAgenticIndex: 70 };
  const html =
    '<script>self.__next_f.push(' +
    JSON.stringify([1, '1:' + JSON.stringify(row) + '\n']) +
    ');</script>';
  const docs = await publicDocuments({
    descriptor: {
      sources: [
        { id: 'aa', kind: 'aa', url: 'https://aa.invalid', verified: true, score_scale: 'percent' },
      ],
    },
    fetch: async () => ({ ok: true, text: async () => html }),
  });
  assert.deepEqual(docs[0].models[0].benchmarks, {
    intelligenceIndex: 88,
    aaCodingIndex: 81,
    aaAgenticIndex: 70,
  });
  assert.equal(docs[0].sources[0].verified, true);
  assert.equal(docs[0].sources[0].score_scale, 'percent');
});
test('safe diagnostics redact quoted keys and email while preserving review lines', () => {
  const safe = safeText('VERDICT: PASS\n{"apiKey":"private"}\nperson@example.test');
  assert.match(safe, /^VERDICT: PASS\n/);
  assert.equal(safe.includes('private'), false);
  assert.equal(safe.includes('person@'), false);
  const parsed = parseReview(
    'VERDICT: PASS\nReviewed SHA: ' + 'a'.repeat(40) + '\n1. P1 NOT FIXED `apps/api/x.ts:12` broken'
  );
  assert.equal(parsed.sha, 'a'.repeat(40));
  assert.equal(parsed.findings[0].closed, false);
  assert.deepEqual(parsed.findings[0].files, ['apps/api/x.ts']);
});
test('host commit excludes private paths and requires installed hook boundary', async () => {
  const calls = [];
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      return { exitCode: 0, stdout: args[0] === 'status' ? ' M tools/ai-brain/x.js\n' : '' };
    },
    hookedGit: async (cwd, args) => calls.push(['hooked', ...args]),
  });
  await runtime.commit({ id: 'TASK-AI-166', cwd: '/fixture' }, { model: 'gpt-test' });
  const add = calls.find((call) => call[0] === 'add');
  for (const excluded of ['.oc', '.serena', '.oc-codex-task.md'])
    assert.ok(add.includes(':(exclude)' + excluded));
  assert.ok(
    calls.some(
      (call) =>
        call[0] === 'hooked' &&
        call[1] === 'commit' &&
        call[3] === '[TASK-AI-166] Address review: writer output (gpt-test)'
    )
  );
  assert.equal(calls.flat().includes('--no-verify'), false);
});
test('non-register merge conflict aborts and refuses push', async () => {
  const calls = [];
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      return {
        exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
        stdout:
          args[0] === 'rev-list' ? '1' : args.includes('--diff-filter=U') ? 'apps/api/x.ts' : '',
      };
    },
    hookedGit: async () => {
      throw new Error('must not commit');
    },
  });
  assert.equal((await runtime.prepare({ cwd: '/fixture', id: 'TASK-AI-166' })).ok, false);
  assert.ok(calls.some((call) => call.join(' ') === 'merge --abort'));
  assert.equal(
    calls.some((call) => call[0] === 'push'),
    false
  );
});
test('CSV-only merge unions both rows and uses normal commit hook', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-runtime-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const csv = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, csv)), { recursive: true });
  const calls = [];
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      const stdout =
        args[0] === 'rev-list'
          ? '1'
          : args.includes('--diff-filter=U')
            ? csv
            : args[0] === 'show'
              ? '"work_item_id","name"\n' + (args[1].startsWith(':2') ? '"A","one"' : '"B","two"')
              : args[0] === 'log'
                ? '[TASK-AI-166] outcome'
                : args[0] === 'rev-parse'
                  ? 'a'.repeat(40)
                  : '';
      return { exitCode: args[0] === 'merge' ? 1 : 0, stdout };
    },
    hookedGit: async (cwd, args) => calls.push(['hooked', ...args]),
  });
  assert.equal((await runtime.prepare({ cwd: dir, id: 'TASK-AI-166' })).ok, true);
  assert.match(fs.readFileSync(path.join(dir, csv), 'utf8'), /"A","one"\n"B","two"/);
  assert.ok(calls.some((call) => call[0] === 'hooked'));
});

test('structured review usage includes text and measured tokens; missing usage remains unknown', () => {
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

test('fanout retains numerical merge order and installed hooks, without dropping lanes', async () => {
  const calls = [];
  const lanes = [2, 1].map((lane) => ({
    lane,
    cwd: '/fixture/lane' + lane,
    branch: 'lane' + lane,
    base: 'a'.repeat(40),
    files: ['apps/file' + lane + '.js'],
    writer: { model: 'gpt-test' },
  }));
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push([cwd, args]);
      return {
        exitCode: 0,
        stdout:
          args[0] === 'diff' && args.includes('--name-only') && !args.includes('--cached')
            ? 'apps/file' + cwd.slice(-1) + '.js'
            : '',
      };
    },
    hookedGit: async (cwd, args) => calls.push([cwd, ['hooked', ...args]]),
  });
  assert.equal(
    (await runtime.collectLanes({ id: 'TASK-AI-166', cwd: '/fixture/main' }, lanes)).state,
    'merged'
  );
  assert.deepEqual(
    calls.filter((call) => call[1][0] === 'merge').map((call) => call[1].at(-1)),
    ['lane1', 'lane2']
  );
  assert.equal(calls.filter((call) => call[1][0] === 'hooked').length, 2);
  assert.equal(calls.flat(2).includes('--force'), false);
});

test('fanout conflict aborts at that lane and never merges later lanes', async () => {
  const calls = [];
  const lanes = [1, 2].map((lane) => ({
    lane,
    cwd: '/fixture/lane' + lane,
    branch: 'lane' + lane,
    base: 'a'.repeat(40),
    files: ['apps/file' + lane + '.js'],
    writer: { model: 'gpt-test' },
  }));
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      return {
        exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
        stdout:
          args[0] === 'diff' && args.includes('--name-only') && !args.includes('--cached')
            ? 'apps/file' + cwd.slice(-1) + '.js'
            : '',
      };
    },
    hookedGit: async () => {},
  });
  assert.equal(
    (await runtime.collectLanes({ id: 'TASK-AI-166', cwd: '/fixture/main' }, lanes)).state,
    'conflict'
  );
  assert.ok(calls.some((call) => call.join(' ') === 'merge --abort'));
  assert.equal(
    calls.some((call) => call.at(-1) === 'lane2' && call[0] === 'merge'),
    false
  );
});

test('command scanner passes cwd and env without shell so host actions target the item', async () => {
  let captured;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  const result = runCommand('fixture', [], {
    platform: 'linux',
    cwd: '/item',
    env: { FIXTURE: 'yes' },
    spawn: (cmd, args, init) => {
      captured = init;
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });
  assert.equal((await result).exitCode, 0);
  assert.equal(captured.cwd, '/item');
  assert.deepEqual(captured.env, { FIXTURE: 'yes' });
  assert.equal(captured.shell, false);
});

test('public scanner error keeps sandbox errno without logging provider bodies', async () => {
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

test('pool writer delegates to existing lane lock/job identity without reading account credentials', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-pool-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'job.json'); fs.writeFileSync(file, JSON.stringify({ accountId: 'agy01', cwd: dir, model: 'fixture-model', prompt: 'task' }));
  let submitted;
  const result = await require('../coordinator-pool-writer').runPoolWriter(file, { submitJob: async (lane, job) => { submitted = { lane, job }; return { state: 'quota', exitCode: 1, jobId: 'agy01/fixture' }; } });
  assert.equal(submitted.lane, 'agy01'); assert.equal(submitted.job.cwd, dir); assert.equal(result.jobId, 'agy01/fixture'); assert.equal(result.reason, 'RESOURCE_EXHAUSTED');
});
