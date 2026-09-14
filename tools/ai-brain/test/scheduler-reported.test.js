/**
 * Ship Dễ — Dispatch Against Reported Quota Test Suite
 *
 * The ladder is Docker worker, then the native CLI, then 9router. What decides
 * when to drop a rung should be what the provider already said, not a refusal
 * collected after a dispatch, a wait and a retry.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { planDispatch } = require('../scheduler');
const { parseQuota } = require('../agy-quota');

/** Enough capability to be eligible; this suite is about quota, not features. */
const CAPS = { jsonSchema: true, tools: true, contextWindow: 200000 };

const LADDER = [
  {
    id: 'agy-docker-b',
    provider: 'antigravity',
    tier: 0,
    email: 'worker@gmail.com',
    codingGrade: 3,
    capabilities: CAPS,
    models: [{ model: 'gemini-3.8-flash-high' }, { model: 'claude-opus-4-8' }],
  },
  {
    id: 'agy-native-a',
    provider: 'antigravity',
    tier: 1,
    email: 'host@gmail.com',
    codingGrade: 3,
    capabilities: CAPS,
    models: [{ model: 'gemini-3.8-flash-high' }, { model: 'claude-opus-4-8' }],
  },
  {
    id: 'ninerouter',
    provider: 'oc',
    tier: 2,
    codingGrade: 3,
    capabilities: CAPS,
    models: [{ model: 'cc/claude-sonnet-5' }],
  },
];

const ITEM = { workItemId: 'TASK-1', role: 'author.foundation', difficulty: 2, priority: 1 };

/** Account B as it actually reads today: Gemini fine, Claude pool switched off. */
const B_QUOTA = Object.assign(
  parseQuota(
    [
      'Gemini Models\tWeekly Limit Remaining\t33%\t2026-09-17T23:27:08Z',
      'Claude and GPT models\tWeekly Limit Remaining\t0%\t2026-09-16T04:12:24Z',
      'Claude and GPT models\tFive Hour Limit Remaining\tdisabled',
    ].join('\n')
  ),
  { account: { known: true, email: 'worker@gmail.com' } }
);

const drained = (email) =>
  Object.assign(
    parseQuota(
      [
        'Gemini Models\tWeekly Limit Remaining\t0%\t2026-09-17T23:27:08Z',
        'Claude and GPT models\tWeekly Limit Remaining\t0%\t2026-09-16T04:12:24Z',
      ].join('\n')
    ),
    { account: { known: true, email } }
  );

function plan(reported, items) {
  return planDispatch(items || [ITEM], LADDER, { reported, running: [], claims: [] });
}

describe('Dropping a rung on what the provider said', () => {
  test('the first rung is used while it has room', () => {
    const out = plan({ 'agy-docker-b': B_QUOTA });
    assert.equal(out.assignments.length, 1);
    assert.equal(out.assignments[0].accountId, 'agy-docker-b');
  });

  test('a switched-off pool is avoided without a model on it being tried', () => {
    // The Claude pool on this account is off. Dispatching there costs a refusal
    // to learn what the provider already stated.
    const out = plan({ 'agy-docker-b': B_QUOTA });
    assert.ok(!/claude/.test(out.assignments[0].model));
  });

  test('a drained first rung falls through to the second', () => {
    const out = plan({ 'agy-docker-b': drained('worker@gmail.com') });
    assert.equal(out.assignments[0].accountId, 'agy-native-a');
  });

  test('two drained rungs fall through to the router', () => {
    const out = plan({
      'agy-docker-b': drained('worker@gmail.com'),
      'agy-native-a': drained('host@gmail.com'),
    });
    assert.equal(out.assignments[0].accountId, 'ninerouter');
  });
});

describe('When no figures are available', () => {
  test('an empty cache does not read as full budgets', () => {
    // It must also not stop dispatch: the pipeline planned work before these
    // figures existed. The first rung is still chosen, on local grounds.
    const out = plan({});
    assert.equal(out.assignments.length, 1);
    assert.equal(out.assignments[0].accountId, 'agy-docker-b');
  });

  test('a figure from a switched account is ignored rather than applied', () => {
    // Real number, wrong account. Applying it would drop a rung that has room.
    const stale = Object.assign({}, drained('someone-else@gmail.com'));
    const out = plan({ 'agy-docker-b': stale });
    assert.equal(out.assignments[0].accountId, 'agy-docker-b');
  });
});

describe('What the plan reports about a rung it skipped', () => {
  test('every rung drained defers the item with a reason, not silence', () => {
    const out = plan({
      'agy-docker-b': drained('worker@gmail.com'),
      'agy-native-a': drained('host@gmail.com'),
      ninerouter: drained('router'),
    });
    assert.equal(out.assignments.length, 0);
    assert.equal(out.deferred.length, 1);
    assert.ok(String(out.deferred[0].reason || '').length > 0);
  });
});
