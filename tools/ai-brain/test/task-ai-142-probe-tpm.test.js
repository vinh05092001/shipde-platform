'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const health = require('../route-health');
const routeProbe = require('../route-probe');
const { candidateKey } = require('../discovery/identity');

function candidate(model) {
  const c = {
    harness: 'hermes',
    accessPath: 'https://fixture.example/v1',
    gateway: 'fixture',
    upstream: 'openai',
    accountId: 'a',
    quotaScope: 'a',
    modelId: model,
    contextWindow: 128000,
  };
  c.candidateKey = candidateKey(c);
  return c;
}
const env = { K: 'fixture-only' };
const tooLarge =
  'Request too large for model `x` in organization `o` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 9247, please reduce your message size';

test('probe reads the token limit from the response header', async () => {
  const result = await routeProbe.probeRoute(candidate('openai/m'), 'K', env, {
    fetch: async () =>
      new Response('{}', { status: 200, headers: { 'X-RateLimit-Limit-Tokens': '8000' } }),
  });
  assert.equal(result.tokensPerMinuteLimit, 8000);
});

test('probe parses limit and requested size from a 413 body', async () => {
  const result = await routeProbe.probeRoute(candidate('openai/m'), 'K', env, {
    fetch: async () => new Response(tooLarge, { status: 413 }),
  });
  assert.equal(result.tokensPerMinuteLimit, 8000);
  assert.equal(result.requestedTokens, 9247);
});

test('selection refuses ROUTE_TPM_TOO_SMALL only when the limit is below a recorded request', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpm-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'health.json');
  const small = candidate('openai/small');
  const unknown = candidate('openai/unknown');
  health.rememberProbe(
    small,
    { ok: true, status: 200, body: '', tokensPerMinuteLimit: 8000 },
    { routeHealthFile: file }
  );
  health.rememberProbe(unknown, { ok: true, status: 200, body: '' }, { routeHealthFile: file });
  assert.equal(
    health.tpmTooSmall(small, { routeHealthFile: file }),
    null,
    'no request size known yet'
  );
  health.rememberLaunchTpm(small, tooLarge, { routeHealthFile: file });
  assert.match(health.tpmTooSmall(small, { routeHealthFile: file }), /^ROUTE_TPM_TOO_SMALL/);
  assert.equal(health.tpmTooSmall(unknown, { routeHealthFile: file }), null);
});
