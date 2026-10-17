'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publicDocuments } = require('../priors-public');
const { mergePriorDocuments, priorFor } = require('../priors');

test('public documents and merged priors carry source ids from descriptor without undefined', async () => {
  const row = { name: 'Claude-3.7-Sonnet', intelligenceIndex: 78.5 };
  const html = `<script>self.__next_f.push(${JSON.stringify([1, '1:' + JSON.stringify({ models: [row] }) + '\n'])})</script>`;

  const docs = await publicDocuments({
    now: 1000,
    fetch: async (url) => ({
      ok: true,
      text: async () => html,
      json: async () => ({
        items: [
          {
            canonicalModelKey: 'model-4',
            displayScore: 78.5,
            benchmarks: { coding: { aaCodingIndex: 78.5 } },
          },
        ],
      }),
    }),
  });

  assert.equal(docs.length, 2);
  // Source id must exist and must not be undefined or the literal string "undefined"
  assert.ok(docs[0].sources[0].id, 'first document source must have an id');
  assert.notEqual(docs[0].sources[0].id, 'undefined');
  assert.ok(docs[1].sources[0].id, 'second document source must have an id');
  assert.notEqual(docs[1].sources[0].id, 'undefined');

  assert.equal(docs[0].models[0].source.id, docs[0].sources[0].id);
  assert.equal(docs[1].models[0].source.id, docs[1].sources[0].id);

  const merged = mergePriorDocuments(docs, 1000);
  assert.ok(Array.isArray(merged.sources) && merged.sources.length >= 2);
  for (const src of merged.sources) {
    assert.ok(src.id, `merged source ${src.url} must have an id`);
    assert.notEqual(src.id, 'undefined');
  }

  const modelRow = merged.ranking.find((r) => r.canonical.includes('model-4'));
  assert.ok(modelRow, 'model row exists in merged priors');
  assert.ok(modelRow.sources.length > 0);
  for (const src of modelRow.sources) {
    assert.ok(src.id, 'model row source must have an id');
    assert.notEqual(src.id, 'undefined');
  }

  const candidate = { modelId: 'model-4' };
  const prior = priorFor(candidate, 'writer', merged, 1000);
  assert.ok(prior.source, 'prior.source must be defined');
  assert.notEqual(prior.source, 'undefined');
  assert.equal(typeof prior.source, 'string');

  const json = JSON.stringify(merged);
  assert.ok(!json.includes('"undefined"'), 'merged document must not contain string "undefined"');
});

test('custom descriptor sources array provides exact ids to public documents', async () => {
  const row = { name: 'Test-Model', intelligenceIndex: 50 };
  const html = `<script>self.__next_f.push(${JSON.stringify([1, '1:' + JSON.stringify({ models: [row] }) + '\n'])})</script>`;

  const customDescriptor = {
    kind: 'public-leaderboards',
    sources: [
      { id: 'custom-aa-board', kind: 'aa', url: 'https://custom-aa.example/board' },
      { id: 'custom-bench-data', kind: 'bench', url: 'https://custom-bench.example/data.json' },
    ],
  };

  const docs = await publicDocuments({
    descriptor: customDescriptor,
    now: 2000,
    fetch: async () => ({
      ok: true,
      text: async () => html,
      json: async () => ({
        items: [{ canonicalModelKey: 'test-model', displayScore: 50 }],
      }),
    }),
  });

  assert.equal(docs[0].sources[0].id, 'custom-aa-board');
  assert.equal(docs[1].sources[0].id, 'custom-bench-data');

  const merged = mergePriorDocuments(docs, 2000);
  assert.equal(merged.sources[0].id, 'custom-aa-board');
  assert.equal(merged.sources[1].id, 'custom-bench-data');
});
