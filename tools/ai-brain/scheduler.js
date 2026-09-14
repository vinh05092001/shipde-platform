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
const { poolHeadroom, rankByHeadroom, isDispatchable } = require('./quota');

const DEFAULTS = {
  maxImplementationAgents: 1,
  maxResearchAgents: 1,
  maxPerAccount: 1,
  maxTotal: 6,
};

const IMPLEMENTATION_ROLES = new Set(['author.foundation', 'author.lowrisk']);
const RESEARCH_ROLES = new Set(['analyst.default', 'planner.default']);

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

  const headrooms = poolHeadroom(accounts, ctx.eventsByAccount || {}, { now });

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

    // A branch held by someone else is the cross-session collision the writer
    // claim exists to catch. Catching it here avoids dispatching work that
    // would only be refused at commit time.
    if (item.branch && claimedBranches.has(item.branch)) {
      const owner = claimedBranches.get(item.branch);
      if (owner !== item.workItemId && owner !== item.owner) {
        deferred.push(waiting(item, 'BRANCH_CLAIMED', 'nhánh đang do ' + owner + ' giữ'));
        continue;
      }
    }

    const { role, eligible, rejected } = eligibleAccounts(item.role, accounts, item);
    if (!role) {
      deferred.push(waiting(item, 'UNKNOWN_ROLE', item.role));
      continue;
    }
    if (eligible.length === 0) {
      deferred.push(waiting(item, 'NO_ELIGIBLE_ACCOUNT', rejected.map((r) => r.account + ': ' + r.reason).join('; ')));
      continue;
    }

    const withRoom = rankByHeadroom(
      eligible.map((a) => a.id),
      headrooms
    ).filter((id) => (perAccountLoad[id] || 0) < limits.maxPerAccount);

    if (withRoom.length === 0) {
      const why = eligible
        .map((a) => {
          const h = headrooms[a.id];
          if (!isDispatchable(h)) return a.id + ': ' + (h ? h.reason : 'không rõ hạn mức');
          return a.id + ': đang bận';
        })
        .join('; ');
      deferred.push(waiting(item, 'NO_QUOTA_OR_BUSY', why));
      continue;
    }

    const chosenId = withRoom[0];
    const chosen = eligible.find((a) => a.id === chosenId);

    assignments.push({
      workItemId: item.workItemId,
      role: item.role,
      branch: item.branch || null,
      accountId: chosen.id,
      provider: chosen.provider,
      model: chosen.model,
      headroom: headrooms[chosen.id].status,
      // Recorded so a later review can see the account was not chosen at random.
      alternatives: withRoom.slice(1, 4),
    });

    busyWorkItems.add(item.workItemId);
    if (item.branch) claimedBranches.set(item.branch, item.workItemId);
    perAccountLoad[chosen.id] = (perAccountLoad[chosen.id] || 0) + 1;
    totalLoad += 1;
    if (isImplementation) implementationLoad += 1;
    if (isResearch) researchLoad += 1;
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
    },
    headrooms,
  };
}

module.exports = { planDispatch, DEFAULTS, IMPLEMENTATION_ROLES, RESEARCH_ROLES };
