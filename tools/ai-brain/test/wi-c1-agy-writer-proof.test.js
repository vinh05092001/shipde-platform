'use strict';

// WI-C1: an agy-pool run records what its quota evidence actually proves.
// The pool reports no served model, so quota groups are group evidence only.

const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../agy-pool-runtime');
const { resolveLauncher } = require('../orchestrate/writer-loop');

function quota({ gemini = 1.0, claude = 1.0 } = {}, at = null) {
  return {
    at,
    groups: [
      {
        name: 'Gemini Models',
        description: 'Models within this group: Gemini 4 Neon',
        buckets: [{ id: 'gemini-weekly', window: 'weekly', remaining_fraction: gemini }],
      },
      {
        name: 'Claude and GPT models',
        description: 'Models within this group: Claude Opus 5.5',
        buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: claude }],
      },
    ],
  };
}

function launchWith(t, { after, isReview = false }) {
  t.mock.method(pool, 'submitJob', (accountId) => ({
    state: 'ok',
    exitCode: 0,
    accountId,
    jobId: accountId + '/run-1',
  }));
  t.mock.method(pool, 'readOutText', () => '{}');
  const snapshots = [quota({ claude: 0.8 }, 1), after];
  const launch = resolveLauncher(
    {
      externalWorkers: 'agy-pool',
      allowAgyPoolWriter: true,
      poolTimeoutMs: 1000,
      readAgyQuota: () => snapshots.shift(),
    },
    null
  );
  return launch({
    harness: 'agy-pool',
    accountId: 'agy03',
    model: 'claude-opus-5.5',
    quotaScope: 'agy03:3p',
    prompt: 'fixture',
    resultSchema: {},
    isReview,
  });
}

test('WI-C1: a writer continues on group evidence and records the proof', (t) => {
  const res = launchWith(t, { after: quota({ claude: 0.7 }, Date.now() + 60000) });
  assert.equal(res.exitCode, 0);
  assert.equal(res.refusal, undefined);
  assert.equal(res.identityProof.evidenceKind, 'requested+group-delta');
  assert.equal(res.identityProof.modelVerified, false);
});

test('WI-C1: contradicting evidence refuses the writer run', (t) => {
  const res = launchWith(t, {
    after: quota({ gemini: 0.9, claude: 0.7 }, Date.now() + 60000),
  });
  assert.equal(res.exitCode, 1);
  assert.match(res.refusal, /^AGY_IDENTITY_REFUSED: AGY_GROUP_DELTA_MISMATCH/);
});

test('WI-C1: a reviewer without a served model is refused', (t) => {
  const res = launchWith(t, { after: quota({ claude: 0.7 }, Date.now() + 60000), isReview: true });
  assert.equal(res.exitCode, 1);
  assert.match(res.refusal, /^REVIEWER_SERVED_MODEL_UNVERIFIED/);
});

test('WI-C1: an after-snapshot written before the run ended is not group evidence', (t) => {
  let submittedAt = null;
  t.mock.method(pool, 'submitJob', (accountId) => {
    submittedAt = Date.now();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    return { state: 'ok', exitCode: 0, accountId, jobId: accountId + '/run-1' };
  });
  t.mock.method(pool, 'readOutText', () => '{}');
  let reads = 0;
  const launch = resolveLauncher(
    {
      externalWorkers: 'agy-pool',
      allowAgyPoolWriter: true,
      poolTimeoutMs: 1000,
      readAgyQuota: () =>
        reads++ === 0 ? quota({ claude: 0.8 }, 1) : quota({ claude: 0.7 }, submittedAt + 1),
    },
    null
  );
  const res = launch({
    harness: 'agy-pool',
    accountId: 'agy03',
    model: 'claude-opus-5.5',
    quotaScope: 'agy03:3p',
    prompt: 'fixture',
    resultSchema: {},
  });
  assert.equal(res.exitCode, 0, 'missing group evidence does not refuse a writer');
  assert.equal(res.identityProof.error, 'AGY_QUOTA_SNAPSHOT_STALE');
  assert.equal(res.identityProof.groupVerified, false);
});

test('WI-C1: the pool runtime only returns the submitted job result', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-wi-c1-runs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'agy03'), { recursive: true });
  const write = (jobId) =>
    fs.writeFileSync(
      path.join(dir, 'agy03', 'result.json'),
      JSON.stringify({ state: 'ok', exitCode: 0, jobId })
    );
  const opts = { fakeRunsDir: dir, timeoutMs: 150, expectedJobId: 'agy03/mine' };

  write('agy03/other');
  const foreign = pool.waitForResult('agy03', 0, opts);
  assert.equal(foreign.state, 'error');
  assert.equal(foreign.reason, 'POOL_TIMEOUT', 'a result naming another job is never returned');

  write('agy03/mine');
  const own = pool.waitForResult('agy03', 0, opts);
  assert.equal(own.state, 'ok');
  assert.equal(own.jobId, 'agy03/mine');
});
