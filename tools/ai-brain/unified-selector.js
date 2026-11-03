'use strict';

/**
 * Ship Dễ — Unified Route Selector & JEV Integration (PATCH 2)
 *
 * Implements the shared unified route selection contract:
 * 1. Candidate Aggregation across 3 pathways (9router, direct, AGY pool).
 * 2. Strict Admission Gating before Ranking:
 *    - Caller-supplied role policies.
 *    - Reviewer independence from author provider/domain.
 *    - Combo constituent branch health and capabilities.
 *    - Quota and route health (including unprobed reset elapsed routes).
 *    - Strict cost ceiling check (rejects unknown-cost candidates).
 * 3. Contract-compliant JEV Advisory:
 *    - JEV advises weight profile trade-offs ONLY, never route identities.
 *    - Responses containing route identities are rejected as IDENTITY_PROHIBITED.
 *    - Context-aware caching with task instructions, criteria, budgets, and health state hash.
 *    - Deterministic per-role fallback when JEV is undecided or fails.
 * 4. Task-scoped Context & Structured Budget Interface:
 *    - Explicit tokenBudget precedence over contextSize.
 *    - No hardcoded magic numbers for budgets.
 *    - Token enforcement truthfully marked UNENFORCED_AT_SELECTION unless bound by runner adapter.
 */

const crypto = require('crypto');
const { createRouteIdentity, distinguishPathway, UNKNOWN } = require('./route-identity');
const { ScopedHealthRegistry, ErrorCategory, HealthScope } = require('./scoped-health');

const WEIGHT_PROFILES = Object.freeze({
  LATENCY_FIRST: { latency: 55, quality: 20, cost: 25 },
  BALANCED: { latency: 34, quality: 33, cost: 33 },
  QUALITY_FIRST: { latency: 10, quality: 65, cost: 25 },
});

const ROLE_FALLBACK_PROFILE = Object.freeze({
  writer: 'BALANCED',
  repair: 'BALANCED',
  reviewer: 'QUALITY_FIRST',
  'security-review': 'QUALITY_FIRST',
  scanner: 'LATENCY_FIRST',
  researcher: 'BALANCED',
  integrator: 'BALANCED',
});

/**
 * Checks if response from advisory illegally names a candidate identity.
 * Reused from jev.js contract.
 */
function advisoryNamesIdentity(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const prohibited = [
    'model',
    'modelId',
    'provider',
    'account',
    'accountId',
    'gateway',
    'upstream',
    'candidate',
    'candidateKey',
  ];
  return prohibited.some((field) => raw[field] !== undefined && raw[field] !== null);
}

/**
 * Checks if harness natively enforces token limits.
 */
function harnessEnforcesTokens(harness) {
  const h = String(harness || '').toLowerCase();
  return ['direct-http', 'api', 'custom-runner'].includes(h);
}

/**
 * Computes deterministic SHA-256 hash of any JSON-serializable object.
 */
function hashObject(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj || {})).digest('hex').slice(0, 16);
}

