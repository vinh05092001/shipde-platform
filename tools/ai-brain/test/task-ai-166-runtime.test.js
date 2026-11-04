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
    {
      error: (text) => errors.push(text),
      log: () => {},
      discoveryDataDir: path.resolve('.oc/tmp/missing-fixture'),
    }
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.warning.code, 'STALE_CATALOGUE');
  assert.match(errors[0], /STALE_CATALOGUE/);
});
test('BR-166-03: fixture candidate tests with custom evidence or pool runs bypass live freshness gate', () => {
  const errors = [];
  const fixtureEvidenceDir = path.resolve('.oc/tmp/fixture-evidence');
  fs.mkdirSync(fixtureEvidenceDir, { recursive: true });
  const result = dispatchCommand(
    { 'dry-run': true, 'evidence-dir': fixtureEvidenceDir },
    {
      error: (text) => errors.push(text),
      log: () => {},
      exit: () => {},
      discoveryDataDir: path.resolve('.oc/tmp/missing-fixture'),
    }
  );
  assert.notEqual(result?.warning?.code, 'STALE_CATALOGUE');
  assert.equal(errors.filter((e) => /STALE_CATALOGUE/.test(e)).length, 0);
});
test('Finding 15 (BR-166-02): two-source benchmark rows stay discrete with no column-wise mean', () => {
  const { mergePriorDocuments } = require('../priors');
  const now = Date.parse('2026-11-02T12:00:00Z');
  const doc = mergePriorDocuments(
    [
      {
        retrievedAt: '2026-11-01T00:00:00Z',
        sources: [{ id: 'skillbench', url: 'https://skillbench.invalid/report' }],
        models: [{ canonical: 'model-x', benchmarks: { 'SWE-bench Verified': 72 } }],
      },
      {
        retrievedAt: '2026-11-01T00:00:00Z',
        sources: [{ id: 'aa', url: 'https://aa.invalid/report' }],
        models: [{ canonical: 'model-x', benchmarks: { 'SWE-bench Verified': 40 } }],
      },
    ],
    now,
    {}
  );
  const row = doc.ranking.find((r) => r.canonical === 'model-x');
  const scores = row.benchmarks
    .filter((b) => b.name === 'SWE-bench Verified')
    .map((b) => b.score)
    .sort((a, b) => a - b);
  assert.deepEqual(scores, [40, 72], 'each source keeps its own discrete row');
  assert.equal(
    row.benchmarks.some((b) => b.score === 56),
    false,
    'no column-wise mean'
  );
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
  let registerAdded = false;
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      if (args[0] === 'add') registerAdded = true;
      const stdout =
        args[0] === 'rev-list'
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-pool-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ accountId: 'agy01', cwd: dir, model: 'fixture-model', prompt: 'task' })
  );
  let submitted;
  const result = await require('../coordinator-pool-writer').runPoolWriter(file, {
    expectedCwd: dir,
    submitJob: async (lane, job) => {
      submitted = { lane, job };
      return { state: 'quota', exitCode: 1, jobId: 'agy01/fixture' };
    },
  });
  assert.equal(submitted.lane, 'agy01');
  assert.equal(submitted.job.cwd, dir);
  assert.equal(result.jobId, 'agy01/fixture');
  assert.equal(result.reason, 'RESOURCE_EXHAUSTED');
});

