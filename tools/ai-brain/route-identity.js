'use strict';

/**
 * Ship Dễ — Route Identity Specification (PATCH 1)
 *
 * Normalizes route identity across all pathways:
 * 1. 9router pathway: harness (http/opencode) -> gateway (9router) -> upstream connection -> outbound model
 * 2. Direct external pathway: harness (opencode/codex/direct-http) -> gateway (direct/none) -> direct provider -> outbound model
 * 3. AGY pool pathway: harness (agy-pool) -> Scheduled Task -> lane (agy01..agy10) -> agy.exe
 *
 * Identity Fields:
 * - harness: execution harness (e.g. 'opencode', 'codex', 'agy-pool', 'direct-http', 'cline', 'paseo')
 * - sourceId: registry source id ('9router', 'oc', 'codex', 'agy-pool', 'direct-api', etc.)
 * - gatewayId: gateway router ('9router', 'direct', 'none')
 * - upstreamProviderId: resolved upstream provider ('antigravity', 'github', 'claude', 'kiro', 'kimchi', 'deepseek', etc.)
 * - connectionId: specific connection ID in gateway/DB (e.g. '3af3ee18-...') or 'UNKNOWN'
 * - accountRef: readable account reference (e.g. 'vi***07@gmail.com', 'agy01', 'Account 1') or 'UNKNOWN'
 * - configuredModelId: exact model as configured/requested (e.g. 'ag/gemini-3.8-flash', 'shipde-writer', 'kimchi/glm-5.3')
 * - outboundModelId: model sent upstream after prefix rewrite/strip (e.g. 'gemini-3.8-flash', 'glm-5.3')
 * - quotaScopeId: identifier of the quota pool. Shared accounts share quotaScopeId without doubling budget.
 * - jobId: tracking job ID or 'UNKNOWN'
 * - attemptId: tracking attempt sequence or 'UNKNOWN'
 * - isCombo: boolean
 * - comboBranches: array of constituent branch identities if isCombo
 * - pathway: '9ROUTER' | 'DIRECT' | 'AGY_POOL'
 */

const GATEWAY_PREFIX_SEPARATOR = '::';
const UNKNOWN = 'UNKNOWN';

// Built-in known provider prefixes for 9router (from 9router package metadata)
const DEFAULT_PREFIX_TO_PROVIDER = Object.freeze({
  ag: 'antigravity',
  gh: 'github',
  cc: 'claude',
  kr: 'kiro',
  gcli: 'grok-cli',
  cl: 'cline',
  cf: 'cloudflare-ai',
  kgw: 'kilo-gateway',
  nous: 'nous',
  ollama: 'ollama',
  mistral: 'mistral',
  kimchi: 'kimchi',
  qd: 'qoder',
  bzl: 'bazaarlink',
  groq: 'groq',
  el: 'elevenlabs',
  jina: 'jina-ai',
  polly: 'aws-polly',
  xmtp: 'xiaomi-tokenplan',
});

/**
 * Distinguishes the primary execution pathway of a route.
 */
function distinguishPathway(identity) {
  if (!identity) return UNKNOWN;
  const h = String(identity.harness || '').toLowerCase();
  const s = String(identity.sourceId || '').toLowerCase();
  const g = String(identity.gatewayId || '').toLowerCase();
  const acc = String(identity.accountRef || identity.account || '').toLowerCase();

  // 1. AGY pool pathway
  if (h === 'agy-pool' || s.startsWith('agy') || /^agy\d{2}$/i.test(acc)) {
    return 'AGY_POOL';
  }

  // 2. 9router pathway
  if (g === '9router' || s === '9router' || identity.isVia9Router === true) {
    return '9ROUTER';
  }

  // 3. Direct external pathway (OpenCode direct, Codex direct, direct HTTP)
  return 'DIRECT';
}

/**
 * Strips provider prefix if present, resolving upstream provider and outbound model.
 * Preserves multi-slash models (e.g. cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast).
 */
function resolveModelPrefix(modelId, customAliases = {}) {
  const m = String(modelId || '').trim();
  if (!m) {
    return { prefix: null, upstreamProviderId: UNKNOWN, outboundModelId: UNKNOWN };
  }

  const slashIdx = m.indexOf('/');
  if (slashIdx === -1) {
    // No slash: direct model or combo alias
    const p = customAliases[m] || DEFAULT_PREFIX_TO_PROVIDER[m] || m;
    return { prefix: null, upstreamProviderId: p, outboundModelId: m };
  }

  const prefix = m.slice(0, slashIdx);
  const remainder = m.slice(slashIdx + 1);
  const resolvedProvider = customAliases[prefix] || DEFAULT_PREFIX_TO_PROVIDER[prefix] || prefix;

  return {
    prefix,
    upstreamProviderId: resolvedProvider,
    outboundModelId: remainder,
  };
}

