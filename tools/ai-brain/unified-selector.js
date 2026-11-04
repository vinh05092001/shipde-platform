'use strict';

/**
 * Ship Dễ — Unified Route Selector & JEV Integration
 *
 * Implements the shared unified route selection contract:
 * 1. Candidate Aggregation across 3 pathways (9router, direct, AGY pool).
 * 2. Strict Admission Gating before Ranking.
 * 3. Contract-compliant JEV Advisory.
 * 4. Task-scoped Context & Structured Budget Interface.
 */

const { createRouteIdentity, UNKNOWN } = require('./route-identity');
const { ScopedHealthRegistry } = require('./scoped-health');
const {
  advisoryNamesIdentity,
  harnessEnforcesTokens,
  evaluateAdmission,
  scoreCandidate,
} = require('./unified-selector-admission');
const {
  WEIGHT_PROFILES,
  ROLE_FALLBACK_PROFILE,
  determineWeightProfile,
} = require('./unified-selector-jev');

const SHARED_JEV_CACHE = new Map();
const SHARED_HEALTH_REGISTRY = new ScopedHealthRegistry();

class UnifiedRouteSelector {
  constructor(options = {}) {
    this.healthRegistry = options.healthRegistry || new ScopedHealthRegistry();
    this.jevCache = options.jevCache || SHARED_JEV_CACHE;
    this.jevAsk = options.jevAsk || null;
    this.excludedModelPatterns = options.excludedModelPatterns || {};
    this.minConfidence = options.minConfidence || 0.6;
  }

  evaluateAdmission(candidate, profile = {}, authorCandidate = null) {
    return evaluateAdmission(candidate, profile, authorCandidate, {
      excludedModelPatterns: this.excludedModelPatterns,
      healthRegistry: this.healthRegistry,
    });
  }

  scoreCandidate(candidate, profile, weights) {
    return scoreCandidate(candidate, profile, weights);
  }

