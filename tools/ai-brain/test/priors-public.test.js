'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publicDocuments, aaRows } = require('../priors-public');
const { normaliseModelId, priorFor } = require('../priors');
test('public fetch parses Flight JSON and BenchLM numbers without coercing missing scores', async () => {
  const row = { name: 'GPT-6 Luna (max)', intelligenceIndex: 42.123 };
  const html = `<script>self.__next_f.push(${JSON.stringify([1, '1:' + JSON.stringify({ models: [row] }) + '\n'])})</script>`;
  const calls = [];
  const docs = await publicDocuments({
    descriptor: {
      endpoint: 'https://artificialanalysis.ai/leaderboards/models',
      benchlm: 'https://benchlm.ai/data/models.json',
    },
    now: 1000,
    fetch: async (url) => {
      calls.push(url);
      return {
        ok: true,
        text: async () => html,
        json: async () => ({
          items: [
            {
              canonicalModelKey: 'mercury-2.5',
              displayScore: 63.4,
              benchmarks: { coding: { aaCodingIndex: null } },
            },
          ],
        }),
      };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(docs[0].models[0].benchmarks.intelligenceIndex, 42.123);
  assert.deepEqual(docs[1].models[0].benchmarks, { benchlm: 63.4 });
  assert.equal(docs[0].models[0].source.retrievedAt, '1970-01-01T00:00:01.000Z');
  assert.throws(() => aaRows('<html/>'), /SCHEMA_CHANGED/);
});
test('effort names and provider ids share canonical ranking identity', () => {
  for (const id of ['GPT-6 Luna (max/high)', 'cl/openai/gpt-6-luna', 'gh/gpt-6-luna'])
    assert.equal(normaliseModelId(id), 'gpt-6-luna');
});
test('unknown prior has no invented score and is explicitly flagged', () => {
  const prior = priorFor({ modelId: 'unknown' }, 'planner', {
    ranking: [
      { canonical: 'a', benchmarks: { intelligenceIndex: 20 } },
      { canonical: 'b', benchmarks: { intelligenceIndex: 40 } },
    ],
  });
  assert.equal(prior.score, null);
  assert.equal(prior.reason, 'NO_BENCHMARK_COVERAGE');
  assert.equal(prior.priorUnknown, true);
  assert.equal(prior.bonus, 0);
});

test('priors tiers follow score quartiles across different distributions', () => {
  const { mergePriorDocuments } = require('../priors');
  for (const values of [
    [1, 2, 3, 4, 5, 6, 7, 8],
    [21, 22, 23, 24, 25, 26, 27, 28],
  ]) {
    const result = mergePriorDocuments([
      {
        models: values.map((score, index) => ({
          modelId: `fixture-${index}`,
          benchmarks: { intelligenceIndex: score },
        })),
      },
    ]);
    assert.deepEqual(
      result.ranking.map((row) => row.codingTier),
      ['T4', 'T4', 'T3', 'T3', 'T2', 'T2', 'T1', 'T1']
    );
    assert.deepEqual(
      result.ranking.map((row) => row.reviewTier),
      result.ranking.map((row) => row.codingTier)
    );
  }
});
test('thinking and effort priors borrow the published base score', () => {
  const now = Date.now();
  const priors = {
    ranking: [
      {
        canonical: 'claude-opus-4-6',
        benchmarks: { intelligenceIndex: 42 },
        codingTier: 'T1',
        retrievedAt: new Date(now).toISOString(),
      },
    ],
  };
  const base = priorFor({ modelId: 'claude-opus-4-6' }, 'planner', priors, now);
  for (const suffix of ['thinking', 'high', 'medium', 'low']) {
    assert.ok(Number.isFinite(base.score));
    assert.equal(
      priorFor({ modelId: `claude-opus-4-6-${suffix}` }, 'planner', priors, now).score,
      base.score
    );
  }
});
