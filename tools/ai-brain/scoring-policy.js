'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { candidateKey } = require('./candidates');
const { matchesCandidate } = require('./route-evidence');
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;

// Values and dimension names belong to the operator's versioned data, not code.
function loadScoringPolicy(file = path.join(__dirname, 'data', 'scoring-policy.json')) {
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { scoringPolicy: undefined, scoringPolicyStatus: 'SCORING_POLICY_MISSING' };
    }
    throw Object.assign(new Error('SCORING_POLICY_INVALID'), { code: 'SCORING_POLICY_INVALID' });
  }
  if (
    !object(policy) ||
    !text(policy.version) ||
    !text(policy.source) ||
    !text(policy.rationale) ||
    !Number.isFinite(policy.maxAgeMs) ||
    policy.maxAgeMs <= 0 ||
    !object(policy.dimensions) ||
    !Object.keys(policy.dimensions).length ||
    Object.entries(policy.dimensions).some(
      ([name, r]) =>
        !text(name) ||
        !object(r) ||
        !Number.isFinite(r.weight) ||
        r.weight <= 0 ||
        !Number.isFinite(r.min) ||
        !Number.isFinite(r.max) ||
        r.max <= r.min ||
        !text(r.unit) ||
        (r.direction !== 'higher' && r.direction !== 'lower') ||
        (r.measurement !== undefined &&
          (!object(r.measurement) || !text(r.measurement.store) || !text(r.measurement.metric)))
    )
  ) {
    throw Object.assign(new Error('SCORING_POLICY_INVALID'), { code: 'SCORING_POLICY_INVALID' });
  }
  return { scoringPolicy: policy, scoringPolicyStatus: 'SCORING_POLICY_LOADED' };
}

function joinMeasurements(candidates, assessment, context = {}) {
  if (!assessment.scoringPolicy) return;
  const health = require('./route-health');
  const routeHealth =
    context.routeHealth ||
    health.loadStore(context.routeHealthFile || health.DEFAULT_ROUTE_HEALTH_PATH, {
      allowMissing: true,
    });
  const priors = context.priors || require('./priors').loadPriors();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const evidence = (context.evidenceData?.combinations || [])
      .filter((c) => matchesCandidate(candidate, c))
      .flatMap((c) => c.evidence || []);
    const id = health.probeIdentity(candidate);
    const route = routeHealth.paths?.[health.healthKey(id.model, id.route)];
    const stores = {
      evidence,
      'route-health': route?.candidateKey === key ? [route] : [],
      priors: (priors.ranking || []).filter((r) => r.modelId === candidate.modelId),
    };
    candidate.measurements = {};
    for (const [dimension, rule] of Object.entries(assessment.scoringPolicy.dimensions)) {
      const binding = rule.measurement;
      const records = binding
        ? Object.hasOwn(stores, binding.store)
          ? stores[binding.store]
          : []
        : Object.values(stores).flat();
      const available = [];
      for (const record of records) {
        const measured = record.measurements?.[binding?.metric || dimension];
        if (measured) available.push(measured);
        // elapsedMs is one recorded observation, never a timeout fallback or tier score.
        // Health can carry forward elapsedMs with a newer check time: do not use that scalar.
        if (
          binding?.store === 'evidence' &&
          binding.metric === 'elapsedMs' &&
          Number.isFinite(record.elapsedMs)
        ) {
          available.push({
            value: record.elapsedMs,
            unit: 'milliseconds',
            samples: 1,
            observedAt: record.observedAt || record.timestamp || record.at || record.ts,
            modelId: record.modelId,
            modelVersion: record.modelVersion,
            source: `${context.evidenceDir || 'evidence'}#${key}`,
          });
        }
      }
      // Reuse the scorer's freshness, unit, bounds, sample and version checks.
      const valid = available.filter((m) => {
        const scored = require('./routing').scoreForProfile(
          { ...candidate, measurements: { [dimension]: m } },
          { scoringPolicy: { ...assessment.scoringPolicy, dimensions: { [dimension]: rule } } },
          context
        );
        return Object.hasOwn(scored.breakdown.measurements, dimension);
      });
      valid.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
      if (valid.length) candidate.measurements[dimension] = valid[0];
    }
  }
}

function printSources(decision, log) {
  for (const c of decision.candidates || decision.ranking || []) {
    const b = c.scoreBreakdown || {};
    const parts = b.policy
      ? Object.fromEntries(
          Object.keys(b)
            .filter((k) => typeof b[k] === 'number' || b[k] === null)
            .map((k) => [k, b.measurements?.[k] ? 'sourced' : 'unknown'])
        )
      : b.sources || {};
    const label = Object.entries(parts)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const qualityLabel = c.qualityLabel || b.qualityLabel;
    log(`${c.offeringId || c.candidateKey}: ${[label, qualityLabel].filter(Boolean).join(', ')}`);
  }
}

module.exports = { loadScoringPolicy, joinMeasurements, printSources };
