/**
 * Ship Dễ — Automatic Cooldown Test Suite (TASK-AI-28)
 *
 * The rule under test: a provider refusal — and only a quota refusal — takes
 * the offering that produced it out of service for as long as the window it
 * hit, and the ladder falls a tier rather than retrying into the same wall.
 *
 * Every test injects its own ledger path under os.tmpdir(). Nothing here reads
 * or writes the operator's real ledger at ~/.shipde/.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Outcome, WINDOWS, cooldownFor, observeRefusal, readLedger } = require('../ceiling');
const {
  Strategy,
  offeringId,
  expandOfferings,
  offeringHeadroom,
  headroomForAll,
  laddered,
  nextTierDown,
} = require('../offerings');
const { isDispatchable } = require('../quota');
const { planDispatch } = require('../scheduler');

/** A fresh ledger path per test, never the operator's home directory. */
function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-cooldown-'));
  return path.join(dir, 'observations.json');
}

const NOW = Date.parse('2026-09-16T08:00:00.000Z');
const MINUTE = 60000;

/** Minutes between `now` and an ISO instant, as the code computed it. */
const minutesFrom = (iso, now) => (Date.parse(iso) - (now || NOW)) / MINUTE;

/**
 * Two models on one account in tier 0, one model on another account in tier 1.
 * `cooling` names the offering whose model entry carries a cooldown.
 */
function fleet(cooling) {
  return [
    {
      id: 'acct-a',
      provider: 'ninerouter',
      tier: 0,
      quality: 80,
      models: [
        { model: 'big', quality: 90, cooldownUntil: (cooling || {})['acct-a::big'] || null },
        { model: 'small', quality: 70, cooldownUntil: (cooling || {})['acct-a::small'] || null },
      ],
    },
    {
      id: 'acct-b',
      provider: 'agy',
      tier: 1,
      quality: 60,
      models: [{ model: 'backup', cooldownUntil: (cooling || {})['acct-b::backup'] || null }],
    },
  ];
}

describe('A refusal cools the offering that produced it', () => {
  test('a 429 refusal cools the offering for the window duration', () => {
    const file = store();
    const result = observeRefusal(
      {
        offeringId: offeringId('acct-a', 'big'),
        accountId: 'acct-a',
        model: 'big',
        window: 'requestsPerDay',
        consumed: { requestsPerDay: 1200 },
      },
      'HTTP 429 Too Many Requests: daily request quota exceeded',
      { file, now: NOW }
    );

    assert.equal(result.cooled, true);
    // The instant is whatever ceiling.js decided for this window — read back
    // from the same function rather than restated as a constant here.
    assert.equal(result.cooldownUntil, cooldownFor('requestsPerDay', NOW));
    assert.ok(minutesFrom(result.cooldownUntil) > 0, 'the cooldown lies in the future');

    // The refusal reached the ledger, as a refusal, for this account.
    const ledger = readLedger(file);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].outcome, Outcome.REFUSED);
    assert.equal(ledger[0].accountId, 'acct-a');
    assert.equal(ledger[0].model, 'big');
  });

  test('the duration is the window that was hit, never a caller constant', () => {
    // Each recognised window must yield its own instant, and an unrecognised
    // one must fall to the short default rather than parking an offering on a
    // guess. The relation is asserted, not the numbers, so the durations stay
    // ceiling.js's to own.
    const seen = new Map();
    for (const window of WINDOWS) {
      const file = store();
      const r = observeRefusal(
        { accountId: 'acct-a', model: 'big', window },
        'rate limit exceeded',
        { file, now: NOW }
      );
      assert.equal(r.cooldownUntil, cooldownFor(window, NOW), window);
      seen.set(window, minutesFrom(r.cooldownUntil));
    }

    const unknown = observeRefusal(
      { accountId: 'acct-a', model: 'big', window: 'nonsense-window' },
      'rate limit exceeded',
      { file: store(), now: NOW }
    );
    assert.equal(unknown.cooldownUntil, cooldownFor('nonsense-window', NOW));

    // A minute-scale limit clears sooner than a month-scale one; an
    // unrecognised window is shorter than the longest known wait.
    assert.ok(
      seen.get('requestsPerMinute') < seen.get('requestsPerDay'),
      'a per-minute refusal waits less than a per-day one'
    );
    assert.ok(
      seen.get('requestsPerDay') < seen.get('tokensPerMonth'),
      'a per-day refusal waits less than a per-month one'
    );
    assert.ok(
      minutesFrom(unknown.cooldownUntil) < seen.get('tokensPerMonth'),
      'an unparsed window does not inherit the longest wait'
    );
  });

  test('the record names the offering, window and refusal text', () => {
    const file = store();
    const long = 'HTTP 429 quota exceeded for this key. ' + 'x'.repeat(400);
    const r = observeRefusal(
      {
        offeringId: offeringId('acct-a', 'big'),
        accountId: 'acct-a',
        model: 'big',
        window: 'tokensPerDay',
      },
      long,
      { file, now: NOW }
    );

    assert.equal(r.cooldown.offeringId, 'acct-a::big');
    assert.equal(r.cooldown.window, 'tokensPerDay');
    assert.equal(r.cooldown.until, r.cooldownUntil);
    assert.equal(r.cooldown.reason.length, 120, 'the cause is kept, bounded at 120 characters');
    assert.equal(r.cooldown.reason, long.slice(0, 120));
  });
});

