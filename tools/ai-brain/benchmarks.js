'use strict';

/**
 * Ship Dễ — External Benchmark Evidence & Capability Table
 *
 * External benchmark evidence is held as discrete, sourced records.
 * One record per (model id, model version, benchmark, benchmark version):
 *   - score
 *   - harness / agent used
 *   - reasoning setting
 *   - source URL
 *   - checked_on date
 *
 * Invariants:
 * 1. Never average scores across different benchmarks. The resolved grade is the
 *    strongest single sourced record (best-of), never a blend of several.
 * 2. A model with no record is UNKNOWN, never "weak".
 * 3. A benchmark record older than 90 days or whose model version no longer matches
 *    an offering is reported by an audit as a warning.
 * 4. A record missing source URL or checked_on is an error.
 * 5. Only a record explicitly marked `verified: true` is evidence. A record that
 *    omits the flag, carries `false`, or carries a non-boolean is refused, so the
 *    gate cannot be disarmed by forgetting one field (AI-46-R09).
 * 6. Every score declares its scale (`score_scale: fraction|percent`). A score
 *    that cannot be mapped — no scale on an ambiguous value, an unknown scale, a
 *    value outside its scale's range — grades nothing and is an audit error
 *    (AI-46-R10). An unmappable score never falls back to "weak".
 * 7. A record does not carry its own grade. The grade is derived from the sourced
 *    score through the benchmark mapping; a self-declared `grade`/`codingGrade`
 *    field in the table is an audit error (AI-46-R11).
 */

const fs = require('fs');
const path = require('path');
const { Difficulty } = require('./fitness');

const DEFAULT_BENCHMARKS_PATH = path.join(__dirname, 'benchmarks.json');
const STALENESS_THRESHOLD_DAYS = 90;

/**
 * The scale a record's score is written on (AI-46-R10).
 *
 * One percentage ladder cannot read two scales. `0.9` is 90% on a fraction scale
 * and 0.9% on a percent scale, which is the difference between ARCHITECTURAL and
 * MECHANICAL, so the record has to say which it means.
 */
const SCORE_SCALE = {
  FRACTION: 'fraction',
  PERCENT: 'percent',
};

/** The range each declared scale admits, in the units that scale writes in. */
const SCORE_SCALE_RANGE = {
  fraction: { min: 0, max: 1 },
  percent: { min: 0, max: 100 },
};

/**
 * Loads benchmark records from disk.
 *
 * Fails closed: a missing, unreadable, unparsable or non-array table throws
 * BENCHMARKS_UNREADABLE, so damaged evidence is never mistaken for "no evidence".
 */
function loadBenchmarks(filePath) {
  const p = filePath || DEFAULT_BENCHMARKS_PATH;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    const err = new Error(`BENCHMARKS_UNREADABLE: ${p}: ${e.message}`);
    err.code = 'BENCHMARKS_UNREADABLE';
    throw err;
  }
  if (!Array.isArray(parsed)) {
    const err = new Error(`BENCHMARKS_UNREADABLE: ${p}: top level is not an array`);
    err.code = 'BENCHMARKS_UNREADABLE';
    throw err;
  }
  return parsed;
}

/**
 * The scale a record declares, or null when it declares none.
 *
 * An unrecognised label is returned as-is so the caller can tell "no scale" from
 * "a scale this code cannot read"; both refuse to grade, but only the second is
 * worth naming in the audit line.
 */
function declaredScoreScale(record) {
  const scale = record.score_scale !== undefined ? record.score_scale : record.scoreScale;
  if (scale === undefined || scale === null) return null;
  if (typeof scale !== 'string' || scale.trim() === '') return null;
  return scale.trim().toLowerCase();
}

/**
 * Puts a declared score on the 0-100 percentage the ladder is defined on.
 *
 * Returns null when the score cannot be mapped. That is deliberate: 0.9 is 90%
 * on a fraction scale and 0.9% on a percent scale, which is the difference
 * between ARCHITECTURAL and MECHANICAL, so an ambiguous value with no declared
 * scale grades nothing rather than guessing. It never falls back to "weak",
 * which is what AI-46-R02 forbids.
 *
 * A value above 1 with no declared scale is still read as a percentage, because
 * this function also scores measured evidence from `productionResults` and
 * `localEvaluation`, which are not table records and carry no `score_scale`.
 * Every record in `benchmarks.json` must declare its scale, and the audit makes
 * an undeclared scale an error (AI-46-R10) so the inference can never be how a
 * table record gets graded.
 */
