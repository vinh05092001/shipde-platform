'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('TASK-AI-142 P1-1: ordinary HTTP 500/503 without missing channel evidence is not classified as NO_CHANNEL', () => {
  const sweepImport = require('../sweep-import');

  // Generic 500 without bracketed upstream status must NOT be NO_CHANNEL
  const err500 = sweepImport.classifySweepRow({
    status: 'HTTP_500',
    err: 'Internal Server Error',
  });
  assert.notEqual(err500.code, 'NO_CHANNEL', 'HTTP 500 must not be classified as NO_CHANNEL');
  assert.equal(err500.code, 'HTTP_500');

  // Generic 503 without missing channel evidence must NOT be NO_CHANNEL
  const err503 = sweepImport.classifySweepRow({
    status: 'HTTP_503',
    err: 'Service Unavailable: upstream connect error',
  });
  assert.notEqual(
    err503.code,
    'NO_CHANNEL',
    'HTTP 503 without channel evidence must not be NO_CHANNEL'
  );
  assert.equal(err503.code, 'HTTP_503');

  // Errors WITH channel evidence MUST be NO_CHANNEL
  const noChan = sweepImport.classifySweepRow({
    status: 'HTTP_503',
    err: 'no channel available for this model',
  });
  assert.equal(noChan.code, 'NO_CHANNEL');

  const vnChan = sweepImport.classifySweepRow({
    status: 'HTTP_503',
    err: 'không có kênh khả dụng',
  });
  assert.equal(vnChan.code, 'NO_CHANNEL');

  const notFound = sweepImport.classifySweepRow({
    status: 'HTTP_503',
    err: 'model_not_found',
  });
  assert.equal(notFound.code, 'NO_CHANNEL');
});

test('TASK-AI-142 P1-2: SKIP rows with a model are skipped and not imported as failures', () => {
  const sweepImport = require('../sweep-import');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-skip-test-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const sweepData = {
    at: '2026-10-19T04:17:00.000Z',
    rows: [
      {
        source: 'aihubmix',
        model: 'unprobed-model',
        status: 'SKIP',
        err: 'Skipped probe due to budget limit',
      },
    ],
  };

  const res = sweepImport.importSweep(sweepData, { evidenceDir, persist: false });
  assert.equal(res.imported, 0, 'Unprobed SKIP rows must not be imported');
  assert.equal(res.failed, 0, 'Unprobed SKIP rows must not count as failures');
  assert.equal(
    res.evidenceData?.cooldowns?.['model::aihubmix::unprobed-model'],
    undefined,
    'Unprobed SKIP rows must not create cooldowns'
  );
  assert.equal(
    (res.evidenceData?.combinations || []).length,
    0,
    'Unprobed SKIP rows must not create capability combinations'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1-3: match account and quota identifiers from live candidates instead of guessing', () => {
  const sweepImport = require('../sweep-import');
  const cli = require('../cli');
  const sourcesApi = require('../sources');
  const { candidateKey } = require('../discovery/identity');

  const registry = sourcesApi.loadSources();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-cand-match-test-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  // Router candidate using account xkiro and quota scope ocz
  const cand = {
    harness: 'paseo',
    accessPath: 'http://127.0.0.1:20128/v1',
    gateway: '9router',
    upstream: 'ocz',
    accountId: 'xkiro',
    quotaScope: 'ocz',
    modelId: 'ocz/real-model',
    source: '9router',
  };
  cand.candidateKey = candidateKey(cand);

  // Sweep row lacks accountId and quotaScope, and reports an account-scoped failure (QUOTA)
  const sweepAt = '2026-10-19T06:00:00.000Z';
  const sweepData = {
    at: sweepAt,
    rows: [
      {
        source: '9router',
        model: 'ocz/real-model',
        status: 'HTTP_402',
        err: 'Payment required: balance insufficient',
      },
    ],
  };

  const res = sweepImport.importSweep(sweepData, {
    evidenceDir,
    registry,
    candidates: [cand],
    persist: true,
  });

  assert.equal(res.failed, 1);

  // Cooldown must match the candidate's exact candidateKey
  assert.ok(
    res.evidenceData.cooldowns[cand.candidateKey],
    `Candidate cooldown must be recorded under candidateKey ${cand.candidateKey}`
  );
  assert.equal(res.evidenceData.cooldowns[cand.candidateKey].cause, 'QUOTA');

  // Verify candidate is excluded in dispatch dry-run
  const item = {
    workItemId: 'TASK-AI-142',
    role: 'writer',
    requiredCapabilities: [],
  };

  const dispatchResult = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates: [cand],
      items: [item],
      evidenceDir,
      now: Date.parse(sweepAt) + 1000,
      log: () => {},
      exit: () => {},
    }
  );

  const rejected = dispatchResult.decision.rejected || [];
  const findRej = rejected.find((r) => (r.offeringId || r.candidateKey) === cand.candidateKey);
  assert.ok(findRej, 'Router candidate with account xkiro must be rejected in dispatch');
  assert.equal(findRej.reason, 'QUOTA');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1-4: combination lookup matches full route identity so results from distinct accounts stay separate', () => {
  const sweepImport = require('../sweep-import');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-combo-test-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const sweepData = {
    at: '2026-10-19T07:00:00.000Z',
    rows: [
      {
        source: '9router',
        model: 'ocz/test-model',
        accountId: 'acc-alpha',
        quotaScope: 'scope-alpha',
        status: 'TOOLS_OK',
        ms: 120,
      },
      {
        source: '9router',
        model: 'ocz/test-model',
        accountId: 'acc-beta',
        quotaScope: 'scope-beta',
        status: 'HTTP_401',
        err: 'Unauthorized: invalid token',
      },
    ],
  };

  const res = sweepImport.importSweep(sweepData, { evidenceDir, persist: false });
  assert.equal(res.imported, 2);

  const combinations = res.evidenceData.combinations || [];
  // Must NOT collapse distinct accounts into one combination
  assert.equal(combinations.length, 2, 'Must have 2 separate combinations for distinct accounts');

  const comboAlpha = combinations.find((c) => (c.accountId || c.account) === 'acc-alpha');
  const comboBeta = combinations.find((c) => (c.accountId || c.account) === 'acc-beta');

  assert.ok(comboAlpha, 'Combination for acc-alpha must exist');
  assert.ok(comboBeta, 'Combination for acc-beta must exist');

  // acc-alpha must only have passing evidence
  assert.equal(comboAlpha.evidence.length, 1);
  assert.equal(comboAlpha.evidence[0].status, 'passed');

  // acc-beta must only have failing evidence
  assert.equal(comboBeta.evidence.length, 1);
  assert.equal(comboBeta.evidence[0].status, 'failed');
  assert.equal(comboBeta.evidence[0].code, 'AUTH');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
