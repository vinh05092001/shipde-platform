'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const priors = require('../priors');
const { dispatchCommand } = require('../cli');

const NOW = Date.parse('2026-11-07T00:00:00.000Z');
const iso = (time) => new Date(time).toISOString();
const source = (time) => ({ url: 'https://benchmark.invalid/scores', retrievedAt: iso(time) });
const OLD = NOW - priors.STALE_AFTER_MS - 1;

function documentWithBenchmark(retrievedAt) {
  return {
    generatedAt: iso(NOW),
    ranking: [
      {
        canonical: 'fixture-model',
        codingTier: 'T1',
        reviewTier: 'T1',
        sources: [source(NOW)],
        benchmarks: [{ name: 'aaCodingIndex', score: 70, source: { ...source(NOW), retrievedAt } }],
      },
    ],
  };
}

test('producer labels retained old benchmarks even when the same source URL was fetched today', async (t) => {
  const dir = fs.mkdtempSync(path.join(__dirname, 'stale-score-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'priors.json');
  const refresh = (time, benchmarks) =>
    priors.refreshPriors({
      file,
      now: time,
      liveModels: [],
      preserveHistory: true,
      search: async () => [
        { models: [{ modelId: 'fixture-model', source: source(time), benchmarks }] },
      ],
    });
  await refresh(OLD, { aaCodingIndex: 70 });
  const doc = await refresh(NOW, { intelligenceIndex: 50 });
  const row = doc.ranking[0];
  assert.equal(row.sources[0].retrievedAt, iso(NOW));
  assert.equal(row.benchmarks.find((b) => b.name === 'aaCodingIndex').source.retrievedAt, iso(OLD));
  assert.equal(row.stale, true);
  assert.equal(priors.loadPriors(file).ranking[0].stale, true);
  assert.equal(priors.priorFor({ modelId: row.canonical }, 'writer', doc, NOW).stale, true);

  const renewed = await refresh(NOW, { aaCodingIndex: 80, intelligenceIndex: 50 });
  assert.equal(renewed.ranking[0].stale, false);
  assert.equal(renewed.ranking[0].benchmarks.find((b) => b.name === 'aaCodingIndex').score, 80);
  assert.equal(priors.arePriorsStale(renewed, NOW), false);
});

test('producer persists stale labels with the default clock used by priors refresh CLI', async (t) => {
  t.mock.method(Date, 'now', () => NOW);
  const dir = fs.mkdtempSync(path.join(__dirname, 'stale-score-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'priors.json');
  await priors.refreshPriors({
    file,
    liveModels: [],
    search: async () => [
      {
        models: [
          { modelId: 'fixture-model', source: source(OLD), benchmarks: { aaCodingIndex: 70 } },
        ],
      },
    ],
  });
  const doc = priors.loadPriors(file);
  assert.equal(doc.generatedAt, iso(NOW));
  assert.equal(doc.ranking[0].stale, true);
  assert.equal(doc.ranking[0].benchmarks[0].source.retrievedAt, iso(OLD));
});

test('dispatch labels old benchmark scores and excludes them from quality despite fresh row metadata', () => {
  const doc = documentWithBenchmark(iso(OLD));
  const candidate = {
    harness: 'opencode',
    accessPath: 'https://route.invalid/v1',
    gateway: 'fixture',
    upstream: 'fixture',
    accountId: 'fixture-account',
    quotaScope: 'fixture-account',
    modelId: 'fixture-model',
    contextWindow: 128000,
    capabilities: { contextWindow: 128000 },
    qualifiedRoles: ['author.foundation'],
    cost: 1,
    evidence: [],
  };
  const result = dispatchCommand(
    { 'dry-run': true },
    {
      now: NOW,
      candidates: [candidate],
      items: [{ workItemId: 'TASK-AI-166', role: 'author.foundation', qualityFloor: 0 }],
      accounts: [],
      registry: { sources: [] },
      evidenceData: [],
      priors: doc,
      assessment: { weights: { quality: 100, latency: 0, cost: 0 } },
      headrooms: { default: 'open' },
      ranking: { useStoredQuota: false, loadQuotaState: false },
      log: () => {},
      exit: () => {},
    }
  );
  assert.equal(result.exitCode, 0);
  const breakdown = result.decision.candidates[0].scoreBreakdown;
  assert.equal(breakdown.stalePriorWarning, true);
  assert.equal(breakdown.prior.stale, true);
  assert.equal(breakdown.prior.bonus, 0);
  assert.equal(breakdown.prior.weight, 0);
  assert.equal(breakdown.quality, null);
});

test('benchmark provenance keeps the existing age boundary and rejects missing, invalid and future dates', () => {
  for (const [date, stale] of [
    [iso(NOW - priors.STALE_AFTER_MS), false],
    [iso(OLD), true],
    [undefined, true],
    ['invalid', true],
    [iso(NOW + priors.STALE_AFTER_MS), true],
  ]) {
    for (const format of ['array', 'object']) {
      const doc = documentWithBenchmark(date);
      if (format === 'object') {
        doc.ranking[0].benchmarks = { aaCodingIndex: doc.ranking[0].benchmarks[0] };
      }
      const prior = priors.priorFor({ modelId: 'fixture-model' }, 'writer', doc, NOW);
      assert.equal(Boolean(prior.stale), stale, `${format}: ${date}`);
    }
  }
});

test('document freshness follows row and effort provenance without treating fresh generated rows as stale', () => {
  const doc = priors.mergePriorDocuments(
    [
      {
        models: [
          { modelId: 'fixture-model', source: source(NOW), benchmarks: { aaCodingIndex: 70 } },
        ],
      },
    ],
    NOW
  );
  assert.equal(priors.arePriorsStale(doc, NOW), false);
  assert.equal(priors.arePriorsStale(doc, NOW + priors.STALE_AFTER_MS), false);
  assert.equal(priors.arePriorsStale(doc, NOW + priors.STALE_AFTER_MS + 1), true);
  doc.ranking[0].efforts = {
    high: { benchmarks: [{ name: 'aaCodingIndex', score: 60, source: source(OLD) }] },
  };
  assert.equal(priors.arePriorsStale(doc, NOW), true);
  const prior = priors.priorFor({ modelId: 'fixture-model-high' }, 'writer', doc, NOW);
  assert.equal(prior.stale, true);
});
