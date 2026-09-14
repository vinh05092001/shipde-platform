'use strict';

/**
 * Ship Dễ — Dispatch Planner
 *
 * Decides which ready Work Items can start right now, on which account, and
 * says why each one that cannot start is waiting. It plans; it does not launch.
 * Something deterministic has to own that decision, and a planner that also
 * executes is a planner nobody can test.
 *
 * Two limits are enforced here and they are not the same kind of thing.
 *
 *   Safety invariant — one writer per Work Item. AGENTS.md states it without
 *   qualification, and two authors on one item corrupt the unit of delivery.
 *   It is not configurable, and `maxImplementationAgents` cannot raise it.
 *
 *   Stability limit — how many implementation agents run at once. AI-TOOL-03
 *   currently sets this to 1, but AGENTS.md frames it as holding "until the
 *   workflow is proven stable", which makes it a setting rather than a rule.
 *   It defaults to 1 so the current policy is what happens unless the operator
 *   deliberately raises it.
 *
 * Parallelism across *different* Work Items is what the second limit governs.
 * Parallelism within one is what the first forbids, permanently.
 */

const { eligibleAccounts } = require('./capabilities');
const { isDispatchable } = require('./quota');
const { expandOfferings, headroomForAll, rankOfferings, laddered, Strategy } = require('./offerings');
const { rankByFitness, Difficulty } = require('./fitness');

const DEFAULTS = {
  maxImplementationAgents: 1,
  maxResearchAgents: 1,
  maxReviewAgents: 2,
  maxPerAccount: 1,
  maxTotal: 6,
};

const IMPLEMENTATION_ROLES = new Set(['author.foundation', 'author.lowrisk']);
const RESEARCH_ROLES = new Set(['analyst.default', 'planner.default']);
// A reviewer reads a pull request; it never writes to the branch, so it holds
// no writer claim and cannot collide with the author. Review therefore runs in
// parallel with authoring by nature, and is the right home for spare capacity.
const REVIEW_ROLES = new Set(['reviewer.primary', 'reviewer.fallback']);

function waiting(item, reason, detail) {
  return {
    workItemId: item.workItemId,
    role: item.role,
    reason,
    detail: detail || null,
  };
}

/**
 * @param items    [{ workItemId, role, branch, riskDomains, priority }]
 * @param accounts capability registry entries
 * @param context  { claims, running, eventsByAccount, limits, now }
 */
