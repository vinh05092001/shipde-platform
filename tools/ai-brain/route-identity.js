const crypto = require('crypto');
const ROUTE_IDENTITY_DATA = require('../../config/route-identity.json');
('use strict');

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

// Known provider prefixes for 9router, loaded from the versioned route identity data.
const DEFAULT_PREFIX_TO_PROVIDER = Object.freeze({
  ...ROUTE_IDENTITY_DATA.prefixToProvider,
});

const PREFIX_PROVIDER_MAP = DEFAULT_PREFIX_TO_PROVIDER;

// Quota group -> quota family aliases, loaded from the same versioned data.
const QUOTA_FAMILY_BY_GROUP = Object.freeze({
  ...ROUTE_IDENTITY_DATA.quotaFamilies,
});

function getQuotaFamily(group) {
  if (group === null || group === undefined) return group;
  return QUOTA_FAMILY_BY_GROUP[group] || group;
}

function escapePart(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/%/g, '%25')
    .replace(/:/g, '%3A')
    .replace(/\u241f/g, '%241F');
}

function unescapePart(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/%3A/g, ':').replace(/%241F/g, '\u241f').replace(/%25/g, '%');
}

/**
 * Distinguishes the primary execution pathway of a route.
 */
const PRIVATE_ACCOUNT_EMAIL_MAP = new Map();
const PRIVATE_SALT = 'shipde-route-identity-salt-v1';

function hashEmail(email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  return crypto
    .createHash('sha256')
    .update(PRIVATE_SALT + '::' + normalized)
    .digest('hex')
    .slice(0, 10);
}

function registerPrivateEmail(key, email) {
  if (!key || !email) return;
  const k = String(key).trim();
  const e = String(email).trim().toLowerCase();
  if (e.includes('@')) {
    // Bindings are per (lane, account) and never rewritten for existing identities.
    PRIVATE_ACCOUNT_EMAIL_MAP.set(k, e);
    PRIVATE_ACCOUNT_EMAIL_MAP.set(k.toLowerCase(), e);
    const hash = hashEmail(e);
    PRIVATE_ACCOUNT_EMAIL_MAP.set(hash, e);
    PRIVATE_ACCOUNT_EMAIL_MAP.set(e, hash);
  }
}

function getPrivateEmail(key) {
  if (!key) return null;
  const k = String(key).trim();
  return PRIVATE_ACCOUNT_EMAIL_MAP.get(k) || PRIVATE_ACCOUNT_EMAIL_MAP.get(k.toLowerCase()) || null;
}

function maskEmailsInString(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (match) => {
    registerPrivateEmail(hashEmail(match), match);
    return hashEmail(match);
  });
}

function sanitizeMetadata(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    // Property names (keys) must be sanitized so email addresses are never copied into keys
    const safeKey = typeof k === 'string' && k.includes('@') ? maskEmailsInString(k) : k;

    if (
      safeKey === 'realAccountRef' ||
      safeKey === 'accountRef' ||
      safeKey === 'originalQuotaScope'
    ) {
      if (typeof v === 'string' && v.includes('@')) {
        registerPrivateEmail(hashEmail(v), v);
        out[safeKey] = hashEmail(v);
      } else {
        out[safeKey] = v;
      }
    } else if (typeof v === 'string' && v.includes('@')) {
      registerPrivateEmail(hashEmail(v), v);
      out[safeKey] = maskEmailsInString(v);
    } else if (Array.isArray(v)) {
      out[safeKey] = v.map((item) =>
        typeof item === 'object'
          ? sanitizeMetadata(item)
          : typeof item === 'string' && item.includes('@')
            ? (registerPrivateEmail(hashEmail(item), item), hashEmail(item))
            : item
      );
    } else if (v && typeof v === 'object') {
      out[safeKey] = sanitizeMetadata(v);
    } else {
      out[safeKey] = v;
    }
  }
  return out;
}

