'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { candidateKey } = require('./candidates');
const { matchesCandidate } = require('./route-evidence');
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;

// Values and dimension names belong to the operator's versioned data, not code.
function loadScoringPolicy(
  file = path.join(__dirname, 'data', 'scoring-policy.json'),
  options = {}
) {
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
    (policy.maxFutureSkewMs !== undefined &&
      (!Number.isFinite(policy.maxFutureSkewMs) || policy.maxFutureSkewMs < 0)) ||
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
  let scoringPriors;
  let data = null;
  if (policy.priorsFile) {
    // The AA snapshot is fetched at runtime (aa-snapshot.js), never committed.
    const snapPath = path.resolve(path.dirname(file), policy.priorsFile);
    let stat;
    try {
      stat = fs.statSync(snapPath);
    } catch (err) {
      return {
        scoringPolicy: undefined,
        scoringPolicyStatus: 'SCORING_POLICY_INACTIVE',
        scoringPriorsStatus: err.code === 'ENOENT' ? 'AA_SNAPSHOT_MISSING' : 'AA_SNAPSHOT_CORRUPT',
      };
    }
    try {
      data = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    } catch {
      return {
        scoringPolicy: undefined,
        scoringPolicyStatus: 'SCORING_POLICY_INACTIVE',
        scoringPriorsStatus: 'AA_SNAPSHOT_CORRUPT',
      };
    }
    if (!data || !Array.isArray(data.rows)) {
      return {
        scoringPolicy: undefined,
        scoringPolicyStatus: 'SCORING_POLICY_INACTIVE',
        scoringPriorsStatus: 'AA_SNAPSHOT_CORRUPT',
      };
    }
    // Freshness has one definition: the snapshot's own observation timestamp when
    // it parses, otherwise the file mtime, so a copied or restored snapshot with a
    // recent mtime is never fresh. Injecting a clock changes the current time, never
    // the freshness definition. The permitted future-clock skew is operator
    // configuration (`policy.maxFutureSkewMs`, override `options.maxFutureSkewMs`),
    // never a code constant; unconfigured means no future tolerance here.
    const now = Number((options && options.now) ?? Date.now());
    const obs = data.observedAt ? Date.parse(data.observedAt) : NaN;
    const age = Number.isFinite(obs) ? now - obs : now - stat.mtimeMs;
    const maxFutureSkewMs = Number((options && options.maxFutureSkewMs) ?? policy.maxFutureSkewMs);
    if (Number.isFinite(policy.maxAgeMs) && (age > policy.maxAgeMs || age < -maxFutureSkewMs)) {
      return {
        scoringPolicy: undefined,
        scoringPolicyStatus: 'SCORING_POLICY_INACTIVE',
        scoringPriorsStatus: 'AA_SNAPSHOT_STALE',
      };
    }
  }
  if (data) {
    scoringPriors = {
      ranking: data.rows.map((row) => {
        const modelId = row.variant ? `${row.base}-${row.variant}` : row.base;
        const modelVersion = `${data.version}:${row.name}`;
        return {
          modelId,
          modelVersion,
          base: row.base,
          variant: row.variant || '',
          measurements: {
            quality: {
              value: row.pct,
              unit: data.unit,
              samples: 1,
              source: data.source,
              observedAt: data.observedAt,
              modelId,
              modelVersion,
            },
          },
        };
      }),
    };
  }
  return {
    scoringPolicy: policy,
    scoringPolicyStatus: 'SCORING_POLICY_LOADED',
    ...(scoringPriors ? { scoringPriors } : {}),
  };
}

// A route ID carries a gateway/vendor path and a deployment tag (`:free`) that AA does not.
// The last path segment, normalised the way AA bases are, names the AA base; a trailing
// segment counts as an effort only when AA publishes that variant for that base. A route
// that names no effort while AA scores only per effort takes the lowest published effort,
// so a score is never higher than AA measured. No vocabulary lives here: it comes from the rows.
function aaRowsFor(modelId, rows, deploymentTags) {
  if (typeof modelId !== 'string' || !rows.length) return [];
  if (!Array.isArray(deploymentTags)) deploymentTags = [];
  let id = modelId
    .split('/')
    .pop()
    .toLowerCase()
    .replace(/[._ ]+/g, '-');
  // Only a configured deployment tag is the same model; any other tag (revision, quantization) stays unknown.
  const tag = id.match(/:([^:]+)$/);
  if (tag) {
    if (!deploymentTags.includes(tag[1])) return [];
    id = id.slice(0, tag.index);
  }
  const byBase = new Map();
  for (const r of rows) {
    if (!r.base) continue;
    if (!byBase.has(r.base)) byBase.set(r.base, []);
    byBase.get(r.base).push(r);
  }
  const plain = byBase.get(id);
  if (plain) {
    const exact = plain.filter((r) => !r.variant);
    if (exact.length) return exact;
    const low = Math.min(...plain.map((r) => r.measurements.quality.value));
    return [{ ...plain.find((r) => r.measurements.quality.value === low), lowestEffort: true }];
  }
  for (const [base, list] of byBase) {
    if (!id.startsWith(base + '-')) continue;
    const variant = id.slice(base.length + 1);
    const hit = list.filter((r) => r.variant === variant);
    if (hit.length) return hit;
  }
  return originRows(id, modelId, byBase, deploymentTags);
}

