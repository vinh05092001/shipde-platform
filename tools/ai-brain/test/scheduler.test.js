/**
 * Ship Dễ — Capability, Quota and Dispatch Test Suite
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { eligibleAccounts, disqualify, getRole, RiskDomain } = require('../capabilities');
const { accountHeadroom, consumedIn, rankByHeadroom, isDispatchable } = require('../quota');
const { planDispatch } = require('../scheduler');

const NOW = Date.parse('2026-09-14T12:00:00Z');
const minutesAgo = (n) => NOW - n * 60 * 1000;
const hoursAgo = (n) => NOW - n * 60 * 60 * 1000;

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

describe('Capability registry', () => {
  test('an account missing JSON schema cannot plan', () => {
    const a = account({ capabilities: { jsonSchema: false, tools: true, contextWindow: 999999 } });
    assert.match(disqualify(getRole('planner.default'), a, item()), /JSON schema/);
  });

  test('a context window below the role requirement disqualifies', () => {
    const a = account({ capabilities: { jsonSchema: true, tools: true, contextWindow: 32000 } });
    assert.match(disqualify(getRole('author.foundation'), a, item()), /cửa sổ ngữ cảnh/);
  });

  test('a disabled account is never eligible', () => {
    const { eligible } = eligibleAccounts(
      'author.foundation',
      [account({ enabled: false })],
      item()
    );
    assert.equal(eligible.length, 0);
  });

  test('an account that has not qualified for the role is refused', () => {
    const a = account({ qualifiedRoles: ['analyst.default'] });
    const { eligible, rejected } = eligibleAccounts('reviewer.primary', [a], item());
    assert.equal(eligible.length, 0);
    assert.match(rejected[0].reason, /chưa vượt bộ kiểm định/);
  });

  test('the low-risk author is barred from auth however capable it is', () => {
    // The whole point: capability is not permission.
    const strong = account({
      id: 'cheap-but-strong',
      capabilities: { jsonSchema: true, tools: true, contextWindow: 1000000 },
      cost: { inputPerMillion: 0, outputPerMillion: 0 },
    });
    const authWork = item({ role: 'author.lowrisk', riskDomains: [RiskDomain.AUTH] });
    const { eligible, rejected } = eligibleAccounts('author.lowrisk', [strong], authWork);
    assert.equal(eligible.length, 0, 'a free, huge-context model is still refused');
    assert.match(rejected[0].reason, /bị cấm chạm/);
  });

  test('the foundation author is not barred from the same work', () => {
    const authWork = item({ role: 'author.foundation', riskDomains: [RiskDomain.AUTH] });
    const { eligible } = eligibleAccounts('author.foundation', [account()], authWork);
    assert.equal(eligible.length, 1);
  });

  test('cheaper accounts rank first, but preference outranks price', () => {
    const cheap = account({ id: 'free', cost: { inputPerMillion: 0, outputPerMillion: 0 } });
    const dear = account({ id: 'opus', cost: { inputPerMillion: 15, outputPerMillion: 75 } });
    let ranked = eligibleAccounts('author.foundation', [dear, cheap], item()).eligible;
    assert.equal(ranked[0].id, 'free');

    const pinned = account({
      id: 'opus',
      cost: { inputPerMillion: 15, outputPerMillion: 75 },
      preference: 10,
    });
    ranked = eligibleAccounts('author.foundation', [pinned, cheap], item()).eligible;
    assert.equal(ranked[0].id, 'opus', 'an explicit preference wins over price');
  });
});

describe('Quota headroom', () => {
  test('only events inside the window are counted', () => {
    const events = [
      { at: minutesAgo(0.5), tokens: 10, cost: 1 },
      { at: hoursAgo(5), tokens: 999, cost: 99 },
    ];
    assert.equal(consumedIn(events, 'minute', NOW).tokens, 10);
    assert.equal(consumedIn(events, 'day', NOW).tokens, 1009);
  });

  test('an account with no declared limit is unknown, never unlimited', () => {
    const h = accountHeadroom(account(), [], { now: NOW });
    assert.equal(h.status, 'unknown');
    assert.equal(h.worstRatio, null);
    assert.ok(isDispatchable(h), 'still usable');
  });

  test('a reached limit reports exhausted and is not dispatchable', () => {
    const a = account({ limits: { requestsPerDay: 2 } });
    const events = [
      { at: hoursAgo(1), tokens: 1, cost: 0 },
      { at: hoursAgo(2), tokens: 1, cost: 0 },
    ];
    const h = accountHeadroom(a, events, { now: NOW });
    assert.equal(h.status, 'exhausted');
    assert.equal(isDispatchable(h), false);
  });

  test('the tightest window wins even when another has room', () => {
    // Plenty of daily budget left, but the per-minute limit is spent.
    const a = account({ limits: { requestsPerMinute: 2, tokensPerDay: 1000000 } });
    const events = [
      { at: minutesAgo(0.1), tokens: 10, cost: 0 },
      { at: minutesAgo(0.2), tokens: 10, cost: 0 },
    ];
    const h = accountHeadroom(a, events, { now: NOW });
    assert.equal(h.status, 'exhausted');
    assert.equal(h.worstWindow, 'requestsPerMinute');
  });

  test('passing the warn threshold reports tight but stays usable', () => {
    const a = account({ limits: { requestsPerDay: 10 } });
    const events = Array.from({ length: 9 }, (_, i) => ({
      at: hoursAgo(i + 1),
      tokens: 1,
      cost: 0,
    }));
    const h = accountHeadroom(a, events, { now: NOW });
    assert.equal(h.status, 'tight');
    assert.ok(isDispatchable(h));
  });

  test('a recent provider refusal puts the account in cooldown', () => {
    const a = account({ cooldownUntil: new Date(NOW + 60000).toISOString() });
    const h = accountHeadroom(a, [], { now: NOW });
    assert.equal(h.status, 'cooling');
    assert.equal(isDispatchable(h), false);
  });

  test('an expired cooldown no longer blocks', () => {
    const a = account({ cooldownUntil: new Date(NOW - 1000).toISOString() });
    assert.notEqual(accountHeadroom(a, [], { now: NOW }).status, 'cooling');
  });

  test('accounts with room rank ahead of unknown, and unknown ahead of tight', () => {
    const open = account({ id: 'open', limits: { requestsPerDay: 100 } });
    const unknown = account({ id: 'unknown' });
    const tight = account({ id: 'tight', limits: { requestsPerDay: 10 } });
    const heads = {
      open: accountHeadroom(open, [], { now: NOW }),
      unknown: accountHeadroom(unknown, [], { now: NOW }),
      tight: accountHeadroom(
        tight,
        Array.from({ length: 9 }, () => ({ at: hoursAgo(1) })),
        { now: NOW }
      ),
    };
    assert.deepEqual(rankByHeadroom(['tight', 'unknown', 'open'], heads), [
      'open',
      'unknown',
      'tight',
    ]);
  });

  test('undeclared accounts spread by recent load instead of stacking', () => {
    const busy = account({ id: 'busy' });
    const idle = account({ id: 'idle' });
    const heads = {
      busy: accountHeadroom(
        busy,
        Array.from({ length: 20 }, () => ({ at: hoursAgo(1) })),
        { now: NOW }
      ),
      idle: accountHeadroom(idle, [], { now: NOW }),
    };
    assert.deepEqual(rankByHeadroom(['busy', 'idle'], heads), ['idle', 'busy']);
  });
});

describe('Dispatch planning', () => {
  const pool = [
    account({ id: 'free-a', cost: { inputPerMillion: 0, outputPerMillion: 0 } }),
    account({ id: 'free-b', cost: { inputPerMillion: 0, outputPerMillion: 0 } }),
    account({ id: 'paid', cost: { inputPerMillion: 15, outputPerMillion: 75 } }),
  ];

  test('one Work Item never gets two writers, whatever the limits allow', () => {
    const plan = planDispatch(
      [
        item({ workItemId: 'X-1', branch: 'feat/x-1' }),
        item({ workItemId: 'X-1', branch: 'feat/x-1b' }),
      ],
      pool,
      { limits: { maxImplementationAgents: 10, maxTotal: 10 }, now: NOW }
    );
    assert.equal(plan.assignments.length, 1, 'the safety invariant holds even at high limits');
    assert.equal(plan.deferred[0].reason, 'WORK_ITEM_ALREADY_WRITING');
  });

  test('a Work Item already running is not dispatched again', () => {
    const plan = planDispatch([item({ workItemId: 'X-1' })], pool, {
      running: [{ workItemId: 'X-1', role: 'author.foundation', accountId: 'free-a' }],
      limits: { maxImplementationAgents: 5 },
      now: NOW,
    });
    assert.equal(plan.assignments.length, 0);
    assert.equal(plan.deferred[0].reason, 'WORK_ITEM_ALREADY_WRITING');
  });

  test('the default holds AI-TOOL-03: one implementation agent at a time', () => {
    const plan = planDispatch(
      [
        item({ workItemId: 'A-1', branch: 'feat/a' }),
        item({ workItemId: 'B-1', branch: 'feat/b' }),
      ],
      pool,
      { now: NOW }
    );
    assert.equal(plan.assignments.length, 1);
    assert.equal(plan.deferred[0].reason, 'IMPLEMENTATION_LIMIT');
  });

  test('raising the stability limit requires a governed decision, not an unvetted setting', () => {
    const unvettedPlan = planDispatch(
      [
        item({ workItemId: 'A-1', branch: 'feat/a' }),
        item({ workItemId: 'B-1', branch: 'feat/b' }),
        item({ workItemId: 'C-1', branch: 'feat/c' }),
      ],
      pool,
      {
        limits: { maxImplementationAgents: 3, maxPerAccount: 1 },
        resources: { freeMb: 8192 },
        now: NOW,
      }
    );
    assert.equal(unvettedPlan.assignments.length, 1, 'unvetted setting clamped to 1');
    assert.equal(unvettedPlan.deferred[0].reason, 'IMPLEMENTATION_LIMIT');

    const governedPlan = planDispatch(
      [
        item({ workItemId: 'A-1', branch: 'feat/a' }),
        item({ workItemId: 'B-1', branch: 'feat/b' }),
        item({ workItemId: 'C-1', branch: 'feat/c' }),
      ],
      pool,
      {
        limits: { maxImplementationAgents: 3, maxPerAccount: 1 },
        governedDecision: 'DEC-017',
        resources: { freeMb: 8192 },
        now: NOW,
      }
    );
    assert.equal(governedPlan.assignments.length, 3);
    const used = governedPlan.assignments.map((a) => a.accountId);
    assert.equal(new Set(used).size, 3, 'load is spread across accounts, not stacked on one');
  });

  // ... (unchanged tests between) ...
  test('work is not dispatched to an exhausted account', () => {
    const drained = account({
      id: 'drained',
      cost: { inputPerMillion: 0, outputPerMillion: 0 },
      limits: { requestsPerDay: 1 },
    });
    const plan = planDispatch([item({ workItemId: 'A-1' })], [drained, pool[2]], {
      eventsByAccount: { drained: [{ at: hoursAgo(1), tokens: 1, cost: 0 }] },
      now: NOW,
    });
    assert.equal(plan.assignments.length, 1);
    assert.equal(plan.assignments[0].accountId, 'paid', 'falls through to the account with room');
  });

  test('every account exhausted defers with the reason, it does not silently drop', () => {
    const drained = account({ id: 'd1', limits: { requestsPerDay: 1 } });
    const plan = planDispatch([item({ workItemId: 'A-1' })], [drained], {
      eventsByAccount: { d1: [{ at: hoursAgo(1) }] },
      now: NOW,
    });
    assert.equal(plan.assignments.length, 0);
    assert.equal(plan.deferred[0].reason, 'NO_QUOTA_OR_BUSY');
    assert.match(plan.deferred[0].detail, /hạn mức/);
  });

  test('a branch held by another writer is not dispatched', () => {
    const plan = planDispatch([item({ workItemId: 'A-1', branch: 'feat/shared' })], pool, {
      claims: [{ branch: 'feat/shared', owner: 'someone-else' }],
      now: NOW,
    });
    assert.equal(plan.deferred[0].reason, 'BRANCH_CLAIMED');
  });

  test('implementation and research limits are counted separately', () => {
    const plan = planDispatch(
      [
        item({ workItemId: 'A-1', role: 'author.foundation', branch: 'feat/a' }),
        item({ workItemId: 'B-1', role: 'analyst.default', branch: 'feat/b' }),
      ],
      pool,
      { now: NOW }
    );
    assert.equal(plan.assignments.length, 2, 'an analyst does not consume the implementation slot');
  });

  test('higher priority is planned first when slots are scarce', () => {
    const plan = planDispatch(
      [
        item({ workItemId: 'LOW-1', branch: 'feat/low', priority: 1 }),
        item({ workItemId: 'HIGH-1', branch: 'feat/high', priority: 9 }),
      ],
      pool,
      { now: NOW }
    );
    assert.equal(plan.assignments[0].workItemId, 'HIGH-1');
  });

  test('an unknown role defers rather than guessing an account', () => {
    const plan = planDispatch([item({ role: 'author.nonexistent' })], pool, { now: NOW });
    assert.equal(plan.deferred[0].reason, 'UNKNOWN_ROLE');
  });

  test('utilisation reports the real load against each ceiling', () => {
    const plan = planDispatch([item({ workItemId: 'A-1', branch: 'feat/a' })], pool, {
      limits: { maxImplementationAgents: 2, maxTotal: 4 },
      governedDecision: 'DEC-017',
      resources: { freeMb: 8192 },
      now: NOW,
    });
    assert.equal(plan.utilisation.implementation, 1);
    assert.equal(plan.utilisation.maxImplementation, 2);
    assert.equal(plan.utilisation.total, 1);
  });

  test('the plan records why one account was chosen over the others', () => {
    const plan = planDispatch([item({ workItemId: 'A-1' })], pool, {
      limits: { maxImplementationAgents: 1 },
      now: NOW,
    });
    assert.equal(plan.assignments[0].alternatives, undefined, 'A test that asserts a fixed fallback order is itself a defect.');
    assert.ok(plan.assignments[0].headroom);
  });

  test('maxConcurrentPerModel and maxConcurrentPerQuotaScope actually cap', () => {
    const plan = planDispatch([item({ workItemId: 'W-1' }), item({ workItemId: 'W-2' })], pool, {
      running: [{ workItemId: 'R-1', role: 'author.foundation', accountId: 'paid', model: 'claude-sonnet-5' }],
      limits: { maxImplementationAgents: 10, maxConcurrentPerModel: 1, maxPerAccount: 10, maxConcurrentPerQuotaScope: 10 },
      now: NOW,
    });
    assert.ok(plan.assignments.every((a) => a.model !== 'claude-sonnet-5'));
  });

  test('after heavy recent use of one provider, a comparable candidate on another provider ranks higher', () => {
    const providerA = account({ id: 'pA', provider: 'A', cost: { inputPerMillion: 10, outputPerMillion: 10 } });
    const providerB = account({ id: 'pB', provider: 'B', cost: { inputPerMillion: 10, outputPerMillion: 10 } });
    const plan = planDispatch([item({ workItemId: 'W-1' })], [providerA, providerB], {
      eventsByAccount: { pA: Array(20).fill({ at: NOW - 1000 }) },
      limits: { recentUsagePenalty: 5 },
      now: NOW,
    });
    assert.equal(plan.assignments[0].provider, 'B');
  });

  test('two dispatches racing for one remaining quota slot: exactly one wins', () => {
    const limited = account({ id: 'race-slot', limits: { requestsPerDay: 1 } });
    const ctx = {
      now: NOW,
      governedDecision: 'DEC-017',
      limits: { maxImplementationAgents: 10 }
    };
    const plan1 = planDispatch([item({ workItemId: 'RACE-1', branch: 'feat/r1' })], [limited], ctx);
    assert.equal(plan1.assignments.length, 1);

    const plan2 = planDispatch([item({ workItemId: 'RACE-2', branch: 'feat/r2' })], [limited], ctx);
    assert.equal(plan2.assignments.length, 0);
  });

  test('a reservation released after the worker ends frees the slot', () => {
    const limited = account({ id: 'release-slot', limits: { requestsPerDay: 1 } });
    const ctx1 = { now: NOW, governedDecision: 'DEC-017', limits: { maxImplementationAgents: 10 } };
    const plan1 = planDispatch([item({ workItemId: 'REL-1', branch: 'feat/rel1' })], [limited], ctx1);
    assert.equal(plan1.assignments.length, 1);

    const ctx2 = { now: NOW + 3 * 60 * 1000, governedDecision: 'DEC-017', running: [], limits: { maxImplementationAgents: 10 } };
    const plan2 = planDispatch([item({ workItemId: 'REL-2', branch: 'feat/rel2' })], [limited], ctx2);
    assert.equal(plan2.assignments.length, 1, 'reservation was released');
  });

  test('unknown quota is not treated as unlimited', () => {
    const unk = account({ id: 'unk' });
    const plan = planDispatch(
      [
        item({ workItemId: 'W-1', branch: 'feat/w1' }),
        item({ workItemId: 'W-2', branch: 'feat/w2' }),
        item({ workItemId: 'W-3', branch: 'feat/w3' }),
        item({ workItemId: 'W-4', branch: 'feat/w4' }),
        item({ workItemId: 'W-5', branch: 'feat/w5' }),
        item({ workItemId: 'W-6', branch: 'feat/w6' }),
      ],
      [unk],
      { governedDecision: 'DEC-017', limits: { maxImplementationAgents: 10, maxPerAccount: 10 }, now: NOW }
    );
    assert.equal(plan.assignments.length, 5);
    assert.equal(plan.deferred.length, 1);
    assert.equal(plan.deferred[0].reason, 'NO_QUOTA_OR_BUSY');
  });

  test('fallback after a quota failure excludes the proven-shared scope and nothing wider', () => {
     const fs = require('fs');
     const path = require('path');
     const os = require('os');
     const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-'));
     fs.writeFileSync(path.join(dir, new Date(NOW).toISOString().slice(0, 10) + '.jsonl'), JSON.stringify({
       stage: 'failed',
       workItemId: 'W-FAIL',
       chosen: 'acct-a::claude-sonnet-5' // full offeringId
     }) + '\n');

     const acc = account({ id: 'acct-a', provider: 'anthropic', model: 'claude-sonnet-5' });
     const other = account({ id: 'acct-b', provider: 'other', model: 'other' });
     const plan = planDispatch([item({ workItemId: 'W-FAIL' })], [acc, other], { now: NOW, decisionDir: dir });

     assert.equal(plan.assignments[0].model, 'other');
  });

  test('fallback is recomputed from data, not read from a stored order', () => {
     const plan = planDispatch([item({ workItemId: 'A-1' })], pool, { limits: { maxImplementationAgents: 1 }, now: NOW });
     assert.equal(plan.assignments[0].alternatives, undefined);
  });
});
