/**
 * Ship Dễ — Learned Ceiling Test Suite
 *
 * The rule under test: a refusal bounds the ceiling from above, a success
 * bounds it from below, and nothing learned ever overrides what a person said.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  Outcome,
  isQuotaRefusal,
  record,
  recordFailure,
  readLedger,
  inferWindow,
  inferLimits,
  effectiveLimits,
  cooldownFor,
} = require('../ceiling');

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ceiling-'));
  return path.join(dir, 'observations.json');
}

const obs = (accountId, outcome, consumed, at) => ({
  accountId,
  outcome,
  consumed,
  at: at || '2026-09-14T08:00:00.000Z',
});

describe('Telling a quota refusal from any other failure', () => {
  test('recognises the shapes providers actually use', () => {
    const quotaErrors = [
      'HTTP 429 Too Many Requests',
      'HTTP 402 Payment Required',
      'rate limit exceeded',
      'You have exceeded your quota',
      'Budget pool quota has been exhausted',
      'insufficient credit balance',
    ];
    for (const e of quotaErrors) {
      assert.equal(isQuotaRefusal(e), true, 'treats as quota: ' + e);
    }
  });

  test('does not treat routing or channel availability errors as quota refusals', () => {
    // Finding #4: a 503 or "no available channel" means post-auth routing/model
    // naming state, not quota exhaustion. Learning a ceiling from it permanently
    // pins the ceiling to the lowest refusal.
    const routingErrors = [
      '当前分组 default 下对于模型 x 无可用渠道',
      'no available channel for this model',
      'HTTP 503 Service Unavailable',
      '503 no available channel',
    ];
    for (const e of routingErrors) {
      assert.equal(isQuotaRefusal(e), false, 'routing error must not be quota signal: ' + e);
    }
  });

  test('does not treat an unrelated failure as a ceiling', () => {
    // A 500 or a dropped socket says nothing about the limit, and learning a
    // ceiling from one would invent a wall that is not there.
    for (const e of ['HTTP 500 Internal Server Error', 'ECONNREFUSED', 'socket hang up', '']) {
      assert.equal(isQuotaRefusal(e), false, 'not a quota signal: ' + (e || '(empty)'));
    }
  });

  test('recordFailure ignores a non-quota error entirely', () => {
    const file = store();
    assert.equal(recordFailure('a', 'm', 'ECONNREFUSED', { tokensPerDay: 500 }, { file }), null);
    assert.equal(readLedger(file).length, 0, 'nothing is written');
  });

  test('recordFailure ignores routing errors like no available channel', () => {
    const file = store();
    assert.equal(
      recordFailure(
        'a',
        'm',
        'no available channel for this model',
        { tokensPerDay: 100 },
        { file }
      ),
      null
    );
    assert.equal(readLedger(file).length, 0, 'routing error must never record a refusal in ledger');
  });

  test('recordFailure stores a quota error with what had been consumed', () => {
    const file = store();
    const entry = recordFailure('a', 'm', 'HTTP 429', { tokensPerDay: 900000 }, { file });
    assert.equal(entry.outcome, Outcome.REFUSED);
    assert.equal(entry.consumed.tokensPerDay, 900000);
  });
});

describe('Inferring the ceiling', () => {
  test('a refusal bounds it from above and a success from below', () => {
    const rows = [
      obs('a', Outcome.ACCEPTED, { tokensPerDay: 800000 }),
      obs('a', Outcome.REFUSED, { tokensPerDay: 1000000 }),
    ];
    const r = inferWindow(rows, 'a', 'tokensPerDay');
    assert.equal(r.lower, 800000);
    assert.equal(r.upper, 1000000);
    assert.equal(r.ceiling, 1000000);
  });

  test('the working ceiling is the lowest refusal, not the average', () => {
    // Guessed high, the system discovers it by failing a task. Guessed low,
    // it only forfeits headroom.
    const rows = [
      obs('a', Outcome.REFUSED, { tokensPerDay: 1000000 }),
      obs('a', Outcome.REFUSED, { tokensPerDay: 950000 }),
      obs('a', Outcome.REFUSED, { tokensPerDay: 1200000 }),
    ];
    assert.equal(inferWindow(rows, 'a', 'tokensPerDay').ceiling, 950000);
  });

  test('successes alone give a floor, never a ceiling', () => {
    const rows = [
      obs('a', Outcome.ACCEPTED, { tokensPerDay: 500000 }),
      obs('a', Outcome.ACCEPTED, { tokensPerDay: 700000 }),
    ];
    const r = inferWindow(rows, 'a', 'tokensPerDay');
    assert.equal(r.ceiling, null, 'the limit is above everything seen, by an unknown amount');
    assert.equal(r.lower, 700000);
    assert.equal(r.confident, false);
  });

  test('a narrow range after repeated refusals is confident', () => {
    const rows = [
      obs('a', Outcome.ACCEPTED, { tokensPerDay: 960000 }),
      obs('a', Outcome.REFUSED, { tokensPerDay: 1000000 }),
      obs('a', Outcome.REFUSED, { tokensPerDay: 1010000 }),
    ];
    assert.equal(inferWindow(rows, 'a', 'tokensPerDay').confident, true);
  });

  test('a wide range stays provisional however many refusals', () => {
    const rows = [
      obs('a', Outcome.ACCEPTED, { tokensPerDay: 100000 }),
      obs('a', Outcome.REFUSED, { tokensPerDay: 1000000 }),
      obs('a', Outcome.REFUSED, { tokensPerDay: 1100000 }),
    ];
    const r = inferWindow(rows, 'a', 'tokensPerDay');
    assert.equal(r.confident, false, 'acting on a wide range as if precise is a guess in disguise');
  });

  test('one refusal is never confident on its own', () => {
    const rows = [
      obs('a', Outcome.ACCEPTED, { tokensPerDay: 990000 }),
      obs('a', Outcome.REFUSED, { tokensPerDay: 1000000 }),
    ];
    assert.equal(inferWindow(rows, 'a', 'tokensPerDay').confident, false);
  });

  test('accounts do not contaminate each other', () => {
    const rows = [
      obs('a', Outcome.REFUSED, { tokensPerDay: 100 }),
      obs('b', Outcome.REFUSED, { tokensPerDay: 900000 }),
    ];
    assert.equal(inferWindow(rows, 'b', 'tokensPerDay').ceiling, 900000);
  });

  test('windows are inferred independently', () => {
    const rows = [
      obs('a', Outcome.REFUSED, { requestsPerMinute: 20, tokensPerDay: 500000 }),
      obs('a', Outcome.ACCEPTED, { requestsPerMinute: 15, tokensPerDay: 400000 }),
    ];
    const all = inferLimits('a', { observations: rows });
    assert.equal(all.requestsPerMinute.ceiling, 20);
    assert.equal(all.tokensPerDay.ceiling, 500000);
  });

  test('an account with no observations infers nothing', () => {
    assert.deepEqual(inferLimits('ghost', { observations: [] }), {});
  });
});

describe('Declared beats learned', () => {
  const observations = [
    obs('a', Outcome.ACCEPTED, { tokensPerDay: 900000 }),
    obs('a', Outcome.REFUSED, { tokensPerDay: 1000000 }),
    obs('a', Outcome.REFUSED, { tokensPerDay: 1000000 }),
  ];

  test('a stated limit is used and the observation stays a cross-check', () => {
    // A learned value silently overriding a stated one is how a system starts
    // disagreeing with its own configuration.
    const account = { id: 'a', limits: { tokensPerDay: 2000000 } };
    const r = effectiveLimits(account, { observations });
    assert.equal(r.limits.tokensPerDay, 2000000);
    assert.equal(r.sources.tokensPerDay, 'declared');
    assert.equal(r.learned.tokensPerDay.ceiling, 1000000, 'the disagreement is still visible');
  });

  test('a learned limit fills a gap and is labelled', () => {
    const r = effectiveLimits({ id: 'a', limits: {} }, { observations });
    assert.equal(r.limits.tokensPerDay, 1000000);
    assert.equal(r.sources.tokensPerDay, 'learned');
  });

  test('an unconfident learning is labelled provisional', () => {
    const wide = [
      obs('a', Outcome.ACCEPTED, { tokensPerDay: 10000 }),
      obs('a', Outcome.REFUSED, { tokensPerDay: 1000000 }),
    ];
    const r = effectiveLimits({ id: 'a', limits: {} }, { observations: wide });
    assert.equal(r.sources.tokensPerDay, 'learned-provisional');
  });

  test('nothing observed leaves the window absent rather than zero', () => {
    const r = effectiveLimits({ id: 'a', limits: {} }, { observations: [] });
    assert.equal(r.limits.tokensPerDay, undefined, 'absent means unknown, not a limit of zero');
  });
});

describe('Cooldown length follows the window that refused', () => {
  const NOW = Date.parse('2026-09-14T08:00:00.000Z');
  const minutesOf = (iso) => (Date.parse(iso) - NOW) / 60000;

  test('a per-minute refusal clears in minutes', () => {
    assert.equal(minutesOf(cooldownFor('requestsPerMinute', NOW)), 2);
  });

  test('a daily refusal waits far longer', () => {
    // Retrying against a daily limit burns attempts for nothing.
    assert.equal(minutesOf(cooldownFor('tokensPerDay', NOW)), 60);
  });

  test('a monthly refusal waits longest', () => {
    assert.equal(minutesOf(cooldownFor('tokensPerMonth', NOW)), 240);
  });

  test('an unknown window gets the short wait', () => {
    // A transient refusal must not park an account for a day.
    assert.equal(minutesOf(cooldownFor('somethingElse', NOW)), 5);
  });
});

describe('Ledger', () => {
  test('records round-trip through the file', () => {
    const file = store();
    record(obs('a', Outcome.REFUSED, { tokensPerDay: 5 }), { file });
    record(obs('a', Outcome.ACCEPTED, { tokensPerDay: 3 }), { file });
    assert.equal(readLedger(file).length, 2);
  });

  test('the ledger is bounded so an old plan does not outvote the current one', () => {
    const file = store();
    for (let i = 0; i < 12; i += 1) {
      record(obs('a', Outcome.ACCEPTED, { tokensPerDay: i }), { file, maxEntries: 5 });
    }
    const rows = readLedger(file);
    assert.equal(rows.length, 5);
    assert.equal(rows[rows.length - 1].consumed.tokensPerDay, 11, 'the newest survive');
  });

  test('a missing ledger reads as empty rather than throwing', () => {
    assert.deepEqual(readLedger(path.join(os.tmpdir(), 'no-such-' + Date.now() + '.json')), []);
  });

  test('an invalid outcome is refused', () => {
    const file = store();
    assert.throws(
      () => record({ accountId: 'a', outcome: 'maybe' }, { file }),
      /accepted hoặc refused/
    );
  });
});

describe('A status code is only a status code in a status context', () => {
  // A loose /402/ matched anything containing those digits. Because the
  // learned ceiling only ratchets down, one false positive pinned an account
  // permanently — the same failure this module removed for 503.
  const refusals = [
    'API Error: 402 Budget pool quota has been exhausted',
    'HTTP 429 Too Many Requests',
    'rate limit exceeded',
    'insufficient credit on this account',
  ];
  const notRefusals = [
    'request id: 20260914402883507jl4rmC8jYjxlK',
    'completed in 402 ms',
    '503 no available channel for this model',
    'wrote 4029 tokens',
  ];

  for (const text of refusals) {
    test(`counts as a quota refusal: ${text.slice(0, 44)}`, () => {
      assert.strictEqual(isQuotaRefusal(text), true);
    });
  }
  for (const text of notRefusals) {
    test(`does not: ${text.slice(0, 44)}`, () => {
      assert.strictEqual(isQuotaRefusal(text), false);
    });
  }
});

describe('A bare trailing status code needs a reason beside it', () => {
  // Matching any line ending in 402 or 429 would have made "tokens: 429" a
  // quota refusal, and the ceiling never recovers from a false positive.
  const refusals = ['Request failed: 402', 'Request failed: 429', 'upstream rejected - 402'];
  const notRefusals = ['tokens: 429', 'wrote 4029 tokens', 'latency 402'];
  for (const t of refusals) {
    test(`counts: ${t}`, () => assert.strictEqual(isQuotaRefusal(t), true));
  }
  for (const t of notRefusals) {
    test(`does not: ${t}`, () => assert.strictEqual(isQuotaRefusal(t), false));
  }
});
