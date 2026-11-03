'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const policy = require('../coordinator');
const runtimeApi = require('../coordinator-runtime');
const live = require('../discovery/live');
const pool = require('../agy-pool-runtime');
const { cmdRun } = require('../discovery');
const { ADAPTERS } = require('../discovery/adapters');
const { reconcileRun } = require('../discovery/reconcile');
const { refreshCatalogue, catalogueFreshness } = require('../catalogue-refresh');

const NOW = Date.parse('2026-11-03T12:00:00Z');
const SHA = 'a'.repeat(40);
const item = { id: 'TASK-AI-166', pr: 123, cwd: 'fixture', task: 'task.md' };
const writer = { model: 'p/writer', family: 'writer', harness: 'opencode', score: 90 };

function temporary(t) {
  const parent = path.resolve(__dirname, '../../../.oc/tmp');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'ai166-review-'));
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
      launch: async () => {
        calls.push('launch');
        return { pid: 12 };
      },
      review: async (work, reviewer) => {
        calls.push(['review', reviewer.family]);
        return { verdict: 'PASS', sha: SHA, findings: [] };
      },
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
  child.pid = 12345;
  child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = () => {};
  child.kill = () => {};
  child.finish = () => {
    child.stdout.emit('end');
    child.stderr.emit('end');
    child.emit('close', 0);
  };
  return child;
}

async function providerListing(rows) {
  return live.enumerateLiveSources({
    config: { provider: { p: { options: { baseURL: 'https://provider.invalid/v1' } } } },
    lanes: [],
    runCommand: async () => ({ exitCode: 0, stdout: 'local-model\tLocal\n' }),
    fetch: async () => ({ ok: true, json: async () => ({ data: rows }) }),
  });
}