function planDispatch(items, accounts, context) {
  const ctx = context || {};
  const limits = Object.assign({}, DEFAULTS, ctx.limits || {});
  const now = ctx.now || Date.now();

  // Dispatch is per model, not per account: one key exposes many models and
  // choosing "the account" says nothing about which will write the code.
  const offerings = expandOfferings(accounts);
  const headrooms = headroomForAll(offerings, ctx.eventsByAccount || {}, ctx.eventsByOffering || {}, { now });

  // What is already in flight, from the caller rather than inferred: the
  // scheduler must never assume a slot is free because it cannot see the work.
  const running = ctx.running || [];
  const claims = ctx.claims || [];

  const busyWorkItems = new Set(running.map((r) => r.workItemId).filter(Boolean));
  const claimedBranches = new Map();
  for (const claim of claims) {
    if (claim.branch) claimedBranches.set(claim.branch, claim.owner);
  }

  const perAccountLoad = {};
  for (const r of running) {
    if (!r.accountId) continue;
    perAccountLoad[r.accountId] = (perAccountLoad[r.accountId] || 0) + 1;
  }

  let implementationLoad = running.filter((r) => IMPLEMENTATION_ROLES.has(r.role)).length;
  let researchLoad = running.filter((r) => RESEARCH_ROLES.has(r.role)).length;
  let reviewLoad = running.filter((r) => REVIEW_ROLES.has(r.role)).length;
  let totalLoad = running.length;

  const assignments = [];
  const deferred = [];

  // Highest priority first; a stable tiebreak keeps the plan reproducible,
  // which matters because this output is compared across runs.
  const queue = [...(items || [])].sort((a, b) => {
    const pa = Number(a.priority || 0);
    const pb = Number(b.priority || 0);
    if (pa !== pb) return pb - pa;
    return String(a.workItemId).localeCompare(String(b.workItemId));
  });

  for (const item of queue) {
    if (totalLoad >= limits.maxTotal) {
      deferred.push(waiting(item, 'TOTAL_LIMIT', 'đã đạt trần ' + limits.maxTotal + ' phiên'));
      continue;
    }

    // The invariant, checked before anything else so it can never be traded
    // away by a later condition.
    if (busyWorkItems.has(item.workItemId)) {
      deferred.push(waiting(item, 'WORK_ITEM_ALREADY_WRITING', 'đầu mục này đã có writer'));
      continue;
    }

    const isImplementation = IMPLEMENTATION_ROLES.has(item.role);
    const isResearch = RESEARCH_ROLES.has(item.role);
    const isReview = REVIEW_ROLES.has(item.role);

    if (isImplementation && implementationLoad >= limits.maxImplementationAgents) {
      deferred.push(
        waiting(item, 'IMPLEMENTATION_LIMIT', 'trần ' + limits.maxImplementationAgents + ' agent hiện thực')
      );
      continue;
    }
    if (isResearch && researchLoad >= limits.maxResearchAgents) {
      deferred.push(waiting(item, 'RESEARCH_LIMIT', 'trần ' + limits.maxResearchAgents + ' agent nghiên cứu'));
      continue;
    }
    if (isReview && reviewLoad >= limits.maxReviewAgents) {
      deferred.push(waiting(item, 'REVIEW_LIMIT', 'trần ' + limits.maxReviewAgents + ' agent review'));
      continue;
    }

    // A branch held by someone else is the cross-session collision the writer
    // claim exists to catch. Catching it here avoids dispatching work that
    // would only be refused at commit time.
    if (!isReview && item.branch && claimedBranches.has(item.branch)) {
      const owner = claimedBranches.get(item.branch);
      if (owner !== item.workItemId && owner !== item.owner) {
        deferred.push(waiting(item, 'BRANCH_CLAIMED', 'nhánh đang do ' + owner + ' giữ'));
        continue;
      }
    }

    const { role, eligible, rejected } = eligibleAccounts(item.role, offerings, item);
    if (!role) {
      deferred.push(waiting(item, 'UNKNOWN_ROLE', item.role));
      continue;
    }
    if (eligible.length === 0) {
      deferred.push(waiting(item, 'NO_ELIGIBLE_ACCOUNT', rejected.map((r) => r.account + ': ' + r.reason).join('; ')));
      continue;
    }

    // Escalation ladder: exhaust tier 0 before spending tier 1, and tier 1
    // before tier 2. Without this the cheapest-first sort inside a tier would
    // happily reach past free local capacity into a metered API key merely
    // because that key reported more headroom.
    // The role decides how to choose inside a tier: authoring wants the best
    // model that still has room, mechanical work wants the cheapest that works.
    // Difficulty, not raw model strength, decides what is needed. Fitness then
    // prefers the sufficient model with the most runway over the strongest one,
    // and refuses any model that cannot finish a task of this size at all.
    const difficulty = Number(item.difficulty) || role.difficulty || Difficulty.STANDARD;
    // The strategy only sets how hard price presses on the choice; it can
    // never let an insufficient or nearly-drained model through.
    const strategy = item.strategy || role.strategy || Strategy.QUALITY_FIRST;
    const fitnessOpts = Object.assign(
      { costWeight: strategy === Strategy.COST_FIRST ? 200 : 1, reviewing: isReview },
      ctx.fitness
    );

    let withRoom = [];
    let chosenTier = null;
    let fitness = null;
    let fitnessRejected = [];
    for (const { tier, offerings: inTier } of laddered(eligible)) {
      const free = inTier.filter((o) => (perAccountLoad[o.accountId] || 0) < limits.maxPerAccount);
      const { ranked, rejected } = rankByFitness(free, difficulty, headrooms, ctx.history || {}, fitnessOpts);
      fitnessRejected = fitnessRejected.concat(rejected);
      if (ranked.length > 0) {
        withRoom = ranked.map((r) => r.offering);
        fitness = ranked[0].verdict;
        chosenTier = tier;
        break;
      }
    }

    if (withRoom.length === 0) {
      const why = fitnessRejected.length > 0
        ? fitnessRejected
            .map((r) => {
              const h = headrooms[r.offeringId];
              return r.offeringId + ': ' + r.reason + (h && h.boundBy ? ' (theo ' + h.boundBy + ')' : '');
            })
            .join('; ')
        : eligible.map((o) => o.id + ': đang bận').join('; ');
      deferred.push(waiting(item, 'NO_QUOTA_OR_BUSY', why));
      continue;
    }

    const chosen = withRoom[0];

    assignments.push({
      workItemId: item.workItemId,
      role: item.role,
      branch: item.branch || null,
      accountId: chosen.accountId,
      provider: chosen.provider,
      model: chosen.model,
      quality: chosen.quality,
      difficulty,
      strategy,
      grade: fitness.grade,
      runway: fitness.runway,
      tokensPerTask: fitness.tokensPerTask,
      fitReason: fitness.reason,
      headroom: headrooms[chosen.id].status,
      tier: chosenTier,
      // Recorded so a later review can see the model was not chosen at random.
      alternatives: withRoom.slice(1, 4).map((o) => o.id),
    });

    // A review does not occupy the Work Item as a writer, so authoring on it
    // may continue and a second review of a different item stays possible.
    if (!isReview) {
      busyWorkItems.add(item.workItemId);
      if (item.branch) claimedBranches.set(item.branch, item.workItemId);
    }
    perAccountLoad[chosen.accountId] = (perAccountLoad[chosen.accountId] || 0) + 1;
    totalLoad += 1;
    if (isImplementation) implementationLoad += 1;
    if (isResearch) researchLoad += 1;
    if (isReview) reviewLoad += 1;
  }

  return {
    assignments,
    deferred,
    utilisation: {
      total: totalLoad,
      maxTotal: limits.maxTotal,
      implementation: implementationLoad,
      maxImplementation: limits.maxImplementationAgents,
      research: researchLoad,
      maxResearch: limits.maxResearchAgents,
      review: reviewLoad,
      maxReview: limits.maxReviewAgents,
      // Slots the operator is paying for and not using. This is the number to
      // watch: capacity idle while the queue is not empty is waste.
      idleImplementation: Math.max(0, limits.maxImplementationAgents - implementationLoad),
      idleReview: Math.max(0, limits.maxReviewAgents - reviewLoad),
    },
    headrooms,
  };
}

module.exports = { planDispatch, DEFAULTS, IMPLEMENTATION_ROLES, RESEARCH_ROLES, REVIEW_ROLES };
