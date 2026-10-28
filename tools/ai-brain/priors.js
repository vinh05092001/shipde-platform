'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PRIORS_FILE = path.join(__dirname, 'data', 'model-priors.json');
const LIVE_PRIORS_FILE = path.join(__dirname, 'data', 'model-priors-live.json');
const TIER_BONUSES = Object.freeze({ T1: 6, T2: 4, T3: 2, T4: 0 });
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

// General benchmarks used only when a model has none of its role's weighted ones.
const FALLBACK_BENCHMARKS = Object.freeze(['aggregate', 'benchlm', 'liveBench']);
// Reported as indirect evidence (below the 0.5 coverage line).
const FALLBACK_COVERAGE = 0.25;
const ROLE_BENCHMARK_WEIGHTS = Object.freeze({
  planner: Object.freeze({ intelligenceIndex: 0.5, aaAgenticIndex: 0.3, aaCodingIndex: 0.2 }),
  writer: Object.freeze({ aaCodingIndex: 0.6, aaAgenticIndex: 0.25, intelligenceIndex: 0.15 }),
  reviewer: Object.freeze({ intelligenceIndex: 0.5, aaCodingIndex: 0.5 }),
});

/**
 * Load priors. Priors are optional and never block routing.
 * When no explicit file is given, read the curated baseline deterministically.
 */
function loadPriors(file) {
  const target = file || (fs.existsSync(LIVE_PRIORS_FILE) ? LIVE_PRIORS_FILE : DEFAULT_PRIORS_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.ranking)) {
      // The live refresh does not cover every model the curated baseline knows;
      // keep curated entries for models the live file lacks.
      if (!file && target === LIVE_PRIORS_FILE && fs.existsSync(DEFAULT_PRIORS_FILE)) {
        try {
          const curated = JSON.parse(fs.readFileSync(DEFAULT_PRIORS_FILE, 'utf8'));
          const known = new Set(parsed.ranking.map((m) => m && m.canonical));
          for (const m of (curated && curated.ranking) || []) {
            if (m && m.canonical && !known.has(m.canonical)) parsed.ranking.push(m);
          }
        } catch (_) {
          /* curated baseline unreadable: live file alone */
        }
      }
      return parsed;
    }
  } catch (_) {
    /* ignore and return empty ranking */
  }
  return { ranking: [] };
}

function normaliseCanonical(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let canonical = value
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '');
  canonical = canonical.split('::').pop();
  canonical = canonical.split('/').pop();
  canonical = canonical.split('@')[0];
  canonical = canonical.replace(/(?::free|-free)$/, '');
  canonical = canonical.replace(/\s*\([^)]*\)/g, '').replace(/[._\s]+/g, '-');
  return canonical || null;
}

/**
 * Resolve one candidate's role-specific benchmark prior, if available.
 *
 * INVARIANT: For any candidate with a valid modelId, this function MUST return
 * an object — never null. Unknown or unscored models receive a null-score
 * prior with `priorUnknown: true`. The only null return is when the candidate
 * itself carries no modelId (a genuine caller error).
 */