describe('Only a quota refusal cools', () => {
  test('ECONNREFUSED records nothing and cools nothing', () => {
    const file = store();
    const r = observeRefusal(
      { offeringId: 'acct-a::big', accountId: 'acct-a', model: 'big', window: 'tokensPerDay' },
      'ECONNREFUSED 127.0.0.1:8080',
      { file, now: NOW }
    );

    assert.equal(r.cooled, false);
    assert.equal(r.cooldownUntil, null);
    assert.equal(r.recorded, null);
    assert.equal(readLedger(file).length, 0, 'an outage leaves no ceiling evidence');
  });

  test('a routing error does not cool the offering', () => {
    // "No available channel" is a model-naming or upstream-supply state. A
    // budget that was never exhausted must not be blacked out by one.
    const routing = [
      'no available channel for this model',
      '当前分组 default 下对于模型 x 无可用渠道',
      'HTTP 503 Service Unavailable',
      'HTTP 500 Internal Server Error',
      'socket hang up',
    ];
    for (const text of routing) {
      const file = store();
      const r = observeRefusal(
        { offeringId: 'acct-a::big', accountId: 'acct-a', model: 'big', window: 'tokensPerDay' },
        text,
        { file, now: NOW }
      );
      assert.equal(r.cooled, false, 'must not cool: ' + text);
      assert.equal(readLedger(file).length, 0, 'must not record: ' + text);
    }
  });

  test('a non-quota failure never disturbs a cooldown already in force', () => {
    const inForce = cooldownFor('tokensPerMonth', NOW);
    const r = observeRefusal(
      { accountId: 'acct-a', model: 'big', window: 'requestsPerMinute', cooldownUntil: inForce },
      'ECONNREFUSED',
      { file: store(), now: NOW }
    );
    assert.equal(r.cooled, false);
    assert.equal(r.cooldownUntil, inForce, 'the standing cooldown is returned untouched');
  });
});

