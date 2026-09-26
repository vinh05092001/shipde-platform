'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const jev = require('../jev');

/** Helper to build a candidate with 7-part identity */
function makeCandidate(over) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: '/api/v1',
      gateway: 'primary-gw',
      upstream: 'openrouter',
      account: 'acc-main',
      quotaScope: 'default',
      modelId: 'gemini-2.5-flash',
      evidence: { id: 'e1' },
    },
    over || {}
  );
}

describe('jev — filterCandidates (TASK-AI-50 C2)', () => {
  test('every input candidate appears in the output with a reason code', () => {
    const candidates = [
      makeCandidate({ evidence: { id: 'e1' } }),
      makeCandidate({ evidence: { id: 'e2' }, cooldownActive: true }),
      makeCandidate({ evidence: null, evidenceId: null }),
      makeCandidate({ evidence: { id: 'e4', conflict: true } }),
      makeCandidate({ evidence: { id: 'e5' }, gatewayDown: true }),
    ];
    const out = jev.filterCandidates(candidates);
    assert.equal(out.length, candidates.length);
    out.forEach((r) => {
      assert.ok(['ELIGIBLE', 'EXCLUDED', 'UNDECIDED'].includes(r.status));
      assert.equal(typeof r.reason, 'string');
      assert.ok(r.reason.length > 0, 'reason code must be non-empty string');
    });
  });

  test('two accounts on one upstream: one exhausted -> EXCLUDED QUOTA_EXHAUSTED, other ELIGIBLE', () => {
    const c1 = makeCandidate({
      upstream: 'upstream-alpha',
      account: 'acc-1',
      quota: { exhausted: true },
      evidence: { id: 'e1' },
    });
    const c2 = makeCandidate({
      upstream: 'upstream-alpha',
      account: 'acc-2',
      quota: {},
      evidence: { id: 'e2' },
    });
    const out = jev.filterCandidates([c1, c2]);
    const res1 = out.find((r) => r.evidenceId === 'e1');
    const res2 = out.find((r) => r.evidenceId === 'e2');
    assert.equal(res1.status, 'EXCLUDED');
    assert.equal(res1.reason, 'QUOTA_EXHAUSTED');
    assert.equal(res2.status, 'ELIGIBLE');
    assert.equal(res2.reason, 'ELIGIBLE');
  });

  test('unknown quota is never ELIGIBLE-as-unlimited', () => {
    const c1 = makeCandidate({ quota: { unknown: true, rankLow: true }, evidence: { id: 'e1' } });
    const c2 = makeCandidate({ quota: { unknown: true }, evidence: { id: 'e2' } });
    const c3 = makeCandidate({ quota: 'unknown', evidence: { id: 'e3' } });
    const out = jev.filterCandidates([c1, c2, c3]);
    for (const r of out) {
      assert.notEqual(r.status, 'ELIGIBLE', 'unknown quota must never be ELIGIBLE');
      assert.equal(r.status, 'EXCLUDED');
      assert.equal(r.reason, 'QUOTA_UNKNOWN_RANKED_LOW');
    }
  });

  test('conflicting evidence yields UNDECIDED INSUFFICIENT_EVIDENCE', () => {
    const c = makeCandidate({ evidence: { id: 'e1', conflict: true } });
    const out = jev.filterCandidates([c]);
    const r = out[0];
    assert.equal(r.status, 'UNDECIDED');
    assert.equal(r.reason, 'INSUFFICIENT_EVIDENCE');
    assert.equal(r.evidenceId, 'e1');
  });

  test('same input twice gives identical output', () => {
    const candidates = [
      makeCandidate({ evidence: { id: 'e1' } }),
      makeCandidate({ quota: { exhausted: true }, evidence: { id: 'e2' } }),
      makeCandidate({ evidence: { id: 'e3', conflict: true } }),
    ];
    const out1 = jev.filterCandidates(candidates);
    const out2 = jev.filterCandidates(candidates);
    assert.deepStrictEqual(out1, out2);
  });

  test('excludes for COOLDOWN_ACTIVE, GATEWAY_DOWN, ACCESS_DENIED, STALLED_RECENTLY, MODEL_NOT_FOUND, NO_EVIDENCE', () => {
    const cases = [
      {
        candidate: makeCandidate({ cooldownActive: true, evidence: { id: 'ev-cool' } }),
        status: 'EXCLUDED',
        reason: 'COOLDOWN_ACTIVE',
        evidenceId: 'ev-cool',
      },
      {
        candidate: makeCandidate({ gatewayDown: true, evidence: { id: 'ev-gw' } }),
        status: 'EXCLUDED',
        reason: 'GATEWAY_DOWN',
        evidenceId: 'ev-gw',
      },
      {
        candidate: makeCandidate({ accessDenied: true, evidence: { id: 'ev-acc' } }),
        status: 'EXCLUDED',
        reason: 'ACCESS_DENIED',
        evidenceId: 'ev-acc',
      },
      {
        candidate: makeCandidate({ stalled: true, evidence: { id: 'ev-stall' } }),
        status: 'EXCLUDED',
        reason: 'STALLED_RECENTLY',
        evidenceId: 'ev-stall',
      },
      {
        candidate: makeCandidate({ modelId: '', evidence: { id: 'ev-model' } }),
        status: 'EXCLUDED',
        reason: 'MODEL_NOT_FOUND',
        evidenceId: 'ev-model',
      },
      {
        candidate: makeCandidate({ evidence: null, evidenceId: null }),
        status: 'EXCLUDED',
        reason: 'NO_EVIDENCE',
        evidenceId: null,
      },
    ];

    const out = jev.filterCandidates(cases.map((c) => c.candidate));
    assert.equal(out.length, cases.length);
    cases.forEach((expected, i) => {
      assert.equal(out[i].status, expected.status);
      assert.equal(out[i].reason, expected.reason);
      assert.equal(out[i].evidenceId, expected.evidenceId);
    });
  });

  test('count in == count out, empty array returns empty array, non-array throws', () => {
    assert.deepStrictEqual(jev.filterCandidates([]), []);
    assert.throws(() => jev.filterCandidates(null), /expects an array/);
    assert.throws(() => jev.filterCandidates('bad'), /expects an array/);

    const input = [makeCandidate(), makeCandidate({ evidence: { id: 'e2' } })];
    const clone = JSON.parse(JSON.stringify(input));
    const out = jev.filterCandidates(input);
    assert.equal(out.length, 2);
    assert.deepStrictEqual(input, clone, 'input must not be mutated');
  });
});
