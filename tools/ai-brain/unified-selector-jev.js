'use strict';

const ROUTE_IDENTITY_DATA = require('../../config/route-identity.json');
const { advisoryNamesIdentity, hashObject } = require('./unified-selector-admission');
const { UNKNOWN } = require('./route-identity');

const WEIGHT_DIMENSIONS = Object.freeze([...(ROUTE_IDENTITY_DATA.weightDimensions || [])]);

function buildWeightProfile(values) {
  const profile = {};
  WEIGHT_DIMENSIONS.forEach((dimension, index) => {
    profile[dimension] = values[index];
  });
  return Object.freeze(profile);
}

const WEIGHT_PROFILES = Object.freeze(
  Object.fromEntries(
    Object.entries(ROUTE_IDENTITY_DATA.weightProfiles || {}).map(([name, values]) => [
      name,
      buildWeightProfile(values),
    ])
  )
);

const ROLE_FALLBACK_PROFILE = Object.freeze({
  writer: 'BALANCED',
  repair: 'BALANCED',
  reviewer: 'QUALITY_FIRST',
  'security-review': 'QUALITY_FIRST',
  scanner: 'LATENCY_FIRST',
  researcher: 'BALANCED',
  integrator: 'BALANCED',
});

async function determineWeightProfile({
  admitted,
  profile,
  fallbackProfileKey,
  jevCache,
  jevAsk,
  minConfidence = 0.6,
  healthRegistry,
}) {
  let chosenProfileKey = fallbackProfileKey;
  let jevOutcome = 'SKIPPED';
  let jevReason = 'NOT_CALLED';
  let jevConfidence = UNKNOWN;

  if (admitted.length >= 2 && typeof jevAsk === 'function') {
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
      healthStateHash: healthRegistry.getStateHash(),
      candidates: admitted
        .map((x) => ({ key: x.candidateKey, metadata: x.metadata, branches: x.comboBranches }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    });

    const cached = jevCache.get(cacheKey);
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

        const jevResponse = await jevAsk(jevQuestion);

        if (advisoryNamesIdentity(jevResponse)) {
          jevOutcome = 'UNDECIDED';
          jevReason = 'IDENTITY_PROHIBITED';
          jevConfidence = 0;
          chosenProfileKey = fallbackProfileKey;
        } else if (
          jevResponse &&
          jevResponse.choice &&
          WEIGHT_PROFILES[jevResponse.choice] &&
          jevResponse.confidence >= minConfidence
        ) {
          jevOutcome = 'DECIDED';
          jevReason = 'JEV_ADVISORY_ACCEPTED';
          jevConfidence = jevResponse.confidence;
          chosenProfileKey = jevResponse.choice;
        } else {
          jevOutcome = 'UNDECIDED';
          jevReason = 'JEV_LOW_CONFIDENCE_OR_UNDECIDED_DETERMINISTIC_FALLBACK';
          jevConfidence = jevResponse ? (jevResponse.confidence ?? UNKNOWN) : UNKNOWN;
          chosenProfileKey = fallbackProfileKey;
        }

        jevCache.set(cacheKey, {
          chosenProfileKey,
          confidence: jevConfidence,
          outcome: jevOutcome,
          timestamp: Date.now(),
        });
      } catch (err) {
        jevOutcome = 'ERROR';
        jevReason = `JEV_CALL_FAILED_${err.message || 'EXCEPTION'}_DETERMINISTIC_FALLBACK`;
        chosenProfileKey = fallbackProfileKey;
        jevCache.set(cacheKey, {
          chosenProfileKey,
          confidence: jevConfidence,
          outcome: jevOutcome,
        });
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

  return {
    chosenProfileKey,
    outcome: jevOutcome,
    reason: jevReason,
    confidence: jevConfidence,
  };
}

module.exports = {
  WEIGHT_PROFILES,
  ROLE_FALLBACK_PROFILE,
  determineWeightProfile,
};
