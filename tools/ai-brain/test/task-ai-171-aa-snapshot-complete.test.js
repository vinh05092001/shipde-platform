'use strict';

// TASK-AI-171: a failed AA model-page fetch fails the snapshot refresh and keeps
// the last good snapshot. Injected fetch only; no network.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { snapshot } = require('../aa-snapshot');

const LEADERBOARD =
  '{"list":[{"releaseSlug":"m-1"},{"releaseSlug":"m-2"}],' +
  '"a":{"slug":"m-1","name":"M 1","intelligenceIndex":40},' +
  '"b":{"slug":"m-2","name":"M 2","intelligenceIndex":20}}';
const PAGE_2 =
  '{"x":{"slug":"m-2-old","name":"M 2 Old","release":{"slug":"m-2"},"deprecated":true,"intelligenceIndex":10}}';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-complete-'));
  const policyFile = path.join(dir, 'scoring-policy.json');
  fs.writeFileSync(
    policyFile,
    JSON.stringify({
      version: 'AA-TEST-1-percentile-v1',
      source: 'https://example.invalid/leaderboard',
      modelPageBase: 'https://example.invalid/models/',
      modelPageConcurrency: 2,
      priorsFile: 'aa-test.json',
      dimensions: { quality: { unit: 'percentile', min: 0, max: 100 } },
    })
  );
  const out = path.join(dir, 'aa-test.json');
  fs.writeFileSync(out, '{"previous":"good"}\n');
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
  return {
    dir,
    policyFile,
    out,
    hash,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const ok = (text) => ({ ok: true, status: 200, text: async () => text });

function fetchWith(pageResult) {
  return async (url) => {
    if (url.endsWith('/leaderboard')) return ok(LEADERBOARD);
    if (url.endsWith('/m-1')) return ok('{}');
    return pageResult();
  };
}

test('a model page answering HTTP 500 fails the refresh and keeps the last snapshot', async () => {
  const e = setup();
  try {
    const before = e.hash();
    await assert.rejects(
      snapshot(
        e.policyFile,
        fetchWith(() => ({ ok: false, status: 500, text: async () => '' }))
      ),
      /AA_DEEP_INCOMPLETE: 1 of 2 model pages failed/
    );
    assert.equal(e.hash(), before, 'previous snapshot unchanged');
    assert.equal(fs.existsSync(e.out + '.tmp'), false, 'no temporary file left');
  } finally {
    e.cleanup();
  }
});

test('a model page that times out fails the refresh and keeps the last snapshot', async () => {
  const e = setup();
  try {
    const before = e.hash();
    const timeout = () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };
    await assert.rejects(snapshot(e.policyFile, fetchWith(timeout)), /AA_DEEP_INCOMPLETE/);
    assert.equal(e.hash(), before);
    assert.equal(fs.existsSync(e.out + '.tmp'), false);
  } finally {
    e.cleanup();
  }
});

test('when every model page answers, the snapshot is written as before', async () => {
  const e = setup();
  try {
    const res = await snapshot(
      e.policyFile,
      fetchWith(() => ok(PAGE_2))
    );
    const doc = JSON.parse(fs.readFileSync(e.out, 'utf8'));
    assert.equal(res.rows, 3);
    assert.deepEqual(doc.rows.map((r) => r.name).sort(), ['M 1', 'M 2', 'M 2 Old']);
    assert.equal(fs.existsSync(e.out + '.tmp'), false);
  } finally {
    e.cleanup();
  }
});

test('a model page AA no longer serves (404) is skipped, not a failure', async () => {
  const e = setup();
  try {
    const res = await snapshot(
      e.policyFile,
      fetchWith(() => ({ ok: false, status: 404, text: async () => '' }))
    );
    assert.equal(res.rows, 2, 'leaderboard rows still written');
  } finally {
    e.cleanup();
  }
});

test('a transient failure is retried once before failing the refresh', async () => {
  const e = setup();
  try {
    let calls = 0;
    const flaky = () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, text: async () => '' };
      return ok(PAGE_2);
    };
    const res = await snapshot(e.policyFile, fetchWith(flaky));
    assert.equal(calls, 2, 'one retry');
    assert.equal(res.rows, 3);
  } finally {
    e.cleanup();
  }
});
