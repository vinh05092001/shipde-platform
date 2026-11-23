'use strict';

// WI-B2 correction: agy-pool quota evidence is group evidence bound to one run.
// The pool reports no served model, so quota groups are group evidence only.

const test = require('node:test');
const assert = require('node:assert/strict');
const agyPoolCandidates = require('../agy-pool-candidates');

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

const RUN = { accountId: 'agy03', jobId: 'agy03/run-1' };
const BASE = { requestedModel: 'claude-opus-5.5', expectedBucket: '3p', accountId: 'agy03' };
// A run that started at 2000 and ended at 3000, bracketed by snapshots at 1900 and 3100.
const BRACKETED = {
  quotaBefore: quota({ claude: 0.8 }, 1900),
  quotaAfter: quota({ claude: 0.7 }, 3100),
  runStartedAt: 2000,
  runEndedAt: 3000,
};

function check(overrides) {
  return agyPoolCandidates.verifyAgyServedIdentity({
    ...BASE,
    receipt: RUN,
    ...BRACKETED,
    ...overrides,
  });
}

test('WI-B2 fix: identity evidence is bound to the run account and job', () => {
  assert.equal(check({ receipt: undefined }).error, 'AGY_RECEIPT_MISSING');
  assert.equal(
    check({ receipt: { accountId: 'agy04', jobId: 'agy04/run-1' } }).error,
    'AGY_ACCOUNT_MISMATCH'
  );
  assert.equal(
    check({ receipt: { accountId: 'agy03', jobId: 'agy04/run-1' } }).error,
    'AGY_RUN_BINDING_MISMATCH'
  );
  assert.equal(check({ expectedJobId: 'agy03/other' }).error, 'AGY_RUN_BINDING_MISMATCH');

  const ok = check({});
  assert.equal(ok.ok, true);
  assert.equal(ok.verified, false);
  assert.equal(ok.modelVerified, false);
  assert.equal(ok.groupVerified, true);
  assert.equal(ok.servedModel, null);
  assert.equal(ok.evidenceKind, 'requested+group-delta');
  assert.equal(ok.accountId, 'agy03');
  assert.equal(ok.jobId, 'agy03/run-1');
});

test('WI-B2 fix: only an explicit served model in the receipt verifies the model', () => {
  const wrong = check({ receipt: { ...RUN, servedModel: 'Gemini 4 Neon' } });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error, 'AGY_SERVED_MODEL_MISMATCH');

  const right = check({ receipt: { ...RUN, servedModel: 'Claude Opus 5.5' } });
  assert.equal(right.verified, true);
  assert.equal(right.modelVerified, true);
  assert.equal(right.evidenceKind, 'receipt+group-delta');

  // An explicit served model stands on its own receipt, without any timing.
  const receiptOnly = check({
    receipt: { ...RUN, servedModel: 'Claude Opus 5.5' },
    runStartedAt: undefined,
    runEndedAt: undefined,
  });
  assert.equal(receiptOnly.modelVerified, true);
  assert.equal(receiptOnly.evidenceKind, 'receipt');
});

test('WI-B2 fix: group evidence needs all four times, in order', () => {
  for (const missing of [
    { quotaBefore: quota({ claude: 0.8 }) },
    { runStartedAt: undefined },
    { runEndedAt: undefined },
    { quotaAfter: quota({ claude: 0.7 }) },
    { runStartedAt: undefined, runEndedAt: undefined },
  ]) {
    const res = check(missing);
    assert.equal(res.ok, false, JSON.stringify(Object.keys(missing)));
    assert.equal(res.error, 'AGY_QUOTA_TIMING_MISSING');
    assert.equal(res.groupVerified, false);
  }
  for (const disordered of [
    { quotaBefore: quota({ claude: 0.8 }, 2500) },
    { quotaAfter: quota({ claude: 0.7 }, 2500) },
    { runStartedAt: 3000, runEndedAt: 2000 },
  ]) {
    const res = check(disordered);
    assert.equal(res.ok, false, JSON.stringify(disordered));
    assert.equal(res.error, 'AGY_QUOTA_SNAPSHOT_STALE');
  }
});

test('WI-B2 fix: a quota rise is not group evidence', () => {
  const reset = check({
    quotaBefore: quota({ claude: 0.2 }, 1900),
    quotaAfter: quota({ claude: 1.0 }, 3100),
  });
  assert.equal(reset.ok, false);
  assert.equal(reset.error, 'AGY_GROUP_DELTA_UNOBSERVED');
});
