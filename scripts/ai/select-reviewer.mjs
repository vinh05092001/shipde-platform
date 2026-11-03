#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — TASK-AI-170: Independent Reviewer Selector
 *
 * Selects an independent reviewer candidate for a given author/writer candidate.
 * Independence enforcement:
 * - Excludes candidates sharing the same account with the writer.
 * - Excludes candidates sharing the same model with the writer.
 * - Excludes candidates sharing the same gateway with the writer.
 * - Excludes candidates sharing the same upstream with the writer.
 *
 * If no eligible independent reviewer candidates remain, returns status BLOCKED with detailed reason.
 * If live selection API is not yet connected/merged, provides a stub with "chưa nối".
 * Zero hardcoded model names in this module.
 */

const norm = (val) => String(val === undefined || val === null ? '' : val).trim().toLowerCase();

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
    for (const prop of ['gateway', 'upstream', 'account', 'model']) {
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
    const objAccount = obj.account !== undefined && obj.account !== null ? obj.account : obj.accountId;
    if (objAccount !== undefined && objAccount !== null && norm(objAccount) !== accountNorm) {
      return null;
    }
    const objModel = obj.modelId !== undefined && obj.modelId !== null ? obj.modelId : obj.model;
    if (objModel !== undefined && objModel !== null && norm(objModel) !== modelNorm) {
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

/**
 * Selection API stub when full live discovery/selection engine is not connected.
 * Ghi chú: selection API chưa nối.
 */
export function getSelectionApiStub(registry = {}) {
  return {
    status: 'UNCONNECTED',
    note: 'selection API chưa nối',
    getCandidates: () => [],
  };
}

/**
 * Selects an independent reviewer candidate for the given author/writer.
 *
 * @param {object} options
 * @param {object|string} options.writer Candidate object or 7-part key of the author/writer
 * @param {Array} [options.candidates] Pool of reviewer candidate objects or keys
 * @param {object} [options.selectionApi] Selection API instance (or uses stub if absent)
 * @param {string} [options.role='reviewer'] Target role to select for
 * @returns {object} Outcome object { ok: boolean, status: string, reviewer?: object, reason?: string }
 */
export function selectReviewer(options = {}) {
  const { writer, role = 'reviewer' } = options;
  const writerParsed = parseCandidate(writer);

  if (!writerParsed) {
    return {
      ok: false,
      status: 'BLOCKED',
      verdict: 'BLOCKED',
      reviewer: null,
      reason: 'INVALID_WRITER_CANDIDATE: writer candidate is missing or invalid',
    };
  }

  let rawPool = options.candidates;
  let stubNote = null;

  if (!rawPool) {
    const api = options.selectionApi || getSelectionApiStub();
    if (api.status === 'UNCONNECTED') {
      stubNote = api.note; // 'selection API chưa nối'
    }
    rawPool = typeof api.getCandidates === 'function' ? api.getCandidates({ role }) : [];
  }

  if (!Array.isArray(rawPool) || rawPool.length === 0) {
    return {
      ok: false,
      status: 'BLOCKED',
      verdict: 'BLOCKED',
      reviewer: null,
      reason: stubNote
        ? `NO_REVIEWER_CANDIDATE: ${stubNote}`
        : 'NO_REVIEWER_CANDIDATE: candidate pool is empty',
    };
  }

  const disqualified = [];
  const eligible = [];

  for (const rawCandidate of rawPool) {
    const parsed = parseCandidate(rawCandidate);
    if (!parsed) {
      disqualified.push({ candidate: rawCandidate, reason: 'MALFORMED_CANDIDATE' });
      continue;
    }

    // Role check
    if (parsed.qualifiedRoles && !parsed.qualifiedRoles.includes(role)) {
      disqualified.push({ candidate: parsed, reason: `NOT_QUALIFIED_FOR_ROLE_${role}` });
      continue;
    }

    const check = checkIndependence(writerParsed, parsed);
    if (!check.independent) {
      disqualified.push({ candidate: parsed, reason: check.reason });
    } else {
      eligible.push(parsed);
    }
  }

  if (eligible.length === 0) {
    const reasonSummary = disqualified.map((d) => d.reason).join('; ');
    return {
      ok: false,
      status: 'BLOCKED',
      verdict: 'BLOCKED',
      reviewer: null,
      candidatesEvaluated: rawPool.length,
      reason: `NO_INDEPENDENT_REVIEWER: all candidates disqualified (${reasonSummary})`,
    };
  }

  // Deterministic selection: pick the first eligible independent candidate
  const chosen = eligible[0];
  let resolved = chosen;
  const resolver =
    (typeof options.resolveCandidate === 'function' && options.resolveCandidate) ||
    (typeof options.resolveReviewer === 'function' && options.resolveReviewer) ||
    (typeof options.resolve === 'function' && options.resolve) ||
    (typeof options.resolver === 'function' && options.resolver) ||
    (options.selectionApi && typeof options.selectionApi.resolveCandidate === 'function'
      ? (c) => options.selectionApi.resolveCandidate(c)
      : null);

  if (resolver) {
    resolved = resolver(chosen);
  } else if (typeof chosen.resolve === 'function') {
    resolved = chosen.resolve();
  }

  // Validate resolved candidate identity via canonicalIdentity
  const resolvedCanonical = canonicalIdentity(resolved);
  if (!resolvedCanonical) {
    return {
      ok: false,
      status: 'BLOCKED',
      verdict: 'BLOCKED',
      reviewer: null,
      candidatesEvaluated: rawPool.length,
      candidatesEligible: eligible.length,
      reason: 'UNVERIFIED_UPSTREAM: chosen reviewer identity is invalid, conflicting, or upstream is empty after resolve',
    };
  }

  // Verify independence after resolve
  const checkAfterResolve = checkIndependence(writerParsed, resolvedCanonical);
  if (!checkAfterResolve.independent) {
    return {
      ok: false,
      status: 'BLOCKED',
      verdict: 'BLOCKED',
      reviewer: null,
      candidatesEvaluated: rawPool.length,
      candidatesEligible: eligible.length,
      reason: `INDEPENDENCE_VIOLATION_AFTER_RESOLVE: ${checkAfterResolve.reason}`,
    };
  }

  // Final check immediately before return on the object to be returned
  const finalReviewer = resolvedCanonical;
  const finalCanonical = canonicalIdentity(finalReviewer);
  if (!finalCanonical) {
    return {
      ok: false,
      status: 'BLOCKED',
      verdict: 'BLOCKED',
      reviewer: null,
      candidatesEvaluated: rawPool.length,
      candidatesEligible: eligible.length,
      reason: 'INVALID_FINAL_REVIEWER: candidate identity failed final validation',
    };
  }

  const finalCheck = checkIndependence(writerParsed, finalCanonical);
  if (!finalCheck.independent) {
    return {
      ok: false,
      status: 'BLOCKED',
      verdict: 'BLOCKED',
      reviewer: null,
      candidatesEvaluated: rawPool.length,
      candidatesEligible: eligible.length,
      reason: `INDEPENDENCE_VIOLATION_FINAL: ${finalCheck.reason}`,
    };
  }

  return {
    ok: true,
    status: 'SELECTED',
    reviewer: finalCanonical,
    candidateKey: finalCanonical.candidateKey,
    candidatesEvaluated: rawPool.length,
    candidatesEligible: eligible.length,
  };
}

export function resolveReviewer(candidate, resolver) {
  if (typeof resolver === 'function') {
    const res = resolver(candidate);
    return canonicalIdentity(res);
  }
  return canonicalIdentity(candidate);
}
