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
      spawnSync: (_cmd, _args, opts) => {
        seenEnv = opts.env;
        return { status: 0, stdout: 'ℹ pass 1\nℹ fail 0\n', stderr: '' };
      },
    }
  );
  assert.ok(seenEnv, 'the gate spawned the suite');
  assert.equal(seenEnv.AI_BRAIN_DISCOVERED_SOURCES, 'none');
  assert.equal(seenEnv.NINEROUTER_API_KEY, undefined);
});