test('Finding 2: launch completed resolves only after stdio streams end and buffers are drained to disk', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-drain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const taskFile = path.join(dir, 'task.md');
  fs.writeFileSync(taskFile, 'task instructions');

  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const stdinEmitter = new EventEmitter();
  stdinEmitter.end = () => {};
  const child = new EventEmitter();
  child.pid = 99999;
  child.stdout = stdoutEmitter;
  child.stderr = stderrEmitter;
  child.stdin = stdinEmitter;
  child.unref = () => {};

  const runtime = createRuntime({
    config: {},
    spawn: () => child,
  });

  const launchHandle = await runtime.launch(
    { id: 'TASK-AI-166', cwd: dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );

  let resolved = false;
  launchHandle.completed.then(() => {
    resolved = true;
  });

  // Emit data chunks on streams
  stdoutEmitter.emit('data', 'chunk 1\n[BLOCKED_BY_SANDBOX]');
  stderrEmitter.emit('data', 'rate limit warning');

  // Child emits close event first (simulating detached piped stdio where exit/close precedes stream end)
  child.emit('close', 0);
  await new Promise((r) => setImmediate(r));

  // Should NOT resolve until stream 'end' is emitted
  assert.equal(resolved, false, 'must not resolve before streams end and drain');

  // Emit end on stdout and stderr
  stdoutEmitter.emit('end');
  stderrEmitter.emit('end');
  const finalResult = await launchHandle.completed;
  assert.equal(finalResult.exitCode, 0);

  // Content must be fully flushed on disk in log file
  const logContent = fs.readFileSync(launchHandle.log, 'utf8');
  assert.ok(logContent.includes('[BLOCKED_BY_SANDBOX]'));
  assert.ok(logContent.includes('rate limit warning'));
});

test('Finding 3: launch log file is bounded and truncated when exceeding MAX_LOG_BYTES', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-bound-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const taskFile = path.join(dir, 'task.md');
  fs.writeFileSync(taskFile, 'task instructions');

  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const stdinEmitter = new EventEmitter();
  stdinEmitter.end = () => {};
  const child = new EventEmitter();
  child.pid = 99998;
  child.stdout = stdoutEmitter;
  child.stderr = stderrEmitter;
  child.stdin = stdinEmitter;
  child.unref = () => {};

  const runtime = createRuntime({
    config: {},
    spawn: () => child,
  });

  const launchHandle = await runtime.launch(
    { id: 'TASK-AI-166', cwd: dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );

  // Emit huge chunk exceeding 2MB
  const bigChunk = ('A'.repeat(1023) + '\n').repeat(1024);
  stdoutEmitter.emit('data', bigChunk);
  stdoutEmitter.emit('data', bigChunk);
  stdoutEmitter.emit('data', bigChunk); // 3MB total emitted
  stdoutEmitter.emit('end');
  stderrEmitter.emit('end');
  child.emit('close', 0);

  await launchHandle.completed;

  const logStats = fs.statSync(launchHandle.log);
  assert.ok(
    logStats.size <= 2 * 1024 * 1024,
    'log size must include the truncation marker within MAX_LOG_BYTES'
  );
  const logContent = fs.readFileSync(launchHandle.log, 'utf8');
  assert.ok(logContent.includes('[TRUNCATED: LOG_SIZE_LIMIT_EXCEEDED]'));
});

test('Finding 6: readLines and metrics CLI skip malformed lines and null PRs without fatal abort', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-metrics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const metricsFile = path.join(dir, 'metrics.jsonl');

  const lines = [
    JSON.stringify({
      item: 'TASK-AI-166',
      pr: 101,
      sha: 'a'.repeat(40),
      round: 1,
      verdict: 'PASS',
    }),
    'this is a malformed non-json line that should be skipped',
    JSON.stringify({ item: 'TASK-AI-166', pr: null, sha: 'b'.repeat(40), round: 2 }), // null PR
    JSON.stringify({
      item: 'TASK-AI-166',
      pr: 102,
      sha: 'c'.repeat(40),
      round: 1,
      verdict: 'PASS',
    }),
  ];
  fs.writeFileSync(metricsFile, lines.join('\n') + '\n');

  const rows = require('../coordinator-runtime').readLines(metricsFile);
  assert.equal(rows.length, 3, 'readLines must skip corrupt non-JSON line');

  // Test coordinator-cli metrics handler with these rows
  t.mock.method(require('../discovery/spawn'), 'runCommand', async () => ({
    exitCode: 0,
    stdout: '{"state":"OPEN"}',
  }));
  const summary = await require('../coordinator-cli').main(['metrics', metricsFile]);
  assert.equal(
    summary.malformedRowsSkipped,
    2,
    'metrics must report malformed JSON and invalid PRs'
  );
  assert.equal(typeof summary.medianRoundsToPass, 'number');
});

