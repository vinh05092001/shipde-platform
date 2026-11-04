'use strict';

/**
 * Ship Dễ — Candidate Adapters
 *
 * Gathers candidate routes across 3 distinct pathways:
 * 1. 9router Adapter (via SQLite DB / model catalog / connections)
 * 2. Direct External Provider Adapter (OpenCode direct, Codex direct, Direct APIs)
 * 3. AGY Pool Adapter (Scheduled Task lanes agy01..agy10)
 */

const fs = require('fs');
const path = require('path');
const {
  createRouteIdentity,
  linkSharedQuotaScopes,
  PREFIX_PROVIDER_MAP,
  UNKNOWN,
  registerPrivateEmail,
  hashEmail,
} = require('./route-identity');
const {
  modelQuotaGroup,
  modelFamily,
  modelId,
  modelEvidence,
} = require('./candidate-adapters-common');
const { loadDirectProviderCandidates } = require('./candidate-adapters-direct');
const { readLaneIdentityEmail, loadAgyPoolCandidates } = require('./candidate-adapters-agy');

/**
 * Loads candidates from 9Router configuration / SQLite / Catalog.
 * Consumes connections and maps models to specific enabled connections.
 */
function load9RouterCandidates(options = {}) {
  const candidates = [];
  const unconnected = [];
  const isOffline = options.gatewayOffline === true || options.port20128Reachable === false;

  let rawCatalog = options.catalog;
  let connections = options.connections;

  if (!rawCatalog) {
    try {
      const candidatesPaths = [
        options.catalogPath,
        path.join(process.env.APPDATA || '', '9router', 'model-catalog.json'),
        path.join(process.env.USERPROFILE || '', '.9router', 'model-catalog.json'),
      ].filter(Boolean);

      for (const p of candidatesPaths) {
        if (fs.existsSync(p)) {
          const content = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (Array.isArray(content)) {
            rawCatalog = content;
            break;
          } else if (content && content.models && typeof content.models === 'object') {
            rawCatalog = Array.isArray(content.models)
              ? content.models
              : Object.entries(content.models).map(([id, evidence]) => ({ ...evidence, id }));
            break;
          }
        }
      }
    } catch {}
  }

  if (!connections) {
    try {
      const connPaths = [
        options.connectionsPath,
        path.join(process.env.APPDATA || '', '9router', 'connections.json'),
        path.join(process.env.APPDATA || '', '9router', '9router-connections.redacted.json'),
      ].filter(Boolean);

      for (const p of connPaths) {
        if (fs.existsSync(p)) {
          const content = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (Array.isArray(content)) {
            connections = content;
            break;
          } else if (content && Array.isArray(content.connections)) {
            connections = content.connections;
            break;
          }
        }
      }
    } catch {}
  }

  if (isOffline) {
    unconnected.push({
      sourceId: '9router',
      gatewayId: '9router',
      reason: 'GATEWAY_DAEMON_OFFLINE_PORT_20128',
    });
    return { candidates, unconnected };
  }

  if (!rawCatalog || !Array.isArray(rawCatalog) || rawCatalog.length === 0) {
    unconnected.push({
      sourceId: '9router',
      gatewayId: '9router',
      reason: 'NO_9ROUTER_DATA_OR_CATALOG_DISCOVERED',
    });
    return { candidates, unconnected };
  }

  const connectionList = Array.isArray(connections) ? connections : [];
  if (connectionList.length === 0) {
    return {
      candidates,
      unconnected: [{ sourceId: '9router', reason: 'NO_ENABLED_CONNECTIONS_DISCOVERED' }],
    };
  }

  for (const rawModel of rawCatalog) {
    const m = modelId(rawModel);
    if (!m || m.toLowerCase() === 'default') continue;

    const slash = m.indexOf('/');
    const prefix = slash !== -1 ? m.slice(0, slash) : null;
    const outbound = slash !== -1 ? m.slice(slash + 1) : m;
    const provider = (prefix && PREFIX_PROVIDER_MAP[prefix]) || prefix || '9router';

    if (connectionList.length > 0) {
      const matchingConnections = connectionList.filter((conn) => {
        if (conn.enabled === false) return false;
        const connProv = String(conn.provider || conn.prefix || '').toLowerCase();
        const resolvedConnProv = PREFIX_PROVIDER_MAP[connProv] || connProv;
        const provMatch =
          connProv === provider.toLowerCase() ||
          resolvedConnProv === provider.toLowerCase() ||
          (prefix && connProv === prefix.toLowerCase()) ||
          (prefix &&
            PREFIX_PROVIDER_MAP[prefix] &&
            connProv === PREFIX_PROVIDER_MAP[prefix].toLowerCase());
        return (
          provMatch && (!Array.isArray(conn.modelAllowlist) || conn.modelAllowlist.includes(m))
        );
      });

      if (matchingConnections.length === 0) {
        unconnected.push({
          sourceId: '9router',
          gatewayId: '9router',
          configuredModelId: m,
          reason: `NO_ENABLED_CONNECTION_FOR_PROVIDER_${provider.toUpperCase()}`,
        });
        continue;
      }

      for (const conn of matchingConnections) {
        const rawAcc = conn.accountRef || conn.connectionId || UNKNOWN;
        if (typeof rawAcc === 'string' && rawAcc.includes('@')) {
          registerPrivateEmail(conn.connectionId, rawAcc);
          registerPrivateEmail(hashEmail(rawAcc), rawAcc);
        }
        const accRef =
          typeof rawAcc === 'string' && rawAcc.includes('@') ? hashEmail(rawAcc) : rawAcc;
        const connId = conn.connectionId || UNKNOWN;
        candidates.push(
          createRouteIdentity({
            harness: options.harness || 'direct-http',
            sourceId: '9router',
            gatewayId: '9router',
            upstreamProviderId: conn.provider || provider,
            configuredModelId: m,
            outboundModelId: outbound,
            accountRef: accRef,
            connectionId: connId,
            quotaScopeId: `quota::${conn.provider || provider}::${accRef}`,
            metadata: {
              connectionId: connId,
              accountRef: accRef,
              prefix,
              ...modelEvidence(rawModel, options),
            },
          })
        );
      }
    }
  }

  return { candidates, unconnected };
}

/**
 * Aggregates candidates from all three pathways into a unified pool.
 * Automatically links shared accounts across pathways to prevent quota bypass.
 */
function aggregateAllCandidates(options = {}) {
  const c9 = load9RouterCandidates(options['9router'] || options);
  const cDirect = loadDirectProviderCandidates(options.direct || options);
  const cAgy = loadAgyPoolCandidates(options.agy || options);

  const rawCandidates = [...c9.candidates, ...cDirect.candidates, ...cAgy.candidates];
  const unconnected = [...c9.unconnected, ...cDirect.unconnected, ...cAgy.unconnected];

  const candidates = linkSharedQuotaScopes(rawCandidates, options.sharedAccountLinks);

  return {
    candidates,
    unconnectedSources: unconnected,
    counts: {
      totalCandidates: candidates.length,
      from9Router: c9.candidates.length,
      fromDirect: cDirect.candidates.length,
      fromAgyPool: cAgy.candidates.length,
      unconnectedCount: unconnected.length,
    },
  };
}

module.exports = {
  load9RouterCandidates,
  loadDirectProviderCandidates,
  loadAgyPoolCandidates,
  aggregateAllCandidates,
  readLaneIdentityEmail,
  modelQuotaGroup,
  modelFamily,
  modelId,
  modelEvidence,
  PREFIX_PROVIDER_MAP,
};