  async selectRoute(candidates, taskProfile, options = {}) {
    const profile = taskProfile || {};
    const authorCandidate = options.authorCandidate || null;

    // 1. Admission Gate
    const admitted = [];
    const rejections = [];

    for (const c of candidates || []) {
      const evaluation = this.evaluateAdmission(c, profile, authorCandidate);
      if (evaluation.admitted) {
        admitted.push(c);
      } else {
        rejections.push({
          candidateKey: c.candidateKey,
          configuredModelId: c.configuredModelId,
          reason: evaluation.rejectionReason,
        });
      }
    }

    const cappedRejections = rejections.slice(0, 50);

    if (admitted.length === 0) {
      return {
        status: 'BLOCKED',
        reason: 'NO_ELIGIBLE_CANDIDATE_ADMITTED',
        totalCandidatesChecked: (candidates || []).length,
        admittedCount: 0,
        rejectionReasons: cappedRejections,
        chosen: null,
      };
    }

    // 2. Weight Profile Trade-off Determination (JEV Advisory or Fallback)
    const role = String(profile.role || 'writer').toLowerCase();
    const fallbackProfileKey = ROLE_FALLBACK_PROFILE[role] || 'BALANCED';

    const jevResult = await determineWeightProfile({
      admitted,
      profile,
      fallbackProfileKey,
      jevCache: this.jevCache,
      jevAsk: this.jevAsk,
      minConfidence: this.minConfidence,
      healthRegistry: this.healthRegistry,
    });

    const chosenProfileKey = jevResult.chosenProfileKey;
    const weights = WEIGHT_PROFILES[chosenProfileKey] || WEIGHT_PROFILES.BALANCED;

    // 3. Post-await Re-validation Gate
    const revalidatedCandidates = [];
    for (const c of admitted) {
      let candidateToCheck = c;
      if (c.isCombo && Array.isArray(c.metadata?.viableBranches)) {
        const validatedViable = c.metadata.viableBranches.filter(
          (b) => this.evaluateAdmission(b, profile, authorCandidate).admitted
        );
        if (validatedViable.length > 0) {
          candidateToCheck = createRouteIdentity({
            ...c,
            comboBranches: validatedViable,
            metadata: {
              ...(c.metadata || {}),
              viableBranches: validatedViable,
            },
          });
        } else {
          continue;
        }
      }
      const evalPost = this.evaluateAdmission(candidateToCheck, profile, authorCandidate);
      if (evalPost.admitted) {
        revalidatedCandidates.push(candidateToCheck);
      }
    }

    if (revalidatedCandidates.length === 0) {
      return {
        status: 'BLOCKED',
        reason: 'NO_ELIGIBLE_CANDIDATE_ADMITTED',
        totalCandidatesChecked: (candidates || []).length,
        admittedCount: 0,
        rejectionReasons: cappedRejections,
        chosen: null,
      };
    }

    // 4. Score & Rank Re-validated Candidates
    const scoredList = revalidatedCandidates.map((c) => {
      const scoring = this.scoreCandidate(c, profile, weights);
      return {
        candidate: c,
        candidateKey: c.candidateKey,
        configuredModelId: c.configuredModelId,
        outboundModelId: c.outboundModelId,
        upstreamProviderId: c.upstreamProviderId,
        accountRef: c.accountRef,
        quotaScopeId: c.quotaScopeId,
        pathway: c.pathway,
        score: scoring.totalScore,
        breakdown: scoring.breakdown,
      };
    });

    scoredList.sort((a, b) => b.score - a.score || a.candidateKey.localeCompare(b.candidateKey));

    const selectedEntry = scoredList[0];
    const chosenCandidate = selectedEntry.candidate;

    // 5. Context & Budget Interface
    const tokenBudget =
      profile.tokenBudget !== undefined
        ? profile.tokenBudget
        : profile.contextSize !== undefined
          ? profile.contextSize
          : UNKNOWN;

    const turnBudget =
      profile.turnBudget !== undefined
        ? profile.turnBudget
        : chosenCandidate.metadata?.turnBudget !== undefined
          ? chosenCandidate.metadata.turnBudget
          : UNKNOWN;

    const deadlineMs =
      profile.expectedDuration !== undefined
        ? profile.expectedDuration
        : profile.deadlineMs !== undefined
          ? profile.deadlineMs
          : UNKNOWN;

    const tokenEnforcement =
      options.runnerEnforcesTokens === true
        ? 'ENFORCED_BY_RUNNER'
        : !harnessEnforcesTokens(chosenCandidate.harness)
          ? 'UNENFORCED_BY_HARNESS'
          : 'UNENFORCED_AT_SELECTION';

    return {
      status: 'ADMITTED_AND_SELECTED',
      chosen: chosenCandidate.candidateKey,
      identity: chosenCandidate,
      ranking: scoredList,
      totalAdmitted: admitted.length,
      totalRejected: rejections.length,
      rejectionReasons: cappedRejections,
      weightProfileUsed: chosenProfileKey,
      weights,
      jev: {
        outcome: jevResult.outcome,
        reason: jevResult.reason,
        confidence: jevResult.confidence,
      },
      budgetContract: {
        tokenBudget,
        turnBudget,
        deadlineMs,
        tokenEnforcement,
        usageRecorded: UNKNOWN,
        costRecordedUsd: UNKNOWN,
      },
      taskContext: {
        taskId: profile.taskId,
        role: profile.role,
        acceptanceCriteria: profile.acceptanceCriteria || [],
        instructions: profile.instructions || '',
      },
    };
  }
}

/**
 * Convenience entry point for runtime / pipeline callers.
 */
async function selectOptimalRoute(params = {}) {
  const { aggregateAllCandidates } = require('./candidate-adapters');
  const selector = new UnifiedRouteSelector({
    healthRegistry: SHARED_HEALTH_REGISTRY,
    ...params.selectorOptions,
  });

  const aggregated = params.candidates
    ? { candidates: params.candidates, unconnectedSources: [] }
    : aggregateAllCandidates(params.adapterOptions || {});
  const candidates = params.candidates || aggregated.candidates;

  const taskProfile = {
    taskId: params.item || params.taskId || 'TASK-UNSPECIFIED',
    role: params.role || 'writer',
    complexity: params.complexity || 'standard',
    requiredCapabilities: params.requiredCapabilities || ['general_code'],
    costCeiling: params.costCeiling !== undefined ? params.costCeiling : null,
    contextSize: params.contextSize,
    tokenBudget: params.tokenBudget,
    turnBudget: params.turnBudget,
    expectedDuration: params.expectedDuration,
    deadlineMs: params.deadlineMs,
    acceptanceCriteria: params.acceptanceCriteria || [],
    instructions: params.instructions || '',
  };

  const result = await selector.selectRoute(candidates, taskProfile, {
    authorCandidate: params.authorCandidate || null,
    runnerEnforcesTokens: params.runnerEnforcesTokens === true,
  });

  return {
    ...result,
    unconnectedSources: aggregated.unconnectedSources,
  };
}

module.exports = {
  UnifiedRouteSelector,
  WEIGHT_PROFILES,
  ROLE_FALLBACK_PROFILE,
  SHARED_HEALTH_REGISTRY,
  SHARED_JEV_CACHE,
  advisoryNamesIdentity,
  harnessEnforcesTokens,
  selectOptimalRoute,
};
