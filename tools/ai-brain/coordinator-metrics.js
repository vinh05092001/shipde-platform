'use strict';
// Metrics identity, row validation and aggregate summary.
function metricsKey(row) {
  return [row.pr, row.sha, row.round].join('|');
}

function validMetric(row) {
  return Boolean(
    row &&
    !Array.isArray(row) &&
    typeof row.item === 'string' &&
    row.item.length > 0 &&
    Number.isSafeInteger(row.pr) &&
    row.pr > 0 &&
    typeof row.sha === 'string' &&
    /^[a-f0-9]{40}$/i.test(row.sha) &&
    Number.isSafeInteger(row.round) &&
    row.round > 0 &&
    ['PASS', 'CHANGES_REQUIRED', 'BLOCKED'].includes(row.verdict) &&
    (row.tokens == null || (Number.isFinite(row.tokens) && row.tokens >= 0)) &&
    (row.ciRed == null || typeof row.ciRed === 'boolean')
  );
}

function metricsSummary(records, merged = new Set()) {
  const rows = [...new Map(records.map((row) => [metricsKey(row), row])).values()];
  const passes = new Map();
  for (const row of rows)
    if (row.verdict === 'PASS') passes.set(row.pr, Math.max(passes.get(row.pr) || 0, row.round));
  const rounds = [...passes.values()].sort((a, b) => a - b);
  const median = rounds.length
    ? (rounds[Math.floor((rounds.length - 1) / 2)] + rounds[Math.ceil((rounds.length - 1) / 2)]) / 2
    : null;
  const mergedPRs = new Set(rows.filter((row) => merged.has(row.pr)).map((row) => row.pr));
  const knownTokens = rows.filter((row) => merged.has(row.pr));
  const completeTokens = knownTokens.every((row) => Number.isFinite(row.tokens));
  return {
    reviews: rows.length,
    medianRoundsToPass: median,
    p90RoundsToPass: rounds.length ? rounds[Math.ceil(rounds.length * 0.9) - 1] : null,
    ciRedRate: rows.length ? rows.filter((row) => row.ciRed).length / rows.length : null,
    mergedPRs: mergedPRs.size,
    tokensPerMergedPR:
      mergedPRs.size && completeTokens
        ? knownTokens.reduce((sum, row) => sum + row.tokens, 0) / mergedPRs.size
        : null,
  };
}

module.exports = {
  metricsKey,
  validMetric,
  metricsSummary,
};