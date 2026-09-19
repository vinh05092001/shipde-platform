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
 * 1. Never average scores across different benchmarks.
 * 2. A model with no record is UNKNOWN, never "weak".
 * 3. A benchmark record older than 90 days or whose model version no longer matches
 *    an offering is reported by an audit as a warning.
 * 4. A record missing source URL or checked_on is an error.
 */

const fs = require('fs');
const path = require('path');
const { Difficulty } = require('./fitness');

const DEFAULT_BENCHMARKS_PATH = path.join(__dirname, 'benchmarks.json');
const STALENESS_THRESHOLD_DAYS = 90;

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
 * Maps a single benchmark score to a Difficulty ladder grade.
 *
 * Invariant: Never average scores across different benchmarks. Each benchmark
 * is evaluated against its own established thresholds.
 */
function gradeFromBenchmark(benchmark, score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;

  const b = String(benchmark || '').toLowerCase();
  if (b.includes('swe-bench')) {
    if (s >= 70) return Difficulty.ARCHITECTURAL;
    if (s >= 60) return Difficulty.COMPLEX;
    if (s >= 45) return Difficulty.STANDARD;
    return Difficulty.MECHANICAL;
  }

  // Generic percentage-based evaluation threshold
  if (s >= 80) return Difficulty.ARCHITECTURAL;
  if (s >= 65) return Difficulty.COMPLEX;
  if (s >= 50) return Difficulty.STANDARD;
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
    // A record whose source was not verified is not evidence (AI-46-R01).
    if (record.verified === false) return false;
    if (modelVersion !== undefined && modelVersion !== null) {
      const rVer = record.model_version || record.modelVersion;
      if (rVer && rVer !== modelVersion) return false;
    }
    return true;
  });

  if (matches.length === 0) {
    return null; // UNKNOWN
  }

  // Pick the best single record for this model without averaging across different benchmarks
  let bestRecord = null;
  let bestGrade = null;

  for (const record of matches) {
    const grade =
      record.grade || record.codingGrade || gradeFromBenchmark(record.benchmark, record.score);
    if (grade && (bestGrade === null || grade > bestGrade)) {
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
 * - Source marked verified: false -> WARNING (BENCHMARK_UNVERIFIED_SOURCE); it grades nothing
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

    if (record.verified === false) {
      findings.push({
        id: modelId,
        code: 'BENCHMARK_UNVERIFIED_SOURCE',
        severity: 'warn',
        message: `Benchmark record for ${modelId} has an unverified source and grades nothing`,
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
  loadBenchmarks,
  gradeFromBenchmark,
  findBenchmarkEvidence,
  auditBenchmarks,
  formatAuditResult,
};

// After the exports: offerings -> fitness require this module back.
if (require.main === module) process.exitCode = main(process.argv.slice(2));
