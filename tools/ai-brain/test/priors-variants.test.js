'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { matchModelPrior, mergePriorDocuments, refreshPriors, priorFor } = require('../priors');
const { publicDocuments } = require('../priors-public');

test('deployment suffixes resolve only to existing entries, including stacked suffixes', () => {
  const base = { canonical: 'model-4', score: 42 };
  for (const suffix of [
    ':batch',
    ':flex',
    ':cloud',
    '[1m]',
    '[128k]',
    ' [1m]',
    '[1.5m]',
    '-fast',
    '-latest',
    '-20250514',
    '-2025-05-14',
    '-0424',
    '-202605',
    '-volc',
    '-turbo',
    '-202605:batch',
    '[1m]:cloud',
  ]) {
    assert.deepEqual(matchModelPrior('provider/model-4' + suffix, [base]), {
      entry: base,
      matchedVia: 'variant-suffix',
      matchedBaseId: 'model-4',
    });
  }
  for (const id of [
    'unknown-fast',
    'model-5-fast',
    'model-4-preview',
    'model-4-8b',
    'model-4-latest-extra',
  ])
    assert.equal(matchModelPrior(id, [base]), null);
  const exact = { canonical: 'model-4-turbo', score: 24 };
  assert.equal(matchModelPrior(exact.canonical, [base, exact]).entry, exact);
});

test('reasoning variants prefer exact published scores, then fall back to the base', () => {
  const base = { canonical: 'model-4', score: 42 };
  const high = { canonical: 'model-4-high', score: 60 };
  for (const id of ['model-4 (high)', 'provider/model-4-high'])
    assert.deepEqual(matchModelPrior(id, [base, high]), { entry: high });
  assert.equal(matchModelPrior('model-4-high:batch', [base, high]).entry, high);
  for (const suffix of [
    '-thinking',
    ' (high)',
    '-agentic',
    '-thinking-agentic',
    '-thinking:batch',
  ]) {
    assert.deepEqual(matchModelPrior('model-4' + suffix, [base]), {
      entry: base,
      matchedVia: 'reasoning-variant',
      matchedBaseId: 'model-4',
    });
  }
});

test('public ingestion and merging retain distinct effort leaderboard entries', async () => {
  const rows = [
    { name: 'Model 4 (high)', intelligenceIndex: 60 },
    { name: 'Model 4', intelligenceIndex: 42 },
  ];
  const docs = await publicDocuments({
    descriptor: {
      endpoint: 'https://artificialanalysis.ai/leaderboards/models',
      benchlm: 'https://benchlm.ai/data/models.json',
    },
    fetch: async () => ({
      ok: true,
      text: async () => `<script id="__NEXT_DATA__">${JSON.stringify(rows)}</script>`,
      json: async () => ({ items: [{ canonicalModelKey: 'model-4', displayScore: 42 }] }),
    }),
  });
  const merged = mergePriorDocuments(docs);
  assert.equal(docs[0].models.length, 2);
  assert.equal(matchModelPrior('model-4 (high)', merged.ranking).entry.benchmarks[0].score, 60);
  assert.equal(matchModelPrior('model-4', merged.ranking).entry.benchmarks[0].score, 42);
});

test('refresh records base provenance and unmatched IDs; repeated refresh never keeps stale aliases', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priors-variants-'));
  const file = path.join(dir, 'priors.json');
  const now = Date.now();
  const source = {
    url: 'https://example.com/leaderboard',
    retrievedAt: new Date(now).toISOString(),
  };
  const search = async () => [
    { models: [{ modelId: 'model-4', benchmarks: { intelligenceIndex: 42 }, source }] },
  ];
  try {
    const result = await refreshPriors({
      file,
      now,
      search,
      liveModels: ['model-4:batch', 'model-4-thinking', 'missing-fast'],
    });
    assert.deepEqual(result.unmatchedLiveModels, ['missing-fast']);
    for (const [id, via] of [
      ['model-4:batch', 'variant-suffix'],
      ['model-4-thinking', 'reasoning-variant'],
    ]) {
      const alias = result.ranking.find((row) => row.canonical === id);
      assert.equal(alias.matchedVia, via);
      assert.equal(alias.matchedBaseId, 'model-4');
      assert.deepEqual(alias.benchmarks, result.ranking[0].benchmarks);
      assert.deepEqual(alias.sources, result.ranking[0].sources);
      const prior = priorFor({ modelId: id }, 'planner', result, now);
      assert.equal(prior.matchedVia, via);
      assert.equal(prior.priorUnknown, undefined);
    }
    const second = await refreshPriors({
      file,
      now,
      search,
      preserveHistory: true,
      liveModels: ['model-4'],
    });
    assert.equal(second.ranking.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('refreshPriors requires an explicit file or root-derived path', async () => {
  await assert.rejects(
    refreshPriors({
      search: async () => [{ models: [] }],
    }),
    /PRIORS_OUTPUT_FILE_REQUIRED/
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priors-root-test-'));
  try {
    const doc = await refreshPriors({
      root: dir,
      search: async () => [{ models: [] }],
      liveModels: [],
    });
    assert.ok(fs.existsSync(path.join(dir, 'model-priors-live.json')));
    assert.equal(doc.ranking.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('quartile tiers recompute after preserveHistory pushes rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priors-quartile-history-'));
  const file = path.join(dir, 'priors.json');
  const now = Date.parse('2026-10-15T00:00:00Z');
  const source = { url: 'https://bench.example/results', retrievedAt: '2026-10-15T00:00:00Z' };
  try {
    // Initial document with 4 models: scores 10, 20, 30, 40 -> T4, T3, T2, T1
    await refreshPriors({
      file,
      now,
      search: async () => [
        {
          models: [
            { modelId: 'm1', benchmarks: { swe: 10 }, source },
            { modelId: 'm2', benchmarks: { swe: 20 }, source },
            { modelId: 'm3', benchmarks: { swe: 30 }, source },
            { modelId: 'm4', benchmarks: { swe: 40 }, source },
          ],
        },
      ],
      liveModels: ['m1', 'm2', 'm3', 'm4'],
    });

    // Fresh refresh with 4 much higher models: 50, 60, 70, 80 + preserveHistory
    const refreshed = await refreshPriors({
      file,
      now,
      preserveHistory: true,
      search: async () => [
        {
          models: [
            { modelId: 'm5', benchmarks: { swe: 50 }, source },
            { modelId: 'm6', benchmarks: { swe: 60 }, source },
            { modelId: 'm7', benchmarks: { swe: 70 }, source },
            { modelId: 'm8', benchmarks: { swe: 80 }, source },
          ],
        },
      ],
      liveModels: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'],
    });

    // With 8 models total (10, 20, 30, 40, 50, 60, 70, 80):
    // T4: 10, 20; T3: 30, 40; T2: 50, 60; T1: 70, 80
    // Previously m4 was T1; with the new distribution it must now be T3!
    const rowM4 = refreshed.ranking.find((r) => r.canonical === 'm4');
    assert.equal(rowM4.codingTier, 'T3');
    assert.equal(rowM4.reviewTier, 'T3');
    const rowM8 = refreshed.ranking.find((r) => r.canonical === 'm8');
    assert.equal(rowM8.codingTier, 'T1');
    assert.equal(rowM8.reviewTier, 'T1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