function getQuotaGroup(id) {
  if (id?.metadata?.quotaGroup) return id.metadata.quotaGroup;
  if (id?.metadata?.quotaFamily) {
    const f = String(id.metadata.quotaFamily).toLowerCase();
    if (f.includes('argon')) return 'argon';
    if (f.includes('gemini')) return 'gemini';
    if (f.includes('claude') || f.includes('gpt') || f.includes('3p') || f.includes('external'))
      return 'external';
    return f;
  }
  const m = String(id?.outboundModelId || id?.configuredModelId || '').toLowerCase();
  if (/argon/i.test(m)) return 'argon';
  if (m.includes('gemini')) return 'gemini';
  const prov = String(id?.upstreamProviderId || id?.sourceId || '').toLowerCase();
  if (prov.includes('antigravity') || prov.includes('agy')) {
    if (m.includes('claude') || m.includes('gpt') || m.includes('opus') || m.includes('sonnet'))
      return 'external';
    return 'external';
  }
  return undefined;
}
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
  const { upstreamProviderId: parsedProvider, outboundModelId: parsedOutbound } =
    resolveModelPrefix(configuredModelId, input.customAliases);

  const upstreamProviderId = input.upstreamProviderId || input.upstream || parsedProvider;
  const outboundModelId = input.outboundModelId || parsedOutbound;

  let connectionId = input.connectionId ? String(input.connectionId).trim() : UNKNOWN;
  if (typeof connectionId === 'string' && connectionId.includes('@')) {
    registerPrivateEmail(connectionId, connectionId);
    connectionId = hashEmail(connectionId);
  }
  let accountRef = input.accountRef || input.account || input.accountId || UNKNOWN;
  if (typeof accountRef === 'string' && accountRef.includes('@')) {
    registerPrivateEmail(accountRef, accountRef);
    accountRef = hashEmail(accountRef);
  }

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
  if (typeof quotaScopeId === 'string' && quotaScopeId.includes('@')) {
    quotaScopeId = maskEmailsInString(quotaScopeId);
  }
  const sanitizedMeta = sanitizeMetadata(input.metadata || {});
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
    metadata: sanitizedMeta,
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

  function resolveRealAccount(id) {
    // Link by private salted hash, NEVER by lane id alone
    const realRef = id.metadata?.realAccountRef;
    if (realRef && realRef !== UNKNOWN) {
      const fromReal = getPrivateEmail(realRef);
      if (fromReal) return fromReal;
      return realRef;
    }
    const fromPrivate =
      getPrivateEmail(id.accountRef) ||
      (id.metadata?.laneId && id.accountRef
        ? getPrivateEmail(id.metadata.laneId + '::' + id.accountRef)
        : null);
    if (fromPrivate) return fromPrivate;
    if (id.harness === 'agy-pool' || id.pathway === 'AGY_POOL') {
      return UNKNOWN;
    }
    const rawAcc = id.accountRef;
    return getPrivateEmail(rawAcc) || rawAcc;
  }

  // Auto-detect identical accounts for any account not explicitly mapped in links
  const accountOccurrences = new Map();
  for (const id of identities) {
    const account = resolveRealAccount(id);
    if (
      account &&
      account !== UNKNOWN &&
      account !== '*' &&
      !String(account).startsWith('unknown')
    ) {
      const prov = id.upstreamProviderId || 'shared';
      const qGroup = getQuotaGroup(id);
      const key = qGroup
        ? JSON.stringify([prov, account, qGroup])
        : JSON.stringify([prov, account]);
      if (!accountOccurrences.has(key)) {
        accountOccurrences.set(key, []);
      }
      accountOccurrences.get(key).push(id);
    }
  }

  for (const [key, ids] of accountOccurrences.entries()) {
    const parsedKey = JSON.parse(key);
    const [prov, account, qGroup] = parsedKey;
    const baseKey = JSON.stringify([prov, account]);
    // Auto-detect if not already explicitly mapped
    if (!links.has(key) && !links.has(baseKey) && !links.has(account) && ids.length > 1) {
      const safeAccount = String(account).includes('@') ? hashEmail(account) : account;
      const canonicalScope = qGroup
        ? `quota::${prov}::${safeAccount}::${qGroup}`
        : `quota::${prov}::${safeAccount}`;
      links.set(key, canonicalScope);
    }
  }

  return identities.map((id) => {
    const realAcc = resolveRealAccount(id);
    const prov = id.upstreamProviderId || 'shared';
    const qGroup = getQuotaGroup(id);
    const groupKey = qGroup ? JSON.stringify([prov, realAcc, qGroup]) : null;
    const baseKey = JSON.stringify([prov, realAcc]);
    const safeAcc = String(realAcc).includes('@') ? hashEmail(realAcc) : realAcc;
    const safeBaseKey = JSON.stringify([prov, safeAcc]);
    const safeGroupKey = qGroup ? JSON.stringify([prov, safeAcc, qGroup]) : null;

    const targetScope =
      (groupKey && links.get(groupKey)) ||
      (safeGroupKey && links.get(safeGroupKey)) ||
      links.get(baseKey) ||
      links.get(safeBaseKey) ||
      links.get(realAcc) ||
      links.get(safeAcc) ||
      links.get(id.accountRef) ||
      links.get(id.connectionId);

    if (targetScope && targetScope !== id.quotaScopeId) {
      const safeOrigScope =
        typeof id.quotaScopeId === 'string' && id.quotaScopeId.includes('@')
          ? maskEmailsInString(id.quotaScopeId)
          : id.quotaScopeId;
      return createRouteIdentity({
        ...id,
        quotaScopeId: targetScope,
        metadata: {
          ...id.metadata,
          linkedQuotaScope: true,
          originalQuotaScope: safeOrigScope,
        },
      });
    }
    return id;
  });
}
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
          quotaScopeId:
            a.quotaScopeId ||
            `quota::${upstreamProviderId}::${a.accountRef || a.connectionId || UNKNOWN}`,
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
  PREFIX_PROVIDER_MAP,
  QUOTA_FAMILY_BY_GROUP,
  getQuotaFamily,
  escapePart,
  unescapePart,
  distinguishPathway,
  resolveModelPrefix,
  createRouteIdentity,
  canonicalCandidateKey,
  parseRouteIdentity,
  linkSharedQuotaScopes,
  expandComboIdentity,
  registerPrivateEmail,
  getPrivateEmail,
  hashEmail,
  maskEmailsInString,
  getQuotaGroup,
};
