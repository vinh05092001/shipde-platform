'use strict';

/**
 * Ship Dễ — Concurrent Implementation Ceiling Governance Suite (TASK-AI-42)
 *
 * Tests that AI-TOOL-03 fixes the concurrent implementation ceiling at 1
 * as a stability measure, and that raising it is a governed decision, not
 * an unvetted runtime setting.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  planDispatch,
  DEFAULTS,
  isGovernedDecision,
  GOVERNED_DECISION_PATTERN,
} = require('../scheduler');

const NOW = Date.parse('2026-09-19T12:00:00Z');

function account(over) {
  return Object.assign(
    {
      id: 'acct-a',
      provider: 'google',
      model: 'gemini-2.5-pro',
      enabled: true,
      capabilities: { jsonSchema: true, tools: true, contextWindow: 1000000 },
      cost: { inputPerMillion: 0, outputPerMillion: 0 },
      limits: {},
    },
    over
  );
}

function item(over) {
  return Object.assign(
    {
      workItemId: 'TASK-AI-01',
      role: 'author.foundation',
      branch: 'feat/item-01',
      riskDomains: [],
    },
    over
  );
}

describe('Ceiling governance: identifier validation', () => {
  test('valid DEC-* identifier matches governed decision format', () => {
    assert.strictEqual(GOVERNED_DECISION_PATTERN.test('DEC-017'), true);
    assert.strictEqual(isGovernedDecision('DEC-017'), true);
    assert.strictEqual(isGovernedDecision({ id: 'DEC-017' }), true);
  });

  test('valid HUMAN-DECISION-* identifier matches governed decision format', () => {
    assert.strictEqual(
      isGovernedDecision('HUMAN-DECISION-ORCHESTRATOR-CORE-PRIORITY-2026-09-08'),
      true
    );
    assert.strictEqual(
      isGovernedDecision('HUMAN-DECISION-CONCURRENT-IMPLEMENTATION-2026-09-19'),
      true
    );
  });

  test('unvetted strings and non-governed identifiers are rejected', () => {
    assert.strictEqual(isGovernedDecision(''), false);
    assert.strictEqual(isGovernedDecision(null), false);
    assert.strictEqual(isGovernedDecision(undefined), false);
    assert.strictEqual(isGovernedDecision(true), false);
    assert.strictEqual(isGovernedDecision('true'), false);
    assert.strictEqual(isGovernedDecision('UNVETTED_OVERRIDE'), false);
    assert.strictEqual(isGovernedDecision('config-setting-high'), false);
    assert.strictEqual(isGovernedDecision({}), false);
    assert.strictEqual(isGovernedDecision({ id: 'random-flag' }), false);
  });
});

describe('Ceiling governance: dispatch planning enforcement', () => {
  const pool = [
    account({ id: 'acct-1', model: 'gemini-2.5-pro' }),
    account({ id: 'acct-2', model: 'claude-sonnet-4-6', provider: 'anthropic' }),
    account({ id: 'acct-3', model: 'claude-opus-4-6-thinking', provider: 'anthropic' }),
  ];

  test('default ceiling is 1 under AI-TOOL-03 and defers second implementation agent', () => {
    const plan = planDispatch(
      [
        item({ workItemId: 'ITEM-1', branch: 'feat/1' }),
        item({ workItemId: 'ITEM-2', branch: 'feat/2' }),
      ],
      pool,
      { now: NOW }
    );
    assert.strictEqual(plan.assignments.length, 1);
    assert.strictEqual(plan.deferred.length, 1);
    assert.strictEqual(plan.deferred[0].reason, 'IMPLEMENTATION_LIMIT');
    assert.strictEqual(plan.utilisation.maxImplementation, 1);
    assert.strictEqual(plan.utilisation.governedDecision, null);
    assert.strictEqual(plan.utilisation.ceilingGoverned, false);
  });

  test('unvetted setting requesting maxImplementationAgents > 1 is clamped to 1 without governed decision', () => {
    const plan = planDispatch(
      [
        item({ workItemId: 'ITEM-1', branch: 'feat/1' }),
        item({ workItemId: 'ITEM-2', branch: 'feat/2' }),
        item({ workItemId: 'ITEM-3', branch: 'feat/3' }),
      ],
      pool,
      {
        limits: { maxImplementationAgents: 3 },
        now: NOW,
      }
    );
    assert.strictEqual(plan.assignments.length, 1, 'unvetted setting must not raise ceiling');
    assert.strictEqual(plan.deferred.length, 2);
    assert.strictEqual(plan.deferred[0].reason, 'IMPLEMENTATION_LIMIT');
    assert.strictEqual(plan.deferred[1].reason, 'IMPLEMENTATION_LIMIT');
    assert.strictEqual(plan.utilisation.maxImplementation, 1);
    assert.strictEqual(plan.utilisation.governedDecision, null);
    assert.strictEqual(plan.utilisation.ceilingGoverned, false);
  });

  test('invalid decision identifier (e.g. true, random string) fails closed and is clamped to 1', () => {
    for (const invalid of ['true', 'OPERATOR_OVERRIDE', 'FLAG_RAISE', '']) {
      const plan = planDispatch(
        [
          item({ workItemId: 'ITEM-1', branch: 'feat/1' }),
          item({ workItemId: 'ITEM-2', branch: 'feat/2' }),
        ],
        pool,
        {
          limits: { maxImplementationAgents: 2, governedDecision: invalid },
          now: NOW,
        }
      );
      assert.strictEqual(
        plan.assignments.length,
        1,
        'invalid decision ' + invalid + ' must be clamped'
      );
      assert.strictEqual(plan.deferred[0].reason, 'IMPLEMENTATION_LIMIT');
      assert.strictEqual(plan.utilisation.maxImplementation, 1);
    }
  });

  test('valid governed decision (DEC-017) permits raising the ceiling to authorized limit', () => {
    const plan = planDispatch(
      [
        item({ workItemId: 'ITEM-1', branch: 'feat/1' }),
        item({ workItemId: 'ITEM-2', branch: 'feat/2' }),
        item({ workItemId: 'ITEM-3', branch: 'feat/3' }),
      ],
      pool,
      {
        limits: { maxImplementationAgents: 3, maxPerAccount: 1 },
        governedDecision: 'DEC-017',
        now: NOW,
      }
    );
    assert.strictEqual(plan.assignments.length, 3);
    assert.strictEqual(plan.deferred.length, 0);
    assert.strictEqual(plan.utilisation.maxImplementation, 3);
    assert.strictEqual(plan.utilisation.governedDecision, 'DEC-017');
    assert.strictEqual(plan.utilisation.ceilingGoverned, true);
  });

  test('single-writer invariant holds permanently even when governed decision raises implementation ceiling', () => {
    const plan = planDispatch(
      [
        item({ workItemId: 'SHARED-ITEM', branch: 'feat/branch-1' }),
        item({ workItemId: 'SHARED-ITEM', branch: 'feat/branch-2' }),
      ],
      pool,
      {
        limits: { maxImplementationAgents: 5, maxPerAccount: 5 },
        governedDecision: 'DEC-017',
        now: NOW,
      }
    );
    assert.strictEqual(
      plan.assignments.length,
      1,
      'two writers on same Work Item permanently forbidden'
    );
    assert.strictEqual(plan.deferred[0].reason, 'WORK_ITEM_ALREADY_WRITING');
  });

  test('reducing implementation ceiling to 0 (e.g. for review or research profile) is accepted', () => {
    const plan = planDispatch([item({ workItemId: 'ITEM-1', branch: 'feat/1' })], pool, {
      limits: { maxImplementationAgents: 0 },
      now: NOW,
    });
    assert.strictEqual(plan.assignments.length, 0);
    assert.strictEqual(plan.deferred[0].reason, 'IMPLEMENTATION_LIMIT');
    assert.strictEqual(plan.utilisation.maxImplementation, 0);
  });
});