function normalizeBenchmarkScore(score, scale) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;

  if (scale === null) {
    return s > 1 && s <= SCORE_SCALE_RANGE.percent.max ? s : null;
  }

  const range = SCORE_SCALE_RANGE[scale];
  if (!range) return null; // a declared scale this code cannot read grades nothing
  if (s < range.min || s > range.max) return null; // outside its own scale
  return scale === SCORE_SCALE.FRACTION ? s * 100 : s;
}

/**
 * Maps a single benchmark score to a Difficulty ladder grade.
 *
 * Invariant: Never average scores across different benchmarks. Each benchmark
 * is evaluated against its own established thresholds, on the scale its record
 * declares. An unmappable score returns null — no grade — rather than the
 * lowest grade.
 */
function gradeFromBenchmark(benchmark, score, scale) {
  const declared =
    typeof scale === 'string' && scale.trim() !== '' ? scale.trim().toLowerCase() : null;
  const percent = normalizeBenchmarkScore(score, declared);
  if (percent === null) return null;

  const b = String(benchmark || '').toLowerCase();
  if (b.includes('swe-bench')) {
    if (percent >= 70) return Difficulty.ARCHITECTURAL;
    if (percent >= 60) return Difficulty.COMPLEX;
    if (percent >= 45) return Difficulty.STANDARD;
    return Difficulty.MECHANICAL;
  }

  // Generic percentage-based evaluation threshold
  if (percent >= 80) return Difficulty.ARCHITECTURAL;
  if (percent >= 65) return Difficulty.COMPLEX;
  if (percent >= 50) return Difficulty.STANDARD;
  return Difficulty.MECHANICAL;
}

/**
 * Finds external benchmark evidence for a given model id and optional model version.
 * Never averages scores across different benchmarks.
 */
function findBenchmarkEvidence(benchmarks, modelId, modelVersion) {
  if (!benchmarks || !Array.isArray(benchmarks)) return null;

  const matches = benchmarks.filter((record) => {
    const rId = record.model_id || record.modelId || record.model;
    if (rId !== modelId) return false;
    // Only an explicitly verified source is evidence (AI-46-R09). Absent, false
    // and non-boolean all refuse to grade: the gate is opt-in, never opt-out.
    if (record.verified !== true) return false;
    if (modelVersion !== undefined && modelVersion !== null) {
      const rVer = record.model_version || record.modelVersion;
      if (rVer && rVer !== modelVersion) return false;
    }
    return true;
  });

  if (matches.length === 0) {
    return null; // UNKNOWN
  }

  // Best-of, never blended: the strongest single sourced record for this model
  // sets the grade (AI-46-R01/R11). A record cannot grade itself — its own
  // `grade`/`codingGrade` field is ignored here and rejected by the audit.
  let bestRecord = null;
  let bestGrade = null;

  for (const record of matches) {
    // The raw declared scale is passed through, not the normalised one: a label
    // this code cannot read must refuse to grade, not fall back to the inference
    // that an absent scale is allowed to use.
    const grade = gradeFromBenchmark(record.benchmark, record.score, record.score_scale);
    if (grade !== null && (bestGrade === null || grade > bestGrade)) {
      bestGrade = grade;
      bestRecord = record;
    }
  }

  if (!bestRecord || bestGrade === null) return null;

  return {
    record: bestRecord,
    grade: bestGrade,
    benchmark: bestRecord.benchmark,
    benchmarkVersion: bestRecord.benchmark_version || bestRecord.benchmarkVersion,
    score: bestRecord.score,
    scoreScale: declaredScoreScale(bestRecord),
    sourceUrl: bestRecord.source_url || bestRecord.sourceUrl,
    checkedOn: bestRecord.checked_on || bestRecord.checkedOn,
  };
}

/**
 * Audits benchmark evidence records for validity, completeness and staleness.
 *
 * Rules:
 * - Missing source URL -> ERROR (BENCHMARK_MISSING_SOURCE_URL)
 * - Missing checked_on date -> ERROR (BENCHMARK_MISSING_CHECKED_ON)
 * - Older than 90 days -> WARNING (BENCHMARK_STALE_RECORD)
 * - Model version does not match an offering -> WARNING (BENCHMARK_VERSION_MISMATCH)
 * - Missing or non-boolean verified flag -> ERROR (BENCHMARK_MISSING_VERIFIED_FLAG)
 * - Source verified: false -> WARNING (BENCHMARK_UNVERIFIED_SOURCE); it grades nothing
 * - Self-declared grade on a record -> ERROR (BENCHMARK_SELF_DECLARED_GRADE)
 * - Missing score_scale -> ERROR (BENCHMARK_MISSING_SCORE_SCALE)
 * - Unknown score_scale -> ERROR (BENCHMARK_UNKNOWN_SCORE_SCALE)
 * - Score outside its declared scale -> ERROR (BENCHMARK_INVALID_SCORE)
 * - Duplicate (model_id, model_version, benchmark, benchmark_version) -> ERROR
 *   (BENCHMARK_DUPLICATE_KEY); the tuple must be unique
 */
