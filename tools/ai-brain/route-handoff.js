'use strict';

const { resolveRoute } = require('./executor');
const { getHarness } = require('./harness');
const { loadSources } = require('./sources');
const { classifyFailure, isEligible } = require('./route-health');
const { upstreamAuthSignal } = require('./failure-classifier');
const { getQuotaScopeState } = require('./quota-scan');
const { proofLevelOf, ProofRank } = require('./evidence');

/**
 * The launch for one route of a structured Controller decision. The route comes
 * from the decision log, never from re-reading the printed ranking, and goes
 * through the same resolver and adapter the executor uses. A route the decision
 * does not hold, or that has no dispatch route, is refused instead of guessed.
 */
function launchFromDecision(decision, request, registry) {
  const d = decision || {};
  const r = request || {};
  const key = r.offeringId || d.selected;
  const chosen = (d.candidates || []).find((c) => c && c.offeringId === key);
  if (!chosen) throw new Error('DECISION_ROUTE_MISSING');
  const provider = chosen.gateway || chosen.source || chosen.upstream;
  const reg = registry || loadSources();
  const route = resolveRoute(
    {
      provider,
      model: chosen.modelId,
      harness: chosen.harness,
      gateway: chosen.gateway,
      upstream: chosen.upstream,
    },
    {},
    reg
  );
  if (!route || !route.provider) throw new Error('DECISION_ROUTE_UNRESOLVED');
  const args = getHarness(route.harnessName).launch({
    candidateKey: key,
    provider: route.provider,
    model: route.model,
    accountId: chosen.accountId,
    gateway: chosen.gateway || '',
    upstream: chosen.upstream,
    quotaScope: chosen.quotaScope,
    prompt: r.prompt,
    branch: r.branch,
    base: r.base,
    cwd: r.cwd,
    title: r.title,
    labels: r.labels || {},
    newWorkspace: r.newWorkspace,
  });
  return { offeringId: key, harness: route.harnessName, model: route.model, args };
}

const MODE = 'full-access';
const known = (v) => v !== undefined && v !== null;

/** Why a route cannot take this ticket, or null when it can. Ping proof alone never qualifies. */
function routeRefusal(c, ticket, ctx, reg) {
  const failed = (ctx.ledger && ctx.ledger.failures) || [];
  const seen = failed.find((f) => f.offeringId === c.offeringId);
  if (seen) return 'ALREADY_FAILED:' + seen.class;
  const authFailed = failed.find(
    (f) =>
      (f.class === 'GATEWAY_KEY_AUTH' && f.gateway === c.gateway && f.accountId === c.accountId) ||
      (f.class === 'UPSTREAM_AUTH' && f.gateway === c.gateway && f.upstream === c.upstream) ||
      (f.class === 'CONNECTION_AUTH' &&
        f.connectionId &&
        f.connectionId === c.connectionId &&
        f.gateway === c.gateway)
  );
  if (authFailed) return authFailed.class;
  const limited = failed.find((f) => f.class === 'RATE_LIMITED' && f.upstream === c.upstream);
  if (limited) return 'UPSTREAM_RATE_LIMITED';
  const broke = failed.find((f) => f.class === 'NO_CREDIT' && f.upstream === c.upstream);
  if (broke && !(Number(broke.affordable) >= ticket.outputTokens)) return 'BUDGET_BELOW_REQUEST';

  const provider = c.gateway || c.source || c.upstream;
  let route = null;
  try {
    route = resolveRoute(
      { provider, model: c.modelId, harness: c.harness, gateway: c.gateway, upstream: c.upstream },
      {},
      reg
    );
    getHarness(route.harnessName);
  } catch {
    route = null;
  }
  if (!route || !route.provider) return 'LAUNCHER_UNAVAILABLE';
  const modes = ((reg.dispatch || {}).launchModes || {})[route.provider];
  if (!Array.isArray(modes)) return 'LAUNCH_MODE_UNKNOWN';
  if (!modes.includes(ticket.mode || MODE)) return 'LAUNCH_MODE_UNSUPPORTED';

  const now = ctx.now;
  if (ctx.routeHealth) {
    const path = { id: c.gateway || c.upstream, accountId: c.accountId };
    if (!isEligible(ctx.routeHealth, c.modelId, path, now)) return 'ROUTE_UNHEALTHY';
  }
  if (c.budget === 'UNKNOWN') return 'BUDGET_UNKNOWN';
  if (c.budget === 'FREE_ALLOWANCE' && ticket.outputTokens > c.budgetRemainingTokens) {
    return 'BUDGET_BELOW_REQUEST';
  }
  const quota = ctx.quotaState ? getQuotaScopeState(c, ctx.quotaState, { now }) : null;
  if (quota && quota.blocked) return 'QUOTA_BLOCKED';
  if (known(c.maxOutputTokens) && Number(c.maxOutputTokens) < ticket.outputTokens) {
    return 'BUDGET_BELOW_REQUEST';
  }
  const proofs = ((ctx.evidenceData || {}).combinations || [])
    .filter(
      (e) =>
        e.modelId === c.modelId &&
        (e.gateway || '') === (c.gateway || '') &&
        (e.accountId || '*') === (c.accountId || '*')
    )
    .flatMap((e) => e.evidence || []);
  const proof = proofs.length ? proofLevelOf(proofs) : 'NONE';
  if (!(ProofRank[proof] >= ProofRank[ticket.minProof])) return 'PROOF_BELOW_TICKET:' + proof;
  return null;
}

