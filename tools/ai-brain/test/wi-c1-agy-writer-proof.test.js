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
