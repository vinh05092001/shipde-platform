/**
 * Ship Dễ — Model Offering and Ladder Test Suite
 *
 * The ladder under test is the operator's: Gemini writes code, 9Router takes
 * over when Gemini is spent, and another API picks up after that.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  Strategy,
  expandOfferings,
  offeringHeadroom,
  headroomForAll,
  rankOfferings,
  laddered,
} = require('../offerings');
const { planDispatch } = require('../scheduler');

const NOW = Date.parse('2026-09-14T12:00:00Z');
const hoursAgo = (n) => NOW - n * 3600000;
const times = (n) => Array.from({ length: n }, () => ({ at: hoursAgo(1), tokens: 0, cost: 0 }));

const CAPS = { jsonSchema: true, tools: true, contextWindow: 200000 };

/** The operator's declared ladder: Gemini 0, 9Router 1, OpenCode 2. */
const gemini = {
  id: 'gemini',
  provider: 'ag',
  tier: 0,
  enabled: true,
  capabilities: CAPS,
  limits: { requestsPerDay: 2 },
  models: [
    { model: 'gemini-3.7-flash-high', quality: 82, cost: { inputPerMillion: 0, outputPerMillion: 0 } },
    { model: 'gemini-3.1-pro-low', quality: 90, cost: { inputPerMillion: 0, outputPerMillion: 0 } },
  ],
};

const nineRouter = {
  id: '9router',
  provider: 'oc',
  tier: 1,
  enabled: true,
  capabilities: CAPS,
  limits: { requestsPerDay: 2 },
  models: [
    { model: 'cc/claude-sonnet-5', quality: 88, cost: { inputPerMillion: 3, outputPerMillion: 15 } },
    { model: 'kimchi/glm-5.3-flash', quality: 60, cost: { inputPerMillion: 0, outputPerMillion: 0 } },
  ],
};

const opencode = {
  id: 'opencode',
  provider: 'oc-api',
  tier: 2,
  enabled: true,
  capabilities: CAPS,
  limits: { requestsPerDay: 100 },
  models: [{ model: 'oc/deepseek-v4-flash-free', quality: 70, cost: { inputPerMillion: 0, outputPerMillion: 0 } }],
};

const LADDER = [opencode, nineRouter, gemini];
const item = { workItemId: 'A-1', role: 'author.foundation', branch: 'feat/a', riskDomains: [] };

describe('Offering expansion', () => {
  test('one account with two models becomes two offerings', () => {
    const offerings = expandOfferings([gemini]);
    assert.equal(offerings.length, 2);
    assert.deepEqual(
      offerings.map((o) => o.model).sort(),
      ['gemini-3.1-pro-low', 'gemini-3.7-flash-high']
    );
  });

  test('a model inherits the account capabilities and tier unless it overrides', () => {
    const [first] = expandOfferings([gemini]);
    assert.equal(first.capabilities.contextWindow, 200000);
    assert.equal(first.tier, 0);
  });

  test('a model may override the tier of its account', () => {
    const mixed = Object.assign({}, gemini, {
      models: [{ model: 'special', tier: 5, quality: 10 }],
    });
    assert.equal(expandOfferings([mixed])[0].tier, 5);
  });

  test('an unrated model defaults to a middling quality rather than zero', () => {
    const plain = { id: 'x', provider: 'p', model: 'm', capabilities: CAPS, tier: 0 };
    assert.equal(expandOfferings([plain])[0].quality, 50);
  });

  test('a disabled account contributes no offerings', () => {
    assert.equal(expandOfferings([Object.assign({}, gemini, { enabled: false })]).length, 0);
  });

  test('the single-model shape still works', () => {
    const plain = { id: 'x', provider: 'p', model: 'm', capabilities: CAPS, tier: 0 };
    const offerings = expandOfferings([plain]);
    assert.equal(offerings.length, 1);
    assert.equal(offerings[0].id, 'x::m');
  });
});

describe('Shared account quota', () => {
  test('models on one key draw from the same budget', () => {
    // Two requests on the account limit of two: both its models are spent,
    // even though neither model has a limit of its own.
    const offerings = expandOfferings([gemini]);
    const heads = headroomForAll(offerings, { gemini: times(2) }, {}, { now: NOW });
    for (const o of offerings) {
      assert.equal(heads[o.id].status, 'exhausted', o.model + ' is bound by the shared key');
      assert.equal(heads[o.id].boundBy, 'account');
    }
  });

  test('a model with its own limit can run dry while the key still has room', () => {
    const acct = Object.assign({}, gemini, {
      limits: { requestsPerDay: 100 },
      models: [
        { model: 'metered', quality: 90, limits: { requestsPerDay: 1 } },
        { model: 'open', quality: 70 },
      ],
    });
    const offerings = expandOfferings([acct]);
    const heads = headroomForAll(
      offerings,
      { gemini: times(5) },
      { 'gemini::metered': times(1) },
      { now: NOW }
    );
    assert.equal(heads['gemini::metered'].status, 'exhausted');
    assert.equal(heads['gemini::metered'].boundBy, 'model');
    assert.notEqual(heads['gemini::open'].status, 'exhausted');
  });

  test('the tighter of the two budgets is what is reported', () => {
    const o = expandOfferings([gemini])[0];
    const h = offeringHeadroom(o, { gemini: times(2) }, {}, { now: NOW });
    assert.equal(h.accountStatus, 'exhausted');
    assert.equal(h.status, 'exhausted');
  });
});

