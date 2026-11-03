'use strict';

/**
 * Ship Dễ — Unified Route Selector & JEV Integration (PATCH 2)
 *
 * Implements the shared unified route selection contract:
 * 1. Candidate Aggregation across 3 pathways (9router, direct, AGY pool).
 * 2. Strict Admission Gating before Ranking.
 * 3. Contract-compliant JEV Advisory with context-aware hashing and deterministic fallback.
 * 4. Task-scoped Context & Structured Budget Interface.
 */

const crypto = require('crypto');
const { createRouteIdentity, distinguishPathway, UNKNOWN } = require('./route-identity');
const { ScopedHealthRegistry, ErrorCategory, HealthScope } = require('./scoped-health');

// AGENTS.md policy: Claude family models are excluded from worker/reviewer roles
const CLAUDE_FAMILY_PATTERN = /claude|opus|sonnet|haiku/i;
const WORKER_REVIEWER_ROLES = new Set(['writer', 'reviewer', 'security-review', 'repair']);

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
 * Checks if harness natively enforces token limits.
 */
function harnessEnforcesTokens(harness) {
  const h = String(harness || '').toLowerCase();
  return ['direct-http', 'api', 'custom-runner'].includes(h);
}

/**
 * Computes deterministic MD5 hash of any JSON-serializable object.
 */
function hashObject(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj || {})).digest('hex').slice(0, 16);
}

class UnifiedRouteSelector {
  constructor(options = {}) {
    this.healthRegistry = options.healthRegistry || new ScopedHealthRegistry();
    this.jevCache = new Map(); // cacheKey -> { chosen, confidence, outcome, timestamp }
    this.jevAsk = options.jevAsk || null;
    this.minConfidence = options.minConfidence || 0.6;
  }

  /**
   * Admission Gate: Evaluates candidate suitability against task profile and policy.
   * Returns { admitted: boolean, rejectionReason?: string, scoreBreakdown?: object }
   */
  evaluateAdmission(candidate, profile, authorCandidate = null) {
    const id = candidate;
    const role = String(profile.role || 'writer').toLowerCase();

    // 1. Policy Bar: AGENTS.md Claude exclusion for worker/reviewer
    if (WORKER_REVIEWER_ROLES.has(role)) {
      if (id.isCombo) {
        // If combo, verify ALL constituent branches
        const hasForbiddenBranch = id.comboBranches.some(
          (b) => CLAUDE_FAMILY_PATTERN.test(b.outboundModelId) || CLAUDE_FAMILY_PATTERN.test(b.configuredModelId)
        );
        if (hasForbiddenBranch) {
          return {
            admitted: false,
            rejectionReason: 'COMBO_CONTAINS_CLAUDE_BRANCH_BARRED_FOR_ROLE',
          };
        }
      } else {
        if (
          CLAUDE_FAMILY_PATTERN.test(id.outboundModelId) ||
          CLAUDE_FAMILY_PATTERN.test(id.configuredModelId)
        ) {
          return {
            admitted: false,
            rejectionReason: 'CLAUDE_FAMILY_EXCLUDED_BY_AGENTS_MD_POLICY',
          };
        }
      }
    }

    // 2. Reviewer Independence Policy: Reviewer cannot share author's provider or failure domain
    if (role === 'reviewer' && authorCandidate) {
      const authorProv = authorCandidate.upstreamProviderId || '';
      const revProv = id.upstreamProviderId || '';
      if (authorProv && revProv && authorProv.toLowerCase() === revProv.toLowerCase()) {
        return {
          admitted: false,
          rejectionReason: 'REVIEWER_SHARES_AUTHOR_UPSTREAM_PROVIDER',
        };
      }
      if (id.isCombo) {
        const sharesBranch = id.comboBranches.some(
          (b) => (b.upstreamProviderId || '').toLowerCase() === authorProv.toLowerCase()
        );
        if (sharesBranch) {
          return {
            admitted: false,
            rejectionReason: 'COMBO_REVIEWER_HAS_BRANCH_SHARING_AUTHOR_PROVIDER',
          };
        }
      }
    }

    // 3. Required Capabilities Match
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

    // 4. Route Health & Cooldown Check
    const health = this.healthRegistry.evaluateHealth(id);
    if (!health.healthy) {
      return {
        admitted: false,
        rejectionReason: `ROUTE_HEALTH_BLOCKED_${health.blockedBy?.toUpperCase()}_${health.category}`,
        resetsAt: health.resetsAt,
      };
    }

    // 5. Cost Ceiling Check
    const estCost = Number(id.metadata?.estimatedCostUsd ?? 0);
    const ceiling = Number(profile.costCeiling);
    if (Number.isFinite(ceiling) && ceiling > 0 && estCost > ceiling) {
      return {
        admitted: false,
        rejectionReason: 'COST_EXCEEDS_TASK_CEILING',
      };
    }

    return {
      admitted: true,
      staleQuota: Boolean(health.staleQuota),
    };
  }

