'use strict';

/**
 * Ship Dễ — Route Identity Construction
 *
 * Builds and freezes a route identity plus its non-colliding canonical candidate key.
 * Pure construction only: no quota linking, no combo expansion, no parsing.
 */

const {
  UNKNOWN,
  GATEWAY_PREFIX_SEPARATOR,
  escapePart,
  resolveModelPrefix,
  registerPrivateEmail,
  hashEmail,
  maskEmailsInString,
  sanitizeMetadata,
  distinguishPathway,
} = require('./route-identity-utils');

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

module.exports = { createRouteIdentity, canonicalCandidateKey };
