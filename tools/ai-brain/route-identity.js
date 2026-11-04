'use strict';

/**
 * Ship Dễ — Route Identity Specification
 *
 * Normalizes route identity across all pathways:
 * 1. 9router pathway: harness -> gateway (9router) -> upstream connection -> outbound model
 * 2. Direct external pathway: harness -> gateway (direct) -> direct provider -> outbound model
 * 3. AGY pool pathway: harness (agy-pool) -> Scheduled Task -> lane (agy01..agy10) -> agy.exe
 */

const {
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
  registerPrivateEmail,
  getPrivateEmail,
  hashEmail,
  maskEmailsInString,
  sanitizeMetadata,
  getQuotaGroup,
} = require('./route-identity-utils');

const { expandComboIdentity } = require('./route-identity-combo');

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

function parseRouteIdentity(key, defaults = {}) {
  if (typeof key !== 'string') return null;

  const rawParts = key.includes('::') ? key.split('::') : key.split('\u241f');

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

function linkSharedQuotaScopes(identities, accountLinks) {
  if (!Array.isArray(identities)) return [];
  const links =
    accountLinks instanceof Map
      ? new Map(accountLinks)
      : accountLinks && typeof accountLinks === 'object'
        ? new Map(Object.entries(accountLinks))
        : new Map();

  function resolveRealAccount(id) {
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
  sanitizeMetadata,
  getQuotaGroup,
};
