'use strict';

/**
 * Tests for the dispatch-state module.
 *
 * Two requirements from the task:
 *   1. The ceiling holds across two dispatches in a row.
 *   2. An unreadable state does not silently read as idle.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readDispatchState, writeDispatchState, DispatchStateError, statePath } = require('../dispatch-state');
const { planDispatch } = require('../scheduler');

// ─── helpers ────────────────────────────────────────────────────────────────

function tmpFile() {
  return path.join(os.tmpdir(), 'dispatch-state-test-' + Math.random().toString(36).slice(2) + '.json');
}

function account(over) {
  return Object.assign(
    {
      id: 'acct-a',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      enabled: true,
      capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
      cost: { inputPerMillion: 3, outputPerMillion: 15 },
      limits: {},
    },
    over
  );
}

function item(over) {
  return Object.assign(
    { workItemId: 'FEAT-A-01', role: 'author.foundation', branch: 'feat/a-01', riskDomains: [] },
    over
  );
}

const POOL = [
  account({ id: 'free-a', cost: { inputPerMillion: 0, outputPerMillion: 0 } }),
  account({ id: 'free-b', cost: { inputPerMillion: 0, outputPerMillion: 0 } }),
];

const NOW = Date.parse('2026-09-14T12:00:00Z');

// ─── dispatch-state unit tests ───────────────────────────────────────────────

describe('dispatch-state: readDispatchState', () => {
  test('returns empty arrays when the file does not exist', () => {
    const file = tmpFile();
    // No file at that path
    const state = readDispatchState({ path: file });
    assert.deepStrictEqual(state.running, []);
    assert.deepStrictEqual(state.claims, []);
  });

  test('throws DispatchStateError when file contains invalid JSON', () => {
    const file = tmpFile();
    fs.writeFileSync(file, 'not-json');
    assert.throws(
      () => readDispatchState({ path: file }),
      (e) => e instanceof DispatchStateError && /JSON/i.test(e.message)
    );
    fs.unlinkSync(file);
  });

  test('throws DispatchStateError when running field is missing', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify({ version: 1 }));
    assert.throws(
      () => readDispatchState({ path: file }),
      (e) => e instanceof DispatchStateError
    );
    fs.unlinkSync(file);
  });

  test('round-trips a LAUNCHED record back through running and claims', () => {
    const file = tmpFile();
    const assignments = [
      { workItemId: 'TASK-1', role: 'author.foundation', accountId: 'free-a', branch: 'feat/task-1' },
    ];
    const records = [
      { workItemId: 'TASK-1', role: 'author.foundation', outcome: 'LAUNCHED', sessionId: 'sess-001' },
    ];
    writeDispatchState(assignments, records, { path: file });
    const state = readDispatchState({ path: file });
    assert.equal(state.running.length, 1, 'one running entry');
    assert.equal(state.running[0].workItemId, 'TASK-1');
    assert.equal(state.running[0].accountId, 'free-a');
    assert.equal(state.claims.length, 1, 'one claim derived from the branch');
    assert.equal(state.claims[0].branch, 'feat/task-1');
    assert.equal(state.claims[0].owner, 'TASK-1');
    fs.unlinkSync(file);
  });

  test('DRY_RUN and REFUSED outcomes are not stored as running', () => {
    const file = tmpFile();
    const assignments = [
      { workItemId: 'A', role: 'author.foundation', accountId: 'free-a', branch: 'feat/a' },
      { workItemId: 'B', role: 'author.foundation', accountId: 'free-b', branch: 'feat/b' },
    ];
    const records = [
      { workItemId: 'A', role: 'author.foundation', outcome: 'DRY_RUN', sessionId: null },
      { workItemId: 'B', role: 'author.foundation', outcome: 'REFUSED', sessionId: null },
    ];
    writeDispatchState(assignments, records, { path: file });
    const state = readDispatchState({ path: file });
    assert.deepStrictEqual(state.running, []);
    assert.deepStrictEqual(state.claims, []);
    fs.unlinkSync(file);
  });
});

// ─── ceiling-across-two-dispatches ──────────────────────────────────────────

describe('dispatch-state: ceiling holds across repeated dispatches', () => {
  test('second dispatch defers IMPLEMENTATION_LIMIT when first launched one author', () => {
    const file = tmpFile();

    // First dispatch: one author item is planned with maxImplementation = 1 (default).
    // Simulate executePlan having launched it (outcome LAUNCHED).
    const firstAssignments = [
      { workItemId: 'FEAT-1', role: 'author.foundation', accountId: 'free-a', branch: 'feat/1' },
    ];
    const firstRecords = [
      { workItemId: 'FEAT-1', role: 'author.foundation', outcome: 'LAUNCHED', sessionId: 'sess-1' },
    ];
    writeDispatchState(firstAssignments, firstRecords, { path: file });

    // Second dispatch: a different item arrives. The ceiling is still 1.
    // Without dispatch-state, planDispatch would see running=[] and assign it.
    // With dispatch-state, it sees running=[FEAT-1] and must defer.
    const state = readDispatchState({ path: file });
    const secondPlan = planDispatch(
      [item({ workItemId: 'FEAT-2', branch: 'feat/2' })],
      POOL,
      { running: state.running, claims: state.claims, now: NOW }
    );

    assert.equal(secondPlan.assignments.length, 0, 'no new assignment — ceiling is still held');
    assert.equal(secondPlan.deferred.length, 1);
    assert.equal(secondPlan.deferred[0].reason, 'IMPLEMENTATION_LIMIT');

    fs.unlinkSync(file);
  });

  test('second dispatch defers WORK_ITEM_ALREADY_WRITING for the same Work Item', () => {
    const file = tmpFile();

    // First dispatch launched FEAT-1.
    writeDispatchState(
      [{ workItemId: 'FEAT-1', role: 'author.foundation', accountId: 'free-a', branch: 'feat/1' }],
      [{ workItemId: 'FEAT-1', role: 'author.foundation', outcome: 'LAUNCHED', sessionId: 's1' }],
      { path: file }
    );

    // Second dispatch: the same Work Item arrives again (e.g. a stuck poll).
    const state = readDispatchState({ path: file });
    const plan = planDispatch(
      [item({ workItemId: 'FEAT-1', branch: 'feat/1' })],
      POOL,
      {
        running: state.running,
        claims: state.claims,
        limits: { maxImplementationAgents: 5, maxTotal: 10 },
        now: NOW,
      }
    );

    assert.equal(plan.assignments.length, 0);
    assert.equal(plan.deferred[0].reason, 'WORK_ITEM_ALREADY_WRITING');

    fs.unlinkSync(file);
  });

  test('second dispatch defers BRANCH_CLAIMED when the branch is held', () => {
    const file = tmpFile();

    writeDispatchState(
      [{ workItemId: 'FEAT-1', role: 'author.foundation', accountId: 'free-a', branch: 'feat/shared' }],
      [{ workItemId: 'FEAT-1', role: 'author.foundation', outcome: 'LAUNCHED', sessionId: 's1' }],
      { path: file }
    );

    const state = readDispatchState({ path: file });
    // A different Work Item tries to take the same branch.
    // Raise the ceiling so the branch check is reached rather than the
    // IMPLEMENTATION_LIMIT check (which is evaluated first in the scheduler).
    const plan = planDispatch(
      [item({ workItemId: 'FEAT-99', branch: 'feat/shared' })],
      POOL,
      {
        running: state.running,
        claims: state.claims,
        limits: { maxImplementationAgents: 5, maxTotal: 10 },
        governedDecision: 'DEC-017',
        now: NOW,
      }
    );

    assert.equal(plan.assignments.length, 0);
    assert.equal(plan.deferred[0].reason, 'BRANCH_CLAIMED');

    fs.unlinkSync(file);
  });
});

// ─── unreadable-state must not be idle ──────────────────────────────────────

describe('dispatch-state: unreadable state does not silently read as idle', () => {
  test('a corrupt file throws DispatchStateError, not a plain parse error', () => {
    const file = tmpFile();
    fs.writeFileSync(file, '{"version":1,"running":"not-an-array"}');
    let thrown = null;
    try {
      readDispatchState({ path: file });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown !== null, 'an error must be thrown');
    assert.ok(thrown instanceof DispatchStateError, 'must be DispatchStateError, not a generic error');
    fs.unlinkSync(file);
  });

  test('a file with invalid JSON throws DispatchStateError', () => {
    const file = tmpFile();
    fs.writeFileSync(file, '{broken json');
    let thrown = null;
    try {
      readDispatchState({ path: file });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown !== null, 'must throw on invalid JSON');
    assert.ok(thrown instanceof DispatchStateError);
    fs.unlinkSync(file);
  });

  test('a missing file does NOT throw — it is the clean-machine case', () => {
    const file = tmpFile();
    // File does not exist; should return empty arrays, not throw.
    const state = readDispatchState({ path: file });
    assert.deepStrictEqual(state, { running: [], claims: [] });
  });

  test('statePath uses a path under .shipde by default', () => {
    const p = statePath({});
    assert.ok(p.includes('.shipde'), 'default path is under ~/.shipde');
    assert.ok(p.endsWith('dispatch-state.json'));
  });

  test('statePath accepts a custom path override', () => {
    const custom = '/tmp/custom-dispatch.json';
    assert.equal(statePath({ path: custom }), custom);
  });
});
