'use strict';

const { candidateKey } = require('./candidates');

// Project only routing evidence: candidate objects can also contain adapter configuration.
function row(c) {
  return {
    candidateKey: c.candidateKey || c.offeringId || candidateKey(c),
    source: c.source || c.sourceId || null,
    harness: c.harness || null,
    gateway: c.gateway || null,
    upstream: c.upstream || null,
    modelId: c.modelId || null,
    accountId: c.accountId || c.account || null,
    score: c.score ?? null,
    scoreBreakdown: c.scoreBreakdown || null,
    reasonCode: c.reasonCode || null,
    reason: c.reason || c.blockReason || null,
  };
}

function filterStage(stage, before, after, rejected = []) {
  return { stage, before: before.map(row), after: after.map(row), rejected: rejected.map(row) };
}

function filterPins(candidates, args, deps = {}) {
  const filters = [...(candidates.filters || [])];
  let kept = candidates.slice();
  for (const field of ['model', 'account', 'harness']) {
    const pin = args[field] || deps[field];
    if (!pin) continue;
    const before = kept;
    kept = before.filter((c) =>
      field === 'model'
        ? [c.modelId, c.model, c.base].includes(pin)
        : field === 'account'
          ? [c.accountId, c.account].includes(pin)
          : c.harness === pin
    );
    filters.push(
      filterStage(
        'pin:' + field,
        before,
        kept,
        before
          .filter((c) => !kept.includes(c))
          .map((c) => ({ ...c, reasonCode: 'PIN_MISMATCH', reason: field + ' does not match pin' }))
      )
    );
  }
  Object.defineProperties(kept, {
    filters: { value: filters },
    excludedRoutes: { value: candidates.excludedRoutes || [] },
  });
  return kept;
}

function dispatchOutput(profile, assessment, candidates, result) {
  const ranking = result.ranking || result.candidates || [];
  const filters = [...(candidates.filters || [])];
  const inputs = new Map(
    filters
      .flatMap((f) => f.before)
      .concat(candidates.map(row))
      .map((c) => [c.candidateKey, c])
  );
  // The first refusal of a route stands: ranking reasons come before filter stages, as in the
  // rejected slice every profile consumer already reads.
  const rejected = [...(result.rejected || []), ...filters.flatMap((f) => f.rejected)].map((c) =>
    row({ ...inputs.get(c.candidateKey || c.offeringId), ...c })
  );
  filters.push(filterStage('ranking', candidates, ranking, result.rejected || []));
  return {
    schemaVersion: 1,
    profile,
    assessment,
    scoreScale: assessment.scoringPolicy
      ? `policy:${assessment.scoringPolicy.version}:0-1`
      : 'controller:weighted-profile',
    ...(assessment.scoringPolicyStatus
      ? { scoringPolicyStatus: assessment.scoringPolicyStatus }
      : {}),
    ...(assessment.scoringPriorsStatus
      ? { scoringPriorsStatus: assessment.scoringPriorsStatus }
      : {}),
    chosen: result.chosen || null,
    selected: ranking.find((c) => (c.candidateKey || c.offeringId) === result.chosen)
      ? row(ranking.find((c) => (c.candidateKey || c.offeringId) === result.chosen))
      : null,
    ranking: ranking.map(row),
    rejected: [...new Map(rejected.reverse().map((c) => [c.candidateKey, c])).values()].reverse(),
    reason: result.reason || null,
    reasonCode: result.reasonCode || result.refused || null,
    filters,
  };
}

function serializeDispatchOutput(value, metadata = {}) {
  const { launch, codeSha } = metadata;
  const receipt = {};
  for (const key of 'pid status exitCode signal offeringId harness model accountId'.split(' ')) {
    if (launch && ['string', 'number', 'boolean'].includes(typeof launch[key]))
      receipt[key] = launch[key];
  }
  const { launch: ignored, ...decision } = value;
  const stable = JSON.stringify(
    { ...decision, codeSha: codeSha || null, ...(launch ? { launch: receipt } : {}) },
    (_, entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(
            Object.keys(entry)
              .sort()
              .map((key) => [key, entry[key]])
          )
        : entry
  );
  return require('./coordinator-text').safeText(stable);
}

module.exports = { filterStage, filterPins, dispatchOutput, serializeDispatchOutput };
