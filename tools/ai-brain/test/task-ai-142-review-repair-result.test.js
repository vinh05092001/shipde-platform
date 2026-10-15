'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { candidateKey } = require('../candidates');
const { repairRound } = require('../orchestrate');
const decisions = require('../decisions');

function candidate(overrides = {}) {
  const c = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: 'fixture-router',
    source: 'fixture-router',
    upstream: 'vendor',
    accountId: 'fixture-account',
    quotaScope: 'fixture-account',
    modelId: 'vendor/fixture',
    quality: 90,
    cost: 1,
    latencyMs: 100,
    capabilities: { tools: true, jsonSchema: true, contextWindow: 64000 },
    evidence: [],
    ...overrides,
  };
  c.candidateKey = candidateKey(c);
  return c;
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-selection-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

for (const outcome of ['success', 'error', 'exception']) {
  test(`review-repair emits exactly one redacted writer-launch-result: ${outcome}`, async (t) => {
    const dir = temp(t);
    const secret = 'fixture-private-value-932801';
    const previous = process.env.FIXTURE_REPAIR_TOKEN;
    process.env.FIXTURE_REPAIR_TOKEN = secret;
    t.after(() => {
      if (previous === undefined) delete process.env.FIXTURE_REPAIR_TOKEN;
      else process.env.FIXTURE_REPAIR_TOKEN = previous;
    });
    const c = candidate();
    const item = { id: 'ITEM-FIXTURE', files: ['file.js'], roleRequirement: { role: 'writer' } };
    const logOpts = { dir: path.join(dir, 'decisions'), runId: 'fixture-run' };
    let launches = 0;
    const repair = repairRound(
      {
        cwd: dir,
        registry: { sources: [] },
        specs: [item],
        jevAsk: async () => {
          throw Error('offline');
        },
      },
      item,
      { candidateKey: c.candidateKey },
      { goal: 'fixture repair' },
      logOpts,
      async () => {
        launches++;
        if (outcome === 'exception') throw Error(`launcher failed ${secret}`);
        return {
          exitCode: outcome === 'success' ? 0 : 1,
          stdout: '',
          stderr: `fixture stderr ${secret}`,
          httpStatus: outcome === 'error' ? 503 : undefined,
        };
      },
      path.join(dir, 'usage'),
      Date.now(),
      [c],
      null,
      { sources: [] }
    );
    await repair([{ id: 'F1', open: true }], 'a'.repeat(40));
    assert.equal(launches, 1);
    const records = decisions.readDecisionsSafe(logOpts);
    const results = records.filter((r) => r.stage === 'writer-launch-result');
    assert.equal(results.length, 1);
    assert.equal(results[0].kind, 'review-repair');
    assert.equal(results[0].chosen, c.candidateKey);
    assert.equal(results[0].exitCode, outcome === 'exception' ? -1 : outcome === 'error' ? 1 : 0);
    assert.ok(!JSON.stringify(records).includes(secret));
    assert.match(results[0].stderr, /REDACTED/i);
  });
}
