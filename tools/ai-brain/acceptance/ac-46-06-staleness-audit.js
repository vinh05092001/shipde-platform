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

const {
  auditBenchmarks,
  loadBenchmarks,
  findBenchmarkEvidence,
  gradeFromBenchmark,
  STALENESS_THRESHOLD_DAYS,
} = require(BENCHMARKS_PATH);

// Audits are pinned to one clock so "stale" means the same thing in every probe
// and the acceptance run cannot flip when it crosses midnight.
const NOW = '2026-09-18T00:00:00.000Z';
const FRESH_DAY = '2026-09-10';
const STALE_DAY = '2026-01-01';

// A record that satisfies every completeness rule at once. Each probe below
// breaks exactly one thing about this record, so a finding can only be caused
// by the defect named, and the valid record doubles as the control proving the
// auditor is not simply always failing.
const validRecord = (id) => ({
  model_id: id,
  benchmark: 'SWE-bench Verified',
  benchmark_version: 'v1.0',
  score: 72,
  score_scale: 'percent',
  source_url: 'https://github.com/swe-bench/SWE-bench/tree/main/docs/results/' + id,
  checked_on: FRESH_DAY,
  verified: true,
});

const codesFor = (record) =>
  auditBenchmarks([record], [], { now: NOW })
    .findings.filter((f) => f.severity === 'error')
    .map((f) => f.code);

const warnCodesFor = (record, offerings) =>
  auditBenchmarks([record], offerings || [], { now: NOW })
    .findings.filter((f) => f.severity === 'warn')
    .map((f) => f.code);

// CONTROL NEGATIVE STEP: the audit must fail closed with a blocking error when
// the required source URL is omitted, and must NOT invent that error otherwise.
const missingUrl = { ...validRecord('control-missing-url') };
delete missingUrl.source_url;
const controlResult = auditBenchmarks([missingUrl], [], { now: NOW });
const controlError = controlResult.findings.find(
  (f) => f.code === 'BENCHMARK_MISSING_SOURCE_URL' && f.severity === 'error'
);
if (!controlError || controlResult.summary.error === 0) {
  console.error('CONTROL_FAILED: audit did not report error for missing source_url');
  process.exit(2);
}
if (codesFor(validRecord('control-valid')).length !== 0) {
  console.error(
    'CONTROL_FAILED: audit reported a complete record as an error: ' +
      JSON.stringify(codesFor(validRecord('control-valid')))
  );
  process.exit(2);
}
console.log('CONTROL: audit caught missing source_url as error (' + controlError.code + ')');

// MEASUREMENT: every documented rule, one probe each. A probe that only ever
// reported staleness — the shape the previous version of this file passed with —
// fails here because each rule below has to name its own error code.
const RULE_PROBES = [
  [
    'missing source URL',
    'BENCHMARK_MISSING_SOURCE_URL',
    () => {
      const record = validRecord('probe-url');
      delete record.source_url;
      return record;
    },
  ],
  [
    'missing checked_on',
    'BENCHMARK_MISSING_CHECKED_ON',
    () => {
      const record = validRecord('probe-checked-on');
      delete record.checked_on;
      return record;
    },
  ],
  [
    'unreadable checked_on',
    'BENCHMARK_INVALID_CHECKED_ON',
    () => ({ ...validRecord('probe-bad-date'), checked_on: 'last tuesday' }),
  ],
  [
    'no declared score scale',
    'BENCHMARK_MISSING_SCORE_SCALE',
    () => {
      const record = validRecord('probe-no-scale');
      delete record.score_scale;
      return record;
    },
  ],
  [
    'unknown score scale',
    'BENCHMARK_UNKNOWN_SCORE_SCALE',
    () => ({ ...validRecord('probe-bad-scale'), score_scale: 'likes' }),
  ],
  [
    'score outside its scale',
    'BENCHMARK_INVALID_SCORE',
    () => ({ ...validRecord('probe-out-of-range'), score: 900 }),
  ],
  [
    'missing verified flag',
    'BENCHMARK_MISSING_VERIFIED_FLAG',
    () => {
      const record = validRecord('probe-no-flag');
      delete record.verified;
      return record;
    },
  ],
  [
    'record carrying its own grade',
    'BENCHMARK_SELF_DECLARED_GRADE',
    () => ({ ...validRecord('probe-self-grade'), grade: 'architectural' }),
  ],
  ['repeated record key', 'BENCHMARK_DUPLICATE_KEY', () => validRecord('probe-dup')],
];

