'use strict';

const { resolveRoute } = require('./executor');
const { getHarness, runHarness } = require('./harness');
const { loadSources, dispatchRoute, getDispatchConfig } = require('./sources');
const { classifyFailure, isEligible } = require('./route-health');
const { upstreamAuthSignal } = require('./failure-classifier');
const { getQuotaScopeState, isScopeBlocked } = require('./quota-scan');
const { proofLevelOf, ProofRank, Status } = require('./evidence');
const { decisionRow } = require('./dispatch-output');

/** Adapt dispatch JSON without interpreting keys, scoring, pruning or choosing a writer. */
function decisionFromDispatch(input, options = {}) {
  const blocked = (reasonCode) => ({
    workItemId: options.workItemId,
    controllerStatus: 'ERROR',
    selected: null,
    candidates: [],
    rejected: [],
    reasonCode,
  });
  let d = input;
  if (typeof input === 'string') {
    try {
      d = JSON.parse(input);
    } catch {
      return blocked('CONTROLLER_JSON_INVALID');
    }
  }
  if (
    !d ||
    d.schemaVersion !== 1 ||
    !Array.isArray(d.ranking) ||
    !Array.isArray(d.rejected) ||
    !(d.chosen === null || (typeof d.chosen === 'string' && d.chosen))
  ) {
    return blocked('CONTROLLER_DECISION_INVALID');
  }
  const keys = d.ranking.map((c) => c?.candidateKey);
  const selected = d.ranking.find((c) => c?.candidateKey === d.chosen);
  if (
    keys.some((k) => typeof k !== 'string' || !k) ||
    new Set(keys).size !== keys.length ||
    (d.chosen
      ? !selected ||
        !selected.modelId ||
        !selected.harness ||
        JSON.stringify(decisionRow(selected)) !== JSON.stringify(decisionRow(d.selected || {}))
      : d.selected !== null)
  ) {
    return blocked('CONTROLLER_DECISION_INVALID');
  }
  const refused = !d.chosen && (d.ranking.length || d.rejected.length);
  if (options.error || (options.exitCode != null && options.exitCode !== 0 && !refused)) {
    return blocked('CONTROLLER_EXECUTION_ERROR');
  }
  return {
    ...d,
    workItemId: d.profile?.taskId || options.workItemId,
    controllerStatus: d.chosen ? 'READY' : refused ? 'REFUSED' : 'EMPTY',
    selected: d.chosen,
    candidates: d.ranking.map((c) => ({ ...decisionRow(c), offeringId: c.candidateKey })),
    reasonCode:
      d.reasonCode ||
      (refused ? 'CONTROLLER_REFUSED' : d.chosen ? null : 'CONTROLLER_EMPTY_CANDIDATES'),
  };
}

/**
 * The launch for one route of a structured Controller decision. The route comes
 * from the decision log, never from re-reading the printed ranking, and goes
 * through the same resolver and adapter the executor uses. A route the decision
 * does not hold, or that has no dispatch route, is refused instead of guessed.
 */
function launchFromDecision(decision, request, registry, context) {
  const d = decision || {};
  const r = request || {};
  const key = r.offeringId || d.selected;
  if (
    d.controllerStatus &&
    (d.controllerStatus !== 'READY' || !d.selected || key !== d.selected || key !== d.chosen)
  ) {
    throw new Error('CONTROLLER_CHOICE_REQUIRED');
  }
  const chosen = (d.candidates || []).find((c) => c && c.offeringId === key);
  if (!chosen) throw new Error('DECISION_ROUTE_MISSING');
  const provider = chosen.gateway || chosen.source || chosen.upstream;
  const reg = registry || loadSources();
  if (!dispatchRoute(provider, reg)) throw new Error('DECISION_ROUTE_UNRESOLVED');
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
  const harness = getHarness(route.harnessName);
  if (!harness) throw new Error('LAUNCHER_UNAVAILABLE');
  const prompt = r.sandboxNote ? [r.prompt, r.sandboxNote].filter(Boolean).join('\n\n') : r.prompt;
  const effort = chosen.effort || chosen.model_reasoning_effort || r.effort;
  const args = harness.launch({
    candidateKey: key,
    provider: route.provider,
    model: route.model,
    mode: r.mode,
    accountId: chosen.accountId,
    gateway: chosen.gateway || '',
    upstream: chosen.upstream,
    quotaScope: chosen.quotaScope,
    prompt,
    branch: r.branch,
    base: r.base,
    cwd: r.cwd,
    isolatedWorker: r.isolatedWorker,
    isolationVerdict: r.isolationVerdict,
    isolationVerdictPath: r.isolationVerdictPath,
    title: r.title,
    labels: r.labels || {},
    newWorkspace: r.newWorkspace,
    effort,
    tokenBudget: r.tokenBudget,
    outputTokens: r.outputTokens,
    workerTimeoutMs: r.workerTimeoutMs,
  });
  if (
    route.harnessName === 'codex' &&
    effort &&
    !args.includes(`model_reasoning_effort=${effort}`)
  ) {
    const mIdx = args.indexOf('--model');
    args.splice(mIdx !== -1 ? mIdx + 2 : 1, 0, '-c', `model_reasoning_effort=${effort}`);
  }
  return {
    offeringId: key,
    harness: route.harnessName,
    model: route.model,
    accountId: chosen.accountId,
    mode: r.mode,
    tokenBudget: r.tokenBudget,
    outputTokens: r.outputTokens,
    timeoutMs: r.workerTimeoutMs ?? r.timeoutMs,
    isolatedWorker: Boolean(r.isolatedWorker),
    check: { candidate: chosen, registry: reg },
    args,
  };
}