/**
 * Creates a normalized route identity object with all standard fields.
 * Any unobserved field is strictly initialized to UNKNOWN (never invented).
 */
function createRouteIdentity(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Route identity input must be an object');
  }

  const harness = input.harness ? String(input.harness).trim() : UNKNOWN;
  const sourceId = input.sourceId ? String(input.sourceId).trim() : UNKNOWN;
  
  // Determine gateway: default to direct unless explicitly 9router or through 9router
  let gatewayId = input.gatewayId || input.gateway;
  if (!gatewayId) {
    if (sourceId === '9router' || (input.endpoint && String(input.endpoint).includes('20128'))) {
      gatewayId = '9router';
    } else {
      gatewayId = 'direct';
    }
  }

  const configuredModelId = input.configuredModelId || input.modelId || input.model || UNKNOWN;
  const { upstreamProviderId: parsedProvider, outboundModelId: parsedOutbound } = resolveModelPrefix(
    configuredModelId,
    input.customAliases
  );

  const upstreamProviderId = input.upstreamProviderId || input.upstream || parsedProvider;
  const outboundModelId = input.outboundModelId || parsedOutbound;

  const connectionId = input.connectionId ? String(input.connectionId).trim() : UNKNOWN;
  const accountRef = input.accountRef || input.account || input.accountId || UNKNOWN;

  // Derive quotaScopeId:
  // If explicitly given, use it; otherwise construct a canonical scope.
  let quotaScopeId = input.quotaScopeId || input.quotaScope;
  if (!quotaScopeId) {
    if (harness === 'agy-pool' || /^agy\d{2}$/i.test(accountRef)) {
      quotaScopeId = `agy-quota::${accountRef}`;
    } else if (gatewayId === '9router') {
      // 9router upstream connection quota scope
      quotaScopeId = `quota::${upstreamProviderId}::${accountRef !== UNKNOWN ? accountRef : connectionId}`;
    } else {
      quotaScopeId = `quota::${upstreamProviderId}::${accountRef}`;
    }
  }

  const jobId = input.jobId ? String(input.jobId).trim() : UNKNOWN;
  const attemptId = input.attemptId ? String(input.attemptId).trim() : UNKNOWN;

  const isCombo = Boolean(input.isCombo || (input.comboBranches && input.comboBranches.length > 0));
  const comboBranches = Array.isArray(input.comboBranches) ? input.comboBranches : [];

  const identity = {
    harness,
    sourceId,
    gatewayId,
    upstreamProviderId,
    connectionId,
    accountRef,
    configuredModelId,
    outboundModelId,
    quotaScopeId,
    jobId,
    attemptId,
    isCombo,
    comboBranches,
    metadata: input.metadata || {},
  };

  identity.pathway = distinguishPathway(identity);
  identity.candidateKey = canonicalCandidateKey(identity);

  return Object.freeze(identity);
}

/**
 * Formats a canonical 7-part candidateKey compatible with existing tools:
 * harness::accessPath::gateway::upstream::account::quotaScope::modelId
 */
function canonicalCandidateKey(identity) {
  const i = identity || {};
  const harness = i.harness || UNKNOWN;
  const accessPath = i.pathway || distinguishPathway(i);
  const gateway = i.gatewayId || 'direct';
  const upstream = i.upstreamProviderId || UNKNOWN;
  const account = i.accountRef !== UNKNOWN ? i.accountRef : (i.connectionId !== UNKNOWN ? i.connectionId : '*');
  const quotaScope = i.quotaScopeId || UNKNOWN;
  const modelId = i.configuredModelId || i.outboundModelId || UNKNOWN;

  return [harness, accessPath, gateway, upstream, account, quotaScope, modelId].join(
    GATEWAY_PREFIX_SEPARATOR
  );
}

/**
 * Parses a canonical candidate key back into a RouteIdentity.
 */
