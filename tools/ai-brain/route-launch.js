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

  if (kind === 'agy-pool') {
    if (opts.laneBusy === true) return { status: 'BUSY' };
    const cwd = present(opts.cwd) ? opts.cwd : chosen.cwd;
    return {
      status: 'READY',
      kind,
      command: null,
      args: null,
      job: { cwd, model: chosen.modelId, accountId: chosen.account },
      runId,
      requestedRoute,
    };
  }

  if ((kind === 'model' || kind === 'combo') && chosen.harness === 'opencode') {
    const prefixes = opts.prefixes || {};
    const gateway = prefixes[chosen.source];
    const modelArg = gateway
      ? gateway + '/' + chosen.modelId
      : chosen.source + '/' + chosen.modelId;
    const args = ['-m', modelArg];
    if (present(opts.taskFile)) args.push(opts.taskFile);
    return {
      status: 'READY',
      kind,
      command: 'opencode',
      args,
      job: null,
      runId,
      requestedRoute,
    };
  }

  return { status: 'BLOCKED', reason: 'UNSUPPORTED_ROUTE' };
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
    failure: present(r.text) ? classifyFailure(r.text) : null,
  };
}

/**
 * Prepare the input for one new decide call after a failed launch.
 *
 * It copies the input, removes the candidate whose routeKey is the failed
 * route's routeKey — no other candidate is dropped, so a second account of the
 * same model stays usable — and appends the failure to `failures`. It never
 * retries and never calls decide itself.
 *
 * @param {Object} input - the previous decide input
 * @param {Object} decision - the decision that failed
 * @param {Object} failure - classifyFailure(decision failure text)
 * @returns {Object} a new decide input
 */
function nextDecisionInput(input, decision, failure) {
  const src = input || {};
  const d = decision || {};
  const failedKey = d.chosen ? routeKey(d.chosen) : null;
  const candidates = (src.candidates || []).filter(
    (c) => failedKey === null || routeKey(c) !== failedKey
  );
  const failures = Array.isArray(src.failures) ? src.failures.slice() : [];
  failures.push({
    routeKey: failedKey,
    runId: present(d.runId) ? d.runId : UNKNOWN,
    failure: failure === undefined ? null : failure,
  });
  return Object.assign({}, src, { candidates, failures });
}

module.exports = {
  buildLaunch,
  observed,
  nextDecisionInput,
};