test('Finding 8: prepare rejects unresolved unmerged files remaining after register union', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-unresolved-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const csv = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, csv)), { recursive: true });

  let conflictChecks = 0;
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      if (args[0] === 'rev-list') return { exitCode: 0, stdout: '1' };
      if (args[0] === 'merge' && args[1] === '--no-commit') return { exitCode: 1, stdout: '' };
      if (args.includes('--diff-filter=U')) {
        // First check returns REGISTER, second check after add returns unresolved file
        return { exitCode: 0, stdout: ++conflictChecks === 1 ? csv : 'unresolved-conflict.ts\n' };
      }
      if (args[0] === 'show') return { exitCode: 0, stdout: '"header"\n"val"' };
      return { exitCode: 0, stdout: '' };
    },
    hookedGit: async () => {},
  });

  const prep = await runtime.prepare({ cwd: dir, id: 'TASK-AI-166' });
  assert.equal(prep.ok, false);
  assert.ok(prep.reason.includes('MAIN_MERGE_CONFLICT'));
});

test('Finding 9: diff --check failure surfaces stderr details in preflight feedback', () => {
  const { preflight } = require('../coordinator');
  const result = preflight(
    'TASK-AI-166',
    ['[TASK-AI-166] outcome'],
    ['tools/ai-brain/x.js'],
    'DIFF_CHECK_FAILED: apps/api/src/main.ts:42: trailing whitespace.'
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.reason.includes('DIFF_CHECK_FAILED: apps/api/src/main.ts:42: trailing whitespace.')
  );
});

test('Finding 11: held loop.lock surfaces clear LOOP_LOCK_HELD error with PID instead of raw EEXIST', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-lock-'));
  const origCwd = process.cwd();
  const originalConfig = process.env.OPENCODE_CONFIG;
  t.after(() => {
    process.chdir(origCwd);
    if (originalConfig === undefined) delete process.env.OPENCODE_CONFIG;
    else process.env.OPENCODE_CONFIG = originalConfig;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const itemsFile = path.join(dir, 'items.json');
  fs.writeFileSync(
    itemsFile,
    JSON.stringify([{ id: 'TASK-AI-166', cwd: dir, pr: 123, task: 'task.md' }])
  );
  fs.writeFileSync(path.join(dir, 'task.md'), 'instructions');
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{}');
  process.env.OPENCODE_CONFIG = path.join(dir, 'opencode.json');

  const coordDir = path.join(dir, '.oc', 'coordinator');
  fs.mkdirSync(coordDir, { recursive: true });
  fs.writeFileSync(path.join(coordDir, 'loop.lock'), JSON.stringify({ pid: 12345 }));

  process.chdir(dir);

  await assert.rejects(
    () => require('../coordinator-cli').main(['run', itemsFile]),
    /LOOP_LOCK_HELD.*12345/
  );
});

test('Finding 12 & 13: pool writer validates cwd and sanitizes CLI output', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-pool-sec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Non-existent cwd rejected
  const badJobFile = path.join(dir, 'bad-job.json');
  fs.writeFileSync(
    badJobFile,
    JSON.stringify({
      accountId: 'agy01',
      cwd: path.join(dir, 'non-existent-path'),
      model: 'm',
      prompt: 'p',
    })
  );
  await assert.rejects(
    () => require('../coordinator-pool-writer').runPoolWriter(badJobFile, { expectedCwd: dir }),
    /INVALID_JOB_CWD/
  );

  // Sanitized reason and jobId returned
  const goodJobFile = path.join(dir, 'good-job.json');
  fs.writeFileSync(
    goodJobFile,
    JSON.stringify({ accountId: 'agy01', cwd: dir, model: 'm', prompt: 'p' })
  );
  const result = await require('../coordinator-pool-writer').runPoolWriter(goodJobFile, {
    expectedCwd: dir,
    submitJob: async () => ({
      state: 'error',
      exitCode: 1,
      reason: 'Failed auth password="my-secret-pw" for user@tenant.com',
      jobId: 'agy01/test-job',
    }),
  });
  assert.equal(result.reason.includes('my-secret-pw'), false);
  assert.equal(result.reason.includes('user@tenant.com'), false);
  assert.ok(result.reason.includes('[REDACTED]'));
});
