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
  escapePart,
  unescapePart,
  distinguishPathway,
  resolveModelPrefix,
  registerPrivateEmail,
  getPrivateEmail,
  hashEmail,
  maskEmailsInString,
  sanitizeMetadata,
} = require('./route-identity-utils');

const { expandComboIdentity } = require('./route-identity-combo');

const { createRouteIdentity, canonicalCandidateKey } = require('./route-identity-create');

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
      outboundModelId: resolveModelPrefix(p[6]).outboundModelId,
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
      outboundModelId: resolveModelPrefix(p[5]).outboundModelId,
      ...defaults,
    });
  }

  return null;
}

module.exports = {
  UNKNOWN,
  GATEWAY_PREFIX_SEPARATOR,
  DEFAULT_PREFIX_TO_PROVIDER,
  PREFIX_PROVIDER_MAP,
  escapePart,
  unescapePart,
  distinguishPathway,
  resolveModelPrefix,
  createRouteIdentity,
  canonicalCandidateKey,
  parseRouteIdentity,
  expandComboIdentity,
  registerPrivateEmail,
  getPrivateEmail,
  hashEmail,
  maskEmailsInString,
  sanitizeMetadata,
};