function priorFor(candidate, role, priors, now) {
  if (candidate && Array.isArray(candidate.comboMembers) && candidate.comboMembers.length > 0) {
    let best = null;
    for (const member of candidate.comboMembers) {
      const p = priorFor({ modelId: member }, role, priors, now);
      if (p && typeof p.score === 'number') {
        if (!best || typeof best.score !== 'number' || p.score > best.score) {
          best = p;
        }
      } else if (!best) {
        best = p;
      }
    }
    if (best) return best;
  }

  const modelId = candidate && (candidate.modelId || candidate.model);
  const canonical = normaliseCanonical(modelId);
  if (!canonical) return null;

  const ranking = priors && Array.isArray(priors.ranking) ? priors.ranking : [];
  const resolved = matchModelPrior(modelId, ranking);
  const match = resolved && resolved.entry;
  if (!match) return neutralPrior(canonical);

  const tier =
    role === 'reviewer' || role === 'security-review' ? match.reviewTier : match.codingTier;
  const bonus = TIER_BONUSES[tier] ?? null;
  if (bonus === null) return neutralPrior(canonical);

  const profile = roleBenchmarkProfile(role);
  const rankingMaxima = benchmarkMaxima(ranking);
  let weighted = weightedBenchmarkScore(match, profile, rankingMaxima);
  if (weighted.coverage === 0) {
    // No role-weighted benchmark for this model: use the first general benchmark it
    // does have, normalised against the same benchmark across the ranking.
    for (const name of FALLBACK_BENCHMARKS) {
      const value = benchmarkValue(match, name);
      if (value !== null && rankingMaxima[name]) {
        const rawScore = (100 * value * FALLBACK_COVERAGE) / rankingMaxima[name];
        weighted = {
          score: Math.round(rawScore),
          raw: rawScore,
          coverage: FALLBACK_COVERAGE,
          rawCoverage: FALLBACK_COVERAGE,
          fallback: name,
        };
        break;
      }
    }
  }
  // The score is the benchmark result over the benchmarks the model actually has;
  // missing ones are not counted as zero. Low coverage is reported (INDIRECT), not
  // subtracted. Zero role coverage must NOT inherit benchmarkScore.
  // Confidence weighting: the renormalised score is shrunk toward the ranking's
  // own mean in proportion to the coverage that backs it, so a prior resting on one
  // benchmark cannot outrank a well-covered model with a similar underlying score.
  // When a model relies on a general fallback benchmark and carries its own measured
  // score, shrink toward that measured score so fallback coverage does not invert
  // top-ranking models below lower-tier ones.
  const shrinkageTarget =
    weighted.fallback && Number.isFinite(match.score)
      ? match.score
      : rankingMeanScore(ranking, profile, rankingMaxima);
  const priorScore =
    weighted.coverage > 0
      ? shrinkByCoverage(
          (weighted.raw ?? weighted.score) / Math.min(1, weighted.rawCoverage ?? weighted.coverage),
          Math.min(1, weighted.rawCoverage ?? weighted.coverage),
          shrinkageTarget
        )
      : null;
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
  if (resolved.matchedVia || match.matchedVia) {
    result.matchedVia = resolved.matchedVia || match.matchedVia;
    result.matchedBaseId = resolved.matchedBaseId || match.matchedBaseId;
  }
  if (weighted.coverage > 0) {
    result.coverage = weighted.coverage;
    if (weighted.coverage < 0.5) result.evidence = 'INDIRECT';
  }
  const liveBench = benchmarkValue(match, 'liveBench');
  if (liveBench !== null) result.liveBench = liveBench;
  if (stale) result.stale = true;
  if (match.sources && match.sources.length) {
    result.sources = match.sources;
    result.url = match.sources[0].url || match.url || null;
    result.retrievedAt = match.sources[0].retrievedAt || retrievalDate || null;
    result.source =
      match.sources[0].id || match.sources[0].name || (priors && priors.label) || 'model-priors';
  } else if (match.url) {
    result.url = match.url;
    result.retrievedAt = match.retrievedAt || retrievalDate || null;
    result.source = match.source || (priors && priors.label) || 'model-priors';
  }
  if (Number.isFinite(priorScore)) {
    result.score = Math.round(Math.max(0, Math.min(100, priorScore)));
  } else if (match.benchmarks || Number.isFinite(match.score) || match.score === null) {
    result.score = null;
    result.qualityLabel = 'QUALITY_UNKNOWN';
    result.priorUnknown = true;
  }
  if (result.score === null) {
    result.qualityLabel = 'QUALITY_UNKNOWN';
    result.priorUnknown = true;
  }
  return result;
}

function neutralPrior(canonical) {
  return {
    canonical,
    score: null,
    bonus: 0,
    priorUnknown: true,
    qualityLabel: 'QUALITY_UNKNOWN',
    reason: 'NO_BENCHMARK_COVERAGE',
  };
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
  if (
    intelligenceIndex !== null &&
    intelligenceIndex !== undefined &&
    Number.isFinite(intelligenceScore)
  )
    return intelligenceScore;
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
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : match && Number.isFinite(match.score)
      ? match.score
      : null;
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
  if (value === null || value === undefined) return null;
  const score = Number(value && typeof value === 'object' ? value.score : value);
  return Number.isFinite(score) ? score : null;
}

function rankingMeanScore(ranking, profile, maxima) {
  let sum = 0;
  let n = 0;
  for (const row of ranking) {
    const w = weightedBenchmarkScore(row, profile, maxima);
    if (w.rawCoverage > 0) {
      sum += w.raw / Math.min(1, w.rawCoverage);
      n += 1;
    }
  }
  return n > 0 ? sum / n : null;
}

function shrinkByCoverage(renormalised, coverage, mean) {
  if (mean === null) return Math.round(renormalised);
  return Math.round(renormalised * coverage + mean * (1 - coverage));
}