for (const [defect, code, build] of RULE_PROBES) {
  const record = build();
  const records = code === 'BENCHMARK_DUPLICATE_KEY' ? [record, build()] : [record];
  const result = auditBenchmarks(records, [], { now: NOW });
  if (!result.findings.some((f) => f.code === code && f.severity === 'error')) {
    console.error('AUDIT_VIOLATION: ' + defect + ' was not reported as an error (' + code + ')');
    process.exit(1);
  }
  if (code !== 'BENCHMARK_DUPLICATE_KEY' && codesFor(validRecord('probe-control')).length !== 0) {
    console.error('AUDIT_CONTROL_FAILED: complete record reported an error for ' + defect);
    process.exit(2);
  }
}
console.log('EVIDENCE: all ' + RULE_PROBES.length + ' audited rules reported their own error code');

// Staleness is a warning, not an error, and the applied window is the declared
// one. An auditor that always warns and one that never warns both fail here.
const staleRecord = { ...validRecord('probe-stale'), checked_on: STALE_DAY };
if (!warnCodesFor(staleRecord).includes('BENCHMARK_STALE_RECORD')) {
  console.error(
    'AUDIT_VIOLATION: a record older than ' + STALENESS_THRESHOLD_DAYS + ' days was not a warning'
  );
  process.exit(1);
}
const staleFinding = auditBenchmarks([staleRecord], [], { now: NOW }).findings.find(
  (f) => f.code === 'BENCHMARK_STALE_RECORD'
);
if (!(staleFinding.ageDays > STALENESS_THRESHOLD_DAYS)) {
  console.error(
    'AUDIT_VIOLATION: stale finding reported no age past the window: ' +
      JSON.stringify(staleFinding)
  );
  process.exit(1);
}
if (warnCodesFor(validRecord('probe-fresh')).includes('BENCHMARK_STALE_RECORD')) {
  console.error('AUDIT_CONTROL_FAILED: an in-window record was reported as stale');
  process.exit(2);
}
if (codesFor(staleRecord).includes('BENCHMARK_STALE_RECORD')) {
  console.error('AUDIT_VIOLATION: staleness must stay a warning, not block as an error');
  process.exit(1);
}

// A model version that no longer matches a configured offering is a warning, and
// a matching version must not be reported — the mismatch rule is the half of
// AC-AI-46-06 that a staleness-only check never exercises.
const mismatched = { ...validRecord('probe-version'), model_version: 'v2' };
if (
  !warnCodesFor(mismatched, [
    { id: 'probe-version', model: 'probe-version', modelVersion: 'v3' },
  ]).includes('BENCHMARK_VERSION_MISMATCH')
) {
  console.error('AUDIT_VIOLATION: mismatched model version was not reported as a warning');
  process.exit(1);
}
if (
  warnCodesFor({ ...validRecord('probe-version'), model_version: 'v3' }, [
    { id: 'probe-version', model: 'probe-version', modelVersion: 'v3' },
  ]).includes('BENCHMARK_VERSION_MISMATCH')
) {
  console.error('AUDIT_CONTROL_FAILED: matching model version reported as a mismatch');
  process.exit(2);
}

// An explicitly unverified source is honest, not malformed: a warning, and it
// must grade nothing (AI-46-R09).
const unverified = { ...validRecord('probe-unverified'), verified: false };
if (codesFor(unverified).length !== 0) {
  console.error('AUDIT_VIOLATION: verified:false was escalated from a warning to an error');
  process.exit(1);
}
if (!warnCodesFor(unverified).includes('BENCHMARK_UNVERIFIED_SOURCE')) {
  console.error('AUDIT_VIOLATION: an unverified source was not reported as a warning');
  process.exit(1);
}
if (findBenchmarkEvidence([unverified], 'probe-unverified') !== null) {
  console.error('AUDIT_VIOLATION: a record marked unverified still graded a model');
  process.exit(1);
}

