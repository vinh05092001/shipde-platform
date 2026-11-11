'use strict';

// TASK-AI-171 launch fidelity: dispatch --execute launches exactly the offering
// the Controller chose, or refuses. Invented ids only; no network.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const ranking = require('../ranking');

function cand(name, extra = {}) {
  return {
    harness: 'paseo',
    accessPath: 'http',
    upstream: 'test-' + name,
    accountId: '9router',
    quotaScope: 'test-' + name,
    gateway: '',
    modelId: 'test-' + name + '/invented-' + name,
    source: '9router',
    status: 'passed',
    evidence: [{ level: 3, status: 'passed' }],
    blocked: false,
    sharedQuota: 'unknown',
    qualifiedRoles: ['author.foundation'],
    ...extra,
  };
}

const ctx = (extra = {}) => ({
  workItemId: 'TASK-TEST-LF',
  role: 'author.foundation',
  kind: 'author.foundation',
  dryRun: true,
  ...extra,
});

function keyOf(decision, name) {
  return decision.candidates.find((c) => c.upstream === 'test-' + name).offeringId;
}

describe('pinned offering (finding 1)', () => {
  test('an eligible pinned offering wins even when another ranks higher', () => {
    const free = ranking.rankAndRecord([cand('a'), cand('b')], ctx());
    const other = free.chosen === keyOf(free, 'a') ? 'b' : 'a';
    const pinnedKey = keyOf(free, other);

    const pinned = ranking.rankAndRecord(
      [cand('a'), cand('b')],
      ctx({ pinnedOffering: pinnedKey })
    );
    assert.equal(pinned.chosen, pinnedKey);
    assert.equal(pinned.pinnedOffering, pinnedKey);
  });

  test('a pinned offering that fails a gate is refused, never replaced', () => {
    const free = ranking.rankAndRecord([cand('a'), cand('b')], ctx());
    const blockedKey = keyOf(free, 'a');

    const decision = ranking.rankAndRecord(
      [cand('a', { blocked: true, blockReason: 'quota exhausted' }), cand('b')],
      ctx({ pinnedOffering: blockedKey })
    );
    assert.equal(decision.chosen, null, 'no other candidate is picked');
    assert.equal(decision.reasonCode, 'OFFERING_NOT_ELIGIBLE');
    assert.match(decision.reason, /^REFUSED: OFFERING_NOT_ELIGIBLE: /);
  });

  test('an unknown pinned offering is refused as not found', () => {
    const decision = ranking.rankAndRecord(
      [cand('a'), cand('b')],
      ctx({ pinnedOffering: 'paseo::http::::test-x::9router::test-x::test-x/none' })
    );
    assert.equal(decision.chosen, null);
    assert.equal(decision.reasonCode, 'OFFERING_NOT_FOUND');
  });

  test('without a pin, selection is unchanged', () => {
    const a = ranking.rankAndRecord([cand('a'), cand('b')], ctx());
    const b = ranking.rankAndRecord([cand('a'), cand('b')], ctx({ pinnedOffering: undefined }));
    assert.equal(a.chosen, b.chosen);
    assert.equal(b.pinnedOffering, undefined);
  });
});
