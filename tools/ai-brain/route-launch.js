'use strict';

/**
 * Ship Dễ — TASK-AI-171: the launcher keeps the route decision.
 *
 * Pure helper between a route decision and a launch. It never reads the clock,
 * the filesystem, the network or a process; every value comes from its
 * arguments. It never re-picks a route, replaces a model id, or swaps a combo
 * for a member: whatever `decide` chose is exactly what is launched. The gateway
 * prefix for a source is supplied as data (`prefixes`, a source -> prefix map),
 * never hard-coded.
 *
 * Failure replay it prevents: the selector picked one route but the launcher
 * sent another, so the logged score belonged to the route that did not run.
 */

const { classifyFailure, routeKey } = require('./route-decision');

const UNKNOWN = 'UNKNOWN';

function routeKeyOfChosen(chosen) {
  return chosen ? routeKey(chosen) : UNKNOWN;
}

function present(value) {
  return value !== undefined && value !== null;
}

function firstPresent(run, keys) {
  const r = run || {};
  for (const key of keys) {
    if (present(r[key]) && r[key] !== '') return r[key];
  }
  return UNKNOWN;
}

/**
 * Why a route cannot be launched, or null when it can. Pass it to decide() as
 * launchCheck, bound to the same options, so a route that cannot run never wins.
 *
 * @param {Object} route - a candidate or a decision's chosen
 * @param {{cwd?: string, prefixes?: Object, taskFile?: string, message?: string, busyLanes?: Array<string>, laneBusy?: boolean}} [options]
 * @returns {string|null}
 */
function launchBlocker(route, options) {
  const r = route || {};
  const opts = options || {};
  if (r.routeKind === 'agy-pool') {
    if (!present(r.account)) return 'LANE_UNKNOWN';
    if (!present(r.modelId)) return 'MODEL_UNKNOWN';
    if (!present(opts.cwd) && !present(r.cwd)) return 'CWD_MISSING';
    if (opts.laneBusy === true || (opts.busyLanes || []).includes(r.account)) return 'LANE_BUSY';
    return null;
  }
  if ((r.routeKind === 'model' || r.routeKind === 'combo') && r.harness === 'opencode') {
    if (!present(r.source) || !present(r.modelId)) return 'MODEL_UNKNOWN';
    const gateway = (opts.prefixes || {})[r.source] || r.source;
    if (String(r.modelId).startsWith(gateway + '/')) return 'PREFIX_ALREADY_PRESENT';
    if (!present(opts.taskFile)) return 'TASK_FILE_MISSING';
    if (!present(opts.message)) return 'MESSAGE_MISSING';
    return null;
  }
  return 'UNSUPPORTED_ROUTE';
}

/**
 * Whether the launcher can bind the requested account. Only an AGY lane job
 * names its account; an opencode argv has no account, so two accounts of one
 * model produce the same command and the account is not enforced.
 */
function accountBinding(route) {
  if (!present(route.account)) return 'NOT_REQUESTED';
  return route.routeKind === 'agy-pool' ? 'ENFORCED' : 'NOT_ENFORCED';
}

/** Who picks the account that really runs: the lane job, a gateway, or nobody we can name. */
function accountChosenBy(route, opts) {
  if (route.routeKind === 'agy-pool') return 'LAUNCHER';
  return (opts.prefixes || {})[route.source] ? 'GATEWAY' : UNKNOWN;
}

/**
 * Build the launch for a decision.
 *
 * A decision that is not DECIDED yields `{ status: 'BLOCKED' }` and no command.
 * An opencode `model` or `combo` route yields an `opencode` command whose argv
 * carries `-m <gateway-or-source>/<modelId>`, the model id untouched. An
 * `agy-pool` route yields the exact lane job `{ cwd, model, accountId }`; a busy
 * lane yields `{ status: 'BUSY' }` and no job. Any other harness or route kind
 * is refused with `UNSUPPORTED_ROUTE`. The launcher never chooses a route.
 *
 * @param {Object} decision - a decide() result
 * @param {{cwd?: string, prefixes?: Object<string,string>, taskFile?: string, laneBusy?: boolean}} [options]
 * @returns {Object}
 */
function buildLaunch(decision, options) {
  const d = decision || {};
  const opts = options || {};
  if (d.status !== 'DECIDED' || !d.chosen) return { status: 'BLOCKED' };

  const chosen = d.chosen;
  const runId = present(d.runId) ? d.runId : UNKNOWN;
  const requestedRoute = routeKeyOfChosen(chosen);
  const kind = chosen.routeKind;

  const blocker = launchBlocker(chosen, opts);
  if (blocker === 'LANE_BUSY') return { status: 'BUSY', reason: blocker };
  if (blocker) return { status: 'BLOCKED', reason: blocker };
  const account = accountBinding(chosen);

  if (kind === 'agy-pool') {
    const cwd = present(opts.cwd) ? opts.cwd : chosen.cwd;
    return {
      status: 'READY',
      kind,
      command: null,
      args: null,
      job: { cwd, model: chosen.modelId, accountId: chosen.account },
      runId,
      requestedRoute,
      account,
      accountChosenBy: 'LAUNCHER',
    };
  }

  const args = ['run', '-m', modelArgOf(chosen, opts), opts.message, '-f', opts.taskFile];
  return {
    status: 'READY',
    kind,
    command: 'opencode',
    args,
    job: null,
    runId,
    requestedRoute,
    account,
    accountChosenBy: accountChosenBy(chosen, opts),
    executedAccount: UNKNOWN,
  };
}

function modelArgOf(route, opts) {
  const gateway = (opts.prefixes || {})[route.source];
  return (gateway || route.source) + '/' + route.modelId;
}