test('R4 F4: production lane submission is awaited and consumes its own completed output', async (t) => {
  let finish;
  let submitted = false;
  t.mock.method(pool, 'submitJob', (lane, job) => {
    assert.equal(lane, 'agy01');
    assert.equal(job.command, 'models');
    submitted = true;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  t.mock.method(pool, 'readOutText', () => {
    throw new Error('must not read a reused mailbox');
  });
  let settled = false;
  const pending = live
    .enumerateLiveSources({
      config: {},
      lanes: ['agy01'],
      runCommand: async () => ({ exitCode: 0, stdout: 'local-model\tLocal\n' }),
    })
    .then((value) => {
      settled = true;
      return value;
    });
  await new Promise(setImmediate);
  assert.equal(submitted, true);
  const settledBeforeReceipt = settled;
  finish({ exitCode: 0, stdout: 'lane-model\tLane\n', jobId: 'agy01/receipt' });
  const result = await pending;
  assert.equal(settledBeforeReceipt, false, 'enumeration must wait for the production receipt');
  assert.deepEqual(result.results.agy01.catalogs[0].models, ['lane-model']);
});

test('R4 F4: pool captures model output while the job still owns the lane lock', (t) => {
  const dir = temporary(t);
  t.mock.method(pool, 'accountDir', () => dir);
  t.mock.method(pool, 'runAdapter', () => ({ exitCode: 0 }));
  t.mock.method(pool, 'waitForResult', () => ({ state: 'ok', exitCode: 0 }));
  const read = t.mock.method(pool, 'readOutText', () => {
    assert.equal(fs.existsSync(path.join(dir, 'job.lock')), true);
    return 'job-model\tJob\n';
  });
  const receipt = pool.submitJob('agy01', { command: 'models', cwd: dir }, { timeoutMs: 1000 });
  assert.equal(receipt.stdout, 'job-model\tJob\n');
  assert.equal(read.mock.callCount(), 1);
  assert.equal(fs.existsSync(path.join(dir, 'job.lock')), false);
});

test('R4 F4: missing receipt output cannot read another job mailbox', async (t) => {
  t.mock.method(pool, 'submitJob', () => ({ exitCode: 0, jobId: 'agy01/receipt' }));
  const read = t.mock.method(pool, 'readOutText', () => 'unrelated-model\tOther\n');
  const result = await live.enumerateLiveSources({
    config: {},
    lanes: ['agy01'],
    runCommand: async () => ({ exitCode: 0, stdout: 'local-model\tLocal\n' }),
  });
  assert.equal(read.mock.callCount(), 0);
  assert.equal(result.results.agy01.status, 'unknown');
});

test('R4 F5: partial registry notes prevent global freshness and preserve the last success', async (t) => {
  const dir = temporary(t);
  const previous = new Date(NOW - 3600000).toISOString();
  fs.writeFileSync(
    path.join(dir, 'freshness.json'),
    JSON.stringify({ lastSuccessfulAt: previous })
  );
  t.mock.method(ADAPTERS, 'orchestrator', () => async () => ({
    status: 'enumerated',
    catalogs: [],
    notes: ['one provider failed'],
  }));
  const result = await cmdRun(
    { 'data-dir': dir },
    {
      registry: { sources: [{ id: 'partial', kind: 'orchestrator' }] },
      config: {},
      lanes: [],
      runCommand: async () => ({ exitCode: 0, stdout: 'local-model\tLocal\n' }),
    }
  );
  const freshness = JSON.parse(fs.readFileSync(path.join(dir, 'freshness.json'), 'utf8'));
  assert.equal(result.exitCode, 1);
  assert.equal(freshness.complete, false);
  assert.equal(freshness.lastSuccessfulAt, previous);
  assert.equal(freshness.failedSources[0].id, 'partial');
  assert.equal(result.sources.find((source) => source.id === 'partial').incomplete, true);
});

test('BR-166-01: the production discovery CLI forwards the private observation path', async (t) => {
  const dir = temporary(t);
  const observation = path.join(dir, 'attempt.json');
  let received;
  t.mock.method(require('../discovery'), 'cmdRun', async (flags) => {
    received = flags;
    return { exitCode: 0, sources: [] };
  });
  await require('../cli').discoveryCommand(
    {
      _: ['discovery', 'run'],
      'discovery-dir': dir,
      'freshness-file': observation,
    },
    { log: () => {}, error: () => {} }
  );
  assert.equal(received['freshness-file'], observation);
});

test('R4 F6: namespace and preset identifiers are retained without manufactured removals', async () => {
  const result = await providerListing([
    { id: 'cf/@cf/cloudflare/clef-flash' },
    { id: 'cl/@preset/reviewer' },
  ]);
  assert.deepEqual(result.results['opencode:p'].catalogs[0].models, [
    'p/cf/@cf/cloudflare/clef-flash',
    'p/cl/@preset/reviewer',
  ]);
});

test('R4 F6: one malformed model makes the entire listing non-authoritative', async () => {
  for (const row of [null, {}, { id: '' }, { id: 7 }, { id: 'bad model' }]) {
    const result = await providerListing([{ id: 'kept' }, row]);
    assert.equal(result.results['opencode:p'].status, 'unknown');
    const prior = { key: 'old', modelId: 'old', state: 'AVAILABLE', sourceIds: ['opencode:p'] };
    const reconciled = reconcileRun({
      registry: { sources: result.sources },
      results: result.results,
      current: new Map([['old', prior]]),
    });
    assert.equal(
      reconciled.transitions.some((entry) => entry.state === 'REMOVED'),
      false
    );
    assert.equal(JSON.stringify(result).includes('bad model'), false);
  }
});

test('R4 F9: the same quota log cannot renew cooldown across ticks or restart', async () => {
  const { calls, deps } = rig({
    inspect: async () => ({ sha: null, dirty: false }),
    logText: async () => 'RESOURCE_EXHAUSTED',
  });
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

test('R4 F9: only newer scoped quota evidence reconciles a log exclusion', async () => {
  const { calls, deps } = rig({
    inspect: async () => ({ sha: null, dirty: false }),
    logText: async () => 'rate limit exceeded',
  });
  const state = stateFor({ writer: { ...writer, log: 'writer.log' } });
  await policy.coordinatorTick([item], state, deps);
  await policy.coordinatorTick([item], state, {
    ...deps,
    now: NOW + 1000,
    quotaEvidence: async () => ({ code: 'OK', at: new Date(NOW - 1).toISOString() }),
  });
  assert.equal(calls.includes('launch'), false, 'old OK evidence cannot clear a new refusal');
  await policy.coordinatorTick([item], state, {
    ...deps,
    now: NOW + 2000,
    quotaEvidence: async () => ({ code: 'OK', at: new Date(NOW + 1000).toISOString() }),
  });
  assert.equal(calls.filter((call) => call === 'launch').length, 1);
});

test('R4 F9: runtime returns the actual selected quota scope observation', async (t) => {
  const dir = temporary(t);
  const file = path.join(dir, 'quota.json');
  const at = new Date(NOW).toISOString();
  fs.writeFileSync(
    file,
    JSON.stringify({
      scopes: {
        'route::p/writer': { code: 'OK', at },
        'other::p/writer': { code: 'QUOTA', at },
      },
    })
  );
  const runtime = runtimeApi.createRuntime({ config: {}, quotaFile: file });
  assert.deepEqual(await runtime.quotaEvidence({ ...writer, gateway: 'route' }), {
    code: 'OK',
    at,
  });
});

test('AC-166-07/08: fan-out reserves each launch durably before spawning a writer', async (t) => {
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
    git: async (work, args) => ({
      exitCode: 0,
      stdout: args[0] === 'rev-parse' ? SHA : 'feat/task-ai-166-test',
    }),
    spawn: () => {
      beforeSpawn = JSON.parse(
        fs.readFileSync(path.join(dir, '.oc/coordinator/state.json'), 'utf8')
      );
      return child;
    },
  });
  runtime.save(state);
  await runtime.fanout(
    { ...item, cwd },
    [{ lane: 1, files: ['tools/test.js'], findings: [] }],
    [{ model: 'gpt-test', family: 'gpt', harness: 'codex', score: 90 }],
    state
  );
  child.finish();
  assert.equal(beforeSpawn.launches.length, 1);
  assert.ok(beforeSpawn.items[item.id].lanes[0].writer.reservedAt);
});

test('AC-166-09: metrics identity is PR, SHA and round even if item metadata changes', () => {
  const row = { item: item.id, pr: item.pr, sha: SHA, round: 1, verdict: 'PASS', tokens: 1 };
  assert.equal(policy.metricsSummary([row, { ...row, item: 'legacy-metadata' }]).reviews, 1);
});

test('R4 F10: an unterminated output line is bounded before EOF and never leaks its tail', async (t) => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'task.md'), 'task');
  const child = childFixture();
  const runtime = runtimeApi.createRuntime({ config: {}, spawn: () => child });
  const handle = await runtime.launch(
    { ...item, cwd: dir },
    { model: 'gpt-test', harness: 'codex' }
  );
  child.stdout.emit('data', 'x'.repeat(128 * 1024));
  const beforeEnd = fs.readFileSync(handle.log, 'utf8');
  child.stdout.emit('data', 'password=fixture-secret\n');
  child.finish();
  await handle.completed;
  assert.match(beforeEnd, /TRUNCATED/);
  assert.ok(fs.statSync(handle.log).size <= runtimeApi.MAX_LOG_BYTES);
  assert.equal(fs.readFileSync(handle.log, 'utf8').includes('fixture-secret'), false);
});

