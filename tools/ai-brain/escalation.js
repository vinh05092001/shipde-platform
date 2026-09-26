'use strict';

/**
 * Ship Dễ — Reasoning Controller Escalation Hook (TASK-AI-50 C3)
 *
 * When Jev's fast candidate filter encounters ambiguous candidates with conflicting
 * or insufficient evidence, it answers UNDECIDED rather than guessing.
 * This module coordinates handing those UNDECIDED items off to the reasoning
 * controller (Hermes / planning model) to resolve eligibility deterministically.
 *
 * Enforced invariants:
 *   1. Only UNDECIDED items are escalated; Jev-decided items are never sent.
 *   2. The reasoning controller is injected as a function (no network / model calls in unit tests).
 *   3. The escalation request provides:
 *      - the question,
 *      - candidate identity (7 parts: harness, accessPath, gateway, upstream, account, quotaScope, modelId),
 *      - conflicting evidence ids,
 *      - what Jev could not decide.
 *   4. Controller answers must be ELIGIBLE or EXCLUDED with a reason code, recorded with
 *      decidedBy='controller', and merged back preserving list order and count (count in == count out).
 *   5. If the controller throws, times out, or returns an invalid verdict, the candidate
 *      stays UNDECIDED (fail closed; never guessed eligible).
 *   6. Escalations per call are strictly bounded. Items exceeding the bound stay UNDECIDED
 *      and are reported.
 */

/**
 * Default maximum number of candidates that can be escalated to the reasoning controller per call.
 *
 * Architectural reason:
 * Invoking the reasoning controller (Hermes / LLM) involves heavy model reasoning,
 * higher latency (~seconds to tens of seconds), and consumes token budget and concurrency slots
 * (the platform contract enforces a strict single-writer ceiling per AGENTS.md).
 * In dispatch loops, more than 5 ambiguous candidates indicates systemic telemetry or
 * evidence failure rather than routine edge cases. Bounding to 5 avoids runway exhaustion,
 * latency spikes, and worker starvation. Items exceeding the bound remain UNDECIDED
 * (fail closed) and are reported for telemetry/operator awareness.
 */
const DEFAULT_MAX_ESCALATIONS = 5;

/** Default timeout for reasoning controller execution in milliseconds */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Extracts the canonical 7-part candidate identity.
 *
 * @param {object} candidate Candidate object
 * @returns {{
 *   harness: string|null,
 *   accessPath: string|null,
 *   gateway: string|null,
 *   upstream: string|null,
 *   account: string|null,
 *   quotaScope: string|null,
 *   modelId: string|null
 * }}
 */
function extractCandidateIdentity(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return {
      harness: null,
      accessPath: null,
      gateway: null,
      upstream: null,
      account: null,
      quotaScope: null,
      modelId: null,
    };
  }
  const id = candidate.identity && typeof candidate.identity === 'object' ? candidate.identity : {};
  return {
    harness:
      candidate.harness !== undefined
        ? candidate.harness
        : id.harness !== undefined
          ? id.harness
          : null,
    accessPath:
      candidate.accessPath !== undefined
        ? candidate.accessPath
        : id.accessPath !== undefined
          ? id.accessPath
          : null,
    gateway:
      candidate.gateway !== undefined
        ? candidate.gateway
        : id.gateway !== undefined
          ? id.gateway
          : null,
    upstream:
      candidate.upstream !== undefined
        ? candidate.upstream
        : id.upstream !== undefined
          ? id.upstream
          : null,
    account:
      candidate.account !== undefined
        ? candidate.account
        : id.account !== undefined
          ? id.account
          : null,
    quotaScope:
      candidate.quotaScope !== undefined
        ? candidate.quotaScope
        : id.quotaScope !== undefined
          ? id.quotaScope
          : null,
    modelId:
      candidate.modelId !== undefined
        ? candidate.modelId
        : id.modelId !== undefined
          ? id.modelId
          : null,
  };
}

