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

import {
  norm,
  candidateKeyFromParts,
  canonicalIdentity,
  parseCandidate,
  checkIndependence,
} from './select-reviewer-identity.mjs';

export {
  canonicalIdentity,
  parseCandidate,
  candidateKeyFromParts,
  checkIndependence,
};

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
