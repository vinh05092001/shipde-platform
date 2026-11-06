'use strict';

const { resolveRoute } = require('./executor');
const { getHarness } = require('./harness');
const { loadSources } = require('./sources');

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
  });
  return { offeringId: key, harness: route.harnessName, model: route.model, args };
}

module.exports = { launchFromDecision };