/**
 * Extracts conflicting evidence IDs associated with a candidate or filter item.
 *
 * @param {object} candidate Candidate object
 * @param {object} filterItem Jev filter result item
 * @returns {Array<string>} Array of conflicting evidence ID strings
 */
function extractConflictingEvidenceIds(candidate, filterItem) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const item = filterItem && typeof filterItem === 'object' ? filterItem : {};

  if (Array.isArray(c.conflictingEvidenceIds)) {
    return c.conflictingEvidenceIds.map(String);
  }
  if (Array.isArray(c.conflictingEvidence)) {
    return c.conflictingEvidence.map((e) =>
      e && typeof e === 'object' && e.id !== undefined ? String(e.id) : String(e)
    );
  }
  if (c.evidence && typeof c.evidence === 'object') {
    if (Array.isArray(c.evidence.conflictingIds)) {
      return c.evidence.conflictingIds.map(String);
    }
    if (Array.isArray(c.evidence.conflicts)) {
      return c.evidence.conflicts.map((e) =>
        e && typeof e === 'object' && e.id !== undefined ? String(e.id) : String(e)
      );
    }
  }
  if (Array.isArray(item.conflictingEvidenceIds)) {
    return item.conflictingEvidenceIds.map(String);
  }

  if (item.evidenceId !== undefined && item.evidenceId !== null) {
    return [String(item.evidenceId)];
  }
  if (c.evidenceId !== undefined && c.evidenceId !== null) {
    return [String(c.evidenceId)];
  }
  if (
    c.evidence &&
    typeof c.evidence === 'object' &&
    c.evidence.id !== undefined &&
    c.evidence.id !== null
  ) {
    return [String(c.evidence.id)];
  }
  if (typeof c.evidence === 'string' && c.evidence.trim().length > 0) {
    return [c.evidence.trim()];
  }
  return [];
}

/**
 * Constructs an escalation request for the reasoning controller.
 *
 * @param {object} candidate Candidate object
 * @param {object} filterItem Jev filter result item
 * @param {object} [options]
 * @returns {{
 *   question: string,
 *   candidateIdentity: object,
 *   identity: object,
 *   conflictingEvidenceIds: Array<string>,
 *   evidenceIds: Array<string>,
 *   whatJevCouldNotDecide: string,
 *   reason: string
 * }}
 */
function buildEscalationRequest(candidate, filterItem, options) {
  const identity = extractCandidateIdentity(candidate);
  const conflictingEvidenceIds = extractConflictingEvidenceIds(candidate, filterItem);
  const whatJevCouldNotDecide = filterItem?.reason || 'INSUFFICIENT_EVIDENCE';
  const customQuestion = options && options.question;
  const question =
    customQuestion ||
    `Resolve whether candidate (${identity.modelId || 'unknown'} via ${identity.upstream || 'unknown'}) is ELIGIBLE or EXCLUDED given conflicting evidence [${conflictingEvidenceIds.join(', ')}].`;

  return {
    question,
    candidateIdentity: identity,
    identity,
    conflictingEvidenceIds,
    evidenceIds: conflictingEvidenceIds,
    whatJevCouldNotDecide,
    reason: whatJevCouldNotDecide,
  };
}

/**
 * Hands off UNDECIDED candidates from Jev's filter result to the injected reasoning controller.
 *
 * @param {Array<object>} filterResults Jev filter output items
 * @param {Array<object>|object} [candidatesOrOptions] Candidate array or options object
 * @param {object} [maybeOptions] Options object when candidates array passed as 2nd arg
 * @returns {Promise<Array<object>>} Final decision list with count preserved and decisions merged
 */
