'use strict';

/**
 * Ship Dễ — TASK-AI-142: an unreported context window ranks last instead of
 * excluding the candidate; a known-too-small window and an observed context
 * overflow still reject.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const routing = require('../routing');
const health = require('../route-health');
const harness = require('../harness');
const { candidateKey } = require('../discovery/identity');

function candidate(model, contextWindow) {
  const c = {
    harness: 'hermes',
    accessPath: 'https://fixture.example/v1',
    gateway: 'fixture',
    upstream: 'openai',
    accountId: 'a',
    quotaScope: 'a',
    modelId: model,
    quality: 60,
    cost: 50,
    latencyMs: 1000,
  };
  if (contextWindow !== undefined) c.contextWindow = contextWindow;
  c.candidateKey = candidateKey(c);
  return c;
}

const assessment = { weightProfile: 'CUSTOM', weights: { quality: 51, latency: 34, cost: 15 } };
const ctx = { priors: { ranking: [] } };

test('unknown context stays eligible but scores below an otherwise equal known one', () => {
  assert.equal(harness.contextRefusal('hermes', undefined, { allowUnknown: true }), null);
  const known = routing.scoreForProfile(candidate('m/known', 128000), assessment, ctx);
  const unknown = routing.scoreForProfile(candidate('m/unknown'), assessment, ctx);
  assert.equal(known.breakdown.contextPenalty, 0);
  assert.ok(unknown.breakdown.contextPenalty > 0);
  assert.ok(unknown.score < known.score);
});

test('a known context below the floor is still refused', () => {
  assert.match(
    harness.contextRefusal('hermes', 16000, { allowUnknown: true }),
    /^CONTEXT_TOO_SMALL/
  );
});

test('a recorded context overflow rejects that model next time and keeps the limit', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'health.json');
  const c = candidate('m/overflow');
  const other = candidate('m/other');
  for (const x of [c, other])
    health.rememberProbe(x, { ok: true, status: 200, body: '' }, { routeHealthFile: file });
  assert.equal(health.contextOverflowObserved(c, { routeHealthFile: file }), null);
  const tpm =
    'Rate limit reached: tokens per minute (TPM): Limit 8000, Requested 9247, maximum context length';
  assert.equal(health.rememberLaunchContextOverflow(c, tpm, { routeHealthFile: file }), null);
  const record = health.rememberLaunchContextOverflow(
    c,
    "This model's maximum context length is 32768 tokens. However, you requested 40000 tokens",
    { routeHealthFile: file }
  );
  assert.equal(record.observedContextLimit, 32768);
  assert.match(
    health.contextOverflowObserved(c, { routeHealthFile: file }),
    /^CONTEXT_OVERFLOW_OBSERVED/
  );
  assert.equal(health.contextOverflowObserved(other, { routeHealthFile: file }), null);
});
