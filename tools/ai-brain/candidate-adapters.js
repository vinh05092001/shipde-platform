'use strict';

/**
 * Ship Dễ — Candidate Adapters (PATCH 2)
 *
 * Gathers candidate routes across 3 distinct pathways:
 * 1. 9router Adapter (via SQLite DB / model catalog / connections)
 * 2. Direct External Provider Adapter (OpenCode direct, Codex direct, Direct APIs)
 * 3. AGY Pool Adapter (Scheduled Task lanes agy01..agy10)
 *
 * Strict Rules:
 * - NO invented fixture defaults in production code paths.
 * - Exact model IDs, prefixes, and casing preserved (including multi-slash models).
 * - "default" metadata excluded from specific model candidates.
 * - Connections consumed to produce per-connection candidate routes.
 * - Shared accounts across pathways linked to unified quota scopes.
 * - Unconnected sources have explicit, observable reasons, never silently dropped.
 */

const fs = require('fs');
const path = require('path');
const { createRouteIdentity, linkSharedQuotaScopes, PREFIX_PROVIDER_MAP, UNKNOWN, registerPrivateEmail, hashEmail } = require('./route-identity');

// Using shared PREFIX_PROVIDER_MAP imported from ./route-identity

function modelQuotaGroup(model) {
  const m = String(model || '').toLowerCase();
  if (/argon/i.test(m)) return 'argon';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('claude') || m.includes('gpt') || m.includes('opus') || m.includes('sonnet')) return 'external';
  return 'external';
}

function modelFamily(model) {
  return modelQuotaGroup(model);
}

function readLaneIdentityEmail(laneId, options) {
  if (typeof options?.readLaneIdentity === 'function') {
    const res = options.readLaneIdentity(laneId);
    const em = typeof res === 'string' ? res : (res?.email || res?.label);
    if (typeof em === 'string' && em.includes('@') && em !== laneId) return em.trim();
  }
  if (options?.laneIdentities && options.laneIdentities[laneId]) {
    const em = options.laneIdentities[laneId];
    if (typeof em === 'string' && em.includes('@') && em !== laneId) return em.trim();
  }
  try {
    const agyPool = require('./agy-pool-runtime');
    const dir = typeof agyPool.accountDir === 'function' ? agyPool.accountDir(laneId, options) : null;
    if (dir) {
      const idFile = path.join(dir, 'identity.json');
      if (fs.existsSync(idFile)) {
        const doc = JSON.parse(fs.readFileSync(idFile, 'utf8'));
        const email = doc.email || doc.label;
        if (typeof email === 'string' && email.includes('@') && email !== laneId) {
          return email.trim();
        }
      }
    }
  } catch {}
  return UNKNOWN;
}

// Preserve discovered evidence; absence is never a capability or ranking claim.
function modelId(model) {
  return typeof model === 'string' ? model.trim() : String(model?.id || model?.modelId || model?.model || model?.configuredModelId || '').trim();
}

