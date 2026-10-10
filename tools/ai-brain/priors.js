'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PRIORS_FILE = path.join(__dirname, 'data', 'model-priors.json');
const TIER_BONUSES = Object.freeze({ T1: 6, T2: 4, T3: 2, T4: 0 });
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

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
function priorFor(candidate, role, priors, now) {
  const modelId = candidate && (candidate.modelId || candidate.model);
  const canonical = normaliseCanonical(modelId);
  if (!canonical) return null;

  const ranking = priors && Array.isArray(priors.ranking) ? priors.ranking : [];
  const match = ranking.find(
    (entry) => entry && normaliseModelId(entry.canonical) === normaliseModelId(modelId)
  );
  if (!match) return null;

  const tier =
    role === 'reviewer' || role === 'security-review' ? match.reviewTier : match.codingTier;
  const bonus = TIER_BONUSES[tier] ?? null;
  if (bonus === null) return null;

  const priorScore = Number.isFinite(Number(match.score))
    ? Number(match.score)
    : benchmarkScore(match);
  const result = {
    canonical: match.canonical,
    tier,
    bonus,
  };
  if (Number.isFinite(priorScore)) {
    const sourceDates = (match.sources || []).map((source) => source && source.retrievedAt);
    result.stale =
      match.stale === true ||
      (sourceDates.length
        ? sourceDates.some((date) => isStale(date, now))
        : isStale(match.retrievedAt || (priors && priors.generatedAt), now));
    result.sources = match.sources || [];
    result.score = Math.round(Math.max(0, Math.min(100, priorScore)));
    result.stale = result.stale === true;
    if (result.stale) result.bonus = 0;
  }
  return result;
}

function isStale(retrievedAt, now) {
  const timestamp = Date.parse(retrievedAt || '');
  return !Number.isFinite(timestamp) || (now || Date.now()) - timestamp > STALE_AFTER_MS;
}

function benchmarkScore(match) {
  const benchmarks =
    match && match.benchmarks && typeof match.benchmarks === 'object' ? match.benchmarks : match;
  const values = Object.entries(benchmarks || {})
    .filter(
      ([key, value]) =>
        key !== 'sources' &&
        key !== 'source' &&
        key !== 'benchmarks' &&
        Number.isFinite(Number(value)) &&
        (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    )
    .map(([, value]) => Math.max(0, Math.min(100, Number(value))));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function normaliseModelId(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parts = value.trim().toLowerCase().split('/');
  return normaliseCanonical(parts.length > 1 ? parts.slice(-2).join('/') : value);
}

function mergePriorDocuments(documents, now) {
  const byCanonical = new Map();
  const sources = [];
  for (const document of documents || []) {
    for (const source of (document && document.sources) || []) {
      if (source && source.url) sources.push(Object.assign({}, source));
    }
    for (const item of (document && document.models) || (document && document.ranking) || []) {
      const canonical = normaliseCanonical(item && (item.modelId || item.model || item.canonical));
      if (!canonical) continue;
      const row = byCanonical.get(canonical) || { canonical, benchmarks: [], sources: [] };
      const sourceRows = (item.sources || (item.source ? [item.source] : [])).filter(
        (source) => source && source.url
      );
      for (const source of sourceRows) {
        row.sources.push({
          url: source.url,
          retrievedAt:
            source.retrievedAt || document.retrievedAt || new Date(now || Date.now()).toISOString(),
        });
      }
      const benchmarks = item.benchmarks || {};
      for (const [name, value] of Object.entries(benchmarks)) {
        const score = Number(value && typeof value === 'object' ? value.score : value);
        if (!Number.isFinite(score)) continue;
        const benchmarkSource = value && value.source ? value.source : sourceRows[0] || null;
        row.benchmarks.push({ name, score, source: benchmarkSource });
        if (benchmarkSource && benchmarkSource.url) {
          row.sources.push({
            url: benchmarkSource.url,
            retrievedAt:
              benchmarkSource.retrievedAt ||
              document.retrievedAt ||
              new Date(now || Date.now()).toISOString(),
          });
        }
      }
      const directScore = benchmarkScore(item);
      if (directScore !== null)
        row.benchmarks.push({
          name: 'aggregate',
          score: directScore,
          source: sourceRows[0] || null,
        });
      if (item.releaseDate) row.releaseDate = item.releaseDate;
      if (Number.isFinite(Number(item.contextWindow)))
        row.contextWindow = Number(item.contextWindow);
      byCanonical.set(canonical, row);
    }
  }
  const rows = Array.from(byCanonical.values()).map((row) => {
    const scores = row.benchmarks.map((benchmark) => benchmark.score);
    const score = scores.length
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : null;
    const tier =
      score === null ? null : score >= 80 ? 'T1' : score >= 70 ? 'T2' : score >= 55 ? 'T3' : 'T4';
    return Object.assign(row, {
      score: score === null ? null : Math.round(score * 10) / 10,
      codingTier: tier,
      reviewTier: tier,
      stale:
        row.sources.length === 0 || row.sources.some((source) => isStale(source.retrievedAt, now)),
    });
  });
  return {
    label: 'EXTERNAL_PRIOR',
    generatedAt: new Date(now || Date.now()).toISOString(),
    sources,
    ranking: rows,
  };
}

async function refreshPriors(options) {
  const opts = options || {};
  if (typeof opts.search !== 'function') throw new Error('PRIORS_SEARCH_SOURCE_REQUIRED');
  const results = await opts.search({
    query:
      opts.query ||
      process.env.AI_BRAIN_PRIORS_QUERY ||
      'coding agent model benchmarks SWE-bench Aider Terminal-Bench',
    limit: opts.limit || 20,
  });
  if (!Array.isArray(results)) throw new Error('PRIORS_SEARCH_RESULT_INVALID');
  const document = mergePriorDocuments(results, opts.now);
  document.searchSource =
    opts.sourceId || opts.searchSource || opts.search.name || 'configured-search-provider';
  const output = opts.file || DEFAULT_PRIORS_FILE;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return document;
}

module.exports = {
  loadPriors,
  priorFor,
  isStale,
  mergePriorDocuments,
  refreshPriors,
  normaliseModelId,
  benchmarkScore,
  DEFAULT_PRIORS_FILE,
};
