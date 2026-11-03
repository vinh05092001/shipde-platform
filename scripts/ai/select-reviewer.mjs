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
 * Parses candidate attributes from a candidate object or 7-part key string:
 * (harness::accessPath::gateway::upstream::account::quotaScope::modelId)
 */
export function parseCandidate(candidate) {
  if (!candidate) return null;
  if (typeof candidate === 'object') {
    const key = candidate.candidateKey || '';
    const parts = key.includes('::') ? key.split('::') : [];
    return {
      harness: candidate.harness || parts[0] || '',
      accessPath: candidate.accessPath || parts[1] || '',
      gateway: candidate.gateway || parts[2] || '',
      upstream: candidate.upstream || parts[3] || '',
      account: candidate.account || candidate.accountId || parts[4] || '',
      quotaScope: candidate.quotaScope || parts[5] || '',
      modelId: candidate.modelId || candidate.model || parts[6] || '',
      candidateKey: key || candidateKeyFromParts(candidate),
      qualifiedRoles: Array.isArray(candidate.qualifiedRoles) ? candidate.qualifiedRoles : ['reviewer'],
    };
  }
  if (typeof candidate === 'string') {
    const parts = candidate.split('::');
    if (parts.length === 7) {
      return {
        harness: parts[0],
        accessPath: parts[1],
        gateway: parts[2],
        upstream: parts[3],
        account: parts[4],
        quotaScope: parts[5],
        modelId: parts[6],
        candidateKey: candidate,
        qualifiedRoles: ['reviewer'],
      };
    }
  }
  return null;
}

export function candidateKeyFromParts(c = {}) {
  return [
    c.harness || '',
    c.accessPath || '',
    c.gateway || '',
    c.upstream || '',
    c.account || c.accountId || '',
    c.quotaScope || '',
    c.modelId || c.model || '',
  ].join('::');
}

/**
 * Checks independence of a reviewer candidate against the writer candidate.
 * Returns { independent: true } or { independent: false, reason: '...' }.
 */
export function checkIndependence(writerParsed, reviewerParsed) {
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
  if (writerUpstream && reviewerUpstream && writerUpstream === reviewerUpstream) {
    return { independent: false, reason: `SAME_UPSTREAM: reviewer shares upstream '${reviewerParsed.upstream}'` };
  }

  // Model independence
  const writerModel = norm(writerParsed.modelId);
  const reviewerModel = norm(reviewerParsed.modelId);
  if (writerModel && reviewerModel && writerModel === reviewerModel) {
    return { independent: false, reason: `SAME_MODEL: reviewer shares modelId '${reviewerParsed.modelId}'` };
  }

  // Gateway independence
  const writerGateway = norm(writerParsed.gateway);
  const reviewerGateway = norm(reviewerParsed.gateway);
  if (writerGateway && reviewerGateway && writerGateway === reviewerGateway) {
    return { independent: false, reason: `SAME_GATEWAY: reviewer shares gateway '${reviewerParsed.gateway}'` };
  }

  // Account independence
  const writerAccount = norm(writerParsed.account);
  const reviewerAccount = norm(reviewerParsed.account);
  if (writerAccount && reviewerAccount && writerAccount === reviewerAccount) {
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
  return {
    ok: true,
    status: 'SELECTED',
    reviewer: chosen,
    candidateKey: chosen.candidateKey,
    candidatesEvaluated: rawPool.length,
    candidatesEligible: eligible.length,
  };
}