const MODE = 'full-access';
const known = (v) => v !== undefined && v !== null;
const normPath = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

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
  if (!dispatchRoute(provider, reg)) return 'LAUNCHER_UNAVAILABLE';
  let route = null;
  try {
    route = resolveRoute(
      { provider, model: c.modelId, harness: c.harness, gateway: c.gateway, upstream: c.upstream },
      {},
      reg
    );
    if (!getHarness(route.harnessName)) return 'LAUNCHER_UNAVAILABLE';
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
  const budget = ticket.tokenBudget ?? ticket.outputTokens;
  if (c.budget === 'UNKNOWN') return 'BUDGET_UNKNOWN';
  if (c.budget === 'FREE_ALLOWANCE' && budget > c.budgetRemainingTokens) {
    return 'BUDGET_BELOW_REQUEST';
  }
  const quotaOptions = { now, registry: reg, candidate: c };
  const quota = ctx.quotaState ? getQuotaScopeState(c, ctx.quotaState, quotaOptions) : null;
  if (isScopeBlocked(quota, now, quotaOptions)) return 'QUOTA_BLOCKED';
  if (known(c.maxOutputTokens) && Number(c.maxOutputTokens) < (ticket.outputTokens ?? budget)) {
    return 'BUDGET_BELOW_REQUEST';
  }
  const proofs = ((ctx.evidenceData || {}).combinations || [])
    .filter(
      (e) =>
        e.harness === route.harnessName &&
        (e.accessPath || '') === (c.accessPath || '') &&
        (e.model || e.modelId) === c.modelId &&
        (e.gateway || '') === (c.gateway || '') &&
        (e.upstream || '') === (c.upstream || '') &&
        (e.accountId || '*') === (c.accountId || '*') &&
        (e.quotaScope || '') === (c.quotaScope || '')
    )
    .flatMap((e) => e.evidence || [])
    .filter((e) => e && e.status === Status.PASSED);
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
  if (!decision.controllerStatus) {
    all.sort((a, b) => rank(b) - rank(a) || Number(b.score || 0) - Number(a.score || 0));
  }
  const eligible = [];
  const rejected = decision.controllerStatus ? [...(decision.rejected || [])] : [];
  for (const c of all) {
    const reason = routeRefusal(c, ticket, ctx, reg);
    if (reason) rejected.push({ offeringId: c.offeringId, reason });
    else eligible.push(c);
  }
  return { eligible, rejected };
}

