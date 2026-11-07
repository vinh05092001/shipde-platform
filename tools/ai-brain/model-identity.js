'use strict';

const DATA = require('../../config/model-identity.json');

const ScoreSource = Object.freeze({
  ROUTE_HISTORY: 'ROUTE_HISTORY',
  VERIFIED_MODEL_REFERENCE: 'VERIFIED_MODEL_REFERENCE',
  NO_DATA: 'NO_DATA',
});

/**
 * Separates the string sent to a provider from the name used to share capability.
 * `outboundModelId` is the route's own id, verbatim. `canonicalModelId` exists only
 * when a mapping names this source, this id and this version with evidence. Nothing
 * is inferred from how a name looks, and a route with no version never matches.
 */
function modelIdentity(route, mappings) {
  const r = route || {};
  const rows = mappings || DATA.mappings;
  const verified = rows.find((m) =>
    (m.routes || []).some(
      (e) =>
        e.source === r.source &&
        e.modelId === r.modelId &&
        Boolean(r.modelVersion) &&
        e.version === r.modelVersion &&
        Boolean(e.evidence)
    )
  );
  const canonical = r.isCombo || !verified ? null : verified.canonicalModelId;
  return { routeId: r.routeId, outboundModelId: r.modelId, canonicalModelId: canonical };
}

/** The opening score of a route and where it came from. */
function startingScore(route, data, mappings) {
  const d = data || {};
  const history = (d.routeScores || {})[route.routeId];
  if (history !== undefined) return { score: history, source: ScoreSource.ROUTE_HISTORY };
  const { canonicalModelId } = modelIdentity(route, mappings);
  const reference = canonicalModelId ? (d.modelScores || {})[canonicalModelId] : undefined;
  if (reference !== undefined) {
    return { score: reference, source: ScoreSource.VERIFIED_MODEL_REFERENCE, canonicalModelId };
  }
  return { score: null, source: ScoreSource.NO_DATA };
}

/**
 * What one outcome may touch. A failure stays in its own scope, never on the shared
 * model. A combo that did not report its executed model scores only the combo route.
 */
function outcomeTargets(route, outcome) {
  const o = outcome || {};
  const quotaScopes = o.scope === 'quotaScope' && route.quotaScope ? [route.quotaScope] : [];
  return { routes: [route.routeId], quotaScopes, models: [] };
}

/** JEV sees route ids that passed the filter, and only those. No model names. */
function jevOptions(eligibleRoutes) {
  return (eligibleRoutes || []).map((r) => r.routeId);
}

/** A JEV answer counts only when it names one of the offered routes exactly. */
function acceptJevChoice(choice, options) {
  return (options || []).includes(choice) ? choice : null;
}

module.exports = {
  ScoreSource,
  modelIdentity,
  startingScore,
  outcomeTargets,
  jevOptions,
  acceptJevChoice,
};
