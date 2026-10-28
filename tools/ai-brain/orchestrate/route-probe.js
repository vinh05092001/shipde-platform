// Safety invariant: reviewer canonical-model probe cap
const sources = require('../sources.json');
const PROBE_BUDGET_MS = Number(sources.dispatch?.probeBudgetMs);

function resolveLaunchRoute(candidate, options, registry) {
  const { resolveRoute } = require('../executor');
  return resolveRoute(
    {
      provider: candidate && (candidate.source || candidate.upstream || candidate.gateway),
      model: candidate && candidate.modelId,
      harness: candidate && candidate.harness,
    },
    { isolatedWorker: Boolean(options && options.isolatedWorker) },
    registry
  );
}

/** An OpenCode provider's models are addressed `<providerKey>/<model>`; the wire id has no key. */
function stripOpencodeProviderPrefix(modelId, source) {
  const key = source && (source.opencodeProvider || source.id);
  return key && String(modelId).startsWith(key + '/')
    ? String(modelId).slice(key.length + 1)
    : modelId;
}

function routeProbeCandidate(candidate, route, registry, allowModelFallback = true) {
  const sources = (registry && registry.sources) || [];
  const routeSource = [candidate.gateway, candidate.source, route && route.provider]
    .map((id) => sources.find((entry) => entry.id === id))
    .find(
      (entry) => entry && (entry.endpoint || /^https?:\/\//i.test(String(entry.accessPath || '')))
    );
  const exactModel = String((route && route.model) || candidate.modelId || candidate.model || '');
  const upstreamModel = stripOpencodeProviderPrefix(
    exactModel.replace(/^ninerouter\//i, ''),
    routeSource
  );
  const modelSource = sources.find(
    (entry) =>
      entry &&
      (entry.endpoint || /^https?:\/\//i.test(String(entry.accessPath || ''))) &&
      Array.isArray(entry.models) &&
      (entry.models.includes(exactModel) || entry.models.includes(upstreamModel))
  );
  let source = routeSource || (allowModelFallback && modelSource) || null;
  if (!source && candidate.upstream) {
    source = sources.find(
      (entry) =>
        entry.id === candidate.upstream &&
        (entry.endpoint || /^https?:\/\//i.test(String(entry.accessPath || '')))
    );
  }
  if (
    source &&
    !source.endpoint &&
    !/^https?:\/\//i.test(String(source.accessPath || '')) &&
    source.reachedVia
  ) {
    source = sources.find((entry) => entry.id === source.reachedVia) || source;
  }
  const accessPath =
    (source &&
      (source.endpoint ||
        (/^https?:\/\//i.test(String(source.accessPath || '')) && source.accessPath))) ||
    candidate.accessPath ||
    candidate.sourceEndpoint;
  const apiKeyEnv = source && source.credential && source.credential.env;
  if (!accessPath || !apiKeyEnv || !/^[A-Za-z0-9_]+$/.test(apiKeyEnv)) return null;
  return {
    accessPath,
    // OpenCode's provider prefix is local configuration, not a gateway alias.
    modelId: upstreamModel,
    maxOutputTokens: candidate.maxOutputTokens || candidate.max_output_tokens,
    apiKeyEnv,
    ...(source.headers && typeof source.headers === 'object' ? { headers: source.headers } : {}),
  };
}

module.exports = {
  PROBE_BUDGET_MS,
  resolveLaunchRoute,
  stripOpencodeProviderPrefix,
  routeProbeCandidate,
};
