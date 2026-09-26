'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const jev = require('../jev');
const {
  escalateUndecided,
  extractCandidateIdentity,
  extractConflictingEvidenceIds,
  buildEscalationRequest,
  DEFAULT_MAX_ESCALATIONS,
} = require('../escalation');

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

describe('escalation — handling UNDECIDED with reasoning controller (TASK-AI-50 C3)', () => {
  test('only UNDECIDED items are escalated', async () => {
    const candidates = [
      makeCandidate({ evidence: { id: 'e-eligible' } }),
      makeCandidate({ quota: { exhausted: true }, evidence: { id: 'e-quota' } }),
      makeCandidate({ cooldownActive: true, evidence: { id: 'e-cool' } }),
      makeCandidate({ evidence: { id: 'e-undecided-1', conflict: true } }),
      makeCandidate({ evidence: { id: 'e-undecided-2', conflict: true } }),
    ];

    const filterResults = jev.filterCandidates(candidates);
    const escalatedRequests = [];
    const controller = async (request) => {
      escalatedRequests.push(request);
      return { status: 'ELIGIBLE', reason: 'RESOLVED_BY_HERMES' };
    };

    const finalResults = await escalateUndecided(filterResults, { controller, candidates });

    assert.equal(escalatedRequests.length, 2, 'only the 2 UNDECIDED items must be escalated');
    assert.deepEqual(
      escalatedRequests.map((r) => r.conflictingEvidenceIds),
      [['e-undecided-1'], ['e-undecided-2']]
    );

    for (const req of escalatedRequests) {
      assert.equal(req.whatJevCouldNotDecide, 'INSUFFICIENT_EVIDENCE');
      assert.ok(req.question.includes('ELIGIBLE or EXCLUDED'));
      assert.equal(typeof req.candidateIdentity, 'object');
      const identityKeys = Object.keys(req.candidateIdentity);
      assert.deepEqual(identityKeys.sort(), [
        'accessPath',
        'account',
        'gateway',
        'harness',
        'modelId',
        'quotaScope',
        'upstream',
      ]);
      assert.equal(req.candidateIdentity.harness, 'hermes');
      assert.equal(req.candidateIdentity.modelId, 'gemini-2.5-flash');
    }
  });

  test('controller answer is merged, decidedBy recorded, count preserved', async () => {
    const candidates = [
      makeCandidate({ evidence: { id: 'e1' } }),
      makeCandidate({ evidence: { id: 'e2', conflict: true } }),
      makeCandidate({ gatewayDown: true, evidence: { id: 'e3' } }),
      makeCandidate({ evidence: { id: 'e4', conflict: true } }),
    ];

    const filterResults = jev.filterCandidates(candidates);
    assert.equal(filterResults.length, 4);

    const controller = async (request) => {
      if (request.conflictingEvidenceIds.includes('e2')) {
        return { status: 'ELIGIBLE', reason: 'HERMES_OVERRIDE_VALID' };
      }
      if (request.conflictingEvidenceIds.includes('e4')) {
        return { status: 'EXCLUDED', reason: 'HERMES_EVIDENCE_UNSOUND' };
      }
      return null;
    };

    const finalResults = await escalateUndecided(filterResults, { controller, candidates });

    assert.equal(finalResults.length, candidates.length, 'count in must equal count out');

    // Index 0: Jev decided ELIGIBLE
    assert.equal(finalResults[0].status, 'ELIGIBLE');
    assert.equal(finalResults[0].reason, 'ELIGIBLE');
    assert.equal(finalResults[0].decidedBy, 'jev');

    // Index 1: Controller decided ELIGIBLE
    assert.equal(finalResults[1].status, 'ELIGIBLE');
    assert.equal(finalResults[1].reason, 'HERMES_OVERRIDE_VALID');
    assert.equal(finalResults[1].decidedBy, 'controller');

    // Index 2: Jev decided EXCLUDED
    assert.equal(finalResults[2].status, 'EXCLUDED');
    assert.equal(finalResults[2].reason, 'GATEWAY_DOWN');
    assert.equal(finalResults[2].decidedBy, 'jev');

    // Index 3: Controller decided EXCLUDED
    assert.equal(finalResults[3].status, 'EXCLUDED');
    assert.equal(finalResults[3].reason, 'HERMES_EVIDENCE_UNSOUND');
    assert.equal(finalResults[3].decidedBy, 'controller');
  });

  test('controller throws / times out / invalid -> stays UNDECIDED, not eligible', async () => {
    const makeUndecidedCandidate = (id) => makeCandidate({ evidence: { id, conflict: true } });

    // Subcase 1: controller throws
    {
      const candidates = [makeUndecidedCandidate('e-throw')];
      const filterResults = jev.filterCandidates(candidates);
      const controller = async () => {
        throw new Error('reasoning controller crashed');
      };

      const out = await escalateUndecided(filterResults, { controller, candidates });
      assert.equal(out.length, 1);
      assert.equal(out[0].status, 'UNDECIDED');
      assert.notEqual(out[0].status, 'ELIGIBLE', 'must not be guessed eligible');
      assert.equal(out[0].reason, 'INSUFFICIENT_EVIDENCE');
      assert.equal(out[0].decidedBy, 'jev');
    }

    // Subcase 2: controller times out
    {
      const candidates = [makeUndecidedCandidate('e-timeout')];
      const filterResults = jev.filterCandidates(candidates);
      const controller = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { status: 'ELIGIBLE', reason: 'SLOW_ANSWER' };
      };

      const out = await escalateUndecided(filterResults, {
        controller,
        candidates,
        timeoutMs: 30,
      });
      assert.equal(out.length, 1);
      assert.equal(out[0].status, 'UNDECIDED');
      assert.notEqual(out[0].status, 'ELIGIBLE', 'must fail closed on timeout');
      assert.equal(out[0].decidedBy, 'jev');
    }

    // Subcase 3: controller returns invalid verdicts or shapes
    const invalidAnswers = [
      null,
      undefined,
      {},
      'ELIGIBLE',
      { status: 'UNKNOWN', reason: 'unsure' },
      { status: 'ELIGIBLE' }, // missing reason
      { status: 'ELIGIBLE', reason: '' }, // empty reason
      { status: 'UNDECIDED', reason: 'still unsure' }, // controller cannot return UNDECIDED
      { verdict: 'INVALID', reason: 'bad' },
    ];

    for (const invalidAnswer of invalidAnswers) {
      const candidates = [makeUndecidedCandidate('e-invalid')];
      const filterResults = jev.filterCandidates(candidates);
      const controller = async () => invalidAnswer;

      const out = await escalateUndecided(filterResults, { controller, candidates });
      assert.equal(out.length, 1);
      assert.equal(out[0].status, 'UNDECIDED');
      assert.notEqual(out[0].status, 'ELIGIBLE', 'invalid answer must fail closed');
      assert.equal(out[0].decidedBy, 'jev');
    }
  });

  test('escalation bound respected', async () => {
    // 6 undecided candidates
    const candidates = [
      makeCandidate({ evidence: { id: 'u1', conflict: true } }),
      makeCandidate({ evidence: { id: 'u2', conflict: true } }),
      makeCandidate({ evidence: { id: 'u3', conflict: true } }),
      makeCandidate({ evidence: { id: 'u4', conflict: true } }),
      makeCandidate({ evidence: { id: 'u5', conflict: true } }),
      makeCandidate({ evidence: { id: 'u6', conflict: true } }),
    ];

    const filterResults = jev.filterCandidates(candidates);
    const escalatedIds = [];
    const controller = async (request) => {
      escalatedIds.push(request.conflictingEvidenceIds[0]);
      return { status: 'ELIGIBLE', reason: 'HERMES_RESOLVED' };
    };

    // Test with explicit bound = 2
    let reportedData = null;
    const out = await escalateUndecided(filterResults, {
      controller,
      candidates,
      maxEscalations: 2,
      onReport: (rep) => {
        reportedData = rep;
      },
    });

    assert.equal(out.length, 6, 'count preserved');
    assert.equal(escalatedIds.length, 2, 'controller called exactly bound times');
    assert.deepEqual(escalatedIds, ['u1', 'u2']);

    // First 2: escalated & decided by controller
    assert.equal(out[0].status, 'ELIGIBLE');
    assert.equal(out[0].decidedBy, 'controller');
    assert.equal(out[1].status, 'ELIGIBLE');
    assert.equal(out[1].decidedBy, 'controller');

    // Remaining 4: stayed UNDECIDED, not eligible
    for (let i = 2; i < 6; i++) {
      assert.equal(out[i].status, 'UNDECIDED');
      assert.notEqual(out[i].status, 'ELIGIBLE');
      assert.equal(out[i].decidedBy, 'jev');
      assert.equal(out[i].boundExceeded, true);
    }

    // Reported check
    assert.ok(reportedData, 'onReport callback was called');
    assert.equal(reportedData.bound, 2);
    assert.equal(reportedData.escalatedCount, 2);
    assert.equal(reportedData.overBoundCount, 4);
    assert.equal(reportedData.overBound.length, 4);

    assert.ok(out.reported, 'reported metadata attached to result array');
    assert.equal(out.reported.overBoundCount, 4);

    // Verify default bound is 5 with stated architectural reason
    assert.equal(DEFAULT_MAX_ESCALATIONS, 5);
  });

  test('extractCandidateIdentity extracts exactly the 7 parts with null defaults', () => {
    const partialCandidate = {
      harness: 'hermes',
      upstream: 'openrouter',
      modelId: 'gemini-2.5-flash',
    };
    const identity = extractCandidateIdentity(partialCandidate);
    assert.deepEqual(identity, {
      harness: 'hermes',
      accessPath: null,
      gateway: null,
      upstream: 'openrouter',
      account: null,
      quotaScope: null,
      modelId: 'gemini-2.5-flash',
    });
    assert.equal(Object.keys(identity).length, 7);
  });

  test('filterCandidates hook supports controller directly and attaches candidate/decidedBy', async () => {
    const candidates = [
      makeCandidate({ evidence: { id: 'e-ok' } }),
      makeCandidate({ evidence: { id: 'e-conflict', conflict: true } }),
    ];

    // Synchronous call without controller keeps C2 behavior with decidedBy and candidate hook
    const syncOut = jev.filterCandidates(candidates);
    assert.equal(syncOut.length, 2);
    assert.equal(syncOut[0].decidedBy, 'jev');
    assert.equal(syncOut[1].decidedBy, 'jev');
    assert.ok(syncOut[0].candidate);

    // With controller in options: invokes escalation seamlessly
    const asyncOut = await jev.filterCandidates(candidates, {
      controller: async () => ({ status: 'EXCLUDED', reason: 'RESOLVED_EXCLUDED' }),
    });
    assert.equal(asyncOut.length, 2);
    assert.equal(asyncOut[0].status, 'ELIGIBLE');
    assert.equal(asyncOut[0].decidedBy, 'jev');
    assert.equal(asyncOut[1].status, 'EXCLUDED');
    assert.equal(asyncOut[1].decidedBy, 'controller');
  });
});