// Module-level persistent cache across selection calls
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

  /**
   * Admission Gate: Evaluates candidate suitability against task profile and policy.
   * Returns { admitted: boolean, rejectionReason?: string, resetsAt?: number, staleQuota?: boolean }
   */
  evaluateAdmission(candidate, profile = {}, authorCandidate = null) {
    const id = candidate;
    const role = String(profile?.role || 'writer').toLowerCase();

    // Model restrictions belong to the caller's role policy, including combo branches.
    const patterns = this.excludedModelPatterns[role] || [];
    const excluded = (route) => patterns.some((pattern) => {
      const regex = pattern instanceof RegExp ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')) : new RegExp(pattern, 'i');
      return regex.test(route.outboundModelId) || regex.test(route.configuredModelId);
    });
    if (excluded(id) || (id.isCombo && id.comboBranches.some(excluded))) {
      return { admitted: false, rejectionReason: 'MODEL_EXCLUDED_BY_ROLE_POLICY' };
    }

    // 2. Reviewer Independence Policy: Reviewer cannot share author's provider or failure domain
    if (role === 'reviewer' && authorCandidate) {
      const authorProv = String(authorCandidate.upstreamProviderId || '').toLowerCase();
      const revProv = String(id.upstreamProviderId || '').toLowerCase();
      if (authorProv && revProv && authorProv === revProv) {
        return {
          admitted: false,
          rejectionReason: 'REVIEWER_SHARES_AUTHOR_UPSTREAM_PROVIDER',
        };
      }
      if (id.isCombo) {
        const branches = Array.isArray(id.comboBranches) ? id.comboBranches : [];
        const sharesBranch = branches.some(
          (b) => String(b.upstreamProviderId || '').toLowerCase() === authorProv
        );
        if (sharesBranch) {
          return {
            admitted: false,
            rejectionReason: 'COMBO_REVIEWER_HAS_BRANCH_SHARING_AUTHOR_PROVIDER',
          };
        }
      }
    }

    // 3. Combo Constituent Branch Health & Capabilities Check (Finding 8)
    if (id.isCombo) {
      const branches = Array.isArray(id.comboBranches) ? id.comboBranches : [];
      const viableBranches = Array.isArray(id.metadata?.viableBranches) ? id.metadata.viableBranches : [];
      if (branches.length === 0 && viableBranches.length === 0) {
        return {
          admitted: false,
          rejectionReason: 'COMBO_HAS_NO_CONSTITUENT_BRANCHES',
        };
      }

      // Reject the whole combo if any executable branch fails admission. Retaining
      // a rejected branch would let downstream execution bypass these gates.
      for (const branch of branches) {
        const evaluation = this.evaluateAdmission(branch, profile, authorCandidate);
        if (!evaluation.admitted) {
          return { admitted: false, rejectionReason: 'COMBO_BRANCH_REJECTED_' + evaluation.rejectionReason };
        }
      }

      for (const branch of viableBranches) {
        const evaluation = this.evaluateAdmission(branch, profile, authorCandidate);
        if (!evaluation.admitted) {
          return { admitted: false, rejectionReason: 'COMBO_BRANCH_REJECTED_' + evaluation.rejectionReason };
        }
      }
    } else {
      // Required Capabilities Match for single route
      const requiredCaps = profile.requiredCapabilities || [];
      const modelCaps = id.metadata?.capabilities || [];
      for (const cap of requiredCaps) {
        if (!modelCaps.includes(cap)) {
          return {
            admitted: false,
            rejectionReason: `MISSING_REQUIRED_CAPABILITY_${cap.toUpperCase()}`,
          };
        }
      }
    }

    // 4. Route Health & Cooldown Check (Finding 3 & 4)
    const health = this.healthRegistry.evaluateHealth(id);
    if (!health.healthy) {
      return {
        admitted: false,
        rejectionReason: health.reason
          ? `ROUTE_HEALTH_BLOCKED_${health.reason}`
          : `ROUTE_HEALTH_BLOCKED_${health.blockedBy?.toUpperCase()}_${health.category}`,
        resetsAt: health.resetsAt,
      };
    }

    // 5. Cost Ceiling Check (Finding 2)
    // Strictly reject candidates with unknown cost when a cost ceiling is set
    const ceiling = Number(profile.costCeiling);
    if (!id.isCombo && profile.costCeiling !== undefined && profile.costCeiling !== null &&
        profile.costCeiling !== UNKNOWN && Number.isFinite(ceiling) && ceiling >= 0) {
      const rawCost = id.metadata?.estimatedCostUsd;
      if (rawCost === undefined || rawCost === null || rawCost === UNKNOWN) {
        return {
          admitted: false,
          rejectionReason: 'UNKNOWN_COST_REJECTED_BY_CEILING',
        };
      }
      const estCost = Number(rawCost);
      if (!Number.isFinite(estCost) || estCost > ceiling) {
        return {
          admitted: false,
          rejectionReason: 'COST_EXCEEDS_TASK_CEILING',
        };
      }
    }

    return {
      admitted: true,
      staleQuota: Boolean(health.staleQuota),
    };
  }

  /**
   * Scores an admitted candidate based on known metadata and weight profile.
   * Does NOT invent default scores (50/60/70) or boost by model name regex.
   * Excludes unknown dimensions and renormalizes weights (per AGENTS.md / ranking.js).
   */
  scoreCandidate(candidate, profile, weights) {
    const id = candidate;
    const meta = id.metadata || {};

    // Quality: from live evidence / priors / metadata
    const qualityRaw = meta.qualityScore !== undefined ? meta.qualityScore : meta.intelligenceIndex;
    const hasQuality = qualityRaw !== undefined && qualityRaw !== null && Number.isFinite(Number(qualityRaw));
    const quality = hasQuality ? Number(qualityRaw) : null;

    // Latency: from priors / evidence
    const latencyRaw = meta.latencyScore;
    const hasLatency = latencyRaw !== undefined && latencyRaw !== null && Number.isFinite(Number(latencyRaw));
    const latency = hasLatency ? Number(latencyRaw) : null;

    // Cost: from metadata / pricing
    const costRaw = meta.costScore;
    const hasCost = costRaw !== undefined && costRaw !== null && Number.isFinite(Number(costRaw));
    const cost = hasCost ? Number(costRaw) : null;

    // Renormalize weights over dimensions that are known
    let totalKnownWeight = 0;
    if (hasQuality) totalKnownWeight += weights.quality;
    if (hasLatency) totalKnownWeight += weights.latency;
    if (hasCost) totalKnownWeight += weights.cost;

    let weightedScore = 0;
    if (totalKnownWeight > 0) {
      let subtotal = 0;
      if (hasQuality) subtotal += quality * weights.quality;
      if (hasLatency) subtotal += latency * weights.latency;
      if (hasCost) subtotal += cost * weights.cost;
      weightedScore = Math.round(subtotal / totalKnownWeight);
    }

    // Penalties
    let penalty = 0;
    if (meta.staleQuota) penalty += 15; // Unknown/stale quota penalty
    if (meta.currentWorkload > 0) penalty += Math.min(30, meta.currentWorkload * 10);

    const finalScore = Math.max(0, weightedScore - penalty);

    return {
      totalScore: finalScore,
      breakdown: {
        qualityScore: hasQuality ? quality : UNKNOWN,
        latencyScore: hasLatency ? latency : UNKNOWN,
        costScore: hasCost ? cost : UNKNOWN,
        renormalizedWeightTotal: totalKnownWeight,
        penalty,
        weights,
      },
    };
  }

  /**
   * Core Selection Pipeline:
   * Admission -> Weight Determination (JEV Advisory or Fallback) -> Ranking -> Controller Selection -> Budget Binding
   */
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

    // 2. Weight Profile Trade-off Determination (JEV Advisory or Deterministic Fallback)
    const role = String(profile.role || 'writer').toLowerCase();
    const fallbackProfileKey = ROLE_FALLBACK_PROFILE[role] || 'BALANCED';
    let chosenProfileKey = fallbackProfileKey;

    let jevOutcome = 'SKIPPED';
    let jevReason = 'NOT_CALLED';
    let jevConfidence = UNKNOWN;

    // Rule: "Không gọi khi dưới hai lựa chọn."
    if (admitted.length >= 2 && typeof this.jevAsk === 'function') {
      // Context-aware composite cache key including criteria, instructions, budgets, and health state hash
      const cacheKey = hashObject({
        taskId: profile.taskId,
        role: profile.role,
        complexity: profile.complexity,
        instructions: profile.instructions || '',
        acceptanceCriteria: profile.acceptanceCriteria || [],
        requiredCapabilities: profile.requiredCapabilities || [],
        costCeiling: profile.costCeiling,
        tokenBudget: profile.tokenBudget,
        turnBudget: profile.turnBudget,
        expectedDuration: profile.expectedDuration,
        contextSize: profile.contextSize,
        deadlineMs: profile.deadlineMs,
        healthStateHash: this.healthRegistry.getStateHash(),
        candidates: admitted.map((x) => ({ key: x.candidateKey, metadata: x.metadata, branches: x.comboBranches }))
          .sort((a, b) => a.key.localeCompare(b.key)),
      });

      const cached = this.jevCache.get(cacheKey);
      if (cached) {
        chosenProfileKey = cached.chosenProfileKey || fallbackProfileKey;
        jevOutcome = cached.outcome;
        jevReason = 'JEV_CACHE_HIT';
        jevConfidence = cached.confidence;
      } else {
        try {
          const weightOptions = Object.keys(WEIGHT_PROFILES);
          const jevQuestion = {
            kind: 'select-weight-profile',
            prompt: `Select weight profile trade-off for task ${profile.taskId} (role: ${profile.role}, complexity: ${profile.complexity})`,
            options: weightOptions,
            evidence: JSON.stringify({
              taskId: profile.taskId,
              role: profile.role,
              complexity: profile.complexity,
              requiredCapabilities: profile.requiredCapabilities || [],
              costCeiling: profile.costCeiling,
              expectedDuration: profile.expectedDuration,
            }),
          };

          const jevResponse = await this.jevAsk(jevQuestion);

          // AGENTS.md / jev.js Contract: JEV is prohibited from naming candidate identities!
          if (advisoryNamesIdentity(jevResponse)) {
            jevOutcome = 'UNDECIDED';
            jevReason = 'IDENTITY_PROHIBITED';
            jevConfidence = 0;
            chosenProfileKey = fallbackProfileKey;
          } else if (
            jevResponse &&
            jevResponse.choice &&
            WEIGHT_PROFILES[jevResponse.choice] &&
            jevResponse.confidence >= this.minConfidence
          ) {
            jevOutcome = 'DECIDED';
            jevReason = 'JEV_ADVISORY_ACCEPTED';
            jevConfidence = jevResponse.confidence;
            chosenProfileKey = jevResponse.choice;
          } else {
            // Rule: "JEV lỗi/undecided phải có fallback xác định được và được ghi log."
            jevOutcome = 'UNDECIDED';
            jevReason = 'JEV_LOW_CONFIDENCE_OR_UNDECIDED_DETERMINISTIC_FALLBACK';
            jevConfidence = jevResponse ? jevResponse.confidence ?? UNKNOWN : UNKNOWN;
            chosenProfileKey = fallbackProfileKey;
          }

          this.jevCache.set(cacheKey, {
            chosenProfileKey,
            confidence: jevConfidence,
            outcome: jevOutcome,
            timestamp: Date.now(),
          });
        } catch (err) {
          jevOutcome = 'ERROR';
          jevReason = `JEV_CALL_FAILED_${err.message || 'EXCEPTION'}_DETERMINISTIC_FALLBACK`;
          chosenProfileKey = fallbackProfileKey;
          this.jevCache.set(cacheKey, { chosenProfileKey, confidence: jevConfidence, outcome: jevOutcome });
        }
      }
    } else if (admitted.length < 2) {
      jevOutcome = 'SKIPPED';
      jevReason = 'SINGLE_ELIGIBLE_CANDIDATE_NO_JEV_CALL';
      chosenProfileKey = fallbackProfileKey;
    } else {
      jevOutcome = 'UNDECIDED';
      jevReason = 'JEV_UNCONFIGURED_DETERMINISTIC_FALLBACK';
      chosenProfileKey = fallbackProfileKey;
    }

    const weights = WEIGHT_PROFILES[chosenProfileKey] || WEIGHT_PROFILES.BALANCED;

    // 3. Post-await Re-validation Gate (Finding 6)
    // If JEV or any await changes health, re-validate candidates before ranking and selection!
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
          });
        } else {
          // All viable branches have failed during await
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

    // 4. Score & Rank Re-validated Candidates using determined weights (Controller Ranking)
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

    // Controller selects highest-scoring admitted and healthy candidate from ranking
    const selectedEntry = scoredList[0];
    const chosenCandidate = selectedEntry.candidate;

    // 4. Context & Budget Interface (Finding 11)
    // Explicit token budget takes precedence over contextSize
    const tokenBudget =
      profile.tokenBudget !== undefined
        ? profile.tokenBudget
        : profile.contextSize !== undefined
          ? profile.contextSize
          : UNKNOWN;

    // Do not invent magic numbers when unsupplied
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

    // Truthful token enforcement status: cannot claim enforced without runner adapter
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
        outcome: jevOutcome,
        reason: jevReason,
        confidence: jevConfidence,
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
 * Convenience entry point for runtime / pipeline callers (e.g. routing.js, cli.js).
 */
async function selectOptimalRoute(params = {}) {
  const { aggregateAllCandidates } = require('./candidate-adapters');
  const selector = new UnifiedRouteSelector({ healthRegistry: SHARED_HEALTH_REGISTRY, ...params.selectorOptions });

  const aggregated = params.candidates ? { candidates: params.candidates, unconnectedSources: [] }
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
