'use strict';

const fs = require('fs');
const path = require('path');

let defaultDescriptor;
try {
  defaultDescriptor = require('./priors-sources/public.json');
} catch {
  defaultDescriptor = {};
}

const DEFAULT_PRIORS_FILE = path.join(__dirname, 'data', 'model-priors.json');
const LIVE_PRIORS_FILE = path.join(__dirname, 'data', 'model-priors-live.json');
const TIER_BONUSES = Object.freeze({ T1: 6, T2: 4, T3: 2, T4: 0 });
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

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
      return parsed;
    }
  } catch (_) {
    /* ignore and return empty ranking */
  }
  return { ranking: [] };
}

function getEffortVariants(config) {
  const cfg = config || defaultDescriptor;
  if (Array.isArray(cfg && cfg.effortVariants) && cfg.effortVariants.length) {
    return cfg.effortVariants.slice().sort((a, b) => b.length - a.length);
  }
  return [];
}

function getDeploymentSuffixes(config) {
  const cfg = config || defaultDescriptor;
  if (Array.isArray(cfg && cfg.deploymentSuffixes) && cfg.deploymentSuffixes.length) {
    return cfg.deploymentSuffixes.slice().sort((a, b) => b.length - a.length);
  }
  return [];
}

function splitModelEffort(value, config) {
  if (typeof value !== 'string' || !value.trim()) return { base: null, effort: null };
  const efforts = getEffortVariants(config);
  let effort = null;
  let raw = value.trim().toLowerCase();

  const parenMatch = raw.match(/\s*\(([^)]*)\)/);
  if (parenMatch) {
    const inside = parenMatch[1].trim();
    for (const eff of efforts) {
      if (inside === eff || inside.includes(eff)) {
        effort = eff;
        break;
      }
    }
    raw = raw.replace(/\s*\([^)]*\)/g, '');
  }

  raw = raw.split('::').pop();
  raw = raw.split('/').pop();
  raw = raw.split('@')[0];

  const cfg = config || defaultDescriptor;
  const stripSuffixes = (cfg && cfg.aliasRules && cfg.aliasRules.stripSuffixes) || [
    ':free',
    '-free',
  ];
  for (const sfx of stripSuffixes) {
    if (raw.endsWith(sfx)) {
      raw = raw.slice(0, -sfx.length);
    }
  }

  raw = raw.replace(/[._\s]+/g, '-').replace(/^-+|-+$/g, '');

  if (!effort) {
    for (const eff of efforts) {
      const suffix = '-' + eff;
      if (raw.endsWith(suffix)) {
        effort = eff;
        raw = raw.slice(0, -suffix.length);
        break;
      }
    }
  }

  const depSuffixes = getDeploymentSuffixes(config);
  for (const dep of depSuffixes) {
    const s1 = ':' + dep;
    const s2 = '-' + dep;
    if (raw.endsWith(s1)) raw = raw.slice(0, -s1.length);
    else if (raw.endsWith(s2)) raw = raw.slice(0, -s2.length);
  }

  raw = raw.replace(/^-+|-+$/g, '');

  return { base: raw || null, effort };
}

