'use strict';
// TASK-AI-25 — unit tests for the qualifiedRoles feedback rule.
//
// These tests prove the shape and isolation invariants (R02, R08, R09, R10)
// that the acceptance matrix says are proved at the unit level rather than
// by standalone ac-25-*.js rows.
//
// Run with: node --test tools/ai-brain/test/feedback.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Require the role-feedback module from the acceptance lib.
const rf = require('../acceptance/lib/role-feedback');

describe('TASK-AI-25 — role-feedback shape and isolation invariants', () => {
  // --- R02: Feedback writes qualifiedRoles + history only -----------------

  test('WRITTEN_FIELDS contains only qualifiedRoles and history', () => {
    assert.ok(rf.WRITTEN_FIELDS.has('qualifiedRoles'), 'qualifiedRoles is a written field');
    assert.ok(rf.WRITTEN_FIELDS.has('history'), 'history is a written field');
    assert.equal(rf.WRITTEN_FIELDS.size, 2, 'only two fields are written');
  });

  test('EXCLUDED_METRICS excludes cost, quotaPercent, grade, quality, preference', () => {
    for (const metric of ['cost', 'quotaPercent', 'grade', 'quality', 'preference']) {
      assert.ok(rf.EXCLUDED_METRICS.has(metric), metric + ' must be excluded');
    }
  });

  // --- R08: Task outcomes and quota observations never share a ledger ------

  test('outcomeRecord does not carry quota observation fields', () => {
    const record = rf.outcomeRecord(
      'offering::model',
      'role',
      'workItem',
      Date.now(),
      true,
      0,
      1000
    );
    assert.ok('available' in record === false, 'outcomeRecord must not have quota available');
    assert.ok(
      'remainingPercent' in record === false,
      'outcomeRecord must not have remainingPercent'
    );
    assert.ok('status' in record === false, 'outcomeRecord must not have quota status');
  });

  // --- R09: History shape fixed ------------------------------------------

  test('aggregateWindow returns fixed history shape', () => {
    const now = Date.now();
    const records = [
      rf.outcomeRecord('offering::model', 'role', 'workItem-1', now - 1000, true, 0, 500),
      rf.outcomeRecord('offering::model', 'role', 'workItem-2', now - 2000, false, 1, 800),
    ];
    const agg = rf.aggregateWindow(records, now - 30 * 24 * 60 * 60 * 1000, now);
    assert.ok(agg !== null, 'aggregateWindow must return a result');
    assert.equal(typeof agg.samples, 'number', 'samples must be a number');
    assert.equal(typeof agg.mergedItems, 'number', 'mergedItems must be a number');
    assert.equal(typeof agg.passRate, 'number', 'passRate must be a number');
    assert.equal(typeof agg.avgRetriesPerMerged, 'number', 'avgRetriesPerMerged must be a number');
    assert.equal(typeof agg.tokensPerMerged, 'number', 'tokensPerMerged must be a number');
  });

  test('aggregateWindow returns null for empty records', () => {
    const agg = rf.aggregateWindow([], Date.now() - 30 * 24 * 60 * 60 * 1000, Date.now());
    assert.equal(agg, null, 'aggregateWindow must return null for empty records');
  });

  // --- R10: Feedback never dispatches/cools/launches --------------------

  test('module exports no dispatch/cool/launch functions', () => {
    const forbidden = ['dispatch', 'cool', 'launch', 'cooldown', 'quota'];
    for (const name of Object.keys(rf)) {
      for (const f of forbidden) {
        assert.ok(
          !name.toLowerCase().includes(f),
          'module must not export ' + f + '-related function: ' + name
        );
      }
    }
  });

  test('evaluateNarrowing never returns dispatch/cool/launch side effects', () => {
    const records = [];
    for (let i = 0; i < 10; i++) {
      records.push(
        rf.outcomeRecord('offering::model', 'role', 'workItem-' + i, Date.now(), true, 0, 100)
      );
    }
    const result = rf.evaluateNarrowing('role', 'offering::model', records, Date.now());
    assert.ok(
      result.decision === 'narrow' || result.decision === 'keep',
      'decision must be narrow or keep'
    );
    assert.ok('dispatch' in result === false, 'result must not contain dispatch');
    assert.ok('cooldown' in result === false, 'result must not contain cooldown');
    assert.ok('launch' in result === false, 'result must not contain launch');
  });

  // --- Shape invariants --------------------------------------------------

  test('applyNarrowing returns a new array, never mutates input', () => {
    const original = ['role-a', 'role-b', 'role-c'];
    const copy = [...original];
    const result = rf.applyNarrowing(original, 'role-b');
    assert.deepEqual(original, copy, 'applyNarrowing must not mutate input');
    assert.ok(Array.isArray(result), 'applyNarrowing must return an array');
    assert.equal(result.length, 2, 'applyNarrowing must remove exactly one role');
    assert.ok(!result.includes('role-b'), 'applyNarrowing must remove the target role');
  });

  test('applyNarrowing on empty array returns empty array', () => {
    const result = rf.applyNarrowing([], 'role-a');
    assert.ok(Array.isArray(result), 'applyNarrowing must return an array');
    assert.equal(result.length, 0, 'applyNarrowing on empty must return empty');
  });

  test('applyNarrowing never adds a role (narrowing-only, R03)', () => {
    const roles = ['analyst.default'];
    const result = rf.applyNarrowing(roles, 'reviewer.primary');
    assert.ok(!result.includes('reviewer.primary'), 'applyNarrowing must never add a role');
  });

  test('outcomeRecord produces a record with correct shape', () => {
    const now = Date.now();
    const record = rf.outcomeRecord('offering::model', 'role', 'workItem', now, true, 2, 5000);
    assert.equal(record.offeringId, 'offering::model');
    assert.equal(record.roleId, 'role');
    assert.equal(record.workItemId, 'workItem');
    assert.equal(record.instant, now);
    assert.equal(record.passed, true);
    assert.equal(record.retries, 2);
    assert.equal(record.tokens, 5000);
  });

  test('outcomeRecord defaults instant to Date.now when omitted', () => {
    const before = Date.now();
    const record = rf.outcomeRecord('offering::model', 'role', 'workItem', null, true, 0, 0);
    const after = Date.now();
    assert.ok(
      record.instant >= before && record.instant <= after,
      'instant must default to Date.now'
    );
  });

  // --- Validation (R07) mock ---------------------------------------------

  test('validateEntry returns SOURCE_MISSING when source is empty', () => {
    const entry = { roleId: 'role', removedAt: Date.now(), source: '' };
    const result = rf.validateEntry(entry);
    assert.equal(result, 'SOURCE_MISSING', 'empty source must be SOURCE_MISSING');
  });

  test('validateEntry returns SOURCE_MISSING when source is null', () => {
    const entry = { roleId: 'role', removedAt: Date.now() };
    const result = rf.validateEntry(entry);
    assert.equal(result, 'SOURCE_MISSING', 'missing source must be SOURCE_MISSING');
  });

  test('validateEntry returns null for valid entry', () => {
    const entry = {
      roleId: 'role',
      removedAt: Date.now(),
      source: 'measured',
      aggregates: { passRate: 0.3, avgRetriesPerMerged: 5, tokensPerMerged: 600000 },
    };
    const result = rf.validateEntry(entry);
    assert.equal(result, null, 'valid entry must pass validation');
  });

  test('validateEntry returns EVIDENCE_STALE for stale operator-declared removal (R07)', () => {
    // An operator-sourced removal older than STALE_AFTER_MS (90 days) must be
    // refused as evidence for a new narrowing decision.
    const staleRemovedAt = Date.now() - rf.STALE_AFTER_MS - 1;
    const entry = {
      roleId: 'role',
      removedAt: staleRemovedAt,
      source: 'operator',
      aggregates: null,
    };
    const result = rf.validateEntry(entry);
    assert.equal(
      result,
      'EVIDENCE_STALE',
      'stale operator removal must be refused as EVIDENCE_STALE'
    );
  });

  // --- R07 enforced on the narrowing decision path -------------------------
  //
  // The rule's stated effect is that a *subsequent* narrowing decision refuses
  // to count a stale or source-less record it is offered as supporting
  // evidence. validateEntry alone does not prove that: these tests call
  // evaluateNarrowing with cited supporting records and assert the decision
  // itself refuses them, and that no supporting record — stale or fresh —
  // ever substitutes for a measured aggregate breach (AI-25-R06) or grants
  // (AI-25-R03).

  const R07_ROLE = 'reviewer.primary';
  const R07_OFFERING = 'acct-a::claude-sonnet-5';

  // One merged item: passRate 0 breaches the floor, but retries (2 <= 3) and
  // tokens per merged (100000 <= 500000) do not — one of three, so below floor.
  const r07BelowFloor = (now) => [
    rf.outcomeRecord(R07_OFFERING, R07_ROLE, 'FEAT-TEST-01', now, false, 2, 100000),
  ];

  // Ten merged items with no passes, 4 retries and 600000 tokens each: all
  // three floors breached, which satisfies the two-of-three requirement.
  const r07SustainedBreach = (now) => {
    const records = [];
    for (let i = 0; i < 10; i++) {
      records.push(
        rf.outcomeRecord(
          R07_OFFERING,
          R07_ROLE,
          'FEAT-TEST-01-' + i,
          now - i * 1000,
          false,
          4,
          600000
        )
      );
    }
    return records;
  };

  test('evaluateNarrowing refuses a stale operator-declared supporting record (R07)', () => {
    const now = Date.now();
    const stale = rf.qualifiedRoleEntry(
      R07_ROLE,
      now - rf.STALE_AFTER_MS - 1,
      'operator declared removal',
      null,
      'operator'
    );
    const result = rf.evaluateNarrowing(R07_ROLE, R07_OFFERING, r07BelowFloor(now), now, [stale]);
    assert.equal(result.decision, 'keep', 'a refused stale record cannot narrow the role');
    assert.equal(result.supportingEvidence, 0, 'the stale record must not be counted');
    assert.equal(result.refusedEvidence.length, 1, 'the refusal must be reported');
    assert.equal(result.refusedEvidence[0].refusal, 'EVIDENCE_STALE');
    assert.ok(
      result.reason.includes('below floor'),
      'the decision still falls back to the measured floor'
    );
    assert.ok(result.reason.includes('EVIDENCE_STALE'), 'the reason names the refused evidence');
    assert.ok(
      result.reason.includes('requires a fresh measured aggregate'),
      'the reason states what is required instead'
    );
  });

  test('evaluateNarrowing refuses a source-less supporting record outright (R07)', () => {
    const now = Date.now();
    const noSource = rf.qualifiedRoleEntry(R07_ROLE, now, 'undocumented removal', null, null);
    const result = rf.evaluateNarrowing(R07_ROLE, R07_OFFERING, r07BelowFloor(now), now, [
      noSource,
    ]);
    assert.equal(result.decision, 'keep');
    assert.equal(result.supportingEvidence, 0);
    assert.equal(result.refusedEvidence[0].refusal, 'SOURCE_MISSING');
    assert.ok(result.reason.includes('SOURCE_MISSING'), 'the reason names the refused evidence');
  });

  test('evaluateNarrowing counts a fresh supporting record yet never narrows without breach (R06+R07)', () => {
    const now = Date.now();
    const fresh = rf.qualifiedRoleEntry(
      R07_ROLE,
      now - 1000,
      'measured removal',
      { passRate: 0.1, avgRetriesPerMerged: 9, tokensPerMerged: 900000 },
      'measured'
    );
    const result = rf.evaluateNarrowing(R07_ROLE, R07_OFFERING, r07BelowFloor(now), now, [fresh]);
    assert.equal(result.supportingEvidence, 1, 'a valid record is counted as supporting');
    assert.equal(result.refusedEvidence.length, 0, 'nothing is refused here');
    assert.equal(
      result.decision,
      'keep',
      'supporting evidence never substitutes for a measured two-of-three breach'
    );
  });

  test('a stale supporting record cannot block a fresh measured breach nor grant a role (R03+R07)', () => {
    const now = Date.now();
    const stale = rf.qualifiedRoleEntry(
      R07_ROLE,
      now - rf.STALE_AFTER_MS - 1,
      'operator declared removal',
      null,
      'operator'
    );
    const result = rf.evaluateNarrowing(R07_ROLE, R07_OFFERING, r07SustainedBreach(now), now, [
      stale,
    ]);
    assert.equal(result.decision, 'narrow', 'the measured aggregate decides on its own');
    assert.equal(result.supportingEvidence, 0, 'the stale record still is not counted');
    assert.equal(result.refusedEvidence[0].refusal, 'EVIDENCE_STALE', 'refusal stays reported');
    assert.notEqual(result.decision, 'restore', 'the decision never grants');
    assert.ok(
      !rf.applyNarrowing([], R07_ROLE).includes(R07_ROLE),
      'refusing evidence cannot re-add a role'
    );
  });

  test('evaluateNarrowing screens supporting records only for the role under decision (R07)', () => {
    const now = Date.now();
    const otherRole = rf.qualifiedRoleEntry(
      'analyst.default',
      now - rf.STALE_AFTER_MS - 1,
      'stale removal of another role',
      null,
      'operator'
    );
    const result = rf.evaluateNarrowing(R07_ROLE, R07_OFFERING, r07BelowFloor(now), now, [
      otherRole,
    ]);
    assert.equal(result.refusedEvidence.length, 0, 'another role record is not this role');
    assert.equal(result.supportingEvidence, 0, 'and is not counted for this role either');
  });

  // --- Constants ---------------------------------------------------------

  test('PASS_RATE_FLOOR is 0.5', () => {
    assert.equal(rf.PASS_RATE_FLOOR, 0.5);
  });

  test('RETRY_CEILING is 3', () => {
    assert.equal(rf.RETRY_CEILING, 3);
  });

  test('TOKENS_PER_MERGED_CEILING is 500000', () => {
    assert.equal(rf.TOKENS_PER_MERGED_CEILING, 500000);
  });

  test('STALE_AFTER_MS is 90 days in milliseconds', () => {
    assert.equal(rf.STALE_AFTER_MS, 90 * 24 * 60 * 60 * 1000);
  });
});