function parseRouteIdentity(key, defaults = {}) {
  if (typeof key !== 'string') return null;
  const parts = key.includes('::') ? key.split('::') : key.split('\u241f');
  
  if (parts.length >= 7) {
    return createRouteIdentity({
      harness: parts[0] || defaults.harness,
      pathway: parts[1],
      gatewayId: parts[2] || defaults.gatewayId,
      upstreamProviderId: parts[3] || defaults.upstreamProviderId,
      accountRef: parts[4] || defaults.accountRef,
      quotaScopeId: parts[5] || defaults.quotaScopeId,
      configuredModelId: parts[6] || defaults.configuredModelId,
      ...defaults,
    });
  }

  if (parts.length === 6) {
    return createRouteIdentity({
      harness: parts[0] || defaults.harness,
      pathway: parts[1],
      gatewayId: parts[2] || defaults.gatewayId,
      upstreamProviderId: parts[3] || defaults.upstreamProviderId,
      accountRef: parts[4] || defaults.accountRef,
      quotaScopeId: UNKNOWN,
      configuredModelId: parts[5] || defaults.configuredModelId,
      ...defaults,
    });
  }

  return null;
}

/**
 * Links shared quota scopes across routes that share the same underlying account.
 * When an account link evidence exists (e.g. 9router connection and AGY lane both using vinh1032007@gmail.com),
 * updates quotaScopeId to the canonical linked pool without doubling budgets.
 *
 * @param {Array<Object>} identities List of route identities
 * @param {Map<string, string>|Object} accountLinks Map of accountRef/connectionId -> canonicalQuotaScopeId
 */
function linkSharedQuotaScopes(identities, accountLinks) {
  if (!Array.isArray(identities) || !accountLinks) return identities;
  const links = accountLinks instanceof Map ? accountLinks : new Map(Object.entries(accountLinks));

  return identities.map((id) => {
    const targetScope = links.get(id.accountRef) || links.get(id.connectionId);
    if (targetScope && targetScope !== id.quotaScopeId) {
      return createRouteIdentity({
        ...id,
        quotaScopeId: targetScope,
        metadata: {
          ...id.metadata,
          linkedQuotaScope: true,
          originalQuotaScope: id.quotaScopeId,
        },
      });
    }
    return id;
  });
}

/**
 * Expands a 9router combo into its constituent branch candidate identities.
 * Preserves the original combo alias on the parent and orders all branches sequentially.
 *
 * @param {Object} comboIdentity The parent combo route identity
 * @param {Array<string|Object>} constituentModels List of model IDs or model objects in the combo
 * @param {Object} candidateAccountMap Map of upstreamProvider -> list of active connections
 */
function expandComboIdentity(comboIdentity, constituentModels, candidateAccountMap = {}) {
  if (!comboIdentity) return null;
  const parent = typeof comboIdentity.candidateKey ? comboIdentity : createRouteIdentity(comboIdentity);

  const branches = (constituentModels || []).map((m, index) => {
    const modelStr = typeof m === 'string' ? m : m.modelId || m.configuredModelId || m.id;
    const { prefix, upstreamProviderId, outboundModelId } = resolveModelPrefix(modelStr);

    const eligibleAccounts = candidateAccountMap[upstreamProviderId] || [];

    return createRouteIdentity({
      harness: parent.harness,
      sourceId: parent.sourceId,
      gatewayId: parent.gatewayId,
      upstreamProviderId,
      configuredModelId: modelStr,
      outboundModelId,
      accountRef: eligibleAccounts.length === 1 ? eligibleAccounts[0].accountRef : UNKNOWN,
      connectionId: eligibleAccounts.length === 1 ? eligibleAccounts[0].connectionId : UNKNOWN,
      quotaScopeId: `quota::${upstreamProviderId}::${eligibleAccounts.length === 1 ? eligibleAccounts[0].accountRef : 'pool'}`,
      isCombo: false,
      metadata: {
        parentCombo: parent.configuredModelId,
        branchIndex: index + 1,
        totalCandidatesForProvider: eligibleAccounts.length,
        candidateAccounts: eligibleAccounts.map((a) => ({
          connectionId: a.connectionId || UNKNOWN,
          accountRef: a.accountRef || UNKNOWN,
          priority: a.priority ?? 999,
        })),
      },
    });
  });

  return createRouteIdentity({
    ...parent,
    isCombo: true,
    comboBranches: branches,
  });
}

module.exports = {
  UNKNOWN,
  GATEWAY_PREFIX_SEPARATOR,
  DEFAULT_PREFIX_TO_PROVIDER,
  distinguishPathway,
  resolveModelPrefix,
  createRouteIdentity,
  canonicalCandidateKey,
  parseRouteIdentity,
  linkSharedQuotaScopes,
  expandComboIdentity,
};