async function escalateUndecided(filterResults, candidatesOrOptions, maybeOptions) {
  if (!Array.isArray(filterResults)) {
    throw new Error('escalateUndecided expects an array of filter results');
  }

  let candidates = null;
  let options = {};
  if (Array.isArray(candidatesOrOptions)) {
    candidates = candidatesOrOptions;
    options = maybeOptions || {};
  } else {
    options = candidatesOrOptions || {};
    candidates = options.candidates || null;
  }

  const controller = options.controller;
  const maxEscalations =
    typeof options.maxEscalations === 'number'
      ? options.maxEscalations
      : typeof options.bound === 'number'
        ? options.bound
        : typeof options.limit === 'number'
          ? options.limit
          : DEFAULT_MAX_ESCALATIONS;
  const timeoutMs =
    typeof options.timeoutMs === 'number'
      ? options.timeoutMs
      : typeof options.timeout === 'number'
        ? options.timeout
        : DEFAULT_TIMEOUT_MS;

  let escalatedCount = 0;
  const overBound = [];
  const finalResults = [];

  for (let i = 0; i < filterResults.length; i++) {
    const item = filterResults[i];
    if (!item || typeof item !== 'object') {
      finalResults.push({
        status: 'EXCLUDED',
        reason: 'NO_EVIDENCE',
        evidenceId: null,
        decidedBy: 'jev',
      });
      continue;
    }

    // Invariant 1: Jev-decided items are never sent to the controller
    if (item.status !== 'UNDECIDED') {
      finalResults.push(
        Object.assign({}, item, {
          decidedBy: item.decidedBy || 'jev',
        })
      );
      continue;
    }

    const candidate = item.candidate || (Array.isArray(candidates) ? candidates[i] : null);

    // Invariant 6: Bound number of escalations per call
    if (escalatedCount >= maxEscalations) {
      const overBoundItem = Object.assign({}, item, {
        status: 'UNDECIDED',
        reason: item.reason || 'INSUFFICIENT_EVIDENCE',
        decidedBy: item.decidedBy || 'jev',
        boundExceeded: true,
      });
      overBound.push(overBoundItem);
      finalResults.push(overBoundItem);
      continue;
    }

    // Within bound: prepare escalation request
    escalatedCount++;
    const request = buildEscalationRequest(candidate, item, options);

    let answer = null;
    if (typeof controller === 'function') {
      try {
        let timer = null;
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Controller timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          if (timer.unref) timer.unref();
        });

        try {
          answer = await Promise.race([Promise.resolve(controller(request)), timeoutPromise]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch (_) {
        // Invariant 5: Controller threw or timed out -> fail closed, stays UNDECIDED
        answer = null;
      }
    }

    // Validate controller answer: must be ELIGIBLE or EXCLUDED with a non-empty reason code
    const answerStatus = answer && (answer.status || answer.verdict);
    const answerReason = answer && answer.reason;
    const isValid =
      (answerStatus === 'ELIGIBLE' || answerStatus === 'EXCLUDED') &&
      typeof answerReason === 'string' &&
      answerReason.trim().length > 0;

    if (isValid) {
      // Invariant 4: Merged back with decidedBy='controller'
      finalResults.push(
        Object.assign({}, item, {
          status: answerStatus,
          reason: answerReason.trim(),
          decidedBy: 'controller',
        })
      );
    } else {
      // Invariant 5: Invalid/null answer -> fail closed, stays UNDECIDED, not eligible
      finalResults.push(
        Object.assign({}, item, {
          status: 'UNDECIDED',
          reason: item.reason || 'INSUFFICIENT_EVIDENCE',
          decidedBy: item.decidedBy || 'jev',
        })
      );
    }
  }

  // Report metadata
  const report = {
    bound: maxEscalations,
    escalatedCount,
    overBoundCount: overBound.length,
    overBound,
  };
  finalResults.reported = report;

  if (typeof options.onReport === 'function') {
    options.onReport(report);
  }

  return finalResults;
}

module.exports = {
  DEFAULT_MAX_ESCALATIONS,
  DEFAULT_TIMEOUT_MS,
  extractCandidateIdentity,
  extractConflictingEvidenceIds,
  buildEscalationRequest,
  escalateUndecided,
};