/**
 * Record what was requested against what actually ran.
 *
 * runId, requestedRoute, executedModel and executedAccount fall back to the
 * decision and then to the string UNKNOWN; exitCode is kept exactly as given
 * (0 stays 0) and is UNKNOWN when absent. failure is classifyFailure(run.text)
 * only when text is present. This is the audit that catches a launcher that ran
 * a route other than the one the decision named.
 *
 * @param {Object} decision - a decide() result
 * @param {Object} [run] - observed run data
 * @returns {Object}
 */
function observed(decision, run) {
  const d = decision || {};
  const r = run || {};
  return {
    runId: present(r.runId) ? r.runId : present(d.runId) ? d.runId : UNKNOWN,
    requestedRoute: present(r.requestedRoute) ? r.requestedRoute : routeKeyOfChosen(d.chosen),
    executedModel: firstPresent(r, ['executedModel', 'model', 'modelId']),
    executedAccount: firstPresent(r, ['executedAccount', 'account', 'accountId']),
    exitCode: present(r.exitCode) ? r.exitCode : UNKNOWN,
    accountHeld: accountHeld(
      d.chosen,
      firstPresent(r, ['executedAccount', 'account', 'accountId'])
    ),
    failure: present(r.text) ? classifyFailure(r.text) : null,
  };
}

/** True or false only when the executed account was seen; otherwise UNKNOWN. */
function accountHeld(chosen, executed) {
  if (!chosen || !present(chosen.account) || executed === UNKNOWN) return UNKNOWN;
  return executed === chosen.account;
}

/** Same harness, source, kind and model on an opencode route means the same command. */
function sameCommand(a, b) {
  if (a.routeKind === 'agy-pool' || b.routeKind === 'agy-pool') return false;
  return (
    a.source === b.source &&
    a.harness === b.harness &&
    a.routeKind === b.routeKind &&
    a.modelId === b.modelId
  );
}

/**
 * Prepare the input for one new decide call after a failed launch.
 *
 * It copies the input, removes the candidate whose routeKey is the failed
 * route's routeKey — no other candidate is dropped, so a second account of the
 * same model stays usable — and appends the failure to `failures`. It never
 * retries and never calls decide itself.
 *
 * Retries are bounded by `input.retryBudget`: a run may only produce another
 * input while the budget is a number above 0, and the returned input carries
 * the budget reduced by one. There is no default; an absent or non-positive
 * budget fails closed with `RETRY_BUDGET_EXHAUSTED` and no candidates, so a
 * failed run can never loop forever.
 *
 * @param {Object} input - the previous decide input
 * @param {Object} decision - the decision that failed
 * @param {Object} failure - classifyFailure(decision failure text)
 * @returns {Object} a new decide input, or a BLOCKED result
 */
function nextDecisionInput(input, decision, failure, run) {
  const src = input || {};
  const d = decision || {};
  const failedKey = d.chosen ? routeKey(d.chosen) : null;
  const failures = Array.isArray(src.failures) ? src.failures.slice() : [];
  failures.push({
    routeKey: failedKey,
    runId: present(d.runId) ? d.runId : UNKNOWN,
    failure: failure === undefined ? null : failure,
  });
  const budget = src.retryBudget;
  if (!(Number.isInteger(budget) && budget > 0)) {
    return {
      status: 'BLOCKED',
      reason: 'RETRY_BUDGET_EXHAUSTED',
      failures,
    };
  }
  // A route whose account the launcher cannot bind would repeat the same command,
  // so it leaves with the failed route instead of counting as a different try.
  const candidates = (src.candidates || []).filter(
    (c) => failedKey === null || (routeKey(c) !== failedKey && !sameCommand(c, d.chosen))
  );
  const scoped = applyFailureScope(src, d.chosen, failure, candidates, run);
  return Object.assign({}, src, scoped, { failures, retryBudget: budget - 1 });
}

/**
 * Carry what a failure proves onto routes sharing the same quotaScope, before the
 * next decide. A monthly quota failure marks them exhausted; a credit failure caps
 * their budget at what the wallet can afford. Without a quotaScope nothing spreads,
 * and an upstream outage never spreads: it says nothing about a shared wallet.
 *
 * The scope on paper is not proof. A gateway may run another account than the one
 * decided, so a wallet is touched only when the failure is proven to belong to it
 * (see failureProvesScope). Otherwise only the equivalent call leaves this retry.
 */
function failureProvesScope(chosen, failure, run) {
  if (present(failure && failure.scope)) return failure.scope === chosen.quotaScope;
  if (accountBinding(chosen) === 'ENFORCED') return true;
  const seen = (run || {}).executedAccount;
  return present(chosen.account) && present(seen) && seen === chosen.account;
}

function applyFailureScope(src, chosen, failure, candidates, run) {
  const scope = chosen ? chosen.quotaScope : undefined;
  const kind = failure && failure.class;
  if (!present(scope) || !failureProvesScope(chosen, failure, run)) return { candidates };
  const shares = (c) => c.quotaScope === scope;
  if (kind === 'QUOTA_MONTHLY') {
    const states = Object.assign({}, src.states);
    for (const c of candidates.filter(shares)) {
      states[routeKey(c)] = Object.assign({}, states[routeKey(c)], { quota: 'EXHAUSTED' });
    }
    return { candidates, states };
  }
  if (kind === 'CREDIT_BUDGET' && Number.isInteger(failure.affordable)) {
    const capped = candidates.map((c) =>
      shares(c)
        ? Object.assign({}, c, {
            budget: Object.assign({}, c.budget, { maxOutputTokens: failure.affordable }),
          })
        : c
    );
    return { candidates: capped };
  }
  return { candidates };
}

module.exports = {
  launchBlocker,
  buildLaunch,
  observed,
  nextDecisionInput,
};