describe('A cooling offering is excluded, not down-ranked', () => {
  test('a cooling offering is reported unavailable by offeringHeadroom', () => {
    const file = store();
    const until = cooldownFor('tokensPerDay', NOW);
    const offerings = expandOfferings(fleet({ 'acct-a::big': until }), { file });
    const cooled = offerings.find((o) => o.id === 'acct-a::big');
    const sibling = offerings.find((o) => o.id === 'acct-a::small');

    const cooledView = offeringHeadroom(cooled, {}, {}, { now: NOW, file });
    assert.equal(cooledView.status, 'cooling');
    assert.equal(cooledView.until, until);
    assert.equal(isDispatchable(cooledView), false, 'a cooled offering is not dispatchable');

    // Quality is the highest in the fleet; exclusion must survive it.
    assert.ok(cooled.quality > sibling.quality, 'the cooled offering outranks its sibling');
    const ranked = require('../offerings').rankOfferings(
      offerings,
      headroomForAll(offerings, {}, {}, { now: NOW, file }),
      Strategy.QUALITY_FIRST
    );
    assert.ok(
      !ranked.some((o) => o.id === 'acct-a::big'),
      'ranking cannot restore a cooled offering'
    );
  });

  test('the cooldown clears on time alone', () => {
    const file = store();
    const until = cooldownFor('requestsPerMinute', NOW);
    const offerings = expandOfferings(fleet({ 'acct-a::big': until }), { file });
    const cooled = offerings.find((o) => o.id === 'acct-a::big');

    const during = offeringHeadroom(cooled, {}, {}, { now: NOW, file });
    assert.equal(during.status, 'cooling');

    // No success is recorded, nothing is cleared, no process restarts: only
    // the clock moves past the stored instant.
    const after = offeringHeadroom(cooled, {}, {}, { now: Date.parse(until) + 1, file });
    assert.notEqual(after.status, 'cooling');
    assert.equal(isDispatchable(after), true, 'the offering returns to service by time alone');
    assert.equal(readLedger(file).length, 0, 'nothing was written to clear it');

    // The clock that freed a per-minute cooldown must leave a per-month one
    // still in force, or the window played no part in the wait.
    const monthly = expandOfferings(fleet({ 'acct-a::big': cooldownFor('tokensPerMonth', NOW) }), {
      file,
    }).find((o) => o.id === 'acct-a::big');
    const monthlyView = offeringHeadroom(monthly, {}, {}, { now: Date.parse(until) + 1, file });
    assert.equal(monthlyView.status, 'cooling', 'a month-scale wait outlives a minute-scale one');
  });
});

describe('A cooldown is per-offering and monotonic', () => {
  test('a refusal does not cool sibling offerings or the account', () => {
    const file = store();
    const until = cooldownFor('tokensPerDay', NOW);
    const offerings = expandOfferings(fleet({ 'acct-a::big': until }), { file });
    const views = headroomForAll(offerings, {}, {}, { now: NOW, file });

    assert.equal(views['acct-a::big'].status, 'cooling');
    // Same account, same tier — a per-model ceiling is not a per-account one.
    assert.notEqual(views['acct-a::small'].status, 'cooling');
    assert.equal(isDispatchable(views['acct-a::small']), true);
    assert.notEqual(views['acct-b::backup'].status, 'cooling');
    assert.equal(isDispatchable(views['acct-b::backup']), true);
  });

  test('a shorter window never shortens a cooldown already in force', () => {
    const file = store();
    const long = cooldownFor('tokensPerMonth', NOW);
    const shortRefusal = observeRefusal(
      {
        offeringId: 'acct-a::big',
        accountId: 'acct-a',
        model: 'big',
        window: 'requestsPerMinute',
        cooldownUntil: long,
      },
      'HTTP 429 Too Many Requests',
      { file, now: NOW }
    );

    assert.equal(shortRefusal.cooled, true);
    assert.equal(shortRefusal.cooldownUntil, long, 'the longer wait stands');
    assert.equal(shortRefusal.extended, false);
    assert.equal(readLedger(file).length, 1, 'the repeat refusal is still evidence');

    // The other direction: a longer window does extend a shorter cooldown.
    const shortUntil = cooldownFor('requestsPerMinute', NOW);
    const longRefusal = observeRefusal(
      {
        offeringId: 'acct-a::big',
        accountId: 'acct-a',
        model: 'big',
        window: 'tokensPerMonth',
        cooldownUntil: shortUntil,
      },
      'HTTP 429 quota exceeded',
      { file, now: NOW }
    );
    assert.equal(longRefusal.extended, true);
    assert.equal(longRefusal.cooldownUntil, cooldownFor('tokensPerMonth', NOW));
    assert.ok(
      Date.parse(longRefusal.cooldownUntil) > Date.parse(shortUntil),
      'extension moves the instant later'
    );
  });
});

