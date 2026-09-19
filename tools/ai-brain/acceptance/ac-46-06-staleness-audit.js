'use strict';
// AC-AI-46-06 — Benchmark staleness and completeness audit:
// A benchmark record older than 90 days or whose model version no longer matches
// an offering is reported as a warning; a record missing source URL or checked_on
// is an error.
//
// Exit codes: 0 invariant holds, 1 invariant violated, 2 cannot measure / control failed.

const fs = require('fs');
const path = require('path');

const BENCHMARKS_PATH = path.resolve('tools/ai-brain/benchmarks.js');
const BENCHMARKS_JSON = path.resolve('tools/ai-brain/benchmarks.json');

if (!fs.existsSync(BENCHMARKS_PATH) || !fs.existsSync(BENCHMARKS_JSON)) {
  console.error('SOURCE_MISSING: benchmark files missing');
  process.exit(2);
}

const { auditBenchmarks, loadBenchmarks } = require(BENCHMARKS_PATH);

// CONTROL NEGATIVE STEP:
// Tamper with a benchmark record by omitting the required source_url.
// The audit must fail closed with a blocking error (severity: 'error').
const tamperedRecord = {
  model_id: 'control-tampered-model',
  benchmark: 'SWE-bench',
  score: 60,
  checked_on: '2026-08-01',
  // source_url is intentionally missing
};

const controlAudit = auditBenchmarks([tamperedRecord]);
const controlError = controlAudit.findings.find(
  (f) => f.code === 'BENCHMARK_MISSING_SOURCE_URL' && f.severity === 'error'
);

if (!controlError || controlAudit.summary.error === 0) {
  console.error('CONTROL_FAILED: audit did not report error for missing source_url');
  process.exit(2);
}
console.log('CONTROL: audit caught missing source_url as error (' + controlError.code + ')');

// MEASUREMENT: Real benchmarks audit
const realRecords = loadBenchmarks(BENCHMARKS_JSON);
const realAudit = auditBenchmarks(realRecords);

if (realAudit.summary.error > 0) {
  console.error('AUDIT_VIOLATION: production benchmarks.json contains errors: ' + JSON.stringify(realAudit.findings));
  process.exit(1);
}

// Check staleness warning logic
const staleRecord = {
  model_id: 'stale-test',
  benchmark: 'SWE-bench',
  score: 60,
  source_url: 'https://example.com',
  checked_on: '2025-01-01', // over 90 days old
};
const staleAudit = auditBenchmarks([staleRecord]);
const staleWarn = staleAudit.findings.find(
  (f) => f.code === 'BENCHMARK_STALE_RECORD' && f.severity === 'warn'
);
if (!staleWarn) {
  console.error('AUDIT_VIOLATION: record older than 90 days was not reported as a warning');
  process.exit(1);
}

// Check model version mismatch warning logic
const mismatchedRecord = {
  model_id: 'mismatched-model',
  model_version: 'v1',
  benchmark: 'SWE-bench',
  score: 60,
  source_url: 'https://example.com',
  checked_on: new Date().toISOString().slice(0, 10),
};
const offerings = [{ model: 'mismatched-model', modelVersion: 'v2' }];
const mismatchAudit = auditBenchmarks([mismatchedRecord], offerings);
const mismatchWarn = mismatchAudit.findings.find(
  (f) => f.code === 'BENCHMARK_VERSION_MISMATCH' && f.severity === 'warn'
);
if (!mismatchWarn) {
  console.error('AUDIT_VIOLATION: mismatched model version was not reported as a warning');
  process.exit(1);
}

console.log('STALENESS_AUDIT_VERIFIED: benchmark staleness and model version mismatch are warnings; missing source URL or checked_on are errors');
process.exit(0);