test('R4 F10: persisted writer logs are read with a byte cap and truncation marker', async (t) => {
  const dir = temporary(t);
  const file = path.join(dir, 'writer.log');
  fs.writeFileSync(file, 'x\n'.repeat(runtimeApi.MAX_LOG_BYTES));
  const runtime = runtimeApi.createRuntime({ config: {} });
  const output = await runtime.logText({ log: file });
  assert.ok(Buffer.byteLength(output) <= runtimeApi.MAX_LOG_BYTES);
  assert.match(output, /TRUNCATED/);
});

test('R4 F10/F14: a truncated structured review can never authorize PASS', () => {
  const output =
    JSON.stringify({ type: 'text', part: { text: `VERDICT: PASS\nReviewed SHA: ${SHA}` } }) +
    '\n[TRUNCATED: LOG_SIZE_LIMIT_EXCEEDED]\n';
  const parsed = runtimeApi.parseReview(runtimeApi.reviewUsage(output).text);
  assert.notEqual(parsed.verdict, 'PASS');
});

test('R4 F13: every fan-out author family remains excluded after collection and restart', async () => {
  const second = { model: 'p/second', family: 'second', harness: 'opencode', score: 99 };
  const independent = {
    model: 'p/independent',
    family: 'independent',
    harness: 'opencode',
    score: 85,
  };
  let ci = 'pending';
  const { calls, deps } = rig({
    collectLanes: async () => ({ state: 'merged' }),
    ci: async () => ({ state: ci, sha: SHA }),
    candidates: async () => [writer, second, independent],
    configured: new Set([writer.model, second.model, independent.model]),
  });
  let state = stateFor({
    lanes: [
      { lane: 1, writer },
      { lane: 2, writer: second },
    ],
  });
  await policy.coordinatorTick([item], state, deps);
  state = JSON.parse(JSON.stringify(state));
  ci = 'green';
  await policy.coordinatorTick([item], state, deps);
  assert.deepEqual(
    calls.find((call) => Array.isArray(call)),
    ['review', 'independent']
  );
});