/** Split the decision's routes into usable and refused, in the Controller's order. */
function screenRoutes(decision, ticket, context, registry) {
  const ctx = context || {};
  const reg = registry || loadSources();
  const all = (decision.candidates || []).slice();
  const rank = (c) => (c.offeringId === decision.selected ? 1 : 0);
  all.sort((a, b) => rank(b) - rank(a) || Number(b.score || 0) - Number(a.score || 0));
  const eligible = [];
  const rejected = [];
  for (const c of all) {
    const reason = routeRefusal(c, ticket, ctx, reg);
    if (reason) rejected.push({ offeringId: c.offeringId, reason });
    else eligible.push(c);
  }
  return { eligible, rejected };
}

/** The first launch of a ticket: the best usable route, or BLOCKED. */
function firstLaunch(decision, ticket, context, registry) {
  if (decision.workItemId !== ticket.workItemId) {
    return { action: 'BLOCKED', reason: 'DECISION_FOR_OTHER_TICKET', rejected: [] };
  }
  const { eligible, rejected } = screenRoutes(decision, ticket, context, registry);
  if (!eligible.length) return { action: 'BLOCKED', reason: 'NO_ELIGIBLE_ROUTE', rejected };
  const request = { ...ticket.request, offeringId: eligible[0].offeringId };
  return { action: 'LAUNCH', launch: launchFromDecision(decision, request, registry), rejected };
}

/**
 * What to do after a failed launch. The ledger belongs to the ticket, so the one
 * fallback is a ceiling across workers and launchers. A failed route is never
 * sent the same request again. A worktree the failed worker left is kept: the
 * fallback continues inside it, and a stop reports it for review.
 */
function afterFailure(decision, ticket, context, failure, registry) {
  const ctx = context || {};
  const ledger = ctx.ledger;
  const f = failure || {};
  const route = (decision.candidates || []).find((c) => c.offeringId === f.offeringId) || {};
  const viaGateway = route.gateway && route.gateway !== f.upstream;
  const authClass = {
    'gateway-key': 'GATEWAY_KEY_AUTH',
    'upstream-credential': 'UPSTREAM_AUTH',
    'upstream-route': 'UPSTREAM_ROUTE_AUTH',
    connection: 'CONNECTION_AUTH',
  };
  const stated = f.authLayer === 'connection' && !f.connectionId ? null : f.authLayer;
  const authLayer = stated || (upstreamAuthSignal(f.message, route) ? 'upstream-route' : null);
  ledger.failures = ledger.failures || [];
  ledger.failures.push({
    offeringId: f.offeringId,
    upstream: f.upstream,
    gateway: route.gateway,
    accountId: route.accountId,
    connectionId: f.connectionId,
    class:
      Number(f.status) === 401 && viaGateway
        ? authClass[authLayer] || 'AUTH_SCOPE_UNKNOWN'
        : classifyFailure(f.status, f.message),
    affordable: f.affordable,
  });
  const kept = f.worktree || ledger.worktree;
  if (kept) ledger.worktree = kept;
  const used = Number(ledger.fallbacksUsed || 0);
  if (used >= Number(ticket.maxFallbacks)) {
    return { action: 'STOP', reason: 'FALLBACK_LIMIT', used, worktree: kept };
  }
  const resumed = kept
    ? { ...ticket, request: { ...ticket.request, cwd: kept, newWorkspace: false } }
    : ticket;
  const next = firstLaunch(decision, resumed, ctx, registry);
  if (next.action === 'LAUNCH') ledger.fallbacksUsed = used + 1;
  return { ...next, worktree: kept };
}

module.exports = { launchFromDecision, screenRoutes, firstLaunch, afterFailure };