// Fail-closed grading: every record the auditor rejects for a scale problem must
// also grade nothing, so an audit error can never be cosmetic. The ambiguous
// 0.45 is the case that matters — it could be read as 45% or 0.45%.
const unmappableProbes = [
  (() => {
    const record = validRecord('grade-no-scale');
    delete record.score_scale;
    record.score = 0.45;
    return record;
  })(),
  { ...validRecord('grade-bad-scale'), score_scale: 'likes' },
  { ...validRecord('grade-out-of-range'), score: 900 },
];
for (const record of unmappableProbes) {
  if (codesFor(record).length === 0) {
    console.error('AUDIT_VIOLATION: unmappable score not reported for ' + record.model_id);
    process.exit(1);
  }
  if (findBenchmarkEvidence([record], record.model_id) !== null) {
    console.error('AUDIT_VIOLATION: an unmappable score still graded a model: ' + record.model_id);
    process.exit(1);
  }
}

// A self-declared grade never reaches the ladder: the sourced score does. The
// record claims ARCHITECTURAL and scores 20%, so anything other than the mapped
// grade means the declared field was read.
const selfGraded = { ...validRecord('probe-self-declared'), grade: 'architectural', score: 20 };
const selfEvidence = findBenchmarkEvidence([selfGraded], 'probe-self-declared');
if (
  !selfEvidence ||
  selfEvidence.grade !== gradeFromBenchmark('SWE-bench Verified', 20, 'percent')
) {
  console.error('AUDIT_VIOLATION: a self-declared grade bypassed the benchmark mapping');
  process.exit(1);
}
if (codesFor(selfGraded).indexOf('BENCHMARK_SELF_DECLARED_GRADE') < 0) {
  console.error('AUDIT_VIOLATION: the record whose grade was ignored was never reported');
  process.exit(1);
}

// MEASUREMENT: the shipped table. Every record declares its scale, and none of
// it is verified, so the table is honest about the threshold while grading
// nothing at all — which is what #116 B2 leaves it able to claim.
const realRecords = loadBenchmarks(BENCHMARKS_JSON);
if (realRecords.length === 0) {
  console.error('AUDIT_VIOLATION: shipped table is empty, nothing to measure');
  process.exit(1);
}
const realResult = auditBenchmarks(realRecords, [], { now: NOW });
if (realResult.summary.error > 0) {
  console.error(
    'AUDIT_VIOLATION: production benchmarks.json contains errors: ' +
      JSON.stringify(realResult.findings.filter((f) => f.severity === 'error'))
  );
  process.exit(1);
}
let gradedShipped = 0;
for (const record of realRecords) {
  if (record.score_scale !== 'percent' && record.score_scale !== 'fraction') {
    console.error(
      'AUDIT_VIOLATION: shipped record has no declared score scale: ' + JSON.stringify(record)
    );
    process.exit(1);
  }
  if (record.verified !== false) {
    console.error(
      'AUDIT_VIOLATION: shipped record claims verification without a checked source: ' +
        JSON.stringify(record)
    );
    process.exit(1);
  }
  if (findBenchmarkEvidence(realRecords, record.model_id, record.model_version) !== null) {
    gradedShipped++;
  }
}
if (gradedShipped !== 0) {
  console.error('AUDIT_VIOLATION: a shipped unverified record matched for grading');
  process.exit(1);
}
console.log(
  'EVIDENCE: shipped table ' +
    realRecords.length +
    ' records, ' +
    realResult.summary.error +
    ' errors, ' +
    realResult.summary.warn +
    ' warnings, 0 records grade'
);

console.log(
  'STALENESS_AUDIT_VERIFIED: benchmark staleness and model version mismatch are warnings; missing source URL or checked_on are errors'
);
process.exit(0);