test('R4 F13: no independent family or an unknown lane author stops for an operator', async () => {
  for (const laneWriter of [writer, {}]) {
    const { calls, deps } = rig({
      collectLanes: async () => ({ state: 'merged' }),
      ...(laneWriter.model
        ? {}
        : {
            candidates: async () => [
              { model: 'reviewer', family: 'independent', harness: 'codex', score: 90 },
            ],
          }),
    });
    const state = stateFor({ lanes: [{ lane: 1, writer: laneWriter }] });
    await policy.coordinatorTick([item], state, deps);
    assert.equal(
      calls.some((call) => Array.isArray(call)),
      false
    );
    assert.ok(['STUCK', 'NO_INDEPENDENT_REVIEWER'].includes(state.items[item.id].status));
  }
});

test('AC-166-05: unresolved register entries still forbid a merge commit after row union', async (t) => {
  const dir = temporary(t);
  const register = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, register)), { recursive: true });
  let committed = false;
  const runtime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'rev-list'
          ? '1'
          : args.includes('--diff-filter=U')
            ? register
            : args[0] === 'show'
              ? 'work_item_id,name\nTASK-AI-166,test'
              : '',
    }),
    hookedGit: async () => {
      committed = true;
    },
  });
  assert.equal((await runtime.prepare({ ...item, cwd: dir })).ok, false);
  assert.equal(committed, false);
});

test('R4 F14: mixed findings and prior FIXED commentary cannot conceal an open P1', async () => {
  for (const block of [
    '1. P1 Open authorization defect; previous issue FIXED',
    '1. P2 FIXED: old issue\nP1 authorization still missing',
    '1. P1 FIXED: old issue; P1 new bypass remains',
    '1. P1 previous issue FIXED; status ambiguous',
  ]) {
    const result = runtimeApi.parseReview(`VERDICT: PASS\nReviewed SHA: ${SHA}\n${block}`);
    const { deps } = rig({
      candidates: async () => [
        { model: 'reviewer', family: 'independent', harness: 'codex', score: 90 },
      ],
      review: async () => result,
    });
    const state = stateFor();
    await policy.coordinatorTick([item], state, deps);
    assert.notEqual(state.items[item.id].status, 'PASS', block);
  }
  const fixed = runtimeApi.parseReview(
    `VERDICT: PASS\nReviewed SHA: ${SHA}\n1. P1 FIXED: tenant check verified`
  );
  assert.equal(fixed.findings[0].closed, true);
});

test('R4 F15: committed private paths are rejected by publication preflight', async () => {
  for (const file of [
    '.oc/writer.log',
    '.oc/coordinator/state.json',
    '.serena/cache',
    '.oc-codex-task.md',
  ]) {
    const runtime = runtimeApi.createRuntime({
      config: {},
      git: async (cwd, args) => ({
        exitCode: 0,
        stdout:
          args[0] === 'rev-list'
            ? '0'
            : args[0] === 'log'
              ? '[TASK-AI-166] outcome'
              : args.includes('--name-only')
                ? file
                : args[0] === 'rev-parse'
                  ? SHA
                  : '',
      }),
    });
    const result = await runtime.prepare(item);
    assert.equal(result.ok, false, file);
    assert.match(result.reason, /PRIVATE/);
  }
});