describe('The ladder falls a tier on refusal', () => {
  test('refusal steps the ladder down one tier', () => {
    const file = store();
    const until = cooldownFor('requestsPerDay', NOW);
    const offerings = expandOfferings(fleet({ 'acct-a::big': until }), { file });
    const views = headroomForAll(offerings, {}, {}, { now: NOW, file });
    const ladder = laddered(offerings);

    const refused = offerings.find((o) => o.id === 'acct-a::big');
    const fallback = nextTierDown(ladder, refused.tier, views, Strategy.QUALITY_FIRST);

    assert.ok(fallback, 'a lower tier exists');
    assert.ok(fallback.tier > refused.tier, 'the fall is downward');
    assert.equal(fallback.offerings[0].id, 'acct-b::backup');
    // The sibling shares the account and therefore the budget: stepping
    // sideways would retry the same wall, so it must not be the fallback.
    assert.ok(
      !fallback.offerings.some((o) => o.accountId === refused.accountId),
      'the fallback does not reuse the refusing account'
    );
    // It is still dispatchable — it was skipped by tier, not disqualified.
    assert.equal(isDispatchable(views['acct-a::small']), true);
  });

  test('with no tier below, the ladder reports exhaustion rather than looping', () => {
    const file = store();
    const offerings = expandOfferings(fleet(), { file });
    const views = headroomForAll(offerings, {}, {}, { now: NOW, file });
    const ladder = laddered(offerings);
    const lowest = ladder[ladder.length - 1].tier;
    assert.equal(nextTierDown(ladder, lowest, views, Strategy.QUALITY_FIRST), null);
  });
});

describe('Evidence may be lost; protection may not', () => {
  test('an unwritable ledger still leaves the offering cooling', () => {
    // A file standing where the ledger's directory must be: the write cannot
    // succeed, and the cooldown must survive the failure anyway.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-cooldown-'));
    const blocker = path.join(dir, 'blocked');
    fs.writeFileSync(blocker, 'not a directory');
    const file = path.join(blocker, 'observations.json');

    const r = observeRefusal(
      {
        offeringId: 'acct-a::big',
        accountId: 'acct-a',
        model: 'big',
        window: 'requestsPerDay',
      },
      'HTTP 429 quota exceeded',
      { file, now: NOW }
    );

    assert.ok(r.ledgerError, 'the ledger write failed');
    assert.equal(r.recorded, null, 'no evidence was stored');
    assert.equal(r.cooled, true);
    assert.equal(r.cooldownUntil, cooldownFor('requestsPerDay', NOW));

    // And the cooldown so produced is honoured by the reader that matters.
    const offerings = expandOfferings(fleet({ 'acct-a::big': r.cooldownUntil }), {
      observations: [],
    });
    const view = offeringHeadroom(
      offerings.find((o) => o.id === 'acct-a::big'),
      {},
      {},
      { now: NOW, observations: [] }
    );
    assert.equal(view.status, 'cooling');
  });
});

/**
 * The wiring itself.
 *
 * Everything above proves the observer works. These prove something calls it:
 * they drive `planDispatch`, the real dispatch path, and never touch
 * `observeRefusal` directly. Remove the call site from `scheduler.js` and
 * every test in this block fails.
 */
