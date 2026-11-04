'use strict';

const crypto = require('crypto');
const { UNKNOWN } = require('./route-identity');

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

function harnessEnforcesTokens(harness) {
  const h = String(harness || '').toLowerCase();
  return ['direct-http', 'api', 'custom-runner'].includes(h);
}

function hashObject(obj) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(obj || {}))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Admission Gate: Evaluates candidate suitability against task profile and policy.
 */
function evaluateAdmission(candidate, profile = {}, authorCandidate = null, context = {}) {
  const id = candidate;
  const role = String(profile?.role || 'writer').toLowerCase();
  const excludedPatterns = context.excludedModelPatterns || {};
  const healthRegistry = context.healthRegistry;

  const patterns = excludedPatterns[role] || [];
  const excluded = (route) =>
    patterns.some((pattern) => {
      const regex =
        pattern instanceof RegExp
          ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
          : new RegExp(pattern, 'i');
      return regex.test(route.outboundModelId) || regex.test(route.configuredModelId);
    });
  if (excluded(id) || (id.isCombo && id.comboBranches.some(excluded))) {
    return { admitted: false, rejectionReason: 'MODEL_EXCLUDED_BY_ROLE_POLICY' };
  }

  // 2. Reviewer Independence Policy
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

  // 3. Combo Constituent Branch Health & Capabilities Check
  if (id.isCombo) {
    const branches = Array.isArray(id.comboBranches) ? id.comboBranches : [];
    const viableBranches = Array.isArray(id.metadata?.viableBranches)
      ? id.metadata.viableBranches
      : [];
    if (branches.length === 0 && viableBranches.length === 0) {
      return {
        admitted: false,
        rejectionReason: 'COMBO_HAS_NO_CONSTITUENT_BRANCHES',
      };
    }

    for (const branch of branches) {
      const evaluation = evaluateAdmission(branch, profile, authorCandidate, context);
      if (!evaluation.admitted) {
        return {
          admitted: false,
          rejectionReason: 'COMBO_BRANCH_REJECTED_' + evaluation.rejectionReason,
        };
      }
    }

    for (const branch of viableBranches) {
      const evaluation = evaluateAdmission(branch, profile, authorCandidate, context);
      if (!evaluation.admitted) {
        return {
          admitted: false,
          rejectionReason: 'COMBO_BRANCH_REJECTED_' + evaluation.rejectionReason,
        };
      }
    }
  } else {
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

  let staleQuota = false;
  // 4. Route Health & Cooldown Check
  if (healthRegistry) {
    const health = healthRegistry.evaluateHealth(id);
    if (!health.healthy) {
      return {
        admitted: false,
        rejectionReason: health.reason
          ? `ROUTE_HEALTH_BLOCKED_${health.reason}`
          : `ROUTE_HEALTH_BLOCKED_${health.blockedBy?.toUpperCase()}_${health.category}`,
        resetsAt: health.resetsAt,
      };
    }
    staleQuota = Boolean(health.staleQuota);
  }

  // 5. Cost Ceiling Check
  const ceiling = Number(profile.costCeiling);
  if (
    !id.isCombo &&
    profile.costCeiling !== undefined &&
    profile.costCeiling !== null &&
    profile.costCeiling !== UNKNOWN &&
    Number.isFinite(ceiling) &&
    ceiling >= 0
  ) {
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
    staleQuota,
  };
}

/**
 * Scores an admitted candidate based on known metadata and weight profile.
 */
function scoreCandidate(candidate, profile, weights) {
  const id = candidate;
  const meta = id.metadata || {};

  const qualityRaw = meta.qualityScore !== undefined ? meta.qualityScore : meta.intelligenceIndex;
  const hasQuality =
    qualityRaw !== undefined && qualityRaw !== null && Number.isFinite(Number(qualityRaw));
  const quality = hasQuality ? Number(qualityRaw) : null;

  const latencyRaw = meta.latencyScore;
  const hasLatency =
    latencyRaw !== undefined && latencyRaw !== null && Number.isFinite(Number(latencyRaw));
  const latency = hasLatency ? Number(latencyRaw) : null;

  const costRaw = meta.costScore;
  const hasCost = costRaw !== undefined && costRaw !== null && Number.isFinite(Number(costRaw));
  const cost = hasCost ? Number(costRaw) : null;

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

  let penalty = 0;
  if (meta.staleQuota) penalty += 15;
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

module.exports = {
  advisoryNamesIdentity,
  harnessEnforcesTokens,
  hashObject,
  evaluateAdmission,
  scoreCandidate,
};