test('R4 F12 pool cwd: an existing different worktree is refused before submission', async (t) => {
  const expectedCwd = temporary(t);
  const other = temporary(t);
  const file = path.join(expectedCwd, 'job.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ accountId: 'agy01', cwd: other, model: 'test', prompt: 'task' })
  );
  let submitted = false;
  await assert.rejects(
    require('../coordinator-pool-writer').runPoolWriter(file, {
      expectedCwd,
      submitJob: async () => {
        submitted = true;
        return { state: 'ok', exitCode: 0 };
      },
    }),
    /JOB_CWD_OUTSIDE_WORKTREE/
  );
  assert.equal(submitted, false);
});

test('R4 F12 metrics: corrupt lines, invalid PRs and malformed records are reported and never queried', async (t) => {
  const dir = temporary(t);
  const file = path.join(dir, 'metrics.jsonl');
  const row = { item: item.id, pr: 123, sha: SHA, round: 1, verdict: 'PASS', tokens: 4 };
  fs.writeFileSync(
    file,
    [
      JSON.stringify(row),
      '{"truncated":',
      JSON.stringify({ ...row, pr: null }),
      JSON.stringify({ ...row, verdict: 'invented' }),
      JSON.stringify({ ...row, tokens: -1 }),
    ].join('\n')
  );
  const queried = [];
  t.mock.method(require('../discovery/spawn'), 'runCommand', async (cmd, args) => {
    queried.push(args[2]);
    return { exitCode: 0, stdout: '{"state":"MERGED"}' };
  });
  const summary = await require('../coordinator-cli').main(['metrics', file]);
  assert.deepEqual(queried, ['123']);
  assert.equal(summary.malformedRowsSkipped, 4);
  assert.equal(summary.reviews, 1);
});

test('R4 F12 metrics: unavailable merge evidence is explicitly partial', async (t) => {
  const file = path.join(temporary(t), 'metrics.jsonl');
  fs.writeFileSync(
    file,
    JSON.stringify({ item: item.id, pr: 123, sha: SHA, round: 1, verdict: 'PASS', tokens: 4 })
  );
  t.mock.method(require('../discovery/spawn'), 'runCommand', async () => ({
    exitCode: 1,
    stderr: 'offline',
  }));
  const summary = await require('../coordinator-cli').main(['metrics', file]);
  assert.equal(summary.partial, true);
  assert.deepEqual(summary.mergeStateUnavailable, [123]);
  assert.equal(summary.tokensPerMergedPR, null);
});

test('R4 F12 whitespace: runtime returns actionable masked diff-check locations', async () => {
  const runtime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: args.includes('--check') ? 2 : 0,
      stdout:
        args[0] === 'log'
          ? '[TASK-AI-166] outcome'
          : args[0] === 'rev-list'
            ? '0'
            : args.includes('--check')
              ? 'tools/ai-brain/x.js:42: trailing whitespace.\n+ password="fixture-value"'
              : '',
    }),
  });
  const result = await runtime.prepare(item);
  assert.equal(result.ok, false);
  assert.match(result.reason, /x\.js:42: trailing whitespace/);
  assert.equal(result.reason.includes('fixture-value'), false);
});

test('R4 F12 diagnostics: filesystem context is retained with credentials masked', (t) => {
  const dir = path.join(temporary(t), 'password=fixture-value');
  fs.mkdirSync(dir);
  assert.throws(
    () => runtimeApi.readLines(dir),
    (error) => {
      assert.match(error.message, /READ_FAILED.*EISDIR/);
      assert.equal(error.message.includes('fixture-value'), false);
      return true;
    }
  );
});

test('R4 F12 diagnostics: the main CLI preserves masked filesystem details', async (t) => {
  const previousExitCode = process.exitCode;
  t.after(() => {
    process.exitCode = previousExitCode;
  });
  const output = [];
  t.mock.method(console, 'error', (text) => output.push(text));
  t.mock.method(require('../coordinator-cli'), 'main', async () => {
    throw Object.assign(new Error('cannot read fixture-path password="fixture-detail"'), {
      code: 'EACCES',
    });
  });
  await require('../cli').main(['coordinator', 'run', 'items.json']);
  assert.equal(process.exitCode, 1);
  assert.match(output.join('\n'), /EACCES.*cannot read fixture-path/);
  assert.doesNotMatch(output.join('\n'), /fixture-detail/);
});

function heldCli(t, id) {
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
  fs.writeFileSync(input, JSON.stringify([{ ...item, id, cwd: dir }]));
  process.chdir(dir);
  return { input, lock };
}

