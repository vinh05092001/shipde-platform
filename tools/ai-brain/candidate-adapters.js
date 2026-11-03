'use strict';

/**
 * Ship Dễ — Candidate Adapters (PATCH 2)
 *
 * Gathers candidate routes across 3 distinct pathways:
 * 1. 9router Adapter (via SQLite DB / model catalog)
 * 2. Direct External Provider Adapter (OpenCode direct, Codex direct, Direct APIs)
 * 3. AGY Pool Adapter (Scheduled Task lanes agy01..agy10)
 *
 * Rules:
 * - Exact model IDs, prefixes, and casing preserved (including multi-slash models).
 * - "default" metadata excluded from specific model candidates.
 * - Unconnected sources have explicit, observable reasons, never silently dropped.
 */

const fs = require('fs');
const path = require('path');
const { createRouteIdentity, UNKNOWN } = require('./route-identity');

/**
 * Loads candidates from 9Router configuration / SQLite / Catalog.
 */
function load9RouterCandidates(options = {}) {
  const candidates = [];
  const unconnected = [];
  const isOffline = options.gatewayOffline === true || options.port20128Reachable === false;

  const catalog = options.catalog || [
    'ag/gemini-3.8-flash',
    'ag/claude-opus-4-6-thinking',
    'gh/gpt-5.4-nano',
    'gcli/grok-4.7',
    'kimchi/glm-5.3',
    'kimchi/kimi-k3',
    'cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    'cl/dots-studio/dots-3-note-preview:free',
    'kgw/kilo-auto/free',
    'default', // metadata entry to be excluded
  ];

  const connections = options.connections || [
    { connectionId: '3af3ee18', provider: 'antigravity', accountRef: 'vi***07@gmail.com', enabled: true },
    { connectionId: 'aca6a8a1', provider: 'github', accountRef: 'vin***01', enabled: true },
    { connectionId: 'dc4d7156', provider: 'kimchi', accountRef: 'vi***01@gmail.com', enabled: true },
    { connectionId: '556a1a55', provider: 'cloudflare-ai', accountRef: 'vinh', enabled: true },
  ];

  for (const rawModel of catalog) {
    const m = String(rawModel).trim();
    // Rule: Tách metadata "default" khỏi model cụ thể
    if (!m || m.toLowerCase() === 'default') continue;

    const slash = m.indexOf('/');
    const prefix = slash !== -1 ? m.slice(0, slash) : null;
    const outbound = slash !== -1 ? m.slice(slash + 1) : m;

    if (isOffline) {
      unconnected.push({
        sourceId: '9router',
        gatewayId: '9router',
        configuredModelId: m,
        reason: 'GATEWAY_DAEMON_OFFLINE_PORT_20128',
      });
      continue;
    }

    candidates.push(
      createRouteIdentity({
        harness: options.harness || 'direct-http',
        sourceId: '9router',
        gatewayId: '9router',
        configuredModelId: m,
        outboundModelId: outbound,
        accountRef: '9router-pool',
        connectionId: UNKNOWN,
        quotaScopeId: `quota::9router::${prefix || 'direct'}`,
        metadata: {
          capabilities: options.modelCapabilities?.[m] || ['general_code', 'tool_call'],
        },
      })
    );
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

  const directSources = options.sources || [
    {
      id: 'deepseek-direct',
      provider: 'deepseek',
      harness: 'opencode', // OpenCode is the harness executing this!
      endpoint: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      credentialEnv: 'DEEPSEEK_API_KEY',
    },
    {
      id: 'codex-direct',
      provider: 'openai',
      harness: 'codex',
      endpoint: 'https://api.openai.com/v1',
      models: ['gpt-6.1-terra', 'gpt-5.3-codex'],
      credentialEnv: 'OPENAI_API_KEY',
    },
    {
      id: 'groq-direct',
      provider: 'groq',
      harness: 'direct-http',
      endpoint: 'https://api.groq.com/openai/v1',
      models: ['llama-3.3-70b-versatile'],
      credentialEnv: 'GROQ_API_KEY',
    },
  ];

  for (const src of directSources) {
    const hasKey = Boolean(options.env?.[src.credentialEnv] || process.env[src.credentialEnv]);

    if (!hasKey && options.skipMissingCredentials !== false) {
      unconnected.push({
        sourceId: src.id,
        gatewayId: 'direct',
        upstreamProviderId: src.provider,
        reason: `CREDENTIAL_ENV_UNSET_${src.credentialEnv}`,
      });
      continue;
    }

    for (const m of src.models || []) {
      if (m.toLowerCase() === 'default') continue;

      candidates.push(
        createRouteIdentity({
          harness: src.harness,
          sourceId: src.id,
          gatewayId: 'direct',
          upstreamProviderId: src.provider,
          configuredModelId: m,
          outboundModelId: m,
          accountRef: src.id,
          connectionId: src.id,
          quotaScopeId: `quota::${src.provider}::${src.id}`,
          metadata: {
            endpoint: src.endpoint,
            capabilities: options.modelCapabilities?.[m] || ['general_code', 'tool_call'],
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

  const lanes = options.lanes || [
    { laneId: 'agy01', accountRef: 'vi***01@gmail.com', quotaExhausted: false },
    { laneId: 'agy02', accountRef: 'vi***02@gmail.com', quotaExhausted: false },
    { laneId: 'agy07', accountRef: 'vi***07@gmail.com', quotaExhausted: false },
    { laneId: 'agy08', accountRef: 'vi***08@gmail.com', quotaExhausted: true },
  ];

  const models = options.models || ['gemini-3.8-flash', 'gemini-3.1-pro-high'];

  for (const lane of lanes) {
    if (lane.quotaExhausted) {
      unconnected.push({
        sourceId: 'agy-pool',
        laneId: lane.laneId,
        reason: 'AGY_LANE_QUOTA_EXHAUSTED',
      });
      continue;
    }

    for (const m of models) {
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
          quotaScopeId: `agy-quota::${lane.laneId}`,
          metadata: {
            laneId: lane.laneId,
            realAccountRef: lane.accountRef,
            capabilities: ['general_code', 'tool_call', 'large_context_64k'],
          },
        })
      );
    }
  }

  return { candidates, unconnected };
}

/**
 * Aggregates candidates from all three pathways into a unified pool.
 */
function aggregateAllCandidates(options = {}) {
  const c9 = load9RouterCandidates(options['9router'] || options);
  const cDirect = loadDirectProviderCandidates(options.direct || options);
  const cAgy = loadAgyPoolCandidates(options.agy || options);

  const candidates = [...c9.candidates, ...cDirect.candidates, ...cAgy.candidates];
  const unconnected = [...c9.unconnected, ...cDirect.unconnected, ...cAgy.unconnected];

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
};