/** The first launch of a ticket: the best usable route, or BLOCKED. */
function firstLaunch(decision, ticket, context, registry) {
  if (decision.controllerStatus && decision.controllerStatus !== 'READY') {
    return { action: 'BLOCKED', reason: decision.reasonCode, rejected: decision.rejected };
  }
  if (decision.controllerStatus && decision.selected !== decision.chosen) {
    return { action: 'BLOCKED', reason: 'CONTROLLER_CHOICE_REQUIRED', rejected: decision.rejected };
  }
  if (decision.workItemId !== ticket.workItemId) {
    return { action: 'BLOCKED', reason: 'DECISION_FOR_OTHER_TICKET', rejected: [] };
  }
  const ledger = (context && context.ledger) || {};
  if (ledger.activeWorker) {
    return { action: 'BLOCKED', reason: 'WORKER_STILL_ACTIVE', rejected: [] };
  }
  if (
    ledger.failures &&
    ledger.failures.length &&
    Number(ledger.fallbacksUsed || 0) >= Number(ticket.maxFallbacks)
  ) {
    return {
      action: 'STOP',
      reason: 'FALLBACK_LIMIT',
      used: Number(ledger.fallbacksUsed || 0),
      worktree: ledger.worktree,
    };
  }
  const { eligible, rejected } = screenRoutes(decision, ticket, context, registry);
  const chosen = decision.controllerStatus
    ? eligible.find((c) => c.offeringId === decision.selected)
    : eligible[0];
  if (decision.controllerStatus && !chosen) {
    return { action: 'BLOCKED', reason: 'CONTROLLER_CHOICE_UNAVAILABLE', rejected };
  }
  if (!eligible.length) return { action: 'BLOCKED', reason: 'NO_ELIGIBLE_ROUTE', rejected };
  const t = normalizeTicket(ticket);
  const request = {
    ...t.request,
    mode: t.mode,
    offeringId: chosen.offeringId,
    effort: chosen.effort || chosen.model_reasoning_effort || ticket.effort || t.request.effort,
    tokenBudget: t.tokenBudget,
    outputTokens: t.outputTokens,
    workerTimeoutMs: t.workerTimeoutMs,
  };
  if (ticket.base || ticket.fetchCheck || ticket.scopeText || ticket.dirtyDiff) {
    const built = buildLaunchPrompt(request.prompt || '', ticket);
    if (built.status !== 'ok') return { action: 'BLOCKED', reason: built.error, rejected };
    request.prompt = built.prompt;
  }
  return {
    action: 'LAUNCH',
    launch: launchFromDecision(decision, request, registry, context),
    rejected,
  };
}

/**
 * What to do after a failed launch. The ledger belongs to the ticket, so the one
 * fallback is a ceiling across workers and launchers. A failed route is never
 * sent the same request again. A worktree the failed worker left is kept: the
 * fallback continues inside it, and a stop reports it for review.
 * The caller checkpoints this ledger and records activeWorker on actual launch.
 * Internal harness retries never call this worker-change boundary. A post-launch
 * failure needs confirmed termination, even if no edits have been reported yet.
 */
