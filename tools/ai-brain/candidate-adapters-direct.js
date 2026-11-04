'use strict';

const {
  createRouteIdentity,
  UNKNOWN,
  registerPrivateEmail,
  hashEmail,
} = require('./route-identity');
const { modelId, modelEvidence } = require('./candidate-adapters-common');

/**
 * Loads direct external providers (OpenCode direct, Codex direct, direct APIs).
 * OpenCode is a harness, NOT a quota source.
 */
function loadDirectProviderCandidates(options = {}) {
  const candidates = [];
  const unconnected = [];

  let directSources = options.sources;

  if (!directSources) {
    try {
      const sourcesApi = require('./sources');
      const loaded = sourcesApi.loadSources();
      const allSrcs = Array.isArray(loaded) ? loaded : loaded?.sources || [];
      directSources = allSrcs.filter(
        (s) => s && s.id !== '9router' && s.id !== 'agy-pool' && s.id !== 'agy-local' && s.endpoint
      );
    } catch {}
  }

  if (!directSources || directSources.length === 0) {
    unconnected.push({
      sourceId: 'direct',
      gatewayId: 'direct',
      reason: 'NO_DIRECT_SOURCES_CONFIGURED',
    });
    return { candidates, unconnected };
  }

  for (const src of directSources) {
    const credEnv = src.credentialEnv || src.credential?.env;
    const hasKey = credEnv ? Boolean(options.env?.[credEnv] || process.env[credEnv]) : false;

    if (!hasKey && options.skipMissingCredentials !== false) {
      unconnected.push({
        sourceId: src.id,
        gatewayId: 'direct',
        upstreamProviderId: src.provider || src.id,
        reason: credEnv ? `CREDENTIAL_ENV_UNSET_${credEnv}` : 'CREDENTIAL_MISSING',
      });
      continue;
    }

    const models = Array.isArray(src.models) ? src.models : [];
    if (models.length === 0) {
      unconnected.push({
        sourceId: src.id,
        gatewayId: 'direct',
        upstreamProviderId: src.provider || src.id,
        reason: 'NO_MODELS_DISCOVERED_FOR_SOURCE',
      });
      continue;
    }

    for (const rawModel of models) {
      const m = modelId(rawModel);
      if (!m || String(m).toLowerCase() === 'default') continue;

      const rawAcc = src.accountRef || UNKNOWN;
      if (typeof rawAcc === 'string' && rawAcc.includes('@')) {
        registerPrivateEmail(src.id, rawAcc);
        registerPrivateEmail(hashEmail(rawAcc), rawAcc);
      }
      const accRef =
        typeof rawAcc === 'string' && rawAcc.includes('@') ? hashEmail(rawAcc) : rawAcc;
      const connId = src.id;
      const prov = src.provider || src.id;

      candidates.push(
        createRouteIdentity({
          harness: src.harness || 'direct-http',
          sourceId: src.id,
          gatewayId: 'direct',
          upstreamProviderId: prov,
          configuredModelId: m,
          outboundModelId: m,
          accountRef: accRef,
          connectionId: connId,
          quotaScopeId: `quota::${prov}::${accRef}`,
          metadata: {
            endpoint: src.endpoint,
            ...modelEvidence(rawModel, options, src),
          },
        })
      );
    }
  }

  return { candidates, unconnected };
}

module.exports = {
  loadDirectProviderCandidates,
};
