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

const { readDispatchState, writeDispatchState, clearDispatchState, DispatchStateError, statePath, SESSION_TTL_MS } = require('../dispatch-state');
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

describe('dispatch-state: ceiling holds across THREE dispatches (finding 1 / finding 3)', () => {
  test('a deferred second dispatch must not erase state so a third dispatch still sees the ceiling', () => {
    const file = tmpFile();

    // Dispatch 1: FEAT-1 is LAUNCHED.
    const d1Assignments = [
      { workItemId: 'FEAT-1', role: 'author.foundation', accountId: 'free-a', branch: 'feat/1' },
    ];
    const d1Records = [
      { workItemId: 'FEAT-1', role: 'author.foundation', outcome: 'LAUNCHED', sessionId: 'sess-1' },
    ];
    writeDispatchState(d1Assignments, d1Records, { path: file });

    // Dispatch 2: FEAT-2 arrives but is deferred (ceiling = 1, already 1 running).
    const state2 = readDispatchState({ path: file });
    const plan2 = planDispatch(
      [item({ workItemId: 'FEAT-2', branch: 'feat/2' })],
      POOL,
      { running: state2.running, claims: state2.claims, now: NOW }
    );
    assert.equal(plan2.assignments.length, 0, 'dispatch 2 must defer');

    // Dispatch 2 write-back: cli.js writes on every non-dry-run, even with 0 assignments.
    // This is the bug: writeDispatchState([], []) erases FEAT-1.
    writeDispatchState(plan2.assignments || [], [], { path: file });

    // Dispatch 3: FEAT-2 arrives again. Without the fix, running=[] and it gets assigned.
    const state3 = readDispatchState({ path: file });
    const plan3 = planDispatch(
      [item({ workItemId: 'FEAT-2', branch: 'feat/2' })],
      POOL,
      { running: state3.running, claims: state3.claims, now: NOW }
    );

    assert.equal(plan3.assignments.length, 0, 'dispatch 3 must STILL defer — ceiling must hold');
    assert.equal(plan3.deferred.length, 1);
    assert.equal(plan3.deferred[0].reason, 'IMPLEMENTATION_LIMIT');

    fs.unlinkSync(file);
  });

  test('a dispatch that launches one session while another is already running preserves both', () => {
    const file = tmpFile();

    // Dispatch 1: FEAT-1 is LAUNCHED.
    writeDispatchState(
      [{ workItemId: 'FEAT-1', role: 'author.foundation', accountId: 'free-a', branch: 'feat/1' }],
      [{ workItemId: 'FEAT-1', role: 'author.foundation', outcome: 'LAUNCHED', sessionId: 'sess-1' }],
      { path: file }
    );

    // Dispatch 2: ceiling raised to 2; FEAT-2 is LAUNCHED alongside FEAT-1.
    const state2 = readDispatchState({ path: file });
    const plan2 = planDispatch(
      [item({ workItemId: 'FEAT-2', branch: 'feat/2' })],
      POOL,
      {
        running: state2.running,
        claims: state2.claims,
        limits: { maxImplementationAgents: 2, maxTotal: 10 },
        governedDecision: 'DEC-017',
        now: NOW,
      }
    );
    assert.equal(plan2.assignments.length, 1, 'dispatch 2 assigns FEAT-2');

    // Write-back from dispatch 2: only FEAT-2 was launched this time.
    const d2Records = [
      { workItemId: 'FEAT-2', role: 'author.foundation', outcome: 'LAUNCHED', sessionId: 'sess-2' },
    ];
    writeDispatchState(plan2.assignments, d2Records, { path: file });

    // Dispatch 3: FEAT-3 arrives; ceiling is still 2, both slots occupied.
    const state3 = readDispatchState({ path: file });
    assert.equal(state3.running.length, 2, 'both FEAT-1 and FEAT-2 must be running');
    const plan3 = planDispatch(
      [item({ workItemId: 'FEAT-3', branch: 'feat/3' })],
      POOL,
      {
        running: state3.running,
        claims: state3.claims,
        limits: { maxImplementationAgents: 2, maxTotal: 10 },
        governedDecision: 'DEC-017',
        now: NOW,
      }
    );

    assert.equal(plan3.assignments.length, 0, 'dispatch 3 must defer — both slots full');
    assert.equal(plan3.deferred[0].reason, 'IMPLEMENTATION_LIMIT');

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
    assert.deepStrictEqual(state, { running: [], claims: [], expired: [] });
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

// ─── TTL expiry (finding 2) ─────────────────────────────────────────────────

describe('dispatch-state: TTL expires stale entries (finding 2)', () => {
  test('a session older than the TTL is expired and reported', () => {
    const file = tmpFile();
    // Write a session launched 5 hours ago.
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const content = JSON.stringify({
      version: 1,
      updatedAt: fiveHoursAgo,
      running: [{
        workItemId: 'FEAT-OLD', role: 'author.foundation',
        accountId: 'free-a', branch: 'feat/old',
        sessionId: 'sess-dead', launchedAt: fiveHoursAgo,
      }],
    });
    fs.writeFileSync(file, content);

    const state = readDispatchState({ path: file });
    assert.equal(state.running.length, 0, 'expired entry must not be in running');
    assert.equal(state.expired.length, 1, 'expired entry must be in expired');
    assert.equal(state.expired[0].workItemId, 'FEAT-OLD');
    assert.equal(state.claims.length, 0, 'expired entry must not create a claim');

    fs.unlinkSync(file);
  });

  test('a session within the TTL is kept', () => {
    const file = tmpFile();
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const content = JSON.stringify({
      version: 1,
      updatedAt: oneHourAgo,
      running: [{
        workItemId: 'FEAT-LIVE', role: 'author.foundation',
        accountId: 'free-a', branch: 'feat/live',
        sessionId: 'sess-live', launchedAt: oneHourAgo,
      }],
    });
    fs.writeFileSync(file, content);

    const state = readDispatchState({ path: file });
    assert.equal(state.running.length, 1, 'live entry must remain in running');
    assert.equal(state.expired.length, 0);
    assert.equal(state.claims.length, 1, 'live entry must still claim its branch');

    fs.unlinkSync(file);
  });

  test('a mixed set of entries: one expired, one alive', () => {
    const file = tmpFile();
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const content = JSON.stringify({
      version: 1,
      updatedAt: oneHourAgo,
      running: [
        {
          workItemId: 'FEAT-OLD', role: 'author.foundation',
          accountId: 'free-a', branch: 'feat/old',
          sessionId: 'sess-dead', launchedAt: fiveHoursAgo,
        },
        {
          workItemId: 'FEAT-LIVE', role: 'author.foundation',
          accountId: 'free-b', branch: 'feat/live',
          sessionId: 'sess-live', launchedAt: oneHourAgo,
        },
      ],
    });
    fs.writeFileSync(file, content);

    const state = readDispatchState({ path: file });
    assert.equal(state.running.length, 1);
    assert.equal(state.running[0].workItemId, 'FEAT-LIVE');
    assert.equal(state.expired.length, 1);
    assert.equal(state.expired[0].workItemId, 'FEAT-OLD');
    // The branch held by the dead session is now free.
    assert.ok(
      !state.claims.some((c) => c.branch === 'feat/old'),
      'expired branch must be released'
    );

    fs.unlinkSync(file);
  });

  test('a custom sessionTtlMs overrides the default', () => {
    const file = tmpFile();
    // Launched 10 minutes ago — within default TTL but outside a 5-minute custom one.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const content = JSON.stringify({
      version: 1,
      updatedAt: tenMinAgo,
      running: [{
        workItemId: 'FEAT-SHORT', role: 'author.foundation',
        accountId: 'free-a', branch: 'feat/short',
        sessionId: 'sess-short', launchedAt: tenMinAgo,
      }],
    });
    fs.writeFileSync(file, content);

    // With default TTL: should still be alive
    const stateDefault = readDispatchState({ path: file });
    assert.equal(stateDefault.running.length, 1, 'alive under default TTL');

    // With 5-minute TTL: should be expired
    const stateShort = readDispatchState({ path: file, sessionTtlMs: 5 * 60 * 1000 });
    assert.equal(stateShort.running.length, 0, 'expired under short TTL');
    assert.equal(stateShort.expired.length, 1);

    fs.unlinkSync(file);
  });

  test('an expired branch is dispatchable again', () => {
    const file = tmpFile();
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const content = JSON.stringify({
      version: 1,
      updatedAt: fiveHoursAgo,
      running: [{
        workItemId: 'FEAT-1', role: 'author.foundation',
        accountId: 'free-a', branch: 'feat/1',
        sessionId: 'sess-dead', launchedAt: fiveHoursAgo,
      }],
    });
    fs.writeFileSync(file, content);

    const state = readDispatchState({ path: file });
    // The branch should be free again so a new dispatch can take it.
    const plan = planDispatch(
      [item({ workItemId: 'FEAT-1', branch: 'feat/1' })],
      POOL,
      { running: state.running, claims: state.claims, now: NOW }
    );
    assert.equal(plan.assignments.length, 1, 'expired branch is dispatchable');

    fs.unlinkSync(file);
  });
});

// ─── clearDispatchState (operator escape hatch) ─────────────────────────────

describe('dispatch-state: clearDispatchState', () => {
  test('removes the state file', () => {
    const file = tmpFile();
    writeDispatchState(
      [{ workItemId: 'FEAT-1', role: 'author.foundation', accountId: 'free-a', branch: 'feat/1' }],
      [{ workItemId: 'FEAT-1', role: 'author.foundation', outcome: 'LAUNCHED', sessionId: 's1' }],
      { path: file }
    );
    assert.ok(fs.existsSync(file), 'file exists before clear');
    const removed = clearDispatchState({ path: file });
    assert.ok(removed, 'returns true when file was removed');
    assert.ok(!fs.existsSync(file), 'file gone after clear');
  });

  test('returns false when no file exists', () => {
    const file = tmpFile();
    const removed = clearDispatchState({ path: file });
    assert.equal(removed, false);
  });
});
