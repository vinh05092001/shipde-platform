/**
 * Ship Dễ — Benchmark Evidence & Capability Table Test Suite (TASK-AI-46)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  loadBenchmarks,
  gradeFromBenchmark,
  findBenchmarkEvidence,
  auditBenchmarks,
  STALENESS_THRESHOLD_DAYS,
} = require('../benchmarks');
const {
  Difficulty,
  EVIDENCE_LAYER,
  GRADE_SOURCE,
  resolveGrade,
  resolveReviewGrade,
  resolveCapability,
  reviewGradeOf,
  isCapable,
} = require('../fitness');
const { ACCESS_TYPE, ACCESS_RANK, expandOfferings, selectOffering } = require('../offerings');

const NOW = new Date('2026-09-18T12:00:00Z');

describe('Benchmark external evidence (TASK-AI-46)', () => {
  test('benchmarks.json loads valid records with source URL and checked_on date', () => {
    const list = loadBenchmarks();
    assert.ok(list.length > 0, 'must load benchmark records');
    for (const r of list) {
      assert.ok(r.model_id, 'must have model_id');
      assert.ok(r.benchmark, 'must have benchmark');
      assert.ok(r.source_url, 'must have source_url');
      assert.ok(r.checked_on, 'must have checked_on date');
      assert.ok(typeof r.score === 'number', 'score must be numeric');
    }
  });

  test('gradeFromBenchmark converts benchmark score to Difficulty without averaging', () => {
    assert.equal(gradeFromBenchmark('SWE-bench Verified', 75), Difficulty.ARCHITECTURAL);
    assert.equal(gradeFromBenchmark('SWE-bench Verified', 62), Difficulty.COMPLEX);
    assert.equal(gradeFromBenchmark('SWE-bench Verified', 50), Difficulty.STANDARD);
    assert.equal(gradeFromBenchmark('SWE-bench Verified', 35), Difficulty.MECHANICAL);
  });

  test('never average scores across different benchmarks', () => {
    const records = [
      {
        model_id: 'test-model',
        benchmark: 'SWE-bench Verified',
        score: 72, // ARCHITECTURAL (4)
        source_url: 'https://example.com/1',
        checked_on: '2026-08-01',
      },
      {
        model_id: 'test-model',
        benchmark: 'HumanEval',
        score: 30, // would be low if averaged
        source_url: 'https://example.com/2',
        checked_on: '2026-08-01',
      },
    ];
    const evidence = findBenchmarkEvidence(records, 'test-model');
    assert.ok(evidence);
    // Grade evaluated from single benchmark record without averaging
    assert.equal(evidence.grade, Difficulty.ARCHITECTURAL);
    assert.notEqual(evidence.score, 51); // (72+30)/2 = 51 must not occur
  });

  test('a model with no record is UNKNOWN, never weak', () => {
    const records = [
      {
        model_id: 'known-model',
        benchmark: 'SWE-bench',
        score: 50,
        source_url: 'https://example.com',
        checked_on: '2026-08-01',
      },
    ];
    const match = findBenchmarkEvidence(records, 'completely-unknown-model');
    assert.equal(match, null);

    const cap = resolveCapability({ id: 'completely-unknown-model' }, { benchmarks: records });
    assert.equal(cap.grade, 'UNKNOWN');
    assert.notEqual(cap.grade, Difficulty.MECHANICAL, 'must never default unrecorded to weak');
    assert.notEqual(
      cap.grade,
      Difficulty.STANDARD,
      'must never default unrecorded to standard in capability resolution'
    );
  });
});

describe('Three evidence layers and precedence (TASK-AI-46)', () => {
  test('productionResults > localEvaluation > externalEvidence precedence', () => {
    const model = {
      id: 'tri-evidence-model',
      productionResults: { grade: Difficulty.ARCHITECTURAL },
      localEvaluation: { grade: Difficulty.COMPLEX },
      externalEvidence: { grade: Difficulty.STANDARD },
    };

    // 1. All three present: productionResults wins
    const cap1 = resolveCapability(model);
    assert.equal(cap1.grade, Difficulty.ARCHITECTURAL);
    assert.equal(cap1.layer, EVIDENCE_LAYER.PRODUCTION);

    // 2. Remove productionResults: localEvaluation wins
    delete model.productionResults;
    const cap2 = resolveCapability(model);
    assert.equal(cap2.grade, Difficulty.COMPLEX);
    assert.equal(cap2.layer, EVIDENCE_LAYER.LOCAL);

    // 3. Remove localEvaluation: externalEvidence wins
    delete model.localEvaluation;
    const cap3 = resolveCapability(model);
    assert.equal(cap3.grade, Difficulty.STANDARD);
    assert.equal(cap3.layer, EVIDENCE_LAYER.EXTERNAL);
  });

  test('caller can tell measurement from inference via layer provenance', () => {
    const measured = { id: 'm', productionResults: { grade: Difficulty.COMPLEX } };
    const r1 = resolveCapability(measured);
    assert.equal(r1.layer, EVIDENCE_LAYER.PRODUCTION);

    const unrecorded = { id: 'unrec', unknownIfUnrecorded: true };
    const r2 = resolveCapability(unrecorded);
    assert.equal(r2.layer, null);
    assert.equal(r2.grade, 'UNKNOWN');
  });

  test('inferred review grade is marked INFERRED and overridden by real review evidence', () => {
    // Without review evidence: defaults to 1-below coding grade and marked INFERRED
    const unratedCoder = { id: 'arch-coder', codingGrade: Difficulty.ARCHITECTURAL };
    const cap1 = resolveCapability(unratedCoder);
    assert.equal(cap1.reviewGrade, Difficulty.COMPLEX);
    assert.equal(cap1.reviewLayer, EVIDENCE_LAYER.INFERRED);
    assert.equal(cap1.reviewInferred, true);

    // With real review evidence in localEvaluation: overrides inferred default
    const withLocalReview = {
      id: 'arch-coder-with-review',
      codingGrade: Difficulty.ARCHITECTURAL,
      localEvaluation: { reviewGrade: Difficulty.ARCHITECTURAL },
    };
    const cap2 = resolveCapability(withLocalReview);
    assert.equal(cap2.reviewGrade, Difficulty.ARCHITECTURAL);
    assert.equal(cap2.reviewLayer, EVIDENCE_LAYER.LOCAL);
    assert.equal(cap2.reviewInferred, false);
    assert.equal(reviewGradeOf(withLocalReview), Difficulty.ARCHITECTURAL);
  });
});

describe('Separate capability from access (TASK-AI-46)', () => {
  test('offerings carry access dimension independent of capability', () => {
    const accounts = [
      {
        id: 'acc-free',
        provider: 'free-provider',
        tier: 0,
        access: ACCESS_TYPE.FREE,
        models: [{ model: 'strong-free-model', codingGrade: Difficulty.ARCHITECTURAL }],
      },
      {
        id: 'acc-paid',
        provider: 'cloud-provider',
        tier: 1,
        access: ACCESS_TYPE.PAY_PER_CALL,
        models: [
          {
            model: 'weak-paid-model',
            codingGrade: Difficulty.MECHANICAL,
            cost: { inputPerMillion: 10 },
          },
        ],
      },
    ];

    const offerings = expandOfferings(accounts);
    const freeOffering = offerings.find((o) => o.model === 'strong-free-model');
    const paidOffering = offerings.find((o) => o.model === 'weak-paid-model');

    assert.equal(freeOffering.access, ACCESS_TYPE.FREE);
    assert.equal(paidOffering.access, ACCESS_TYPE.PAY_PER_CALL);

    // Strong free model is NOT ranked as weak
    assert.equal(freeOffering.codingGrade, Difficulty.ARCHITECTURAL);
    assert.equal(paidOffering.codingGrade, Difficulty.MECHANICAL);
  });

  test('selection order: capable candidates -> headroom -> cheapest access first', () => {
    const offerings = [
      {
        id: 'acc-paid::model-arch',
        accountId: 'acc-paid',
        model: 'model-arch',
        codingGrade: Difficulty.ARCHITECTURAL,
        access: ACCESS_TYPE.PAY_PER_CALL,
        cost: { inputPerMillion: 15, outputPerMillion: 60 },
        quality: 90,
      },
      {
        id: 'acc-plan::model-arch',
        accountId: 'acc-plan',
        model: 'model-arch',
        codingGrade: Difficulty.ARCHITECTURAL,
        access: ACCESS_TYPE.INCLUDED_IN_PAID_PLAN,
        cost: { inputPerMillion: 0, outputPerMillion: 0 },
        quality: 90,
      },
      {
        id: 'acc-free::model-arch',
        accountId: 'acc-free',
        model: 'model-arch',
        codingGrade: Difficulty.ARCHITECTURAL,
        access: ACCESS_TYPE.FREE,
        cost: { inputPerMillion: 0, outputPerMillion: 0 },
        quality: 90,
      },
    ];

    const headrooms = {
      'acc-paid::model-arch': { status: 'open' },
      'acc-plan::model-arch': { status: 'open' },
      'acc-free::model-arch': { status: 'open' },
    };

    const res = selectOffering({
      difficulty: Difficulty.ARCHITECTURAL,
      offerings,
      headrooms,
    });

    assert.ok(res.selected);
    // Cheapest access first: free wins over plan and pay-per-call
    assert.equal(res.selected.id, 'acc-free::model-arch');
  });

  test('on quota refusal, re-select inside capable set and skip every source sharing the exhausted quota', () => {
    const offerings = [
      {
        id: 'acc-1::model-a',
        accountId: 'acc-1',
        model: 'model-a',
        codingGrade: Difficulty.COMPLEX,
        access: ACCESS_TYPE.FREE,
      },
      {
        id: 'acc-1::model-b',
        accountId: 'acc-1',
        model: 'model-b',
        codingGrade: Difficulty.COMPLEX,
        access: ACCESS_TYPE.FREE,
      },
      {
        id: 'acc-2::model-c',
        accountId: 'acc-2',
        model: 'model-c',
        codingGrade: Difficulty.COMPLEX,
        access: ACCESS_TYPE.INCLUDED_IN_PAID_PLAN,
      },
    ];

    const headrooms = {
      'acc-1::model-a': { status: 'open' },
      'acc-1::model-b': { status: 'open' },
      'acc-2::model-c': { status: 'open' },
    };

    // Before refusal, acc-1::model-a is chosen (free access)
    const initial = selectOffering({
      difficulty: Difficulty.COMPLEX,
      offerings,
      headrooms,
    });
    assert.equal(initial.selected.id, 'acc-1::model-a');

    // Quota refusal on acc-1::model-a:
    // Both acc-1::model-a and acc-1::model-b share acc-1 quota and MUST be skipped
    const rotated = selectOffering({
      difficulty: Difficulty.COMPLEX,
      offerings,
      headrooms,
      refusedOffering: initial.selected,
    });

    assert.ok(rotated.selected);
    assert.equal(rotated.selected.id, 'acc-2::model-c', 'must rotate to independent account acc-2');
    assert.equal(rotated.skippedExhausted.length, 2, 'both acc-1 offerings skipped');
  });

  test('an offering with no headroom record is not selectable', () => {
    const offerings = [
      {
        id: 'acc-1::model-a',
        accountId: 'acc-1',
        model: 'model-a',
        codingGrade: Difficulty.COMPLEX,
        access: ACCESS_TYPE.FREE,
      },
      {
        id: 'acc-2::model-b',
        accountId: 'acc-2',
        model: 'model-b',
        codingGrade: Difficulty.COMPLEX,
        access: ACCESS_TYPE.PAY_PER_CALL,
      },
    ];
    const res = selectOffering({
      difficulty: Difficulty.COMPLEX,
      offerings,
      headrooms: { 'acc-2::model-b': { status: 'open' } },
    });
    assert.equal(res.selected.id, 'acc-2::model-b');
  });
});

describe('Benchmark source verification and key uniqueness (TASK-AI-46)', () => {
  const base = {
    model_id: 'dup-model',
    model_version: 'v1',
    benchmark: 'SWE-bench Verified',
    benchmark_version: 'v1.0',
    source_url: 'https://example.com/1',
    checked_on: '2026-09-01',
  };

  test('a record marked verified: false grades nothing and is reported', () => {
    const records = [{ ...base, score: 75, verified: false }];
    assert.equal(findBenchmarkEvidence(records, 'dup-model'), null);
    const codes = auditBenchmarks(records, [], { now: NOW }).findings.map((f) => f.code);
    assert.ok(codes.includes('BENCHMARK_UNVERIFIED_SOURCE'));
  });

  test('a repeated (model, version, benchmark, benchmark version) key is an audit error', () => {
    const records = [
      { ...base, score: 40 },
      { ...base, score: 80, source_url: 'https://example.com/2' },
    ];
    const dup = auditBenchmarks(records, [], { now: NOW }).findings.filter(
      (f) => f.code === 'BENCHMARK_DUPLICATE_KEY'
    );
    assert.equal(dup.length, 1);
    assert.equal(dup[0].severity, 'error');
    assert.equal(dup[0].recordIndex, 1);
  });

  test('every shipped benchmark record is marked unverified until a real source is recorded', () => {
    for (const r of loadBenchmarks()) assert.strictEqual(r.verified, false);
  });
});

describe('Benchmark staleness and completeness audit (TASK-AI-46)', () => {
  test('audit flags records older than 90 days as warning', () => {
    const staleRecord = {
      model_id: 'stale-model',
      benchmark: 'SWE-bench',
      score: 60,
      source_url: 'https://example.com',
      checked_on: '2026-05-01', // > 90 days before 2026-09-18
    };

    const res = auditBenchmarks([staleRecord], [], { now: NOW });
    assert.equal(res.summary.warn, 1);
    assert.equal(res.summary.error, 0);
    assert.equal(res.findings[0].code, 'BENCHMARK_STALE_RECORD');
  });

  test('audit flags missing source URL or checked_on as error', () => {
    const missingUrl = {
      model_id: 'm1',
      benchmark: 'SWE-bench',
      score: 60,
      checked_on: '2026-08-01',
    };
    const missingDate = {
      model_id: 'm2',
      benchmark: 'SWE-bench',
      score: 60,
      source_url: 'https://example.com',
    };

    const res = auditBenchmarks([missingUrl, missingDate], [], { now: NOW });
    assert.equal(res.summary.error, 2);
    const codes = res.findings.map((f) => f.code);
    assert.ok(codes.includes('BENCHMARK_MISSING_SOURCE_URL'));
    assert.ok(codes.includes('BENCHMARK_MISSING_CHECKED_ON'));
  });

  test('audit flags model version mismatch with offerings as warning', () => {
    const record = {
      model_id: 'gemini-3.8-flash-high',
      model_version: '20250101', // mismatched version
      benchmark: 'SWE-bench',
      score: 60,
      source_url: 'https://example.com',
      checked_on: '2026-08-15',
    };

    const offerings = [{ model: 'gemini-3.8-flash-high', modelVersion: '20260201' }];

    const res = auditBenchmarks([record], offerings, { now: NOW });
    assert.equal(res.summary.warn, 1);
    assert.equal(res.summary.error, 0);
    assert.equal(res.findings[0].code, 'BENCHMARK_VERSION_MISMATCH');
  });

  test('production benchmarks.json passes audit with zero errors', () => {
    const list = loadBenchmarks();
    const res = auditBenchmarks(list, [], { now: NOW });
    assert.equal(res.summary.error, 0, 'must have zero errors');
  });
});

describe('Evidence reaches real offerings and fails closed (#106 review 05:09Z)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { ACCOUNTS } = require('../seed-accounts');
  const { formatAuditResult } = require('../benchmarks');

  const verifiedFlash = {
    model_id: 'gemini-3.8-flash-high',
    benchmark: 'SWE-bench Verified',
    benchmark_version: '1.0',
    score: 50,
    source_url: 'https://example.com/flash',
    checked_on: '2026-09-01',
  };

  test('a seed offering resolves through externalEvidence by its model, not its offering id', () => {
    const offerings = expandOfferings(ACCOUNTS, { benchmarks: [verifiedFlash] });
    const flash = offerings.filter((o) => o.model === 'gemini-3.8-flash-high');
    assert.ok(flash.length > 0, 'seed accounts carry gemini-3.8-flash-high');
    for (const o of flash) {
      assert.notStrictEqual(o.id, o.model, 'offering id differs from model');
      assert.equal(o.gradeRecord.source, GRADE_SOURCE.EXTERNAL);
      assert.equal(o.gradeRecord.class, Difficulty.STANDARD);
    }
  });

  test('loadBenchmarks throws on a corrupt, non-array or missing table', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
    const corrupt = path.join(dir, 'corrupt.json');
    const object = path.join(dir, 'object.json');
    fs.writeFileSync(corrupt, '{');
    fs.writeFileSync(object, '{}');
    for (const p of [corrupt, object, path.join(dir, 'missing.json')]) {
      assert.throws(() => loadBenchmarks(p), { code: 'BENCHMARKS_UNREADABLE' });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('resolveGrade does not read damaged evidence as no evidence', () => {
    const bad = [];
    bad.filter = () => {
      throw new Error('damaged');
    };
    assert.throws(
      () => resolveGrade({ id: 'x', model: 'm', codingGrade: 3 }, { benchmarks: bad }),
      /damaged/,
    );
  });

  test('summary.pass counts records with no findings', () => {
    const res = auditBenchmarks([{ model_id: 'm' }, verifiedFlash], [], { now: NOW });
    assert.deepStrictEqual(res.summary, { total: 2, pass: 1, warn: 0, error: 2 });
  });

  test('the audit prints the operator-console state lines', () => {
    const ok = auditBenchmarks([verifiedFlash], [], { now: NOW });
    assert.equal(
      formatAuditResult(ok),
      'Benchmark audit: VALIDATED (1 records, 0 errors, 0 warnings)',
    );
    const bad = auditBenchmarks([{ model_id: 'm', checked_on: '2026-09-01' }], [], { now: NOW });
    assert.equal(
      formatAuditResult(bad),
      'Benchmark audit: FAILED (1 errors: BENCHMARK_MISSING_SOURCE_URL: m)',
    );
  });
});