  /**
   * Scores an admitted candidate based on task profile and weight profile.
   */
  scoreCandidate(candidate, profile, weights) {
    const id = candidate;
    const meta = id.metadata || {};

    // Quality: model intelligence index or prior score (default 50)
    let quality = Number(meta.qualityScore || meta.intelligenceIndex || 50);
    
    // Task complexity matching: light tasks should use light models with high score
    const complexity = String(profile.complexity || 'standard').toLowerCase();
    const isLightTask = ['trivial', 'simple', 'short'].includes(complexity);
    const isLightModel = meta.isLightweight === true || /flash|mini|nano|small/i.test(id.outboundModelId);

    if (isLightTask && isLightModel) {
      quality = Math.max(quality, 80); // light model is optimal for light task
    }

    // Latency score (0-100, default 60)
    const latency = Number(meta.latencyScore || 60);

    // Cost score: lower cost = higher score (0-100)
    const cost = Number(meta.costScore || 70);

    // Penalties
    let penalty = 0;
    if (meta.staleQuota) penalty += 15; // Unknown/stale quota penalty
    if (meta.currentWorkload > 0) penalty += Math.min(30, meta.currentWorkload * 10);

    const weightedScore = Math.max(
      0,
      Math.round(
        (quality * weights.quality + latency * weights.latency + cost * weights.cost) / 100 - penalty
      )
    );

    return {
      totalScore: weightedScore,
      breakdown: {
        qualityScore: quality,
        latencyScore: latency,
        costScore: cost,
        penalty,
        weights,
      },
    };
  }

