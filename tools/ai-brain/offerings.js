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
const { effectiveLimits } = require('./ceiling');
const agyQuota = require('./agy-quota');
const { sameAccount } = require('./agy-identity');

/** Severity order shared by every headroom merge in this file. */
const SEVERITY = { open: 0, unknown: 1, tight: 2, exhausted: 3, cooling: 4 };

/**
 * What the provider itself says is left, when it says anything.
 *
 * Local accounting measures what we spent; this measures what the vendor
 * thinks is left, which is the only number that can account for spend from
 * outside this pipeline — the operator using the same account in the IDE, or a
 * pool being switched off outright. Where the two disagree the tighter one is
 * taken, so a vendor reporting an empty pool stops dispatch even while our own
 * ledger looks healthy.
 *
 * Returns null rather than `unknown` when there is nothing to say. Folding an
 * unknown into the merge would drag a known-open offering down to unknown and
 * make every offering look equally uncertain, which is the opposite of what
 * reading the vendor's own number was for.
 */
function reportedView(offering, reportedByAccount) {
  const quota = (reportedByAccount || {})[offering.accountId];
  if (!quota || !quota.available) return null;

  // A reading belongs to the account that produced it. If the offering names
  // an expected address and the reading came from a different one, the
  // operator switched accounts and this number describes someone else's budget.
  if (offering.accountEmail && quota.account) {
    if (!sameAccount({ known: true, email: offering.accountEmail }, quota.account)) return null;
  }

  const headroom = agyQuota.headroomFor(quota, offering.model);
  if (!headroom.known) return null;

  const status = agyQuota.statusFrom(headroom);
  return {
    status,
    remainingPercent: headroom.remainingPercent,
    window: headroom.window,
    resetsAt: headroom.resetsAt,
    family: headroom.family,
    disabled: (headroom.windows || []).some((w) => w.disabled),
    observedAt: quota.observedAt || null,
    account: quota.account && quota.account.known ? quota.account.email : null,
  };
}

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
function expandOfferings(accounts, options) {
  const out = [];
  for (const account of accounts || []) {
    if (account.enabled === false) continue;

    const declared =
      Array.isArray(account.models) && account.models.length > 0
        ? account.models
        : [
            {
              model: account.model,
              quality: account.quality,
              cost: account.cost,
              capabilities: account.capabilities,
              limits: account.limits,
            },
          ];

    const effective = effectiveLimits(account, options);

    for (const entry of declared) {
      const model = typeof entry === 'string' ? entry : entry.model;
      if (!model) continue;
      const e = typeof entry === 'string' ? {} : entry;

      out.push({
        id: offeringId(account.id, model),
        accountId: account.id,
        provider: account.provider,
        // The address the operator signed this account in as. Carried so a
        // vendor-reported quota can be refused when it came from a different
        // address, which happens whenever the operator switches accounts.
        accountEmail: account.email || null,
        model,
        // Operator-declared order. Nothing here assumes local is cheaper or
        // that a subscription beats an API key; the ladder is whatever the
        // operator configured.
        tier: Number(e.tier !== undefined ? e.tier : account.tier || 0),
        // 0-100. Promptfoo results are meant to write this; absent, it is 50
        // so an unrated model sorts below anything measured and above nothing.
        quality: Number(
          e.quality !== undefined ? e.quality : account.quality !== undefined ? account.quality : 50
        ),
        capabilities: Object.assign({}, account.capabilities, e.capabilities),
        cost: Object.assign({}, account.cost, e.cost),
        preference: Number(e.preference !== undefined ? e.preference : account.preference || 0),
        // The hardest class of work this model is trusted to finish. Distinct
        // from `quality`: quality ranks two models against each other, grade
        // says whether either may take the task at all.
        codingGrade:
          e.codingGrade !== undefined
            ? Number(e.codingGrade)
            : account.codingGrade !== undefined
              ? Number(account.codingGrade)
              : undefined,
        qualifiedRoles: e.qualifiedRoles || account.qualifiedRoles,
        enabled: e.enabled !== false,
        // Kept apart so the combined check below can see which is which.
        modelLimits: e.limits || {},
        // A limit the operator never stated can still be known, if the
        // provider has refused often enough to bound it. effectiveLimits
        // prefers the declared number and fills gaps from observation.
        accountLimits: effective.limits,
        limitSources: effective.sources,
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
    {
      id: offering.accountId,
      limits: offering.accountLimits,
      cooldownUntil: offering.cooldownUntil,
    },
    accountEvents,
    options
  );
  const modelView = accountHeadroom(
    { id: offering.id, limits: offering.modelLimits, cooldownUntil: offering.cooldownUntil },
    modelEvents,
    options
  );

  const severity = SEVERITY;
  let worse = severity[modelView.status] > severity[accountView.status] ? modelView : accountView;
  let boundBy = worse === modelView ? 'model' : 'account';

  // The vendor's own figure is merged on two grounds: it may tighten, and it
  // may resolve an `unknown`. The second is not loosening — `unknown` means we
  // have no information about this budget, and the vendor has just supplied
  // some. What it may never do is overturn a local `exhausted`, because our
  // ledger counts spend the vendor has not billed yet, nor a `cooling`, which
  // records an actual refusal.
  //
  // It is kept out of the local windows because it is a percentage of an
  // undisclosed ceiling and cannot be added to a token count without inventing
  // the ceiling.
  const reported = reportedView(offering, (options || {}).reported);
  if (
    reported &&
    (severity[reported.status] > severity[worse.status] || worse.status === 'unknown')
  ) {
    worse = Object.assign({}, worse, {
      status: reported.status,
      reason:
        reported.disabled && reported.status === 'exhausted'
          ? 'Nhà cung cấp đã tắt nhóm ' + reported.family + ' trên tài khoản này'
          : 'Nhà cung cấp báo còn ' + reported.remainingPercent + '% (' + reported.window + ')',
    });
    boundBy = 'reported';
  }

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
    // Carried whole so the dashboard can show the vendor's number next to our
    // own rather than only the merged verdict.
    reported: reported || null,
    // Named so a deferral message can say which budget actually ran out.
    boundBy,
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
  return [...byTier.keys()]
    .sort((a, b) => a - b)
    .map((tier) => ({ tier, offerings: byTier.get(tier) }));
}

/**
 * The tier to fall to after an offering refused.
 *
 * One tier down, not one offering along. Offerings inside a tier normally
 * share an account and therefore a budget, so moving sideways retries the same
 * wall; the ladder exists precisely to name the next independent budget.
 */
function nextTierDown(ladder, fromTier, headrooms, strategy) {
  for (const rung of ladder || []) {
    if (!(rung.tier > fromTier)) continue;
    const ranked = rankOfferings(rung.offerings, headrooms || {}, strategy);
    if (ranked.length > 0) return { tier: rung.tier, offerings: ranked };
  }
  return null;
}

module.exports = {
  Strategy,
  offeringId,
  expandOfferings,
  offeringHeadroom,
  headroomForAll,
  rankOfferings,
  laddered,
  nextTierDown,
  blendedCost,
};