test('R4 F12 lock: held lock reports PID and age without stealing or altering it', async (t) => {
  const { input, lock } = heldCli(t, item.id);
  const before = fs.readFileSync(lock, 'utf8');
  await assert.rejects(
    require('../coordinator-cli').main(['run', input]),
    /LOOP_LOCK_HELD.*PID 12345.*age.*inspect/i
  );
  assert.equal(fs.readFileSync(lock, 'utf8'), before);
});

test('R4 F16: a governed GOAL identifier passes validation to the existing lock guard', async (t) => {
  const { input } = heldCli(t, 'GOAL-AUTOCLAW-REPOS-1');
  await assert.rejects(require('../coordinator-cli').main(['run', input]), /LOOP_LOCK_HELD/);
});

test('R4 F12 push: detached or unrelated branches are refused and the approved OID is pinned', async () => {
  for (const branch of ['', 'feat/task-ai-999-unrelated', 'feat/task-ai-1660-mismatch']) {
    const calls = [];
    const runtime = runtimeApi.createRuntime({
      config: {},
      git: async (cwd, args) => {
        calls.push(args);
        return { exitCode: 0, stdout: args[0] === 'rev-parse' ? SHA : branch };
      },
    });
    await assert.rejects(runtime.push(item, SHA), /ITEM_BRANCH_MISMATCH/);
    assert.equal(
      calls.some((args) => args[0] === 'push'),
      false
    );
  }
  const calls = [];
  const branch = 'feat/task-ai-166-refresh-model-catalogue';
  const runtime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      return { exitCode: 0, stdout: args[0] === 'rev-parse' ? SHA : branch };
    },
  });
  await runtime.push(item, SHA);
  assert.deepEqual(calls.at(-1), ['push', 'origin', `${SHA}:refs/heads/${branch}`]);
});

test('AC-166-05: item inspection refuses a branch whose numeric ID only shares a prefix', async () => {
  const runtime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout: args[0] === 'branch' ? 'feat/task-ai-1660-other' : '',
    }),
  });
  await assert.rejects(runtime.inspect(item), /ITEM_BRANCH_MISMATCH/);
});

test('R4 F12 privacy regression: persisted audit metadata and standalone credentials are masked', async (t) => {
  const dir = temporary(t);
  const runtime = runtimeApi.createRuntime({ config: {}, root: dir });
  const metadata = {
    round: 1,
    sha: SHA,
    verdict: 'PASS',
    writer: 'person@tenant.test',
    text: 'checked',
  };
  await runtime.history({ ...item, cwd: dir }, metadata);
  await runtime.metrics({ ...metadata, item: item.id, pr: item.pr, tokens: 4 });
  for (const file of [path.join(dir, '.oc/history.md'), runtime.metricsFile]) {
    assert.equal(fs.readFileSync(file, 'utf8').includes('person@tenant.test'), false);
  }
  for (const value of [
    'sk-fixturevalue',
    'https://login:fixturevalue@host.test/path?token=fixturevalue',
  ])
    assert.equal(runtimeApi.safeText(value).includes('fixturevalue'), false);
});

test('R4 F10/F12 privacy: quoted partial lines and structured output mask the complete value', () => {
  for (const quote of ['"', "'"]) {
    const partial = runtimeApi.safeText(`password=${quote}fixture-partial\nVERDICT: PASS`);
    assert.equal(partial.includes('fixture-partial'), false);
    assert.match(partial, /\nVERDICT: PASS$/);
  }
  const event = { type: 'text', part: { text: 'password="fixture-structured"\nVERDICT: PASS' } };
  const masked = runtimeApi.safeText(JSON.stringify(event));
  assert.equal(masked.includes('fixture-structured'), false);
  assert.match(JSON.parse(masked).part.text, /VERDICT: PASS/);
});

