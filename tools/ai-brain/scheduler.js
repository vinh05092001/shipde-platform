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
 *   Stability limit — how many implementation agents run at once across different
 *   Work Items. AI-TOOL-03 fixes it at 1 as a stability measure; raising it is a
 *   governed decision, not an unvetted setting (TASK-AI-42, DEC-017). Passing
 *   `maxImplementationAgents > 1` without an approved governed decision identifier
 *   (DEC-* or HUMAN-DECISION-*) is held at 1.
 *
 * Parallelism across *different* Work Items is what the second limit governs.
 * Parallelism within one is what the first forbids, permanently.
 */

const { eligibleAccounts } = require('./capabilities');
const { isDispatchable } = require('./quota');
const {
  expandOfferings,
  headroomForAll,
  rankOfferings,
  laddered,
  Strategy,
} = require('./offerings');
const { rankByFitness, Difficulty } = require('./fitness');
const { observeRefusal } = require('./ceiling');

const GOVERNED_DECISION_PATTERN = /^(?:HUMAN-DECISION-[A-Z0-9-]+|DEC-[0-9]{3,})$/;

function isGovernedDecision(val) {
  if (!val) return false;
  if (typeof val === 'string') return GOVERNED_DECISION_PATTERN.test(val.trim());
  if (typeof val === 'object' && val.id)
    return GOVERNED_DECISION_PATTERN.test(String(val.id).trim());
  return false;
}

/**
 * How many concurrent agents the machine can actually hold (TASK-AI-49).
 *
 * The governed decision says how many the *process* permits; this says how
 * many the hardware permits, and the smaller of the two wins. They answer
 * different questions and neither substitutes for the other: a ceiling of
 * three agreed by a human is still three sessions of 300–400 MB each, and on a
 * host with 1 GB free the third one does not fail cleanly — it makes every
 * other process on the machine slower while it swaps.
 *
 * Reserve is held back for the daemons that must keep answering while agents
 * run (Paseo, 9Router, the dashboard) plus the editor the operator is using.
 * Measured worker cost: Cline holds 270–375 MB and has no memory knob, so 350
 * is the honest figure rather than a hopeful one.
 *
 * Returns { allowed, freeMb, reserveMb, perAgentMb, limiting }. A machine that
 * cannot report its free memory yields `allowed: null`, which callers treat as
 * "no opinion" — refusing to dispatch because a reading was unavailable would
 * stop the queue over a missing number rather than a missing resource.
 */
function resourceCeiling(options) {
  const opts = options || {};
  const perAgentMb = Number(opts.perAgentMb) > 0 ? Number(opts.perAgentMb) : 350;
  const reserveMb = Number.isFinite(Number(opts.reserveMb)) ? Number(opts.reserveMb) : 2048;

  let freeMb = opts.freeMb;
  if (freeMb === undefined || freeMb === null) {
    try {
      freeMb = require('os').freemem() / (1024 * 1024);
    } catch (_) {
      freeMb = null;
    }
  }
  freeMb = Number(freeMb);
  if (!Number.isFinite(freeMb)) {
    return { allowed: null, freeMb: null, reserveMb, perAgentMb, limiting: 'unmeasured' };
  }

  const usable = freeMb - reserveMb;
  const allowed = usable <= 0 ? 0 : Math.floor(usable / perAgentMb);
  return {
    allowed,
    freeMb: Math.round(freeMb),
    reserveMb,
    perAgentMb,
    limiting: allowed === 0 ? 'ram' : null,
  };
}

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

/**
 * The provider-reported readings the cache still vouches for.
 *
 * Failing to read the cache yields no readings rather than an error. The
 * scheduler planned dispatch before these figures existed and must still plan
 * without them; what it must never do is treat their absence as evidence that
 * every budget is full.
 */
function cachedReadings(ctx) {
  try {
    const { readIdentity } = require('./agy-identity');
    const { usableReadings } = require('./quota-store');
    return usableReadings(readIdentity({ home: ctx.home }), { home: ctx.home, now: ctx.now })
      .reported;
  } catch (e) {
    return {};
  }
}

/**
 * Cools every offering a provider has just refused.
 *
 * This is the one place in the planner where a provider speaks in its own
 * words. A reading with `available: false` carries the text the CLI failed
 * with — `readQuota` keeps it verbatim — and `quota-store` deliberately holds
 * a failed reading for a short window precisely so the next planning pass can
 * see it. Until now the merge in `offeringHeadroom` dropped it on the floor:
 * an unavailable reading returns null there, so a genuine `429` taught the
 * scheduler nothing and the next task was routed straight back into it.
 *
 * `observeRefusal` decides everything else — whether the text is about quota
 * at all, how long the wait is for the window that was hit, and whether a
 * cooldown already in force outlasts the new one. Nothing is restated here.
 *
 * The write lands on `offering.cooldownUntil`, which `offeringHeadroom` and
 * `accountHeadroom` already consult, so no reader changes and a cooled
 * offering is excluded from headroom rather than merely down-ranked.
 */