// Sources rename models. When no AA base matches directly, resolve the model's origin:
// by a policy deployment tag and a trailing numeric release tag that one side carries and the other omits
// (`deepseek-v4.1-flash` = AA `DeepSeek V4.1 Flash 1017`). Several candidates take the
// lowest published score, so an equivalent is never scored above what AA measured.
function originRows(id, modelId, byBase, deploymentTags) {
  let own = id;
  for (const t of deploymentTags) if (own.endsWith('-' + t)) own = own.slice(0, -t.length - 1);
  const lowest = (list, via) => {
    const low = Math.min(...list.map((r) => r.measurements.quality.value));
    return [{ ...list.find((r) => r.measurements.quality.value === low), via }];
  };
  // Operator 2026-11-08: a known AA base followed by a variant AA does not publish
  // (`gpt-6.1-sol-pro`, `glm-5.3-prime`) takes that base's result, at its lowest published
  // score. The longest matching base wins so `glm-5-3-flash-x` prefers `glm-5-3-flash` over
  // `glm-5-3`. The shared prior matcher is not used: it merges aliases across distinct models.
  // An exact base after the deployment tag is that model, never a shorter parent.
  if (byBase.has(own)) return lowest(byBase.get(own), 'aa-origin-deployment-tag');
  let parent = null;
  for (const base of byBase.keys()) {
    if (own.startsWith(base + '-') && (!parent || base.length > parent.length)) parent = base;
  }
  if (parent) return lowest(byBase.get(parent), 'aa-origin-variant');
  const tagless = (s) => s.replace(/-\d{3,8}$/, '');
  own = tagless(own);
  const candidates = [];
  for (const [base, list] of byBase) if (tagless(base) === own) candidates.push(...list);
  if (candidates.length) return lowest(candidates, 'aa-origin-release-tag');
  // Operator 2026-11-08: when AA lists no base for the name, take its prefix family
  // (`glm-5` -> AA `glm-5-3*`). Trailing segments are dropped one at a time; a family needs
  // at least two segments so a bare vendor word never matches. Lowest family score only.
  for (let p = own; p.includes('-'); p = p.slice(0, p.lastIndexOf('-'))) {
    const family = [];
    for (const [base, list] of byBase) if (base.startsWith(p + '-')) family.push(...list);
    if (family.length && p.split('-').length >= 2) return lowest(family, 'aa-origin-family');
  }
  // Last resort (operator 2026-11-08, e.g. MiniMax-M2.7, deprecated without an index): the
  // vendor's lowest published score, when the first name segment names an AA vendor family.
  const vendor = own.split('-')[0];
  const vendorRows = [];
  for (const [base, list] of byBase) if (base.split('-')[0] === vendor) vendorRows.push(...list);
  return vendorRows.length ? lowest(vendorRows, 'aa-origin-vendor') : [];
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
    const snapshot = assessment.scoringPriors?.ranking || [];
    const exactRows = snapshot.filter((r) => r.modelId === candidate.modelId);
    // A joined AA row is attributed to this route's model ID; the AA row it came from stays as provenance.
    const snapshotRows = exactRows.length
      ? exactRows
      : aaRowsFor(candidate.modelId, snapshot, assessment.scoringPolicy.deploymentTags).map(
          (r) => ({
            ...r,
            modelId: candidate.modelId,
            measurements: {
              quality: {
                ...r.measurements.quality,
                modelId: candidate.modelId,
                aaModelId: r.modelId,
                matchedVia: r.via
                  ? r.via
                  : r.lowestEffort
                    ? 'aa-lowest-effort'
                    : r.variant
                      ? 'aa-base-effort'
                      : 'aa-base',
              },
            },
          })
        );
    // This is the operator-defined AA observation version, not a provider revision.
    // Never replace an explicit route version.
    if (!candidate.modelVersion && snapshotRows.length === 1) {
      candidate.modelVersion = snapshotRows[0].modelVersion;
    }
    const key = candidateKey(candidate);
    const evidence = (context.evidenceData?.combinations || [])
      .filter((c) => matchesCandidate(candidate, c))
      .flatMap((c) => c.evidence || []);
    const id = health.probeIdentity(candidate);
    const route = routeHealth.paths?.[health.healthKey(id.model, id.route)];
    const stores = {
      evidence,
      'route-health': route?.candidateKey === key ? [route] : [],
      priors: [
        ...snapshotRows,
        ...(priors.ranking || []).filter((r) => r.modelId === candidate.modelId),
      ],
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
