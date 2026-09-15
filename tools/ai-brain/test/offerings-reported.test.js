/**
 * Ship Dễ — Vendor-Reported Quota Test Suite
 *
 * Local accounting knows what this pipeline spent. The vendor knows what is
 * left. They disagree whenever the operator uses the same account outside the
 * pipeline, and the vendor is the one who gets to refuse the request.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { expandOfferings, offeringHeadroom } = require('../offerings');
const { parseQuota } = require('../agy-quota');

/** Account B on 2026-09-14: Gemini has room, the Claude pool is switched off. */
const ACCOUNT_B_QUOTA = Object.assign(
  parseQuota(
    [
      'Gemini Models\tWeekly Limit Remaining\t33%\t2026-09-17T23:27:08Z',
      'Gemini Models\tFive Hour Limit Remaining\t92%\t2026-09-14T11:55:59Z',
      'Claude and GPT models\tWeekly Limit Remaining\t0%\t2026-09-16T04:12:24Z',
      'Claude and GPT models\tFive Hour Limit Remaining\tdisabled',
    ].join('\n')
  ),
  { account: { known: true, email: 'worker@gmail.com' } }
);

function offeringsFor(email) {
  return expandOfferings([
    {
      id: 'acc-b',
      provider: 'antigravity',
      email,
      models: [{ model: 'gemini-3.8-flash-high' }, { model: 'claude-opus-4-8' }],
    },
  ]);
}

const pick = (offerings, model) => offerings.find((o) => o.model === model);

describe('Merging the vendor figure with local accounting', () => {
  const offerings = offeringsFor('worker@gmail.com');
  const reported = { 'acc-b': ACCOUNT_B_QUOTA };

  test('a switched-off pool stops dispatch even with a clean local ledger', () => {
    // Nothing was spent here by us, so local accounting has no objection.
    const h = offeringHeadroom(pick(offerings, 'claude-opus-4-8'), {}, {}, { reported });
    assert.equal(h.status, 'exhausted');
    assert.equal(h.boundBy, 'reported');
    assert.match(h.reason, /tắt nhóm claude-gpt/);
  });

  test('the other pool on the same account is unaffected', () => {
    const h = offeringHeadroom(pick(offerings, 'gemini-3.8-flash-high'), {}, {}, { reported });
    assert.equal(h.status, 'open');
    assert.equal(h.reported.remainingPercent, 33);
    assert.equal(h.reported.window, 'weekly');
  });

  test('the vendor figure is carried through for display, not just the verdict', () => {
    const h = offeringHeadroom(pick(offerings, 'gemini-3.8-flash-high'), {}, {}, { reported });
    assert.equal(h.reported.account, 'worker@gmail.com');
    assert.equal(h.reported.resetsAt, '2026-09-17T23:27:08Z');
  });

  test('the vendor can only tighten, never loosen', () => {
    // Local accounting says exhausted; a vendor reporting 33% left must not
    // override it, because our own ledger counts spend the vendor has not
    // billed yet.
    const spent = pick(offerings, 'gemini-3.8-flash-high');
    spent.modelLimits = { requestsPerDay: 1 };
    const events = { [spent.id]: [{ at: Date.now(), requests: 1 }] };
    const h = offeringHeadroom(spent, {}, events, { reported });
    assert.equal(h.status, 'exhausted');
    assert.notEqual(h.boundBy, 'reported');
  });
});

describe('Refusing a figure that belongs to another account', () => {
  test('a reading from a different address is ignored entirely', () => {
    // The operator switched accounts. The percentage on file is real, but it
    // describes a budget this offering does not draw from.
    const offerings = offeringsFor('someone-else@gmail.com');
    const h = offeringHeadroom(
      pick(offerings, 'claude-opus-4-8'),
      {},
      {},
      { reported: { 'acc-b': ACCOUNT_B_QUOTA } }
    );
    assert.equal(h.reported, null);
    assert.notEqual(h.status, 'exhausted');
  });

  test('an account with no declared address accepts the reading', () => {
    // Nothing to contradict, and refusing here would discard the vendor figure
    // for every account the operator has not annotated.
    const offerings = offeringsFor(null);
    const h = offeringHeadroom(
      pick(offerings, 'claude-opus-4-8'),
      {},
      {},
      { reported: { 'acc-b': ACCOUNT_B_QUOTA } }
    );
    assert.equal(h.status, 'exhausted');
  });
});

describe('When the vendor says nothing', () => {
  const offerings = offeringsFor('worker@gmail.com');

  test('an unread quota leaves the local verdict alone', () => {
    // Folding `unknown` in would drag every known-open offering down to
    // unknown, which is worse than not asking the vendor at all.
    const h = offeringHeadroom(
      pick(offerings, 'gemini-3.8-flash-high'),
      {},
      {},
      {
        reported: { 'acc-b': { available: false, reason: 'mạng lỗi' } },
      }
    );
    assert.equal(h.reported, null);
    assert.equal(h.status, 'unknown');
    assert.match(h.reason, /Chưa khai hạn mức/);
  });

  test('a model outside both families is not assigned a pool', () => {
    const other = expandOfferings([
      {
        id: 'acc-b',
        provider: 'antigravity',
        email: 'worker@gmail.com',
        models: [{ model: 'mystery-1' }],
      },
    ]);
    const h = offeringHeadroom(other[0], {}, {}, { reported: { 'acc-b': ACCOUNT_B_QUOTA } });
    assert.equal(h.reported, null);
  });

  test('no reported map at all behaves as before', () => {
    const h = offeringHeadroom(pick(offerings, 'gemini-3.8-flash-high'), {}, {}, {});
    assert.equal(h.reported, null);
  });
});
