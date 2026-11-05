#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — TASK-AI-170: Independent Reviewer Identity & Independence Verification
 *
 * Canonical candidate parsing, key generation, and independence validation.
 */

const norm = (val) => String(val === undefined || val === null ? '' : val).trim().toLowerCase();

/**
 * Generates a 7-part candidate key from object parts.
 */
export function candidateKeyFromParts(c = {}) {
  const account = c.account !== undefined && c.account !== null ? c.account : (c.accountId || '');
  const model = c.modelId !== undefined && c.modelId !== null ? c.modelId : (c.model || '');
  return [
    c.harness || 'UNKNOWN',
    c.accessPath || 'UNKNOWN',
    c.gateway || '',
    c.upstream || '',
    account,
    c.quotaScope || 'UNKNOWN',
    model,
  ].join('::');
}

/**
 * Canonical identity parser and validator.
 * Parses candidateKey -> { gateway, upstream, account, model }.
 * If object has fields, each present field must match candidateKey, otherwise invalid.
 * If any of the four dimensions (gateway, upstream, account, model) is empty or UNKNOWN -> invalid.
 *
 * @param {object|string} candidate
 * @returns {object|null} Canonical identity object or null if invalid
 */
export function canonicalIdentity(candidate) {
  if (!candidate) return null;

  let rawKey = '';
  let obj = null;

  if (typeof candidate === 'string') {
    rawKey = candidate.trim();
  } else if (typeof candidate === 'object') {
    obj = candidate;
    const existingKey = candidate.candidateKey || candidate.key;
    rawKey = typeof existingKey === 'string' ? existingKey.trim() : '';
  } else {
    return null;
  }

  // If candidate is an object without candidateKey, construct candidateKey from object fields
  if (!rawKey && obj) {
    rawKey = candidateKeyFromParts(obj);
  }

  const parts = rawKey.split('::');
  if (parts.length !== 7) {
    return null;
  }

  const keyHarness = parts[0].trim();
  const keyAccessPath = parts[1].trim();
  const keyGateway = parts[2].trim();
  const keyUpstream = parts[3].trim();
  const keyAccount = parts[4].trim();
  const keyQuotaScope = parts[5].trim();
  const keyModel = parts[6].trim();

  // All four core dimensions must be non-empty and not UNKNOWN
  const gatewayNorm = norm(keyGateway);
  const upstreamNorm = norm(keyUpstream);
  const accountNorm = norm(keyAccount);
  const modelNorm = norm(keyModel);

  if (
    !gatewayNorm || gatewayNorm === 'unknown' ||
    !upstreamNorm || upstreamNorm === 'unknown' ||
    !accountNorm || accountNorm === 'unknown' ||
    !modelNorm || modelNorm === 'unknown'
  ) {
    return null;
  }

  // If candidate object has fields, each present field must strictly match key
  if (obj) {
    for (const prop of ['gateway', 'upstream', 'account', 'accountId', 'model', 'modelId']) {
      if (Object.hasOwn(obj, prop)) {
        const val = obj[prop];
        if (val === null || val === undefined || String(val).trim() === '') {
          return null;
        }
      }
    }

    if (obj.gateway !== undefined && obj.gateway !== null && norm(obj.gateway) !== gatewayNorm) {
      return null;
    }
    if (obj.upstream !== undefined && obj.upstream !== null && norm(obj.upstream) !== upstreamNorm) {
      return null;
    }
    if (obj.account !== undefined && obj.account !== null && norm(obj.account) !== accountNorm) {
      return null;
    }
    if (obj.accountId !== undefined && obj.accountId !== null && norm(obj.accountId) !== accountNorm) {
      return null;
    }
    if (obj.model !== undefined && obj.model !== null && norm(obj.model) !== modelNorm) {
      return null;
    }
    if (obj.modelId !== undefined && obj.modelId !== null && norm(obj.modelId) !== modelNorm) {
      return null;
    }

    if (obj.harness !== undefined && obj.harness !== null && norm(obj.harness) !== norm(keyHarness)) {
      return null;
    }
    if (obj.accessPath !== undefined && obj.accessPath !== null && norm(obj.accessPath) !== norm(keyAccessPath)) {
      return null;
    }
    if (obj.quotaScope !== undefined && obj.quotaScope !== null && norm(obj.quotaScope) !== norm(keyQuotaScope)) {
      return null;
    }
  }

  return {
    harness: keyHarness || (obj && obj.harness ? String(obj.harness).trim() : 'UNKNOWN'),
    accessPath: keyAccessPath || (obj && obj.accessPath ? String(obj.accessPath).trim() : 'UNKNOWN'),
    gateway: keyGateway,
    upstream: keyUpstream,
    account: keyAccount,
    quotaScope: keyQuotaScope || (obj && obj.quotaScope ? String(obj.quotaScope).trim() : 'UNKNOWN'),
    modelId: keyModel,
    model: keyModel,
    candidateKey: rawKey,
    qualifiedRoles: (obj && Array.isArray(obj.qualifiedRoles)) ? obj.qualifiedRoles : ['reviewer'],
  };
}

/**
 * Parses candidate attributes from a candidate object or 7-part key string.
 * Delegates directly to canonicalIdentity for consistent validation.
 */
export function parseCandidate(candidate) {
  return canonicalIdentity(candidate);
}

/**
 * Checks independence of a reviewer candidate against the writer candidate.
 * Returns { independent: true } or { independent: false, reason: '...' }.
 */
export function checkIndependence(writerCandidate, reviewerCandidate) {
  const writerParsed = canonicalIdentity(writerCandidate);
  const reviewerParsed = canonicalIdentity(reviewerCandidate);

  if (!writerParsed || !reviewerParsed) {
    return { independent: false, reason: 'INVALID_CANDIDATE: writer or reviewer could not be parsed' };
  }

  // Same candidate key or object
  if (
    writerParsed.candidateKey &&
    reviewerParsed.candidateKey &&
    norm(writerParsed.candidateKey) === norm(reviewerParsed.candidateKey)
  ) {
    return { independent: false, reason: 'SAME_CANDIDATE: reviewer is the writer' };
  }

  // Upstream independence
  const writerUpstream = norm(writerParsed.upstream);
  const reviewerUpstream = norm(reviewerParsed.upstream);
  if (writerUpstream === reviewerUpstream) {
    return { independent: false, reason: `SAME_UPSTREAM: reviewer shares upstream '${reviewerParsed.upstream}'` };
  }

  // Model independence
  const writerModel = norm(writerParsed.model);
  const reviewerModel = norm(reviewerParsed.model);
  if (writerModel === reviewerModel) {
    return { independent: false, reason: `SAME_MODEL: reviewer shares modelId '${reviewerParsed.modelId}'` };
  }

  // Gateway independence
  const writerGateway = norm(writerParsed.gateway);
  const reviewerGateway = norm(reviewerParsed.gateway);
  if (writerGateway === reviewerGateway) {
    return { independent: false, reason: `SAME_GATEWAY: reviewer shares gateway '${reviewerParsed.gateway}'` };
  }

  // Account independence
  const writerAccount = norm(writerParsed.account);
  const reviewerAccount = norm(reviewerParsed.account);
  if (writerAccount === reviewerAccount) {
    return { independent: false, reason: `SAME_ACCOUNT: reviewer shares account '${reviewerParsed.account}'` };
  }

  return { independent: true };
}

export { norm };