describe('Choosing a good model', () => {
  test('quality wins over price by default', () => {
    const offerings = expandOfferings([nineRouter]);
    const heads = headroomForAll(offerings, {}, {}, { now: NOW });
    const ranked = rankOfferings(offerings, heads, Strategy.QUALITY_FIRST);
    // Sonnet costs money and the GLM flash model is free; the good one wins.
    assert.equal(ranked[0].model, 'cc/claude-sonnet-5');
  });

  test('cost-first flips that for mechanical work', () => {
    const offerings = expandOfferings([nineRouter]);
    const heads = headroomForAll(offerings, {}, {}, { now: NOW });
    const ranked = rankOfferings(offerings, heads, Strategy.COST_FIRST);
    assert.equal(ranked[0].model, 'kimchi/glm-5.3-flash');
  });

  test('an exhausted model is not ranked at all', () => {
    const offerings = expandOfferings([nineRouter]);
    const heads = headroomForAll(offerings, { '9router': times(2) }, {}, { now: NOW });
    assert.equal(rankOfferings(offerings, heads, Strategy.QUALITY_FIRST).length, 0);
  });

  test('tiers are ordered as the operator declared them', () => {
    const tiers = laddered(expandOfferings(LADDER));
    assert.deepEqual(tiers.map((t) => t.tier), [0, 1, 2]);
    assert.equal(tiers[0].offerings[0].accountId, 'gemini');
  });
});

describe('The operator ladder: Gemini, then 9Router, then another API', () => {
  test('Gemini writes code first, on its best model', () => {
    const plan = planDispatch([item], LADDER, { now: NOW });
    assert.equal(plan.assignments[0].accountId, 'gemini');
    assert.equal(plan.assignments[0].model, 'gemini-3.1-pro-low', 'the stronger Gemini model, not the first listed');
    assert.equal(plan.assignments[0].tier, 0);
  });

  test('when Gemini runs out, 9Router takes over', () => {
    const plan = planDispatch([item], LADDER, {
      eventsByAccount: { gemini: times(2) },
      now: NOW,
    });
    assert.equal(plan.assignments[0].accountId, '9router');
    assert.equal(plan.assignments[0].model, 'cc/claude-sonnet-5');
  });

  test('when 9Router also runs out, the next API picks it up', () => {
    const plan = planDispatch([item], LADDER, {
      eventsByAccount: { gemini: times(2), '9router': times(2) },
      now: NOW,
    });
    assert.equal(plan.assignments[0].accountId, 'opencode');
    assert.equal(plan.assignments[0].tier, 2);
  });

  test('a spent tier is skipped whole, not model by model', () => {
    // Gemini's key is exhausted, so neither of its models may be reached even
    // though the second was never individually used.
    const plan = planDispatch([item], LADDER, {
      eventsByAccount: { gemini: times(2) },
      now: NOW,
    });
    assert.notEqual(plan.assignments[0].accountId, 'gemini');
  });

  test('everything spent defers and names which budget ran out', () => {
    const plan = planDispatch([item], LADDER, {
      eventsByAccount: { gemini: times(2), '9router': times(2), opencode: times(100) },
      now: NOW,
    });
    assert.equal(plan.assignments.length, 0);
    assert.equal(plan.deferred[0].reason, 'NO_QUOTA_OR_BUSY');
    assert.match(plan.deferred[0].detail, /theo account|theo model/);
  });

  test('a cheap mechanical task takes the cheap model on the same ladder', () => {
    const mechanical = Object.assign({}, item, {
      role: 'author.lowrisk',
      strategy: Strategy.COST_FIRST,
    });
    const plan = planDispatch([mechanical], LADDER, {
      eventsByAccount: { gemini: times(2) },
      now: NOW,
    });
    assert.equal(plan.assignments[0].model, 'kimchi/glm-5.3-flash');
  });

  test('the plan records the model quality and the strategy used', () => {
    const plan = planDispatch([item], LADDER, { now: NOW });
    assert.equal(plan.assignments[0].quality, 90);
    assert.equal(plan.assignments[0].strategy, Strategy.QUALITY_FIRST);
    assert.ok(plan.assignments[0].alternatives.length > 0);
  });
});
