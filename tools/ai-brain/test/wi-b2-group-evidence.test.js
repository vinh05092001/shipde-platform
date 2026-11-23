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

test('WI-B2 fix: identity evidence is bound to the run account and job', () => {
  const before = quota({ claude: 0.8 });
  const after = quota({ claude: 0.7 });
  const check = (receipt, extra) =>
    agyPoolCandidates.verifyAgyServedIdentity({
      ...BASE,
      receipt,
      quotaBefore: before,
      quotaAfter: after,
      ...extra,
    });
  assert.equal(check(undefined).error, 'AGY_RECEIPT_MISSING');
  assert.equal(check({ accountId: 'agy04', jobId: 'agy04/run-1' }).error, 'AGY_ACCOUNT_MISMATCH');
  assert.equal(
    check({ accountId: 'agy03', jobId: 'agy04/run-1' }).error,
    'AGY_RUN_BINDING_MISMATCH'
  );
  assert.equal(check(RUN, { expectedJobId: 'agy03/other' }).error, 'AGY_RUN_BINDING_MISMATCH');
  const ok = check(RUN);
  assert.equal(ok.ok, true);
  assert.equal(ok.modelVerified, false);
  assert.equal(ok.servedModel, null);
  assert.equal(ok.accountId, 'agy03');
  assert.equal(ok.jobId, 'agy03/run-1');
});

test('WI-B2 fix: only an explicit served model in the receipt verifies the model', () => {
  const before = quota({ claude: 0.8 });
  const after = quota({ claude: 0.7 });
  const wrong = agyPoolCandidates.verifyAgyServedIdentity({
    ...BASE,
    receipt: { ...RUN, servedModel: 'Gemini 4 Neon' },
    quotaBefore: before,
    quotaAfter: after,
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error, 'AGY_SERVED_MODEL_MISMATCH');

  const right = agyPoolCandidates.verifyAgyServedIdentity({
    ...BASE,
    receipt: { ...RUN, servedModel: 'Claude Opus 5.5' },
    quotaBefore: before,
    quotaAfter: after,
  });
  assert.equal(right.verified, true);
  assert.equal(right.modelVerified, true);
  assert.equal(right.evidenceKind, 'receipt+group-delta');
});

test('WI-B2 fix: a stale after-snapshot or a quota rise is not group evidence', () => {
  const stale = agyPoolCandidates.verifyAgyServedIdentity({
    ...BASE,
    receipt: RUN,
    quotaBefore: quota({ claude: 0.8 }, 1000),
    quotaAfter: quota({ claude: 0.7 }, 1500),
    runStartedAt: 2000,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'AGY_QUOTA_SNAPSHOT_STALE');

  const lateBefore = agyPoolCandidates.verifyAgyServedIdentity({
    ...BASE,
    receipt: RUN,
    quotaBefore: quota({ claude: 0.8 }, 2500),
    quotaAfter: quota({ claude: 0.7 }, 3000),
    runStartedAt: 2000,
  });
  assert.equal(
    lateBefore.ok,
    false,
    'a before-snapshot taken after the run start does not bracket it'
  );
  assert.equal(lateBefore.error, 'AGY_QUOTA_SNAPSHOT_STALE');

  const midRun = agyPoolCandidates.verifyAgyServedIdentity({
    ...BASE,
    receipt: RUN,
    quotaBefore: quota({ claude: 0.8 }, 1900),
    quotaAfter: quota({ claude: 0.7 }, 2500),
    runStartedAt: 2000,
    runEndedAt: 3000,
  });
  assert.equal(
    midRun.ok,
    false,
    'an after-snapshot taken before the run ended does not bracket it'
  );
  assert.equal(midRun.error, 'AGY_QUOTA_SNAPSHOT_STALE');

  const backwards = agyPoolCandidates.verifyAgyServedIdentity({
    ...BASE,
    receipt: RUN,
    quotaBefore: quota({ claude: 0.8 }, 1900),
    quotaAfter: quota({ claude: 0.7 }, 4000),
    runStartedAt: 3000,
    runEndedAt: 2000,
  });
  assert.equal(backwards.error, 'AGY_QUOTA_SNAPSHOT_STALE');

  const bracketed = agyPoolCandidates.verifyAgyServedIdentity({
    ...BASE,
    receipt: RUN,
    quotaBefore: quota({ claude: 0.8 }, 1900),
    quotaAfter: quota({ claude: 0.7 }, 3100),
    runStartedAt: 2000,
    runEndedAt: 3000,
  });
  assert.equal(bracketed.ok, true);
  assert.equal(bracketed.groupVerified, true);

  const reset = agyPoolCandidates.verifyAgyServedIdentity({
    ...BASE,
    receipt: RUN,
    quotaBefore: quota({ claude: 0.2 }),
    quotaAfter: quota({ claude: 1.0 }),
  });
  assert.equal(reset.ok, false);
  assert.equal(reset.error, 'AGY_GROUP_DELTA_UNOBSERVED');
});
