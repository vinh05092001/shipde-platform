'use strict';

// Machine discovery data (tools/ai-brain/data/sources.json) must not leak into
// an explicit registry or into the host brain gate. Live 17/10: the Controller's
// host gate failed 11 candidate tests for GOAL-G-F622511E-1 because this
// machine's 33 discovered sources were merged into every loadSources() call.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sources = require('../sources');
const orchestrate = require('../orchestrate');

function writeJson(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

test('an explicit registry file is read alone unless a discovered file is named', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-iso-'));
  try {
    const file = writeJson(dir, 'registry.json', {
      sources: [{ id: 'only', kind: 'model-source', credential: { type: 'api-key', env: 'K' } }],
    });
    const discoveredFile = writeJson(dir, 'discovered.json', {
      sources: [
        {
          id: 'found',
          endpoint: 'https://found.example/v1',
          credential: { type: 'env', name: 'FOUND_KEY' },
        },
      ],
    });
    assert.deepEqual(
      sources.loadSources({ file }).sources.map((s) => s.id),
      ['only']
    );
    assert.deepEqual(
      sources
        .loadSources({ file, discoveredFile })
        .sources.map((s) => s.id)
        .sort(),
      ['found', 'only']
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the host brain gate runs the suite without machine discovery data', () => {
  let seenEnv = null;
  orchestrate.runHostBrainGate(
    {},
    {
      hostCwd: path.resolve(__dirname, '..', '..', '..'),
      brainSuite: 'tools/ai-brain/test/task-ai-142-sources-isolation.test.js',
      spawnSync: (cmd, _args, opts) => {
        // git calls prepare the clean checkout; the suite run is the node call.
        if (cmd !== 'git') seenEnv = opts.env;
        return { status: 0, stdout: 'ℹ pass 1\nℹ fail 0\n', stderr: '' };
      },
    }
  );
  assert.ok(seenEnv, 'the gate spawned the suite');
  assert.equal(seenEnv.AI_BRAIN_DISCOVERED_SOURCES, 'none');
  assert.equal(seenEnv.AI_BRAIN_MACHINE_DATA, 'none');
  assert.equal(seenEnv.NINEROUTER_API_KEY, undefined);
});

test('machine caches are off when AI_BRAIN_MACHINE_DATA=none', () => {
  // Live 17/10 run 6: the host gate failed candidate tests because the
  // models.dev cache in the Hermes home gave a model a 200k context window.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'machdata-'));
  const previous = process.env.AI_BRAIN_MACHINE_DATA;
  try {
    writeJson(dir, 'models_dev_cache.json', { p: { models: { m: { limit: { context: 1 } } } } });
    const candidates = require('../candidates');
    process.env.AI_BRAIN_MACHINE_DATA = 'none';
    assert.equal(candidates.loadModelCatalog({ hermesHome: dir }), null);
    assert.ok(
      candidates.loadModelCatalog({ modelCatalogPath: path.join(dir, 'models_dev_cache.json') }),
      'an explicit catalogue path still counts'
    );
  } finally {
    if (previous === undefined) delete process.env.AI_BRAIN_MACHINE_DATA;
    else process.env.AI_BRAIN_MACHINE_DATA = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