function afterFailure(decision, ticket, context, failure, registry) {
  const ctx = context || {};
  const ledger = ctx.ledger;
  const f = failure || {};
  const beforeLaunch = f.phase === 'before-launch';
  if (ledger.activeWorker && (beforeLaunch || ledger.activeWorker.offeringId !== f.offeringId)) {
    return { action: 'STOP', reason: 'WORKER_STILL_ACTIVE', worktree: ledger.worktree };
  }
  if (!beforeLaunch && f.workerStopped !== true) {
    return {
      action: 'STOP',
      reason: 'WORKER_STOP_REQUIRED',
      worktree: f.worktree || ledger.worktree,
    };
  }
  delete ledger.activeWorker;
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
    class: beforeLaunch
      ? 'LAUNCH_FAILED'
      : Number(f.status) === 401 && viaGateway
        ? authClass[authLayer] || 'AUTH_SCOPE_UNKNOWN'
        : classifyFailure(f.status, f.message),
    phase: beforeLaunch ? 'before-launch' : 'after-launch',
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

function normalizeTicket(spec = {}, options = {}) {
  const req = spec.request || options.request || {};
  const mode = spec.mode || req.mode || options.mode || MODE;
  const tokenBudget = spec.tokenBudget ?? options.tokenBudget;
  const outputTokens = spec.outputTokens ?? options.outputTokens;
  return {
    workItemId: spec.workItemId || spec.item || options.workItemId,
    mode,
    tokenBudget,
    outputTokens,
    minProof: spec.minProof || options.minProof || 'NONE',
    maxFallbacks: spec.maxFallbacks ?? options.maxFallbacks ?? 1,
    workerTimeoutMs: spec.workerTimeoutMs ?? options.workerTimeoutMs,
    request: { ...req, mode, tokenBudget, outputTokens },
  };
}

function buildLaunchPrompt(taskContent, options = {}) {
  const { base, baseSha, fetchCheck, dirtyDiff, scopeText, allowedPaths } = options;
  if (fetchCheck?.failed) return { status: 'error', error: 'FETCH_FAILED' };
  const pinned = baseSha || base;
  if (!pinned || !/^[0-9a-f]{40}$/i.test(String(pinned)))
    return { status: 'error', error: 'BASE_NOT_IMMUTABLE' };
  const sections = [
    taskContent,
    `Pinned base: ${pinned}`,
    dirtyDiff && `Worktree diff:\n${dirtyDiff}`,
  ].filter(Boolean);
  if (!scopeText) return { status: 'ok', prompt: sections.join('\n\n') };
  const allowed = new Set((allowedPaths || []).map(normPath));
  if (!allowed.size) return { status: 'error', error: 'SCOPE_UNAUTHORIZED' };
  const outside = (
    scopeText.match(/[A-Za-z]:[\\/][^\s"'`,;]+|(?:[\w.@-]+[\\/])+[\w.@-]+\.[A-Za-z0-9]{1,8}/g) || []
  )
    .map(normPath)
    .filter(
      (p) =>
        p &&
        !/^[a-z]+:\/\//i.test(p) &&
        !allowed.has(p) &&
        ![...allowed].some((a) => a.startsWith(p + '/') || (a.endsWith('/') && p.startsWith(a)))
    );
  if (outside.length) return { status: 'error', error: 'SCOPE_EXPANSION_FORBIDDEN' };
  return { status: 'ok', prompt: [...sections, scopeText].join('\n\n') };
}

function revalidate(launch, options) {
  const ctx = options.context;
  const c = launch.check && launch.check.candidate;
  if (!ctx || !c) return null;
  const now = ctx.now || Date.now();
  const route = { id: c.gateway || c.upstream, accountId: c.accountId };
  if (ctx.routeHealth && !isEligible(ctx.routeHealth, c.modelId, route, now)) {
    return 'ROUTE_UNHEALTHY';
  }
  if (ctx.quotaState) {
    const quota = getQuotaScopeState(c, ctx.quotaState, {
      now,
      registry: launch.check.registry,
      candidate: c,
    });
    if (isScopeBlocked(quota, now)) return 'QUOTA_BLOCKED';
  }
  return null;
}

function laneBusy(lane, options) {
  if (!lane) return false;
  const fs = options.fs || require('fs');
  const path = options.path || require('path');
  const pool = options.pool || require('./agy-pool-runtime');
  let dir;
  try {
    dir = pool.accountDir(lane, options);
  } catch {
    return false;
  }
  const files = options.busyFiles || {};
  const job = files.job ? path.resolve(files.job) : path.join(dir, 'job.json');
  const result = files.result ? path.resolve(files.result) : path.join(dir, 'result.json');
  return fs.existsSync(job) && !fs.existsSync(result);
}

function executeLaunch(launch, options = {}) {
  const adapter = launch?.harness ? getHarness(launch.harness) : null;
  if (!adapter) return { status: 'refused', reason: 'UNKNOWN_HARNESS' };
  const isAgy = launch.harness === 'agy-pool';
  const lane = isAgy ? launch.accountId || options.lane || options.accountId : null;
  if (isAgy && laneBusy(lane, options)) {
    return { status: 'refused', reason: 'LANE_BUSY', accountId: lane };
  }
  const denied = revalidate(launch, options);
  if (denied) return { status: 'refused', reason: denied };
  const timeoutMs =
    launch.timeoutMs ??
    options.timeoutMs ??
    options.workerTimeoutMs ??
    (isAgy ? getDispatchConfig(launch.check?.registry, options).agyPoolTimeoutMs : undefined);
  const runOpts = {
    ...options,
    mode: launch.mode,
    tokenBudget: launch.tokenBudget,
    outputTokens: launch.outputTokens,
    timeoutMs,
  };
  if (typeof options.runner === 'function') return options.runner(adapter, launch.args, runOpts);
  const run =
    options.run ||
    (launch.isolatedWorker ? require('./isolation-launcher').getIsolatedLauncher() : runHarness);
  const res = run(adapter, launch.args.slice(), runOpts);
  const ok = Boolean(res && res.exitCode === 0);
  return {
    ...res,
    status: ok ? 'spawned' : 'failed',
    ...(!ok && { reason: (res && res.stderr) || 'HARNESS_NONZERO_EXIT' }),
    offeringId: launch.offeringId,
    accountId: lane ?? launch.accountId ?? null,
    ...(timeoutMs !== undefined && { timeoutSec: Math.round(timeoutMs / 1000) }),
  };
}

module.exports = {
  decisionFromDispatch,
  launchFromDecision,
  screenRoutes,
  firstLaunch,
  afterFailure,
  normalizeTicket,
  buildLaunchPrompt,
  executeLaunch,
};