function normaliseCanonical(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = splitModelEffort(value);
  if (parsed.base) return parsed.base;
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
  const weighted = weightedBenchmarkScore(match, profile, rankingMaxima);
  // Zero role coverage must NOT inherit benchmarkScore.
  const priorScore = weighted.coverage > 0 ? weighted.score : null;
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
  if (
    resolved.fallback ||
    match.fallback ||
    (Array.isArray(match.benchmarks) && match.benchmarks.some((b) => b.fallback))
  ) {
    result.fallback = true;
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

function benchmarkMaxima(ranking) {
  const maxima = {};
  for (const row of ranking) {
    for (const name of Object.keys(ROLE_BENCHMARK_WEIGHTS.planner)) {
      const score = benchmarkValue(row, name);
      if (score !== null) maxima[name] = Math.max(maxima[name] || 0, score);
      for (const eff of Object.values(row.efforts || {})) {
        const effScore = benchmarkValue(eff, name);
        if (effScore !== null) maxima[name] = Math.max(maxima[name] || 0, effScore);
      }
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

function matchModelPrior(modelId, ranking, options) {
  if (!modelId || !Array.isArray(ranking)) return null;
  const config = (options && (options.config || options.descriptor)) || defaultDescriptor;
  const { base, effort } = splitModelEffort(modelId, config);
  const exactId = leaderboardModelId(modelId);

  const byCanonical = new Map();
  for (const row of ranking) {
    if (!row) continue;
    if (row.canonical) {
      byCanonical.set(row.canonical, row);
      const norm = leaderboardModelId(row.canonical);
      if (norm) byCanonical.set(norm, row);
      if (config && config.aliasRules && config.aliasRules.digitBoundaryHyphen) {
        byCanonical.set(row.canonical.replace(/([a-z])(\d)/g, '$1-$2'), row);
      }
    }
  }

  // 1. Exact match on raw ID or exactId (prioritizes exact published entries)
  if (exactId && byCanonical.has(exactId)) {
    return { entry: byCanonical.get(exactId) };
  }
  const depStrippedId = exactId
    ? exactId.replace(
        /(?::(?:batch|flex|cloud)|-?\[\d+(?:-\d+)?[km]\]|-(?:fast|latest|volc|turbo|\d{4}-\d{2}-\d{2}|\d{8}|\d{6}|\d{4}))$/,
        ''
      )
    : null;
  if (depStrippedId && depStrippedId !== exactId && byCanonical.has(depStrippedId)) {
    return {
      entry: byCanonical.get(depStrippedId),
      matchedVia: 'variant-suffix',
      matchedBaseId: byCanonical.get(depStrippedId).canonical,
    };
  }

  // 2. Direct match on base canonical
  let matchedEntry = base ? byCanonical.get(base) : null;
  if (
    !matchedEntry &&
    base &&
    config &&
    config.aliasRules &&
    config.aliasRules.digitBoundaryHyphen
  ) {
    const withHyphen = base.replace(/^([a-z]+)(\d)/, '$1-$2');
    const withoutHyphen = base.replace(/^([a-z]+)-(\d)/, '$1$2');
    matchedEntry = byCanonical.get(withHyphen) || byCanonical.get(withoutHyphen);
  }

  // 3. Fallback queue for legacy unmerged deployment/reasoning suffixes
  let matchedVia = undefined;
  let matchedBaseId = undefined;
  if (!matchedEntry && exactId) {
    const queue = [{ id: exactId, reasoning: false }];
    const seen = new Set([exactId]);
    for (const current of queue) {
      if (!current.id) continue;
      const deployment = current.id.replace(
        /(?::(?:batch|flex|cloud)|-?\[\d+(?:-\d+)?[km]\]|-(?:fast|latest|volc|turbo|\d{4}-\d{2}-\d{2}|\d{8}|\d{6}|\d{4}))$/,
        ''
      );
      const reasoning = current.id.replace(
        /-(?:thinking|agentic|high|medium|low|minimal|max|xhigh|none|reasoning|non-reasoning)$/,
        ''
      );
      for (const [b, effFlag] of [
        [deployment, false],
        [reasoning, true],
      ]) {
        if (b === current.id || seen.has(b)) continue;
        seen.add(b);
        const usedReasoning = current.reasoning || effFlag;
        if (byCanonical.has(b)) {
          matchedEntry = byCanonical.get(b);
          matchedVia = usedReasoning ? 'reasoning-variant' : 'variant-suffix';
          matchedBaseId = matchedEntry.canonical;
          break;
        }
        queue.push({ id: b, reasoning: usedReasoning });
      }
      if (matchedEntry) break;
    }
  }

  if (!matchedEntry) return null;

  // Plain legacy row without .efforts or array .benchmarks
  if (
    !matchedEntry.efforts &&
    (!matchedEntry.benchmarks || !Array.isArray(matchedEntry.benchmarks))
  ) {
    return {
      entry: matchedEntry,
      matchedVia:
        matchedVia ||
        (effort
          ? 'reasoning-variant'
          : exactId !== matchedEntry.canonical
            ? 'variant-suffix'
            : undefined),
      matchedBaseId: matchedBaseId || matchedEntry.canonical,
    };
  }

  // If effort is requested on canonical entry with per-effort benchmarks
  if (effort) {
    const effortData = matchedEntry.efforts && matchedEntry.efforts[effort];
    const effortBenchmarks =
      effortData && Array.isArray(effortData.benchmarks) ? effortData.benchmarks.slice() : [];
    const baseBenchmarks = Array.isArray(matchedEntry.benchmarks) ? matchedEntry.benchmarks : [];

    let hasFallback = false;
    let combinedBenchmarks;
    if (effortBenchmarks.length === 0) {
      combinedBenchmarks = baseBenchmarks;
      hasFallback = true;
    } else {
      combinedBenchmarks = effortBenchmarks.slice();
      for (const baseB of baseBenchmarks) {
        if (!combinedBenchmarks.some((b) => b.name === baseB.name)) {
          combinedBenchmarks.push({ ...baseB, fallback: true, fallbackFrom: 'base' });
          hasFallback = true;
        }
      }
    }

    const effScores = combinedBenchmarks.map((b) => b.score).filter(Number.isFinite);
    const effScore = effScores.length
      ? Math.round((effScores.reduce((s, v) => s + v, 0) / effScores.length) * 10) / 10
      : matchedEntry.score;

    return {
      entry: {
        ...matchedEntry,
        benchmarks: combinedBenchmarks,
        effort,
        score: effScore,
        fallback: hasFallback,
      },
      effort,
      matchedVia: 'reasoning-variant',
      matchedBaseId: matchedEntry.canonical,
      fallback: hasFallback,
    };
  }

  // Base model query
  const hasFallback =
    Array.isArray(matchedEntry.benchmarks) && matchedEntry.benchmarks.some((b) => b.fallback);
  return {
    entry: matchedEntry,
    matchedVia:
      matchedVia ||
      (exactId !== matchedEntry.canonical
        ? hasFallback
          ? 'reasoning-variant'
          : 'variant-suffix'
        : undefined),
    matchedBaseId: matchedBaseId || matchedEntry.canonical,
    fallback: hasFallback,
  };
}

function getNormalizationMethod(config) {
  const cfg = config || defaultDescriptor;
  return (
    (cfg && cfg.normalization && cfg.normalization.method) ||
    (cfg && cfg.normalizationMethod) ||
    (typeof cfg?.normalization === 'string' ? cfg.normalization : 'percentile')
  );
}

function normalizeScore(score, allScores, method) {
  if (!Number.isFinite(score)) return null;
  if (!Array.isArray(allScores) || allScores.length === 0) return score;
  const m = (method || 'percentile').toLowerCase();
  if (m === 'none' || m === 'raw') {
    return score;
  }
  if (m === 'min-max') {
    const min = Math.min(...allScores);
    const max = Math.max(...allScores);
    if (max === min) return 100;
    return ((score - min) / (max - min)) * 100;
  }
  // 'percentile': percentile within source distribution (percentage of observed scores <= score)
  const n = allScores.length;
  if (n <= 1) return 100;
  const countLe = allScores.filter((s) => s <= score).length;
  return (countLe / n) * 100;
}

function benchmarkTimestamp(b) {
  if (b && b.source && typeof b.source.retrievedAt === 'string') {
    const ts = Date.parse(b.source.retrievedAt);
    if (Number.isFinite(ts)) return ts;
  }
  return 0;
}

function dedupeBenchmarks(benchmarks) {
  const byName = new Map();
  for (const b of benchmarks || []) {
    if (!b || typeof b !== 'object' || typeof b.name !== 'string') continue;
    const existing = byName.get(b.name);
    if (!existing) {
      byName.set(b.name, b);
    } else {
      const tsExisting = benchmarkTimestamp(existing);
      const tsNew = benchmarkTimestamp(b);
      // Replace if new is newer or equal (latest value per source, deterministic)
      if (tsNew >= tsExisting) {
        byName.set(b.name, b);
      }
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getBenchmarkStreamKey(b) {
  if (!b) return '';
  const sourceId = (b.source && (b.source.id || b.source.url)) || '';
  const name = b.name || 'aggregate';
  return sourceId ? `${sourceId}::${name}` : name;
}

function applyNormalizationAndTiers(rows, config, now) {
  const method = getNormalizationMethod(config);

  // 1. Deduplicate benchmarks on each row and effort
  for (const row of rows) {
    row.benchmarks = dedupeBenchmarks(row.benchmarks);
    for (const effData of Object.values(row.efforts || {})) {
      effData.benchmarks = dedupeBenchmarks(effData.benchmarks);
    }
  }

  // 2. Collect distribution of scores per benchmark source
  const streamScores = new Map();
  for (const row of rows) {
    for (const b of row.benchmarks || []) {
      if (Number.isFinite(b.score)) {
        const key = getBenchmarkStreamKey(b);
        if (!streamScores.has(key)) streamScores.set(key, []);
        streamScores.get(key).push(b.score);
      }
    }
    for (const effData of Object.values(row.efforts || {})) {
      for (const eb of effData.benchmarks || []) {
        if (Number.isFinite(eb.score)) {
          const key = getBenchmarkStreamKey(eb);
          if (!streamScores.has(key)) streamScores.set(key, []);
          streamScores.get(key).push(eb.score);
        }
      }
    }
  }

  // 3. Normalize each benchmark independently within its source
  for (const row of rows) {
    for (const b of row.benchmarks || []) {
      const key = getBenchmarkStreamKey(b);
      const pool = streamScores.get(key) || [b.score];
      const norm = normalizeScore(b.score, pool, method);
      b.normalizedScore = norm === null ? null : Math.round(norm * 10) / 10;
    }
    for (const effData of Object.values(row.efforts || {})) {
      for (const eb of effData.benchmarks || []) {
        const key = getBenchmarkStreamKey(eb);
        const pool = streamScores.get(key) || [eb.score];
        const norm = normalizeScore(eb.score, pool, method);
        eb.normalizedScore = norm === null ? null : Math.round(norm * 10) / 10;
      }
    }

    // 4. Derive aggregate score from normalized scores
    const normScores = (row.benchmarks || []).map((b) => b.normalizedScore).filter(Number.isFinite);
    const score = normScores.length
      ? Math.round((normScores.reduce((sum, v) => sum + v, 0) / normScores.length) * 10) / 10
      : null;
    row.score = score;
    row.normalizedScore = score;

    const rawScores = (row.benchmarks || []).map((b) => b.score).filter(Number.isFinite);
    row.rawScore = rawScores.length
      ? Math.round((rawScores.reduce((sum, v) => sum + v, 0) / rawScores.length) * 10) / 10
      : null;

    for (const effData of Object.values(row.efforts || {})) {
      const effNormScores = (effData.benchmarks || [])
        .map((b) => b.normalizedScore)
        .filter(Number.isFinite);
      effData.score = effNormScores.length
        ? Math.round((effNormScores.reduce((sum, v) => sum + v, 0) / effNormScores.length) * 10) /
          10
        : null;
      effData.normalizedScore = effData.score;

      const effRawScores = (effData.benchmarks || []).map((b) => b.score).filter(Number.isFinite);
      effData.rawScore = effRawScores.length
        ? Math.round((effRawScores.reduce((sum, v) => sum + v, 0) / effRawScores.length) * 10) / 10
        : null;
    }

    if (now) {
      row.stale =
        !row.sources ||
        row.sources.length === 0 ||
        row.sources.some((source) => isStale(source.retrievedAt, now));
    }
  }

  // 5. Derive codingTier / reviewTier from the normalized aggregate
  assignQuartileTiers(rows);
  return rows;
}

function mergePriorDocuments(documents, now, options) {
  const config = (options && (options.config || options.descriptor)) || defaultDescriptor;
  const byCanonical = new Map();
  const sources = [];
  for (const document of documents || []) {
    for (const source of (document && document.sources) || []) {
      if (source && source.url) sources.push(Object.assign({}, source));
    }
    for (const item of (document && document.models) || (document && document.ranking) || []) {
      const rawId = item && (item.modelId || item.model || item.canonical);
      const { base: canonical, effort } = splitModelEffort(rawId, config);
      if (!canonical) continue;

      const row = byCanonical.get(canonical) || {
        canonical,
        benchmarks: [],
        efforts: {},
        sources: [],
      };

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
      if (!effort && row.benchmarks.some((b) => b.fallback)) {
        // Real base model row arrived after earlier effort row populated fallback benchmarks
        row.benchmarks = row.benchmarks.filter((b) => !b.fallback);
      }
      const targetBenchmarks = effort ? [] : row.benchmarks;

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
        const benchEntry = { name, score, source: normalizedBenchmarkSource };
        targetBenchmarks.push(benchEntry);
        if (normalizedBenchmarkSource && normalizedBenchmarkSource.url) {
          row.sources.push(normalizedBenchmarkSource);
        }
      }

      const directScore = benchmarkScore(item);
      if (directScore !== null && targetBenchmarks.length === 0) {
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
        targetBenchmarks.push({
          name: 'aggregate',
          score: directScore,
          source: directSource,
        });
      }

      if (effort) {
        row.efforts[effort] = row.efforts[effort] || { benchmarks: [] };
        row.efforts[effort].benchmarks.push(...targetBenchmarks);
        if (row.benchmarks.length === 0) {
          for (const b of targetBenchmarks) {
            row.benchmarks.push({ ...b, fallback: true, fallbackFrom: effort });
          }
        }
      }

      if (item.releaseDate) row.releaseDate = item.releaseDate;
      if (Number.isFinite(Number(item.contextWindow)))
        row.contextWindow = Number(item.contextWindow);
      byCanonical.set(canonical, row);
    }
  }
  const rows = Array.from(byCanonical.values());
  applyNormalizationAndTiers(rows, config, now);
  const method = getNormalizationMethod(config);
  return {
    label: 'EXTERNAL_PRIOR',
    generatedAt: new Date(now || Date.now()).toISOString(),
    normalizationMethod: method,
    normalization: { method },
    sources,
    ranking: rows,
  };
}

function assignQuartileTiers(rows) {
  const scores = rows
    .map((row) =>
      row.normalizedScore !== undefined && row.normalizedScore !== null
        ? row.normalizedScore
        : row.score
    )
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  // Nearest-rank quartiles of the scored population; ties share a tier.
  const tiers = ['T4', 'T3', 'T2', 'T1'];
  const quartiles = tiers
    .slice(1)
    .map((_, index) => scores[Math.ceil(((index + 1) * scores.length) / tiers.length) - 1]);
  for (const row of rows) {
    const s =
      row.normalizedScore !== undefined && row.normalizedScore !== null
        ? row.normalizedScore
        : row.score;
    if (s === null || s === undefined || !Number.isFinite(s)) {
      row.score = null;
      row.codingTier = null;
      row.reviewTier = null;
      continue;
    }
    const tier = tiers[quartiles.filter((threshold) => s > threshold).length];
    row.codingTier = tier;
    row.reviewTier = tier;
  }
  return rows;
}

async function refreshPriors(options) {
  const opts = options || {};
  const config = (opts && (opts.config || opts.descriptor)) || defaultDescriptor;
  const method = getNormalizationMethod(config);
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
  const document = mergePriorDocuments(results, opts.now, { ...opts, config });
  if (opts.preserveHistory) {
    for (const row of loadPriors(output).ranking) {
      const fresh = document.ranking.find((item) => item.canonical === row.canonical);
      if (!fresh) {
        document.ranking.push(row);
      } else {
        const mergedBenchmarks = fresh.benchmarks ? fresh.benchmarks.slice() : [];
        for (const oldB of row.benchmarks || []) {
          const freshIdx = mergedBenchmarks.findIndex((b) => b.name === oldB.name);
          if (freshIdx === -1) {
            mergedBenchmarks.push(oldB);
          } else {
            const freshB = mergedBenchmarks[freshIdx];
            if (benchmarkTimestamp(oldB) > benchmarkTimestamp(freshB)) {
              mergedBenchmarks[freshIdx] = oldB;
            }
          }
        }
        fresh.benchmarks = dedupeBenchmarks(mergedBenchmarks);

        if (row.efforts) {
          fresh.efforts = fresh.efforts || {};
          for (const [effName, effData] of Object.entries(row.efforts)) {
            if (!fresh.efforts[effName]) {
              fresh.efforts[effName] = effData;
            } else {
              const mergedEff = (fresh.efforts[effName].benchmarks || []).slice();
              for (const oldB of effData.benchmarks || []) {
                const idx = mergedEff.findIndex((b) => b.name === oldB.name);
                if (idx === -1) {
                  mergedEff.push(oldB);
                } else {
                  if (benchmarkTimestamp(oldB) > benchmarkTimestamp(mergedEff[idx])) {
                    mergedEff[idx] = oldB;
                  }
                }
              }
              fresh.efforts[effName].benchmarks = dedupeBenchmarks(mergedEff);
            }
          }
        }

        const existingUrls = new Set((fresh.sources || []).map((s) => s.url));
        for (const s of row.sources || []) {
          if (s && s.url && !existingUrls.has(s.url)) {
            fresh.sources.push(s);
            existingUrls.add(s.url);
          }
        }
      }
    }
    applyNormalizationAndTiers(document.ranking, config, opts.now);
  }
  document.normalizationMethod = method;
  document.normalization = { method };
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
  splitModelEffort,
  getNormalizationMethod,
  normalizeScore,
  dedupeBenchmarks,
};
