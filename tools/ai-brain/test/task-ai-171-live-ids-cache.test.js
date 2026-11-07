'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const publicPriors = require('../priors-public');
const { splitModelEffort } = require('../priors');

test('prior matching reads an unchanged catalogue once', (t) => {
  const stat = { mtimeMs: 1794000000000, size: 1 };
  const read = t.mock.method(fs, 'readFileSync', (file, ...rest) =>
    String(file).endsWith('catalogue.jsonl')
      ? '{"modelId":"fixture/model"}\n'
      : read.mock.original(file, ...rest)
  );
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'statSync', () => stat);
  const reads = () =>
    read.mock.calls.filter((c) => String(c.arguments[0]).endsWith('catalogue.jsonl')).length;
  const first = reads();
  publicPriors.liveModelIds();
  publicPriors.liveModelIds();
  splitModelEffort('fixture/model');
  splitModelEffort('fixture/other');
  assert.equal(reads() - first, 1);
  stat.mtimeMs += 1;
  publicPriors.liveModelIds();
  assert.equal(reads() - first, 2);
});
