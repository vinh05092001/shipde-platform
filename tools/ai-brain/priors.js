'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PRIORS_FILE = path.join(__dirname, 'data', 'external-model-priors.json');
const TIER_BONUSES = Object.freeze({ T1: 6, T2: 4, T3: 2, T4: 0 });

/** Load the local, curated prior file. Priors are optional and never block routing. */
function loadPriors(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file || DEFAULT_PRIORS_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.ranking)) {
      return { ranking: [] };
    }
    return parsed;
  } catch (_) {
    return { ranking: [] };
  }
}

function normaliseCanonical(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let canonical = value.trim().toLowerCase().split('/').pop();
  canonical = canonical.split('@')[0];
  canonical = canonical.replace(/(?::free|-free)$/, '');
  canonical = canonical.replace(/[._]/g, '-');
  return canonical || null;
}

/** Resolve one candidate's role-specific benchmark prior, if available. */
function priorFor(candidate, role, priors) {
  const modelId = candidate && (candidate.modelId || candidate.model);
  const canonical = normaliseCanonical(modelId);
  if (!canonical) return null;

  const ranking = priors && Array.isArray(priors.ranking) ? priors.ranking : [];
  const match = ranking.find((entry) => entry && normaliseCanonical(entry.canonical) === canonical);
  if (!match) return null;

  const tier =
    role === 'reviewer' || role === 'security-review' ? match.reviewTier : match.codingTier;
  const bonus = TIER_BONUSES[tier] ?? null;
  if (bonus === null) return null;

  return { canonical: match.canonical, tier, bonus };
}

module.exports = { loadPriors, priorFor };
