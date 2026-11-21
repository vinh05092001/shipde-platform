'use strict';

/**
 * Ship Dễ — Canonical failure-domain identity helpers (extracted from routing.js, TASK-AI-191).
 *
 * Single source of truth for failure-domain normalization and comparison across
 * intake, orchestrate, review, publisher, and dispatch — without pulling in the
 * legacy multi-route ranking/scoring engine.
 */

const fs = require('fs');
const path = require('path');

function failureDomainFromCandidateKey(key) {
  const parts = String(key || '').split('::');
  if (parts.length !== 7) return null;
  const domain = [parts[2], parts[3]].filter((p) => p && p !== '*');
  return domain.length ? domain.join('/') : 'unknown';
}

let upstreamGatewayIndex = null;
function getUpstreamGatewayIndex(registry) {
  if (registry && Array.isArray(registry.sources)) {
    const idx = new Map();
    for (const src of registry.sources) {
      if (src.routerAlias && src.reachedVia && !idx.has(src.routerAlias)) {
        idx.set(src.routerAlias, src.reachedVia);
      }
    }
    return idx;
  }
  if (upstreamGatewayIndex) return upstreamGatewayIndex;
  upstreamGatewayIndex = new Map();
  try {
    const catFile = path.join(__dirname, 'data', 'discovery', 'catalogue.jsonl');
    if (fs.existsSync(catFile)) {
      const raw = fs.readFileSync(catFile, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.upstream && entry.gateway && !upstreamGatewayIndex.has(entry.upstream)) {
            upstreamGatewayIndex.set(entry.upstream, entry.gateway);
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
  try {
    const { loadSources } = require('./sources');
    const loaded = loadSources();
    for (const src of (loaded && loaded.sources) || []) {
      if (src.routerAlias && src.reachedVia && !upstreamGatewayIndex.has(src.routerAlias)) {
        upstreamGatewayIndex.set(src.routerAlias, src.reachedVia);
      }
    }
  } catch (_) {}
  return upstreamGatewayIndex;
}

function resolveGatewayForUpstream(upstream, registry) {
  if (!upstream || upstream === '*') return '';
  const idx = getUpstreamGatewayIndex(registry);
  return idx.get(upstream) || '';
}

function canonicalFailureDomain(x, registry) {
  if (!x) return 'unknown';
  if (typeof x === 'object') {
    if (x.failureDomain && typeof x.failureDomain === 'string' && x.failureDomain !== 'unknown') {
      return x.failureDomain;
    }
    if (x.gateway && x.upstream && x.gateway !== '*') {
      return `${x.gateway}/${x.upstream}`;
    }
    if (x.candidateKey) {
      const fromKey = failureDomainFromCandidateKey(x.candidateKey);
      if (fromKey && fromKey !== 'unknown') return fromKey;
    }
    if (!x.gateway && x.upstream && x.upstream.startsWith('agy')) {
      return `agy/${x.upstream}`;
    }
    const gw =
      x.gateway && x.gateway !== '*' ? x.gateway : resolveGatewayForUpstream(x.upstream, registry);
    const up = x.upstream && x.upstream !== '*' ? x.upstream : '';
    const parts = [gw, up].filter(Boolean);
    return parts.length ? parts.join('/') : 'unknown';
  }

  const str = String(x).trim();
  if (str.includes('::')) {
    const fromKey = failureDomainFromCandidateKey(str);
    if (fromKey) return fromKey;
  }
  if (str.includes('/')) {
    const parts = str.split('/').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    if (parts.length === 1) return canonicalFailureDomain(parts[0]);
    return str;
  }
  const gw = resolveGatewayForUpstream(str);
  if (gw) {
    return `${gw}/${str}`;
  }
  return str;
}

function failureDomainOf(candidate) {
  return canonicalFailureDomain(candidate);
}

/** Compare candidates using the canonical identity for a classified failure scope. */
function sameFailureDomain(candidate, failed, classification) {
  if (!candidate || !failed || !classification) return false;
  const scope = classification.scope || 'unknown';
  const sameRoute = () => {
    const leftDomain = failureDomainOf(candidate);
    const rightDomain = failureDomainOf(failed);
    return leftDomain !== 'unknown' && rightDomain !== 'unknown' && leftDomain === rightDomain;
  };

  if (scope === 'gateway') {
    if (
      !candidate.gateway ||
      !failed.gateway ||
      candidate.gateway === '*' ||
      failed.gateway === '*'
    ) {
      return false;
    }
    return candidate.gateway === failed.gateway;
  }
  if (scope === 'upstream') {
    if (candidate.gateway === '*' || failed.gateway === '*') {
      return false;
    }
    return sameRoute();
  }
  if (scope === 'connection') {
    return (
      Boolean(classification.connectionId) &&
      candidate.connectionId === classification.connectionId &&
      sameRoute()
    );
  }
  if (scope === 'account') {
    const viaGateway = failed.gateway && failed.upstream && failed.gateway !== failed.upstream;
    const bare401 = classification.evidence?.httpStatus === 401 && !classification.authLayer;
    if (viaGateway && bare401) return false;
    if (viaGateway && classification.authLayer && candidate.gateway !== failed.gateway)
      return false;
    return (
      candidate.accountId &&
      failed.accountId &&
      candidate.accountId !== '*' &&
      failed.accountId !== '*' &&
      canonicalFailureDomain(candidate.accountId) === canonicalFailureDomain(failed.accountId)
    );
  }
  if (scope === 'candidate' || scope === 'model') {
    return (
      sameRoute() &&
      Boolean(
        (candidate.modelId || candidate.model) &&
        (candidate.modelId || candidate.model) === (failed.modelId || failed.model)
      )
    );
  }
  if (scope === 'access_path')
    return candidate.accessPath && candidate.accessPath === failed.accessPath;
  if (scope === 'harness') {
    if (classification.cause === 'launch_config') return false;
    return candidate.harness && candidate.harness === failed.harness;
  }
  return false;
}

/** Whether any identity dimension of the candidate is an explicitly forbidden domain. */
function matchesForbiddenDomain(candidate, forbiddenFailureDomains) {
  const domains = new Set(forbiddenFailureDomains || []);
  if (domains.size === 0) return false;
  const fields = [
    candidate.gateway,
    candidate.upstream,
    candidate.accountId,
    candidate.accessPath,
    candidate.harness,
  ];
  return fields.some((f) => f !== undefined && f !== null && f !== '*' && domains.has(f));
}

module.exports = {
  failureDomainFromCandidateKey,
  canonicalFailureDomain,
  failureDomainOf,
  sameFailureDomain,
  matchesForbiddenDomain,
};