function modelEvidence(model, options, source = {}) {
  const id = modelId(model);
  const evidence = typeof model === 'object' && model ? model : {};
  const metadata = {
    ...source.metadata,
    ...evidence,
    ...evidence.metadata,
    ...options.modelMetadata?.[id],
  };
  const inferredGroup = modelQuotaGroup(id);
  const explicitGroup = evidence.quotaGroup || metadata.quotaGroup;
  const explicitFamily = evidence.quotaFamily || metadata.quotaFamily;
  const familyToGroup = explicitFamily
    ? (/argon/i.test(explicitFamily) ? 'argon' : /claude|gpt|3p|external/i.test(explicitFamily) ? 'external' : /gemini/i.test(explicitFamily) ? 'gemini' : explicitFamily)
    : undefined;
  const quotaGroup = explicitGroup || familyToGroup || inferredGroup || undefined;
  const quotaFamily = explicitFamily || (quotaGroup === 'external' ? 'claude-gpt' : quotaGroup);
  return {
    ...metadata,
    ...(quotaGroup ? { quotaGroup } : {}),
    ...(quotaFamily ? { quotaFamily } : {}),
    capabilities: options.modelCapabilities?.[id] ?? metadata.capabilities ?? source.capabilities ?? [],
  };
}

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

  // In production: discover from actual files on disk if options omitted
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
            rawCatalog = Array.isArray(content.models) ? content.models : Object.entries(content.models).map(([id, evidence]) => ({ ...evidence, id }));
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

  // If no catalog discovered or empty: report unconnected reason, do NOT invent fake models!
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
    return { candidates, unconnected: [{ sourceId: '9router', reason: 'NO_ENABLED_CONNECTIONS_DISCOVERED' }] };
  }

  for (const rawModel of rawCatalog) {
    const m = modelId(rawModel);
    // Rule: Tách metadata "default" khỏi model cụ thể
    if (!m || m.toLowerCase() === 'default') continue;

    const slash = m.indexOf('/');
    const prefix = slash !== -1 ? m.slice(0, slash) : null;
    const outbound = slash !== -1 ? m.slice(slash + 1) : m;
    const provider = (prefix && PREFIX_PROVIDER_MAP[prefix]) || prefix || '9router';

    if (connectionList.length > 0) {
      // Consume connections: find matching connection(s) for this model's provider/prefix
      const matchingConnections = connectionList.filter((conn) => {
        if (conn.enabled === false) return false;
        const connProv = String(conn.provider || conn.prefix || '').toLowerCase();
        const resolvedConnProv = PREFIX_PROVIDER_MAP[connProv] || connProv;
        const provMatch =
          connProv === provider.toLowerCase() ||
          resolvedConnProv === provider.toLowerCase() ||
          (prefix && connProv === prefix.toLowerCase()) ||
          (prefix && PREFIX_PROVIDER_MAP[prefix] && connProv === PREFIX_PROVIDER_MAP[prefix].toLowerCase());
        return provMatch && (!Array.isArray(conn.modelAllowlist) || conn.modelAllowlist.includes(m));
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
        const accRef = typeof rawAcc === 'string' && rawAcc.includes('@') ? hashEmail(rawAcc) : rawAcc;
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
      const accRef = typeof rawAcc === 'string' && rawAcc.includes('@') ? hashEmail(rawAcc) : rawAcc;
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

/**
 * Loads AGY pool lanes (agy01..agy10 via Scheduled Task).
 */
function loadAgyPoolCandidates(options = {}) {
  const candidates = [];
  const unconnected = [];

  let lanes = options.lanes;
  let models = options.models;

  if (!lanes || !models) {
    try {
      const agyPool = require('./agy-pool-runtime');
      if (!lanes && typeof agyPool.discoverAccounts === 'function') {
        const accountIds = agyPool.discoverAccounts(options);
        lanes = accountIds.map((laneId) => {
          let quota;
          try {
            quota = typeof agyPool.quotaReading === 'function' ? agyPool.quotaReading(laneId, options) : null;
          } catch {}
          const realAccountRef = readLaneIdentityEmail(laneId, options);
          return {
            laneId,
            accountRef: realAccountRef,
            quota,
          };
        });
      }
      if (!models && typeof agyPool.discoverPoolModels === 'function') {
        models = agyPool.discoverPoolModels();
      }
    } catch {}
  }

  if (!lanes || lanes.length === 0 || !models || models.length === 0) {
    unconnected.push({
      sourceId: 'agy-pool',
      gatewayId: 'direct',
      reason: 'NO_AGY_LANES_OR_MODELS_DISCOVERED',
    });
    return { candidates, unconnected };
  }

  for (const lane of lanes) {
    if (lane.quotaExhausted) {
      unconnected.push({
        sourceId: 'agy-pool',
        laneId: lane.laneId,
        reason: 'AGY_LANE_QUOTA_EXHAUSTED',
      });
      continue;
    }

    let laneEmail = UNKNOWN;
    if (lane.accountRef && lane.accountRef !== lane.laneId && lane.accountRef !== UNKNOWN && String(lane.accountRef).includes('@')) {
      laneEmail = lane.accountRef;
    } else {
      laneEmail = readLaneIdentityEmail(lane.laneId, options);
    }
    if (laneEmail && laneEmail !== UNKNOWN && String(laneEmail).includes('@')) {
      registerPrivateEmail(lane.laneId, laneEmail);
      registerPrivateEmail(hashEmail(laneEmail), laneEmail);
    }

    for (const rawModel of models) {
      const m = modelId(rawModel);
      if (!m || String(m).toLowerCase() === 'default') continue;

      const rows = lane.quota?.rows || lane.rows || [];
      const evidence = modelEvidence(rawModel, options);
      const membershipRow = rows.find((r) => Array.isArray(r.models) && r.models.includes(m));
      const membershipGroup = membershipRow?.group || (membershipRow?.family ? (/argon/i.test(membershipRow.family) ? 'argon' : membershipRow.family === 'claude-gpt' ? 'external' : membershipRow.family) : null);
      const laneGroups = Array.isArray(lane.quota?.groups) ? lane.quota.groups : Array.isArray(lane.groups) ? lane.groups : [];
      const membershipFromGroup = laneGroups.find((g) => Array.isArray(g.models) && g.models.includes(m));
      const parsedGroup = membershipGroup || membershipFromGroup?.id || membershipFromGroup?.group;

      const targetGroup = (evidence.quotaFamily ? (/argon/i.test(evidence.quotaFamily) ? 'argon' : /claude|gpt|3p|external/i.test(evidence.quotaFamily) ? 'external' : 'gemini') : null)
        || (evidence.quotaGroup && evidence.quotaGroup !== 'gemini' && evidence.quotaGroup !== 'external' ? evidence.quotaGroup : null)
        || evidence.quotaGroup
        || parsedGroup
        || modelQuotaGroup(m);

      const matchingRows = rows.filter((r) => {
        if (modelId(r) === m) return true;
        if (Array.isArray(r.models) && r.models.includes(m)) return true;
        if (r.group && r.group === targetGroup) return true;
        if (r.family && (r.family === targetGroup || (targetGroup === 'external' && r.family === 'claude-gpt'))) return true;
        return false;
      });
      const exhausted = matchingRows.some((r) => r.disabled === true ||
        (r.remainingPercent != null && Number.isFinite(Number(r.remainingPercent)) && Number(r.remainingPercent) <= 0));
      const known = matchingRows.length > 0 && matchingRows.every((r) =>
        r.known !== false && r.remainingPercent != null && r.remainingPercent !== '' &&
        Number.isFinite(Number(r.remainingPercent)));
      if (lane.quota?.available === false || exhausted || !known) {
        unconnected.push({ sourceId: 'agy-pool', laneId: lane.laneId, configuredModelId: m,
          reason: exhausted ? 'AGY_MODEL_QUOTA_EXHAUSTED' : 'AGY_MODEL_QUOTA_UNKNOWN' });
        continue;
      }
      const quotaScopeKey = `agy-quota::${lane.laneId}::${targetGroup}`;
      candidates.push(
        createRouteIdentity({
          harness: 'agy-pool',
          sourceId: 'agy-pool',
          gatewayId: 'direct',
          upstreamProviderId: 'antigravity',
          configuredModelId: m,
          outboundModelId: m,
          accountRef: lane.laneId,
          connectionId: lane.laneId,
          quotaScopeId: quotaScopeKey,
          metadata: {
            laneId: lane.laneId,
            quotaGroup: targetGroup,
            ...evidence,
          },
        })
      );
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

  // Link shared quota scopes across pathways
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
  PREFIX_PROVIDER_MAP,
};