  /**
   * Core Selection Pipeline:
   * Admission -> Scoring -> JEV Advisory -> Budget Binding
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

    // 2. Determine Weight Profile
    const role = String(profile.role || 'writer').toLowerCase();
    const fallbackProfileKey = ROLE_FALLBACK_PROFILE[role] || 'BALANCED';
    const weights = WEIGHT_PROFILES[fallbackProfileKey];

    // 3. Score & Rank Admitted Candidates
    const scoredList = admitted.map((c) => {
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

    // 4. JEV Advisory Integration
    let selectedEntry = scoredList[0];
    let jevOutcome = 'SKIPPED';
    let jevReason = 'NOT_CALLED';
    let jevConfidence = UNKNOWN;

    // Rule: "Không gọi khi dưới hai lựa chọn."
    if (scoredList.length >= 2 && typeof this.jevAsk === 'function') {
      const topN = scoredList.slice(0, Math.min(5, scoredList.length));
      
      // Context-aware composite cache key
      const cacheKey = hashObject({
        profile: {
          taskId: profile.taskId,
          role: profile.role,
          complexity: profile.complexity,
          requiredCapabilities: profile.requiredCapabilities,
        },
        candidates: topN.map((x) => x.candidateKey),
        healthEpoch: Date.now() - (Date.now() % (60 * 1000)), // 1-minute bucketed health state
      });

      const cached = this.jevCache.get(cacheKey);
      if (cached) {
        jevOutcome = cached.outcome;
        jevReason = 'JEV_CACHE_HIT';
        jevConfidence = cached.confidence;
        const match = topN.find((x) => x.candidateKey === cached.chosen);
        if (match) selectedEntry = match;
      } else {
        try {
          const prompt = `Select the optimal route for task ${profile.taskId} (role: ${profile.role}, complexity: ${profile.complexity}). Options: ${topN.map((x) => x.candidateKey).join(', ')}`;
          const jevResponse = await this.jevAsk({
            kind: 'select-route',
            prompt,
            options: topN.map((x) => x.candidateKey),
            context: { profile, options: topN },
          });

          if (
            jevResponse &&
            jevResponse.choice &&
            jevResponse.confidence >= this.minConfidence &&
            topN.some((x) => x.candidateKey === jevResponse.choice)
          ) {
            jevOutcome = 'DECIDED';
            jevReason = 'JEV_ADVISORY_ACCEPTED';
            jevConfidence = jevResponse.confidence;
            selectedEntry = topN.find((x) => x.candidateKey === jevResponse.choice) || selectedEntry;
          } else {
            // Rule: "JEV lỗi/undecided phải có fallback xác định được và được ghi log."
            jevOutcome = 'UNDECIDED';
            jevReason = 'JEV_LOW_CONFIDENCE_OR_UNDECIDED_DETERMINISTIC_FALLBACK';
            jevConfidence = jevResponse ? jevResponse.confidence ?? UNKNOWN : UNKNOWN;
          }

          this.jevCache.set(cacheKey, {
            chosen: selectedEntry.candidateKey,
            confidence: jevConfidence,
            outcome: jevOutcome,
            timestamp: Date.now(),
          });
        } catch (err) {
          jevOutcome = 'ERROR';
          jevReason = `JEV_CALL_FAILED_${err.message || 'EXCEPTION'}_DETERMINISTIC_FALLBACK`;
        }
      }
    } else if (scoredList.length < 2) {
      jevOutcome = 'SKIPPED';
      jevReason = 'SINGLE_ELIGIBLE_CANDIDATE_NO_JEV_CALL';
    }

    // 5. Context & Budget Interface
    const chosenCandidate = selectedEntry.candidate;
    const tokenBudget = profile.contextSize || profile.tokenBudget || 32000;
    const turnBudget = profile.turnBudget || 15;
    const deadlineMs = profile.expectedDuration || 300000;
    const tokenEnforcement = harnessEnforcesTokens(chosenCandidate.harness)
      ? 'ENFORCED_BY_RUNNER'
      : 'UNENFORCED_BY_HARNESS';

    return {
      status: 'ADMITTED_AND_SELECTED',
      chosen: chosenCandidate.candidateKey,
      identity: chosenCandidate,
      ranking: scoredList,
      totalAdmitted: admitted.length,
      totalRejected: rejections.length,
      rejectionReasons: cappedRejections,
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
 * Convenience entry point for runtime / pipeline callers (e.g. route.js).
 */
async function selectOptimalRoute(params = {}) {
  const { aggregateAllCandidates } = require('./candidate-adapters');
  const selector = new UnifiedRouteSelector(params.selectorOptions || {});

  const aggregated = aggregateAllCandidates(params.adapterOptions || {});
  const candidates = params.candidates || aggregated.candidates;

  const taskProfile = {
    taskId: params.item || params.taskId || 'TASK-UNSPECIFIED',
    role: params.role || 'writer',
    complexity: params.complexity || 'standard',
    requiredCapabilities: params.requiredCapabilities || ['general_code'],
    costCeiling: params.costCeiling || null,
    contextSize: params.contextSize || 32000,
    turnBudget: params.turnBudget || 15,
    expectedDuration: params.expectedDuration || 300000,
    acceptanceCriteria: params.acceptanceCriteria || [],
    instructions: params.instructions || '',
  };

  const result = await selector.selectRoute(candidates, taskProfile, {
    authorCandidate: params.authorCandidate || null,
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
  CLAUDE_FAMILY_PATTERN,
  harnessEnforcesTokens,
  selectOptimalRoute,
};