test('R4 F10/F12 privacy: structured metadata stays valid and masks nested credentials', async (t) => {
  const dir = temporary(t);
  const runtime = runtimeApi.createRuntime({ config: {}, root: dir });
  const record = {
    pr: item.pr,
    item: item.id,
    sha: SHA,
    round: 1,
    verdict: 'PASS',
    tokens: 17,
    writer: 'test-model',
    details: {
      authorization: 'fixture-header',
      notes: ['password="fixture-escaped\\\"fixture-tail"\nchecked', 'person@tenant.test'],
      usage: { input_tokens: 12, output_tokens: 5 },
    },
  };
  await runtime.metrics(record);
  const output = fs.readFileSync(runtime.metricsFile, 'utf8');
  assert.doesNotMatch(output, /fixture-header|fixture-escaped|fixture-tail|person@tenant/);
  const parsed = JSON.parse(output);
  assert.equal(parsed.verdict, 'PASS');
  assert.equal(parsed.tokens, 17);
  assert.deepEqual(parsed.details.usage, { input_tokens: 12, output_tokens: 5 });
});

test('R4 F10/F12 privacy: split credentials and an unterminated final line are masked on disk', async (t) => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'task.md'), 'task');
  const child = childFixture();
  const runtime = runtimeApi.createRuntime({ config: {}, spawn: () => child });
  const handle = await runtime.launch(
    { ...item, cwd: dir },
    { model: 'gpt-test', harness: 'codex' }
  );
  child.stdout.emit('data', 'pass');
  child.stdout.emit('data', 'word="fixture-stream');
  child.finish();
  await handle.completed;
  const output = fs.readFileSync(handle.log, 'utf8');
  assert.doesNotMatch(output, /fixture-stream/);
  assert.match(output, /REDACTED/);
});

test('prior freshness fix: even one millisecond in the future is invalid evidence', () => {
  assert.equal(
    catalogueFreshness({
      now: NOW,
      freshness: { lastSuccessfulAt: new Date(NOW + 1).toISOString() },
    }).stale,
    true
  );
  assert.equal(
    catalogueFreshness({
      now: NOW,
      freshness: { lastSuccessfulAt: new Date(NOW - 48 * 3600000).toISOString() },
    }).stale,
    false
  );
});

test('prior privacy fix: quota summaries retain aggregate counts without identifiers', async (t) => {
  const dir = temporary(t);
  const quotaFile = path.join(dir, 'quota.json');
  const summaryFile = path.join(dir, 'summary.json');
  fs.writeFileSync(
    quotaFile,
    JSON.stringify({
      scopes: {
        a: {
          source: 'customer-source',
          scope: 'tenant-private',
          upstream: 'private-upstream',
          model: 'private-model',
          code: 'OK',
          at: new Date(NOW).toISOString(),
        },
      },
    })
  );
  await refreshCatalogue({
    dataDir: dir,
    quotaFile,
    summaryFile,
    now: NOW,
    verifyEvidence: false,
    run: async () => ({ exitCode: 0 }),
  });
  const text = fs.readFileSync(summaryFile, 'utf8');
  assert.equal(/customer-source|tenant-private|private-upstream|private-model/.test(text), false);
  assert.deepEqual(JSON.parse(text).statusCounts, { OK: 1 });
});

test('BR-166-01: a discovery stage cannot publish freshness before the whole refresh succeeds', async (t) => {
  const dir = temporary(t);
  const freshnessFile = path.join(dir, 'freshness.json');
  const previous = new Date(NOW - 3600000).toISOString();
  fs.writeFileSync(freshnessFile, JSON.stringify({ lastSuccessfulAt: previous }));
  let seenDuringQuota;
  const result = await refreshCatalogue({
    dataDir: dir,
    now: NOW,
    verifyEvidence: false,
    run: async (args, context) => {
      if (args[0] === 'discovery') {
        fs.writeFileSync(
          context?.discoveryFile || freshnessFile,
          JSON.stringify({
            lastAttemptAt: new Date(NOW).toISOString(),
            lastSuccessfulAt: new Date(NOW).toISOString(),
            complete: true,
            failedSources: [],
          })
        );
      }
      if (args[0] === 'quota-scan') {
        seenDuringQuota = JSON.parse(fs.readFileSync(freshnessFile, 'utf8')).lastSuccessfulAt;
        return { exitCode: 1, stderr: 'offline' };
      }
      return { exitCode: 0 };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(seenDuringQuota, previous, 'a crash during quota must not leave a fresh gate');
  assert.equal(JSON.parse(fs.readFileSync(freshnessFile, 'utf8')).lastSuccessfulAt, previous);
});
