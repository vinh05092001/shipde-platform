'use strict';

const { probeSource } = require('./source-discovery');
const { candidateKey } = require('./candidates');
const sourcesApi = require('./sources');
const assessments = new WeakMap();

// A /models response is inventory, never proof of a successful inference.
// Keep this view in memory; the source/key registry remains owned by its author.
async function refreshWriterRegistry(registry, options = {}) {
  const sources = await Promise.all(
    (registry.sources || []).map(async (source) => {
      if (
        source.kind !== 'router' ||
        source.enabled === false ||
        source.servesModels === false ||
        !source.endpoint ||
        sourcesApi.isRetired(source.id, registry) ||
        sourcesApi.isDeferred(source.id, registry)
      )
        return source;
      const credential = source.credential || {};
      const reading = await probeSource(
        {
          ...source,
          models: [],
          modelMeta: {},
          credential:
            credential.type === 'api-key' ? { type: 'env', name: credential.env } : credential,
        },
        {
          env: { ...process.env, ...options.env },
          fetch: (url, init) =>
            (options.fetchModels || options.fetch || globalThis.fetch)(url, {
              ...init,
              signal: AbortSignal.timeout(5000),
            }),
        }
      );
      return {
        ...source,
        models: reading.status === 'available' ? reading.models : source.models || [],
        modelMeta: { ...source.modelMeta, ...reading.modelMeta },
        writerInventory: {
          status: reading.status === 'available' ? 'listed' : 'unavailable',
          listed: reading.status === 'available' ? reading.models.length : null,
          observedAt: reading.lastProbeAt,
          probeSucceeded: false,
        },
      };
    })
  );
  return { ...registry, sources };
}

async function assessOnce(profile, source, ask, options, routing) {
  let cache = assessments.get(options);
  if (!cache) {
    cache = new Map();
    assessments.set(options, cache);
  }
  // Only actual JEV inputs participate; attempt number and excluded routes do not.
  const key = JSON.stringify({
    question: routing.jevQuestion(profile),
    source: source && {
      id: source.id,
      endpoint: source.endpoint,
      model: source.model,
      minConfidence: source.minConfidence,
    },
  });
  const prior = cache.get(key);
  if (prior && prior.ask === options.jevAsk) return prior.result;
  const result = routing.assessTask(profile, {
    ask,
    source,
    minConfidence: source && source.minConfidence,
  });
  cache.set(key, { ask: options.jevAsk, result });
  return result;
}

function applyProbe(candidate, result) {
  const quota = (result && result.quota) || {
    status: 'unknown',
    remaining: {},
    source: 'not-exposed',
  };
  candidate.routeEvidence = {
    ...candidate.routeEvidence,
    configured: true,
    probeSucceeded: result?.ok === true,
    status: result?.status || 0,
  };
  candidate.probeQuota = quota;
  if (quota.status === 'exhausted') {
    candidate.blocked = true;
    candidate.blockReason = 'QUOTA_EXHAUSTED: route probe';
    candidate.blockScope = 'candidate';
  }
  return { candidateKey: candidateKey(candidate), quota };
}

function inventoryEvidence(candidate, registry, configured) {
  const source = (registry.sources || []).find(
    (s) => s.id === (candidate.sourceId || candidate.source || candidate.gateway)
  );
  return {
    ...candidate.routeEvidence,
    listed:
      source?.writerInventory?.status === 'listed'
        ? (source.models || []).includes(candidate.modelId)
        : null,
    configured,
    probeSucceeded: candidate.routeEvidence?.probeSucceeded === true,
  };
}

module.exports = { refreshWriterRegistry, assessOnce, applyProbe, inventoryEvidence };