function coolRefusedOfferings(offerings, reported, ctx, now) {
  const cooled = [];
  for (const offering of offerings) {
    const reading = (reported || {})[offering.accountId];
    if (!reading || reading.available !== false) continue;

    const observed = observeRefusal(
      {
        offeringId: offering.id,
        accountId: offering.accountId,
        model: offering.model,
        window: reading.window || null,
        cooldownUntil: offering.cooldownUntil,
      },
      reading.reason,
      { now, file: ctx.ledgerFile }
    );
    if (!observed.cooled) continue;

    offering.cooldownUntil = observed.cooldownUntil;
    cooled.push(observed.cooldown);
  }
  return cooled;
}

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
  const {
    withQuotaLock,
    activeReservations,
    pruneReservations,
    recordReservation,
  } = require('./quota-store');
  const decisions = require('./decisions');

  const now = ctx.now || Date.now();
  const lockOpts = { home: ctx.home, now };
  return withQuotaLock(lockOpts, () => {
    const ctxLimits = ctx.limits || {};
    const decisionCandidate = ctx.governedDecision || ctxLimits.governedDecision || null;
    const decisionValid = isGovernedDecision(decisionCandidate);
    const decisionId = decisionValid
      ? typeof decisionCandidate === 'string'
        ? decisionCandidate.trim()
        : String(decisionCandidate.id).trim()
      : null;

    let requestedMaxImpl =
      ctxLimits.maxImplementationAgents !== undefined
        ? Number(ctxLimits.maxImplementationAgents)
        : DEFAULTS.maxImplementationAgents;

    let effectiveMaxImpl = DEFAULTS.maxImplementationAgents;
    let ceilingGoverned = false;

    if (Number.isFinite(requestedMaxImpl)) {
      if (requestedMaxImpl <= 1) {
        effectiveMaxImpl = Math.max(0, requestedMaxImpl);
      } else if (decisionValid) {
        effectiveMaxImpl = requestedMaxImpl;
        ceilingGoverned = true;
      } else {
        effectiveMaxImpl = 1;
        ceilingGoverned = false;
      }
    }

    const resources = ctx.resources
      ? resourceCeiling(ctx.resources)
      : { allowed: null, freeMb: null, reserveMb: null, perAgentMb: null, limiting: 'not consulted' };
    let ramLimited = false;
    if (resources.allowed !== null && resources.allowed < effectiveMaxImpl) {
      effectiveMaxImpl = resources.allowed;
      ramLimited = true;
    }

    const limits = Object.assign({}, DEFAULTS, ctxLimits, {
      maxImplementationAgents: effectiveMaxImpl,
    });
    const now = ctx.now || Date.now();

    const offerings = expandOfferings(accounts);
    const reported = ctx.reported !== undefined ? ctx.reported : cachedReadings(ctx);
    const cooldowns = coolRefusedOfferings(offerings, reported, ctx, now);

    const running = ctx.running || [];
    const claims = ctx.claims || [];

    const runningWorkItems = new Set(running.map(r => r.workItemId).filter(Boolean));
    if (ctx.prune !== false) pruneReservations(now, runningWorkItems, lockOpts);

    const reservations = activeReservations(lockOpts);

    const headrooms = headroomForAll(
      offerings,
      ctx.eventsByAccount || {},
      ctx.eventsByOffering || {},
      { now, reported, reservationsByAccount: reservations.byAccount, reservationsByOffering: reservations.byOffering }
    );

    const decisionLog = decisions.readDecisionsDetailed({ dir: ctx.decisionDir, now }).records || [];
    const failuresByItem = {};
    for (const rec of decisionLog) {
      if (rec.stage === 'failed' || rec.stage === 'refused') {
        if (rec.workItemId && rec.chosen) {
          failuresByItem[rec.workItemId] = failuresByItem[rec.workItemId] || new Set();
          failuresByItem[rec.workItemId].add(rec.chosen);
        }
      }
    }

    const busyWorkItems = new Set(runningWorkItems);
    const claimedBranches = new Map();
    for (const claim of claims) {
      if (claim.branch) claimedBranches.set(claim.branch, claim.owner);
    }

    const perAccountLoad = {};
    const perModelLoad = {};
    const perProviderLoad = {};
    for (const r of running) {
      if (r.accountId) perAccountLoad[r.accountId] = (perAccountLoad[r.accountId] || 0) + 1;
      if (r.model) perModelLoad[r.model] = (perModelLoad[r.model] || 0) + 1;
      if (r.provider) perProviderLoad[r.provider] = (perProviderLoad[r.provider] || 0) + 1;
    }

    const recentUsage = {};
    for (const [accId, evs] of Object.entries(ctx.eventsByAccount || {})) {
       recentUsage[accId] = (evs || []).filter(e => {
         const at = typeof e.at === 'number' ? e.at : Date.parse(e.at);
         return now - at < 60 * 60 * 1000;
       }).length;
    }

    let implementationLoad = running.filter((r) => IMPLEMENTATION_ROLES.has(r.role)).length;
    let researchLoad = running.filter((r) => RESEARCH_ROLES.has(r.role)).length;
    let reviewLoad = running.filter((r) => REVIEW_ROLES.has(r.role)).length;
    let totalLoad = running.length;

    const assignments = [];
    const deferred = [];

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

      if (busyWorkItems.has(item.workItemId)) {
        deferred.push(waiting(item, 'WORK_ITEM_ALREADY_WRITING', 'đầu mục này đã có writer'));
        continue;
      }

      const isImplementation = IMPLEMENTATION_ROLES.has(item.role);
      const isResearch = RESEARCH_ROLES.has(item.role);
      const isReview = REVIEW_ROLES.has(item.role);

      if (isImplementation && implementationLoad >= limits.maxImplementationAgents) {
        deferred.push(waiting(item, 'IMPLEMENTATION_LIMIT', 'trần ' + limits.maxImplementationAgents + ' agent hiện thực'));
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

      const difficulty = Number(item.difficulty) || role.difficulty || Difficulty.STANDARD;
      const strategy = item.strategy || role.strategy || Strategy.QUALITY_FIRST;
      const fitnessOpts = Object.assign(
        {
          costWeight: strategy === Strategy.COST_FIRST ? 200 : 1,
          reviewing: isReview,
          providerLoad: perProviderLoad,
          modelLoad: perModelLoad,
          scopeLoad: perAccountLoad,
          recentUsage,
          maxConcurrentPerModel: limits.maxConcurrentPerModel,
          maxConcurrentPerQuotaScope: limits.maxConcurrentPerQuotaScope,
          recentUsagePenalty: limits.recentUsagePenalty,
          explorationBudget: limits.explorationBudget,
          providerDiversity: limits.providerDiversity,
        },
        ctx.fitness
      );

      const failedIds = failuresByItem[item.workItemId] || new Set();

      let withRoom = [];
      let chosenTier = null;
      let fitness = null;
      let fitnessRejected = [];

      for (const { tier, offerings: inTier } of laddered(eligible)) {
        const free = inTier.filter(o =>
          !failedIds.has(o.id) &&
          (perAccountLoad[o.accountId] || 0) < limits.maxPerAccount
        );

        const { ranked, rejected } = rankByFitness(
          free,
          difficulty,
          headrooms,
          ctx.history || {},
          fitnessOpts
        );
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
          ? fitnessRejected.map((r) => {
              const h = headrooms[r.offeringId];
              return r.offeringId + ': ' + r.reason + (h && h.boundBy ? ' (theo ' + h.boundBy + ')' : '');
            }).join('; ')
          : eligible.map((o) => o.id + ': đang bận hoặc đã thử và thất bại').join('; ');
        deferred.push(waiting(item, 'NO_QUOTA_OR_BUSY', why));
        continue;
      }

      const chosen = withRoom[0];

      if (!ctx.dryRun && item.workItemId && chosen.accountId && chosen.id) {
         recordReservation(item.workItemId, item.role, chosen.accountId, chosen.id, fitness.tokensPerTask, lockOpts);
      }

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
        graded: chosen.gradeRecord ? chosen.gradeRecord.graded : false,
        gradeSource: chosen.gradeRecord ? chosen.gradeRecord.source : 'assumed',
        gradeProvenance: chosen.gradeRecord ? chosen.gradeRecord.provenance || null : null,
        runway: fitness.runway,
        tokensPerTask: fitness.tokensPerTask,
        fitReason: fitness.reason,
        headroom: headrooms[chosen.id].status,
        tier: 0,
      });

      if (!isReview) {
        busyWorkItems.add(item.workItemId);
        if (item.branch) claimedBranches.set(item.branch, item.workItemId);
      }
      perAccountLoad[chosen.accountId] = (perAccountLoad[chosen.accountId] || 0) + 1;
      perModelLoad[chosen.model] = (perModelLoad[chosen.model] || 0) + 1;
      perProviderLoad[chosen.provider] = (perProviderLoad[chosen.provider] || 0) + 1;
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
      governedDecision: decisionId,
      ceilingGoverned,
      // What the memory reading did to the ceiling, so an operator who
      // expected three agents and got one can see which limit bound.
      ramLimited,
      resources,
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
    // Every cooldown this pass wrote, with the offering, the instant, the
    // window and the provider's own words. A cooldown whose cause cannot be
    // read back is indistinguishable from a bug.
    cooldowns,
  };
  });
}

module.exports = {
  planDispatch,
  resourceCeiling,
  DEFAULTS,
  IMPLEMENTATION_ROLES,
  RESEARCH_ROLES,
  REVIEW_ROLES,
  isGovernedDecision,
  GOVERNED_DECISION_PATTERN,
};
