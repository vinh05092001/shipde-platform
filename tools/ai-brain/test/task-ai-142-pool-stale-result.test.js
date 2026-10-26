'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pool = require('../agy-pool-runtime');

test('a stale result that cannot be removed fails the submission before launch', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-stale-result-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const dir = pool.accountDir('agy01', { runsDir });
  // A directory in place of result.json cannot be unlinked (EISDIR/EPERM, not ENOENT).
  fs.mkdirSync(path.join(dir, 'result.json'), { recursive: true });
  const launched = t.mock.method(pool, 'runAdapter', () => ({ exitCode: 0 }));
  const result = pool.submitJob('agy01', { prompt: 'fixture' }, { runsDir });
  assert.equal(result.state, 'error');
  assert.match(result.reason, /POOL_STALE_RESULT_UNREMOVABLE/);
  assert.equal(launched.mock.callCount(), 0, 'the adapter never runs against a stale result');
});

test('the configured pool bound wins over an unbounded general launch timeout', (t) => {
  const { resolveLauncher } = require('../orchestrate');
  let seen;
  t.mock.method(pool, 'submitJob', (_account, _job, opts) => {
    seen = opts.timeoutMs;
    return { state: 'ok', exitCode: 0, jobId: 'agy01/fixture' };
  });
  t.mock.method(pool, 'readOutText', () => 'fixture');
  const launch = resolveLauncher(
    {
      externalWorkers: 'agy-pool',
      timeoutMs: Infinity,
      registry: { sources: [], dispatch: { agyPoolWriterEnabled: true, agyPoolTimeoutMs: 1234 } },
    },
    null
  );
  launch({
    harness: 'agy-pool',
    accountId: 'agy01',
    model: 'fixture',
    cwd: os.tmpdir(),
    prompt: 'x',
  });
  assert.equal(seen, 1234);
});

test('a shorter job deadline still bounds the pool wait', (t) => {
  const { resolveLauncher } = require('../orchestrate');
  let seen;
  t.mock.method(pool, 'submitJob', (_account, _job, opts) => {
    seen = opts.timeoutMs;
    return { state: 'ok', exitCode: 0, jobId: 'agy01/fixture' };
  });
  t.mock.method(pool, 'readOutText', () => 'fixture');
  const launch = resolveLauncher(
    {
      externalWorkers: 'agy-pool',
      timeoutMs: Infinity,
      registry: { sources: [], dispatch: { agyPoolWriterEnabled: true, agyPoolTimeoutMs: 1234 } },
    },
    null
  );
  launch({
    harness: 'agy-pool',
    accountId: 'agy01',
    model: 'fixture',
    cwd: os.tmpdir(),
    prompt: 'x',
    workerTimeoutMs: 500,
  });
  assert.equal(seen, 500);
});

test('a longer caller timeout never exceeds the configured pool bound', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-bound-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const started = Date.now();
  const result = pool.waitForResult('agy01', started, {
    runsDir,
    timeoutMs: 10 * 60 * 1000,
    registry: { dispatch: { agyPoolTimeoutMs: 50 } },
  });
  assert.notEqual(result.state, 'ok');
  assert.ok(Date.now() - started < 5000, 'the configured 50 ms bound applies');
});

test('a result naming another job is never accepted as the current job output', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-other-job-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const dir = pool.accountDir('agy01', { runsDir });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'result.json'),
    JSON.stringify({ state: 'ok', exitCode: 0, jobId: 'agy01/previous-job' })
  );
  const result = pool.waitForResult('agy01', Date.now(), {
    runsDir,
    timeoutMs: 50,
    expectedJobId: 'agy01/current-job',
  });
  assert.equal(result.state, 'error');
  assert.equal(result.reason, 'POOL_TIMEOUT');
});

test('an untagged result is not accepted for a job that expects its identity', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-untagged-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const dir = pool.accountDir('agy01', { runsDir });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ state: 'ok', exitCode: 0 }));
  const result = pool.waitForResult('agy01', Date.now(), {
    runsDir,
    timeoutMs: 50,
    expectedJobId: 'agy01/current-job',
  });
  assert.equal(result.reason, 'POOL_TIMEOUT');
});
