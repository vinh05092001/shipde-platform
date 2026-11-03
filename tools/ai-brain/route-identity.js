'use strict';

/**
 * Ship Dễ — Route Identity Specification (PATCH 1 - Fixed per Codex Review)
 *
 * Normalizes route identity across all pathways:
 * 1. 9router pathway: harness (http/opencode) -> gateway (9router) -> upstream connection -> outbound model
 * 2. Direct external pathway: harness (opencode/codex/direct-http) -> gateway (direct/none) -> direct provider -> outbound model
 * 3. AGY pool pathway: harness (agy-pool) -> Scheduled Task -> lane (agy01..agy10) -> agy.exe
 *
 * Fixes for Codex Review:
 * - Unambiguous key encoding: every component is escaped so components containing '::'
 *   (such as quotaScopeId 'quota::google::user') do NOT break component splitting.
 * - Non-colliding candidate keys: preserves sourceId and connectionId alongside accountRef
 *   so distinct sources/connections never collide.
 */

const GATEWAY_PREFIX_SEPARATOR = '::';
const UNKNOWN = 'UNKNOWN';

// Built-in known provider prefixes for 9router
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

function escapePart(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/%/g, '%25')
    .replace(/:/g, '%3A')
    .replace(/\u241f/g, '%241F');
}

function unescapePart(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/%3A/g, ':')
    .replace(/%241F/g, '\u241f')
    .replace(/%25/g, '%');
}

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

  let quotaScopeId = input.quotaScopeId || input.quotaScope;
  if (!quotaScopeId) {
    if (harness === 'agy-pool' || /^agy\d{2}$/i.test(accountRef)) {
      quotaScopeId = `agy-quota::${accountRef}`;
    } else if (gatewayId === '9router') {
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
 * Formats a canonical 9-part candidateKey:
 * harness::sourceId::gatewayId::upstream::connectionId::accountRef::quotaScope::configuredModelId::outboundModelId
 * Every part is escaped so components with '::' never break parsing.
 */
function canonicalCandidateKey(identity) {
  const i = identity || {};
  const harness = i.harness || UNKNOWN;
  const sourceId = i.sourceId || UNKNOWN;
  const gatewayId = i.gatewayId || 'direct';
  const upstream = i.upstreamProviderId || UNKNOWN;
  const connectionId = i.connectionId || UNKNOWN;
  const accountRef = i.accountRef || UNKNOWN;
  const quotaScope = i.quotaScopeId || UNKNOWN;
  const configuredModelId = i.configuredModelId || UNKNOWN;
  const outboundModelId = i.outboundModelId || UNKNOWN;

  return [
    harness,
    sourceId,
    gatewayId,
    upstream,
    connectionId,
    accountRef,
    quotaScope,
    configuredModelId,
    outboundModelId,
  ]
    .map(escapePart)
    .join(GATEWAY_PREFIX_SEPARATOR);
}

/**
 * Parses a candidate key back into a RouteIdentity.
 * Handles both 9-part escaped keys and legacy 7-part / 6-part keys.
 */
function parseRouteIdentity(key, defaults = {}) {
  if (typeof key !== 'string') return null;

  const rawParts = key.includes('::') ? key.split('::') : key.split('\u241f');

  // If 9 parts (canonical escaped format)
  if (rawParts.length === 9) {
    const p = rawParts.map(unescapePart);
    return createRouteIdentity({
      harness: p[0],
      sourceId: p[1],
      gatewayId: p[2],
      upstreamProviderId: p[3],
      connectionId: p[4],
      accountRef: p[5],
      quotaScopeId: p[6],
      configuredModelId: p[7],
      outboundModelId: p[8],
      ...defaults,
    });
  }

  // Legacy 7-part format: harness::accessPath::gateway::upstream::account::quotaScope::modelId
  if (rawParts.length === 7) {
    const p = rawParts.map(unescapePart);
    return createRouteIdentity({
      harness: p[0],
      pathway: p[1],
      gatewayId: p[2],
      upstreamProviderId: p[3],
      accountRef: p[4],
      quotaScopeId: p[5],
      configuredModelId: p[6],
      outboundModelId: p[6],
      ...defaults,
    });
  }

  // Legacy 6-part format
  if (rawParts.length === 6) {
    const p = rawParts.map(unescapePart);
    return createRouteIdentity({
      harness: p[0],
      pathway: p[1],
      gatewayId: p[2],
      upstreamProviderId: p[3],
      accountRef: p[4],
      quotaScopeId: UNKNOWN,
      configuredModelId: p[5],
      outboundModelId: p[5],
      ...defaults,
    });
  }

  return null;
}

/**
 * Links shared quota scopes across routes that share the same provider/account.
 * Explicit accountLinks keys are JSON.stringify([upstreamProviderId, realAccountRef]).
 */
function linkSharedQuotaScopes(identities, accountLinks) {
  if (!Array.isArray(identities)) return [];
  const links =
    accountLinks instanceof Map
      ? new Map(accountLinks)
      : accountLinks && typeof accountLinks === 'object'
        ? new Map(Object.entries(accountLinks))
        : new Map();

  // If no explicit links provided, auto-detect identical real accounts across routes/pathways
  if (links.size === 0) {
    const accountOccurrences = new Map();
    for (const id of identities) {
      const account = id.metadata?.realAccountRef || id.accountRef;
      const realAcc = JSON.stringify([id.upstreamProviderId, account]);
      if (
        account && account !== UNKNOWN && account !== '*' &&
        !String(account).startsWith('unknown')
      ) {
        if (!accountOccurrences.has(realAcc)) {
          accountOccurrences.set(realAcc, []);
        }
        accountOccurrences.get(realAcc).push(id);
      }
    }
    for (const [acc, ids] of accountOccurrences.entries()) {
      if (ids.length > 1) {
        // Shared account detected across multiple candidate routes
        const prov = ids[0].upstreamProviderId || 'shared';
        const canonicalScope = `quota::${prov}::${ids[0].metadata?.realAccountRef || ids[0].accountRef}`;
        links.set(acc, canonicalScope);
      }
    }
  }

  return identities.map((id) => {
    const realAcc = id.metadata?.realAccountRef || id.accountRef;
    const targetScope =
      links.get(JSON.stringify([id.upstreamProviderId, realAcc]));
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
 */
function expandComboIdentity(comboIdentity, constituentModels, candidateAccountMap = {}) {
  if (!comboIdentity) return null;
  const parent = comboIdentity.candidateKey ? comboIdentity : createRouteIdentity(comboIdentity);

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
      quotaScopeId: eligibleAccounts.length === 1 ? eligibleAccounts[0].quotaScopeId : UNKNOWN,
      isCombo: false,
      metadata: {
        parentCombo: parent.configuredModelId,
        branchIndex: index + 1,
        totalCandidatesForProvider: eligibleAccounts.length,
        ...(typeof m === 'object' ? m : {}),
        ...(typeof m === 'object' ? m.metadata : {}),
        capabilities: m.capabilities ?? m.metadata?.capabilities ?? [],
        candidateAccounts: eligibleAccounts.map((a) => ({
          connectionId: a.connectionId || UNKNOWN,
          accountRef: a.accountRef || UNKNOWN,
          priority: a.priority ?? UNKNOWN,
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
  escapePart,
  unescapePart,
  distinguishPathway,
  resolveModelPrefix,
  createRouteIdentity,
  canonicalCandidateKey,
  parseRouteIdentity,
  linkSharedQuotaScopes,
  expandComboIdentity,
};