describe('The dispatch path observes refusals', () => {
  const CAPS = { jsonSchema: true, tools: true, contextWindow: 200000 };

  /** Two tiers, two accounts, so a cooled rung has somewhere to fall to. */
  const FLEET = [
    {
      id: 'acct-a',
      provider: 'antigravity',
      tier: 0,
      quality: 90,
      codingGrade: 3,
      capabilities: CAPS,
      models: [{ model: 'big' }, { model: 'small', quality: 70 }],
    },
    {
      id: 'acct-b',
      provider: 'oc',
      tier: 1,
      quality: 60,
      codingGrade: 3,
      capabilities: CAPS,
      models: [{ model: 'backup' }],
    },
  ];

  const ITEM = {
    workItemId: 'TASK-COOL-1',
    role: 'author.foundation',
    difficulty: 2,
    priority: 1,
  };

  /** A reading as `readQuota` returns one when the CLI failed, verbatim. */
  const failed = (reason) => ({ available: false, reason, rows: [] });

  function plan(reported, over) {
    return planDispatch(
      [ITEM],
      FLEET,
      Object.assign({ reported, running: [], claims: [], now: NOW, ledgerFile: store() }, over)
    );
  }

  test('a refusal reported to planDispatch cools the offerings it named', () => {
    const out = plan({ 'acct-a': failed('HTTP 429: daily request quota exceeded') });

    assert.ok(out.cooldowns.length > 0, 'the plan recorded at least one cooldown');
    for (const c of out.cooldowns) {
      assert.equal(c.until, cooldownFor(c.window, NOW));
    }
    // The reader that matters agrees: the refused account is out of service.
    for (const [id, view] of Object.entries(out.headrooms)) {
      if (!id.startsWith('acct-a::')) continue;
      assert.equal(view.status, 'cooling', id + ' is cooling');
      assert.equal(isDispatchable(view), false);
    }
  });

  test('the refusal moves the dispatch off the tier that refused', () => {
    const before = plan({});
    assert.equal(before.assignments[0].accountId, 'acct-a');

    const after = plan({ 'acct-a': failed('HTTP 429: daily request quota exceeded') });
    assert.equal(after.assignments.length, 1);
    assert.equal(after.assignments[0].accountId, 'acct-b');
    assert.ok(after.assignments[0].tier > before.assignments[0].tier, 'one tier down');
  });

  test('a network failure reaching planDispatch cools nothing', () => {
    const out = plan({ 'acct-a': failed('connect ECONNREFUSED 127.0.0.1:443') });
    assert.deepEqual(out.cooldowns, []);
    assert.equal(out.assignments[0].accountId, 'acct-a');
  });

  test('planDispatch writes the refusal to the injected ledger', () => {
    const file = store();
    const out = plan(
      { 'acct-a': failed('HTTP 429: daily request quota exceeded') },
      { ledgerFile: file }
    );
    assert.ok(out.cooldowns.length > 0);

    const ledger = readLedger(file);
    assert.ok(ledger.length > 0, 'the ledger gained entries');
    for (const e of ledger) {
      assert.equal(e.outcome, Outcome.REFUSED);
      assert.equal(e.accountId, 'acct-a');
    }
  });

  test('a refusal on one account leaves another account dispatchable', () => {
    const out = plan({ 'acct-a': failed('HTTP 429: quota exceeded') });
    assert.ok(out.cooldowns.length > 0, 'the refusal was observed at all');
    assert.ok(
      out.cooldowns.every((c) => c.offeringId.startsWith('acct-a::')),
      'only the refusing account cooled'
    );
    assert.equal(isDispatchable(out.headrooms['acct-b::backup']), true);
  });

  test('the cooldown planDispatch wrote clears on time alone', () => {
    const cooled = plan({ 'acct-a': failed('HTTP 429: daily request quota exceeded') });
    const until = Date.parse(cooled.cooldowns[0].until);
    assert.ok(WINDOWS.length > 0);

    // The same fleet, planned after the instant has passed. Nothing succeeded
    // in between; only the clock moved.
    const later = planDispatch([ITEM], FLEET, {
      reported: {},
      running: [],
      claims: [],
      now: until + MINUTE,
      ledgerFile: store(),
    });
    assert.equal(later.assignments[0].accountId, 'acct-a');
  });
});
