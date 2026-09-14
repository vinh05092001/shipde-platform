'use strict';

/**
 * Ship Dễ — Model Offerings
 *
 * The unit of dispatch is not an account, it is a model on an account. One API
 * key commonly exposes a dozen models of very different quality, and picking
 * "the account" says nothing about which of them will write the code.
 *
 * Two consequences shape this file.
 *
 * Quota is rarely per model. A key usually carries one shared budget that
 * every model on it draws from, so an offering is constrained by BOTH its own
 * limit and its account's. Checking only the model limit lets a key be
 * overdrawn twelve times over; checking only the account limit hides a model
 * that is individually rate-limited. Both are evaluated and the tighter wins.
 *
 * Rank is not price. The operator asked for a good model to write code, not
 * the cheapest one that technically qualifies, so ordering inside a tier is by
 * declared quality and price is the tiebreak. A role may override this — a
 * mechanical fixture task genuinely should take the cheapest thing that works.
 */

const { accountHeadroom, isDispatchable } = require('./quota');

/** How an offering is chosen within a tier. */
const Strategy = {
  QUALITY_FIRST: 'quality-first',
  COST_FIRST: 'cost-first',
};

function offeringId(accountId, model) {
  return accountId + '::' + model;
}

/**
 * Flattens accounts into one offering per model.
 *
 * An account may declare `models: [...]` or a single `model`. Model entries
 * inherit the account's capabilities, cost, tier and limits unless they
 * override them, so the common case stays short.
 */
function expandOfferings(accounts) {
  const out = [];
  for (const account of accounts || []) {
    if (account.enabled === false) continue;

    const declared = Array.isArray(account.models) && account.models.length > 0
      ? account.models
      : [{ model: account.model, quality: account.quality, cost: account.cost, capabilities: account.capabilities, limits: account.limits }];

    for (const entry of declared) {
      const model = typeof entry === 'string' ? entry : entry.model;
      if (!model) continue;
      const e = typeof entry === 'string' ? {} : entry;

      out.push({
        id: offeringId(account.id, model),
        accountId: account.id,
        provider: account.provider,
        model,
        // Operator-declared order. Nothing here assumes local is cheaper or
        // that a subscription beats an API key; the ladder is whatever the
        // operator configured.
        tier: Number(e.tier !== undefined ? e.tier : account.tier || 0),
        // 0-100. Promptfoo results are meant to write this; absent, it is 50
        // so an unrated model sorts below anything measured and above nothing.
        quality: Number(e.quality !== undefined ? e.quality : account.quality !== undefined ? account.quality : 50),
        capabilities: Object.assign({}, account.capabilities, e.capabilities),
        cost: Object.assign({}, account.cost, e.cost),
        preference: Number(e.preference !== undefined ? e.preference : account.preference || 0),
        // The hardest class of work this model is trusted to finish. Distinct
        // from `quality`: quality ranks two models against each other, grade
        // says whether either may take the task at all.
        codingGrade:
          e.codingGrade !== undefined ? Number(e.codingGrade) : account.codingGrade !== undefined ? Number(account.codingGrade) : undefined,
        qualifiedRoles: e.qualifiedRoles || account.qualifiedRoles,
        enabled: e.enabled !== false,
        // Kept apart so the combined check below can see which is which.
        modelLimits: e.limits || {},
        accountLimits: account.limits || {},
        cooldownUntil: e.cooldownUntil || account.cooldownUntil || null,
      });
    }
  }
  return out.filter((o) => o.enabled);
}

/**
 * Headroom for an offering, tightest of its model budget and its account's
 * shared budget.
 *
 * `eventsByAccount` is keyed by account id — the shared spend — and
 * `eventsByOffering` by offering id, for a model with its own meter.
 */
function offeringHeadroom(offering, eventsByAccount, eventsByOffering, options) {
  const accountEvents = (eventsByAccount || {})[offering.accountId] || [];
  const modelEvents = (eventsByOffering || {})[offering.id] || [];

  const accountView = accountHeadroom(
    { id: offering.accountId, limits: offering.accountLimits, cooldownUntil: offering.cooldownUntil },
    accountEvents,
    options
  );
  const modelView = accountHeadroom(
    { id: offering.id, limits: offering.modelLimits, cooldownUntil: offering.cooldownUntil },
    modelEvents,
    options
  );

  const severity = { open: 0, unknown: 1, tight: 2, exhausted: 3, cooling: 4 };
  const worse = severity[modelView.status] > severity[accountView.status] ? modelView : accountView;

  // Status takes the worse of the two, but windows are merged. An account with
  // no declared limit reports `unknown` with no windows, and letting that
  // replace the model's own declared budget would hide real information —
  // runway would read as unknown for a model whose remaining tokens are known.
  // Where both declare the same window, the one with less left wins.
  const windows = Object.assign({}, accountView.windows);
  for (const [key, w] of Object.entries(modelView.windows || {})) {
    const existing = windows[key];
    if (!existing || w.limit - w.used < existing.limit - existing.used) windows[key] = w;
  }

  return Object.assign({}, worse, {
    windows,
    offeringId: offering.id,
    accountStatus: accountView.status,
    modelStatus: modelView.status,
    // Named so a deferral message can say which budget actually ran out.
    boundBy: worse === modelView ? 'model' : 'account',
  });
}

function headroomForAll(offerings, eventsByAccount, eventsByOffering, options) {
  const out = {};
  for (const o of offerings) {
    out[o.id] = offeringHeadroom(o, eventsByAccount, eventsByOffering, options);
  }
  return out;
}

function blendedCost(offering) {
  const c = offering.cost || {};
  return Number(c.inputPerMillion || 0) * 0.8 + Number(c.outputPerMillion || 0) * 0.2;
}

/**
 * Orders dispatchable offerings within one tier.
 *
 * Under QUALITY_FIRST an explicit preference still wins, then declared
 * quality, then price. Headroom is not part of the order: an offering either
 * has room or it was already filtered out, and letting "more remaining budget"
 * outrank quality is how the best model goes unused while it still had room.
 */
function rankOfferings(offerings, headrooms, strategy) {
  const usable = offerings.filter((o) => isDispatchable(headrooms[o.id]));

  return usable.sort((a, b) => {
    if (a.preference !== b.preference) return b.preference - a.preference;
    if (strategy === Strategy.COST_FIRST) {
      const ca = blendedCost(a);
      const cb = blendedCost(b);
      if (ca !== cb) return ca - cb;
      return b.quality - a.quality;
    }
    if (a.quality !== b.quality) return b.quality - a.quality;
    return blendedCost(a) - blendedCost(b);
  });
}

/** Offerings grouped by tier, in the order the operator declared. */
function laddered(offerings) {
  const byTier = new Map();
  for (const o of offerings) {
    if (!byTier.has(o.tier)) byTier.set(o.tier, []);
    byTier.get(o.tier).push(o);
  }
  return [...byTier.keys()].sort((a, b) => a - b).map((tier) => ({ tier, offerings: byTier.get(tier) }));
}

module.exports = {
  Strategy,
  offeringId,
  expandOfferings,
  offeringHeadroom,
  headroomForAll,
  rankOfferings,
  laddered,
  blendedCost,
};