function auditBenchmarks(benchmarks, offerings, options) {
  const opts = options || {};
  const now = opts.now ? new Date(opts.now) : new Date();
  const list = benchmarks || [];
  const findings = [];

  // Build lookup of known offering models and their versions
  const offeringVersions = new Map();
  for (const o of offerings || []) {
    const model = o.model || o.id;
    if (!offeringVersions.has(model)) {
      offeringVersions.set(model, new Set());
    }
    if (o.modelVersion) {
      offeringVersions.get(model).add(o.modelVersion);
    }
  }

  const seenKeys = new Map();
  for (let i = 0; i < list.length; i++) {
    const record = list[i];
    const modelId = record.model_id || record.modelId || record.model || `entry-${i}`;
    const modelVersion = record.model_version || record.modelVersion;

    const key = [
      modelId,
      modelVersion || '',
      record.benchmark || '',
      record.benchmark_version || record.benchmarkVersion || '',
    ].join('|');
    if (seenKeys.has(key)) {
      findings.push({
        id: modelId,
        code: 'BENCHMARK_DUPLICATE_KEY',
        severity: 'error',
        message: `Benchmark record for ${modelId} repeats the key of record ${seenKeys.get(key)}`,
        recordIndex: i,
      });
    } else {
      seenKeys.set(key, i);
    }

    // Rule 5: the verified flag must be an explicit boolean (AI-46-R09). A record
    // that omits it must not grade, so omitting it is an error, not a warning.
    if (typeof record.verified !== 'boolean') {
      findings.push({
        id: modelId,
        code: 'BENCHMARK_MISSING_VERIFIED_FLAG',
        severity: 'error',
        message: `Benchmark record for ${modelId} does not declare verified: true or false; only verified: true grades`,
        recordIndex: i,
      });
    } else if (record.verified === false) {
      findings.push({
        id: modelId,
        code: 'BENCHMARK_UNVERIFIED_SOURCE',
        severity: 'warn',
        message: `Benchmark record for ${modelId} has an unverified source and grades nothing`,
        recordIndex: i,
      });
    }

    // Rule 7: a record may not carry its own grade (AI-46-R11). The grade comes
    // from the sourced score through the benchmark mapping or it does not exist.
    if (record.grade !== undefined || record.codingGrade !== undefined) {
      findings.push({
        id: modelId,
        code: 'BENCHMARK_SELF_DECLARED_GRADE',
        severity: 'error',
        message: `Benchmark record for ${modelId} declares its own grade; grades come from the sourced benchmark score`,
        recordIndex: i,
      });
    }

    // Rule 6: every score declares the scale it is written on (AI-46-R10), and the
    // value must sit inside that scale. An unmappable score grades nothing.
    const scale = declaredScoreScale(record);
    if (scale === null) {
      findings.push({
        id: modelId,
        code: 'BENCHMARK_MISSING_SCORE_SCALE',
        severity: 'error',
        message: `Benchmark record for ${modelId} does not declare score_scale (fraction or percent)`,
        recordIndex: i,
      });
    } else if (!SCORE_SCALE_RANGE[scale]) {
      findings.push({
        id: modelId,
        code: 'BENCHMARK_UNKNOWN_SCORE_SCALE',
        severity: 'error',
        message: `Benchmark record for ${modelId} declares unknown score_scale '${scale}' (expected fraction or percent)`,
        recordIndex: i,
      });
    } else if (normalizeBenchmarkScore(record.score, scale) === null) {
      findings.push({
        id: modelId,
        code: 'BENCHMARK_INVALID_SCORE',
        severity: 'error',
        message: `Benchmark record for ${modelId} has score ${record.score} outside the ${scale} scale (0-${SCORE_SCALE_RANGE[scale].max})`,
        recordIndex: i,
      });
    }

    const sourceUrl = record.source_url || record.sourceUrl;
    const checkedOn = record.checked_on || record.checkedOn;

    // Rule 1: Missing source URL is an error
    if (!sourceUrl || typeof sourceUrl !== 'string' || sourceUrl.trim() === '') {
      findings.push({
        id: modelId,
        code: 'BENCHMARK_MISSING_SOURCE_URL',
        severity: 'error',
        message: `Benchmark record for ${modelId} is missing required source URL`,
        recordIndex: i,
      });
    }

    // Rule 2: Missing checked_on is an error
    if (!checkedOn || typeof checkedOn !== 'string' || checkedOn.trim() === '') {
      findings.push({
        id: modelId,
        code: 'BENCHMARK_MISSING_CHECKED_ON',
        severity: 'error',
        message: `Benchmark record for ${modelId} is missing required checked_on date`,
        recordIndex: i,
      });
    } else {
      // Rule 3: Older than 90 days is a warning
      const checkedDate = new Date(checkedOn);
      if (isNaN(checkedDate.getTime())) {
        findings.push({
          id: modelId,
          code: 'BENCHMARK_INVALID_CHECKED_ON',
          severity: 'error',
          message: `Benchmark record for ${modelId} has invalid checked_on date: ${checkedOn}`,
          recordIndex: i,
        });
      } else {
        const ageMs = now.getTime() - checkedDate.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays > STALENESS_THRESHOLD_DAYS) {
          findings.push({
            id: modelId,
            code: 'BENCHMARK_STALE_RECORD',
            severity: 'warn',
            message: `Benchmark record for ${modelId} was checked ${Math.floor(ageDays)} days ago (exceeds ${STALENESS_THRESHOLD_DAYS} days threshold)`,
            recordIndex: i,
            ageDays: Math.floor(ageDays),
          });
        }
      }
    }

    // Rule 4: Model version no longer matches an offering (warning)
    if (offerings && offerings.length > 0) {
      if (!offeringVersions.has(modelId)) {
        findings.push({
          id: modelId,
          code: 'BENCHMARK_VERSION_MISMATCH',
          severity: 'warn',
          message: `Benchmark model ${modelId} does not match any configured offering`,
          recordIndex: i,
        });
      } else if (modelVersion) {
        const knownVersions = offeringVersions.get(modelId);
        if (knownVersions.size > 0 && !knownVersions.has(modelVersion)) {
          findings.push({
            id: modelId,
            code: 'BENCHMARK_VERSION_MISMATCH',
            severity: 'warn',
            message: `Benchmark version ${modelVersion} for ${modelId} does not match configured offering versions (${[...knownVersions].join(', ')})`,
            recordIndex: i,
          });
        }
      }
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  const flagged = new Set(findings.map((f) => f.recordIndex)).size;

  return {
    findings,
    summary: {
      total: list.length,
      pass: list.length - flagged,
      warn: warnCount,
      error: errorCount,
    },
  };
}

/**
 * The operator-console line for an audit result (TASK-AI-46 UI states).
 */
function formatAuditResult(result) {
  const { summary, findings } = result;
  if (summary.error === 0) {
    return `Benchmark audit: VALIDATED (${summary.total} records, 0 errors, ${summary.warn} warnings)`;
  }
  const errors = findings
    .filter((f) => f.severity === 'error')
    .map((f) => `${f.code}: ${f.id}`)
    .join(', ');
  return `Benchmark audit: FAILED (${summary.error} errors: ${errors})`;
}

/**
 * `node tools/ai-brain/benchmarks.js audit [file]` — exit 0 when valid, 1 on
 * any error finding or an unreadable table. Checks versions against the seed offerings.
 */
function main(argv) {
  const [cmd, file] = argv;
  if (cmd !== 'audit') {
    console.error('usage: node tools/ai-brain/benchmarks.js audit [benchmarks.json]');
    return 2;
  }
  let records;
  try {
    records = loadBenchmarks(file);
  } catch (e) {
    console.log(`Benchmark audit: FAILED (1 errors: ${e.message})`);
    return 1;
  }
  const { ACCOUNTS } = require('./seed-accounts');
  const { expandOfferings } = require('./offerings');
  const offerings = expandOfferings(ACCOUNTS, { benchmarks: records });
  const result = auditBenchmarks(records, offerings);
  console.log(formatAuditResult(result));
  for (const f of result.findings) console.log(`  ${f.severity} ${f.code} ${f.message}`);
  return result.summary.error === 0 ? 0 : 1;
}

module.exports = {
  DEFAULT_BENCHMARKS_PATH,
  STALENESS_THRESHOLD_DAYS,
  SCORE_SCALE,
  loadBenchmarks,
  normalizeBenchmarkScore,
  gradeFromBenchmark,
  findBenchmarkEvidence,
  auditBenchmarks,
  formatAuditResult,
};

// After the exports: offerings -> fitness require this module back.
if (require.main === module) process.exitCode = main(process.argv.slice(2));
