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
test('unknown prior is neutral median and explicitly flagged', () => {
  const prior = priorFor({ modelId: 'unknown' }, 'planner', {
    ranking: [
      { canonical: 'a', benchmarks: { intelligenceIndex: 20 } },
      { canonical: 'b', benchmarks: { intelligenceIndex: 40 } },
    ],
  });
  assert.equal(prior.score, 37.5);
  assert.equal(prior.priorUnknown, true);
  assert.equal(prior.bonus, 0);
});
