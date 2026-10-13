'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PRIORS_FILE = path.join(__dirname, 'data', 'model-priors.json');
const TIER_BONUSES = Object.freeze({ T1: 6, T2: 4, T3: 2, T4: 0 });
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const ROLE_BENCHMARK_WEIGHTS = Object.freeze({
  planner: Object.freeze({ intelligenceIndex: 0.5, aaAgenticIndex: 0.3, aaCodingIndex: 0.2 }),
  writer: Object.freeze({ aaCodingIndex: 0.6, aaAgenticIndex: 0.25, intelligenceIndex: 0.15 }),
  reviewer: Object.freeze({ intelligenceIndex: 0.5, aaCodingIndex: 0.5 }),
});

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

  const profile = roleBenchmarkProfile(role);
  const rankingMaxima = benchmarkMaxima(ranking);
  const weighted = weightedBenchmarkScore(match, profile, rankingMaxima);
  // Missing role-profile benchmarks contribute zero. Aggregate and legacy scores
  // use different scales and must never be substituted into this weighted score.
  const priorScore = weighted.score;
  const sourceDates = (match.sources || [])
    .map((source) => source && source.retrievedAt)
    .filter(Boolean);
  const retrievalDate =
    match.retrievedAt ||
    (priors && priors.generatedAt) ||
    (match.sources && match.sources.length ? match.sources[0].retrievedAt : null);
  const stale =
    match.stale === true ||
    (sourceDates.length > 0
      ? sourceDates.some((date) => isStale(date, now))
      : isStale(retrievalDate, now));

  const result = { canonical: match.canonical, tier, bonus: stale ? 0 : bonus };
  if (weighted.coverage > 0) {
    result.coverage = weighted.coverage;
    if (weighted.coverage < 0.5) result.evidence = 'INDIRECT';
  }
  const liveBench = benchmarkValue(match, 'liveBench');
  if (liveBench !== null) result.liveBench = liveBench;
  if (stale) result.stale = true;
  if (match.sources && match.sources.length) result.sources = match.sources;
  if (
    Number.isFinite(priorScore) &&
    (weighted.coverage > 0 || match.benchmarks || Number.isFinite(match.score))
  ) {
    result.score = Math.round(Math.max(0, Math.min(100, priorScore)));
  }
  return result;
}

function isStale(retrievedAt, now) {
  const timestamp = Date.parse(retrievedAt || '');
  const currentTime = now || Date.now();
  return (
    !Number.isFinite(timestamp) ||
    timestamp > currentTime ||
    currentTime - timestamp > STALE_AFTER_MS
  );
}

function benchmarkScore(match) {
  const benchmarks =
    match && match.benchmarks && typeof match.benchmarks === 'object' ? match.benchmarks : match;
  const intelligenceIndex = Array.isArray(benchmarks)
    ? benchmarks.find((entry) => entry && entry.name === 'intelligenceIndex')?.score
    : benchmarks && benchmarks.intelligenceIndex;
  const intelligenceScore = Number(
    intelligenceIndex && typeof intelligenceIndex === 'object'
      ? intelligenceIndex.score
      : intelligenceIndex
  );
  if (Number.isFinite(intelligenceScore)) return intelligenceScore;
  const entries = Array.isArray(benchmarks)
    ? benchmarks.map((entry) => [entry && entry.name, entry && entry.score])
    : Object.entries(benchmarks || {});
  const values = entries
    .filter(
      ([key, value]) =>
        typeof key === 'string' &&
        /bench|coding|swe|aider|terminal|live.?code|arena/i.test(key) &&
        Number.isFinite(value)
    )
    .map(([, value]) => Math.max(0, Math.min(100, value)));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function roleBenchmarkProfile(role) {
  if (role === 'planner' || role === 'planner.default') return ROLE_BENCHMARK_WEIGHTS.planner;
  if (role === 'reviewer' || role === 'security-review') return ROLE_BENCHMARK_WEIGHTS.reviewer;
  if (role === 'writer' || (typeof role === 'string' && role.startsWith('author.')))
    return ROLE_BENCHMARK_WEIGHTS.writer;
  return ROLE_BENCHMARK_WEIGHTS.writer;
}

function benchmarkValue(match, name) {
  const benchmarks = match && match.benchmarks;
  const value = Array.isArray(benchmarks)
    ? benchmarks.find((entry) => entry && entry.name === name)?.score
    : benchmarks && benchmarks[name] !== undefined
      ? benchmarks[name]
      : match && match[name];
  const score = Number(value && typeof value === 'object' ? value.score : value);
  return Number.isFinite(score) ? score : null;
}

function benchmarkMaxima(ranking) {
  const maxima = {};
  for (const row of ranking) {
    for (const name of Object.keys(ROLE_BENCHMARK_WEIGHTS.planner)) {
      const score = benchmarkValue(row, name);
      if (score !== null) maxima[name] = Math.max(maxima[name] || 0, score);
    }
  }
  return maxima;
}

function weightedBenchmarkScore(match, weights, maxima) {
  let score = 0;
  let coverage = 0;
  for (const [name, weight] of Object.entries(weights)) {
    const value = benchmarkValue(match, name);
    const max = maxima[name];
    if (value === null || !max) continue;
    score += (value / max) * weight;
    coverage += weight;
  }
  return { score: Math.round(100 * score), coverage: Math.round(coverage * 1000) / 1000 };
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
      score === null ? null : score >= 74 ? 'T1' : score >= 66 ? 'T2' : score >= 50 ? 'T3' : 'T4';
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
  const query =
    opts.query ||
    process.env.AI_BRAIN_PRIORS_QUERY ||
    'coding agent model benchmarks SWE-bench Aider Terminal-Bench';
  const results = await opts.search(query);
  if (!Array.isArray(results)) throw new Error('PRIORS_SEARCH_RESULT_INVALID');
  const document = mergePriorDocuments(results, opts.now);
  const provenanceValid = document.ranking.every(
    (entry) =>
      entry.sources.length > 0 &&
      entry.sources.every(
        (source) =>
          typeof source.url === 'string' &&
          /^https?:\/\//i.test(source.url) &&
          typeof source.retrievedAt === 'string' &&
          Number.isFinite(Date.parse(source.retrievedAt))
      ) &&
      entry.benchmarks.every((benchmark) => {
        if (!benchmark.source) {
          benchmark.source = entry.sources[0];
        }
        return (
          typeof benchmark.source.url === 'string' &&
          /^https?:\/\//i.test(benchmark.source.url) &&
          typeof benchmark.source.retrievedAt === 'string' &&
          Number.isFinite(Date.parse(benchmark.source.retrievedAt))
        );
      })
  );
  if (!provenanceValid) throw new Error('PRIORS_SOURCE_PROVENANCE_REQUIRED');
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
  ROLE_BENCHMARK_WEIGHTS,
  roleBenchmarkProfile,
  weightedBenchmarkScore,
  DEFAULT_PRIORS_FILE,
};