function benchmarkMaxima(ranking) {
  const maxima = {};
  for (const row of ranking) {
    for (const name of [...Object.keys(ROLE_BENCHMARK_WEIGHTS.planner), ...FALLBACK_BENCHMARKS]) {
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
  return {
    score: Math.round(100 * score),
    raw: 100 * score,
    coverage: Math.round(coverage * 1000) / 1000,
    rawCoverage: coverage,
  };
}

function normaliseModelId(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parts = value.trim().toLowerCase().split('/');
  return normaliseCanonical(parts.length > 1 ? parts.slice(-2).join('/') : value);
}

// Preserve effort labels for exact leaderboard lookup; routing identity stays compatible.
function leaderboardModelId(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let raw = value
    .trim()
    .toLowerCase()
    .replace(/\s*\(([^)]*)\)/g, (_, effort) => '-' + effort.replace(/[^a-z0-9]+/g, '-'));
  raw = raw.split('::').pop();
  raw = raw.split('/').pop();
  return raw
    .split('@')[0]
    .replace(/(?::free|-free)$/, '')
    .replace(/[._\s]+/g, '-');
}

function matchModelPrior(modelId, ranking) {
  const id = leaderboardModelId(modelId);
  const byId = new Map(
    ranking.filter(Boolean).map((row) => [leaderboardModelId(row.canonical), row])
  );
  if (byId.has(id)) return { entry: byId.get(id) };
  const queue = [{ id, reasoning: false }];
  const seen = new Set([id]);
  for (const current of queue) {
    if (!current.id) continue;
    const deployment = current.id.replace(
      /(?::(?:batch|flex|cloud)|-?\[\d+(?:-\d+)?[km]\]|-(?:fast|latest|volc|turbo|\d{4}-\d{2}-\d{2}|\d{8}|\d{6}|\d{4}))$/,
      ''
    );
    const reasoning = current.id.replace(
      /-(?:thinking|agentic|high|medium|low|minimal|xhigh|none|reasoning|non-reasoning)$/,
      ''
    );
    for (const [base, effort] of [
      [deployment, false],
      [reasoning, true],
    ]) {
      if (base === current.id || seen.has(base)) continue;
      seen.add(base);
      const usedReasoning = current.reasoning || effort;
      if (byId.has(base))
        return {
          entry: byId.get(base),
          matchedVia: usedReasoning ? 'reasoning-variant' : 'variant-suffix',
          matchedBaseId: byId.get(base).canonical,
        };
      queue.push({ id: base, reasoning: usedReasoning });
    }
  }
  return null;
}

function mergePriorDocuments(documents, now) {
  const byCanonical = new Map();
  const sources = [];
  for (const document of documents || []) {
    for (const source of (document && document.sources) || []) {
      if (source && source.url) sources.push(Object.assign({}, source));
    }
    for (const item of (document && document.models) || (document && document.ranking) || []) {
      const canonical = leaderboardModelId(item && (item.modelId || item.model || item.canonical));
      if (!canonical) continue;
      const row = byCanonical.get(canonical) || { canonical, benchmarks: [], sources: [] };
      const sourceRows = (item.sources || (item.source ? [item.source] : [])).filter(
        (source) => source && source.url
      );
      for (const source of sourceRows) {
        row.sources.push({
          ...(source.id ? { id: source.id } : source.name ? { id: source.name } : {}),
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
        const normalizedBenchmarkSource = benchmarkSource
          ? {
              ...(benchmarkSource.id
                ? { id: benchmarkSource.id }
                : benchmarkSource.name
                  ? { id: benchmarkSource.name }
                  : {}),
              url: benchmarkSource.url,
              retrievedAt:
                benchmarkSource.retrievedAt ||
                document.retrievedAt ||
                new Date(now || Date.now()).toISOString(),
            }
          : null;
        row.benchmarks.push({ name, score, source: normalizedBenchmarkSource });
        if (normalizedBenchmarkSource && normalizedBenchmarkSource.url) {
          row.sources.push(normalizedBenchmarkSource);
        }
      }
      const directScore = benchmarkScore(item);
      if (directScore !== null) {
        const directSource = sourceRows[0]
          ? {
              ...(sourceRows[0].id
                ? { id: sourceRows[0].id }
                : sourceRows[0].name
                  ? { id: sourceRows[0].name }
                  : {}),
              url: sourceRows[0].url,
              retrievedAt:
                sourceRows[0].retrievedAt ||
                document.retrievedAt ||
                new Date(now || Date.now()).toISOString(),
            }
          : null;
        row.benchmarks.push({
          name: 'aggregate',
          score: directScore,
          source: directSource,
        });
      }
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
    return Object.assign(row, {
      score: score === null ? null : Math.round(score * 10) / 10,
      codingTier: null,
      reviewTier: null,
      stale:
        row.sources.length === 0 || row.sources.some((source) => isStale(source.retrievedAt, now)),
    });
  });
  assignQuartileTiers(rows);
  return {
    label: 'EXTERNAL_PRIOR',
    generatedAt: new Date(now || Date.now()).toISOString(),
    sources,
    ranking: rows,
  };
}

function assignQuartileTiers(rows) {
  const scores = rows
    .map((row) => row.score)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  // Nearest-rank quartiles of the scored population; ties share a tier.
  const tiers = ['T4', 'T3', 'T2', 'T1'];
  const quartiles = tiers
    .slice(1)
    .map((_, index) => scores[Math.ceil(((index + 1) * scores.length) / tiers.length) - 1]);
  for (const row of rows) {
    if (row.score === null || row.score === undefined || !Number.isFinite(row.score)) {
      row.score = null;
      row.codingTier = null;
      row.reviewTier = null;
      continue;
    }
    const tier = tiers[quartiles.filter((threshold) => row.score > threshold).length];
    row.codingTier = tier;
    row.reviewTier = tier;
  }
  return rows;
}

async function refreshPriors(options) {
  const opts = options || {};
  const output =
    opts.file ||
    (opts.root
      ? fs.existsSync(path.join(opts.root, 'tools', 'ai-brain', 'data'))
        ? path.join(opts.root, 'tools', 'ai-brain', 'data', 'model-priors-live.json')
        : fs.existsSync(path.join(opts.root, 'data'))
          ? path.join(opts.root, 'data', 'model-priors-live.json')
          : path.join(opts.root, 'model-priors-live.json')
      : null);
  if (!output) throw new Error('PRIORS_OUTPUT_FILE_REQUIRED');

  if (typeof opts.search !== 'function')
    opts.search = () => require('./priors-public').publicDocuments(opts);
  const query =
    opts.query ||
    process.env.AI_BRAIN_PRIORS_QUERY ||
    'coding agent model benchmarks SWE-bench Aider Terminal-Bench';
  const results = await opts.search(query);
  if (!Array.isArray(results)) throw new Error('PRIORS_SEARCH_RESULT_INVALID');
  const document = mergePriorDocuments(results, opts.now);
  if (opts.preserveHistory) {
    for (const row of loadPriors(output).ranking) {
      const fresh = document.ranking.find((item) => item.canonical === row.canonical);
      if (!fresh) {
        document.ranking.push(row);
      } else {
        const added = (row.benchmarks || []).filter(
          (b) => !fresh.benchmarks.some((n) => JSON.stringify(n) === JSON.stringify(b))
        );
        if (added.length) {
          fresh.benchmarks.push(...added);
          const scores = fresh.benchmarks.map((b) => b.score).filter(Number.isFinite);
          fresh.score = scores.length
            ? Math.round((scores.reduce((sum, v) => sum + v, 0) / scores.length) * 10) / 10
            : null;
        }
      }
    }
    assignQuartileTiers(document.ranking);
  }
  const liveModels = opts.liveModels || require('./priors-public').liveModelIds();
  const scoredRows = document.ranking.filter((row) => !row.matchedVia);
  document.ranking = scoredRows.slice();
  document.unmatchedLiveModels = [];
  for (const id of [...new Set(liveModels.map(leaderboardModelId))].filter(Boolean).sort()) {
    const match = matchModelPrior(id, scoredRows);
    if (!match) document.unmatchedLiveModels.push(id);
    else if (match.matchedVia)
      document.ranking.push({
        ...match.entry,
        canonical: id,
        matchedVia: match.matchedVia,
        matchedBaseId: match.matchedBaseId,
      });
  }
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
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return document;
}

function arePriorsStale(priorsDoc, now) {
  const p = priorsDoc || loadPriors();
  if (!p || !Array.isArray(p.ranking) || p.ranking.length === 0) return false;
  const sourceDates = (p.sources || []).map((s) => s && s.retrievedAt).filter(Boolean);
  const retrievalDate = p.generatedAt || (sourceDates.length ? sourceDates[0] : null);
  if (isStale(retrievalDate, now)) return true;
  return p.ranking.some((item) => item && (item.stale === true || isStale(item.retrievedAt, now)));
}

module.exports = {
  loadPriors,
  priorFor,
  isStale,
  arePriorsStale,
  STALE_AFTER_MS,
  mergePriorDocuments,
  refreshPriors,
  normaliseModelId,
  leaderboardModelId,
  matchModelPrior,
  benchmarkScore,
  ROLE_BENCHMARK_WEIGHTS,
  roleBenchmarkProfile,
  weightedBenchmarkScore,
  DEFAULT_PRIORS_FILE,
  LIVE_PRIORS_FILE,
};
