const { test } = require('node:test');
const assert = require('node:assert');
const { classifyFailure, upstreamAuthSignal } = require('../failure-classifier');
const { sameFailureDomain } = require('../routing');
const evidence = require('../evidence');
const key = 'gw-shared-key';
const via = { harness: 'paseo', gateway: 'gw', accountId: key, quotaScope: key };
const A = { ...via, upstream: 'up-a', modelId: 'up-a/m', offeringId: 'a' };
const A2 = { ...via, upstream: 'up-a', modelId: 'up-a/n', offeringId: 'a2' };
const B = { ...via, upstream: 'up-b', modelId: 'up-b/m', offeringId: 'b' };
const direct = {
  harness: 'opencode-direct',
  gateway: 'other',
  upstream: 'other',
  accountId: 'other-key',
  modelId: 'other/m',
};
const classify = (extra) =>
  classifyFailure({
    httpStatus: 401,
    body: 'unauthorized',
    accountId: key,
    gateway: 'gw',
    upstream: 'up-a',
    ...extra,
  });
const hits = (c, cls) => Boolean(sameFailureDomain(c, A, cls));

test('a confirmed shared-key failure covers that key and spares a direct source', () => {
  const cls = classify({ authLayer: 'gateway-key' });
  assert.equal(cls.scope, 'account');
  assert.equal(hits(B, cls), true);
  assert.equal(hits(direct, cls), false);
});

test('a confirmed upstream credential failure stays on that upstream', () => {
  const cls = classify({ authLayer: 'upstream-credential' });
  assert.equal(cls.scope, 'upstream');
  assert.equal(hits(A2, cls), true);
  assert.equal(hits(B, cls), false);
});

test('a confirmed connection failure stays on that connection', () => {
  const cls = classify({ authLayer: 'connection', connectionId: 'c1' });
  assert.equal(cls.scope, 'connection');
  assert.equal(hits({ ...A2, connectionId: 'c1' }, cls), true);
  assert.equal(hits({ ...A2, connectionId: 'c2' }, cls), false);
  assert.equal(hits(B, cls), false);
});

test('a bare 401 names no layer and widens to nothing', () => {
  const cls = classify({});
  assert.equal(cls.cause, 'auth_scope_unknown');
  assert.equal(hits(A2, cls), false);
  assert.equal(hits(B, cls), false);
});

test('a direct 401 keeps the account scope', () => {
  const cls = classifyFailure({ httpStatus: 401, body: 'x', accountId: 'k' });
  assert.equal(cls.scope, 'account');
  const self = { ...direct, accountId: 'k' };
  assert.equal(Boolean(sameFailureDomain({ ...self, modelId: 'other/n' }, self, cls)), true);
});

test('stored cooldowns follow the same scope', () => {
  const now = new Date().toISOString();
  const cd = (authLayer) => ({
    cooldowns: {
      k: {
        scope: 'account',
        accountId: key,
        upstream: 'up-a',
        gateway: 'gw',
        authLayer,
        blockReason: '401',
        blockedAt: now,
        lastStatus: 'blocked',
        resetTime: Date.now() + 60000,
      },
    },
  });
  const opts = { loadQuotaState: false };
  assert.equal(evidence.isCandidateBlocked(cd('gateway-key'), B, opts).blocked, true);
  assert.equal(evidence.isCandidateBlocked(cd('gateway-key'), direct, opts).blocked, false);
  assert.equal(evidence.isCandidateBlocked(cd(null), B, opts).blocked, false);
});

// Redacted from real scans on 2026-11-05. Each came through one shared gateway key.
const realErrors = [
  [
    'cc/claude-opus-5-5',
    'cc',
    '[claude/claude-opus-5-5] [401]: {"type":"error","error":{"type":"authentication_error","message":"OAuth access token has expired. Re-authenticate to continue."}}',
  ],
  [
    'cl/meta/muse-spark-1.3',
    'cl',
    '[cline/meta/muse-spark-1.3] [401]: {"error":"Unauthorized: Please make sure you\'re using the latest version of Cline and re-authenticate your Cline account."} (reset after 1m)',
  ],
  [
    'cmc/deepseek/deepseek-v4-pro',
    'cmc',
    '[commandcode/deepseek/deepseek-v4-pro] [401]: Your API key has expired. Log in again to get a new key: run `cmd login`, or create a new key in Command Code Studio. (reset after 2m)',
  ],
  [
    'glm/glm-5.3',
    'glm',
    '[glm/glm-5.3] [401]: {"error":{"code":"401","message":"token expired or incorrect"}} (reset after 2m)',
  ],
];

for (const [modelId, upstream, body] of realErrors) {
  test(`real error on ${modelId} leaves its siblings and other upstreams alone`, () => {
    const failed = { ...via, upstream, modelId, offeringId: 'a' };
    const cls = classifyFailure({
      httpStatus: 401,
      body,
      accountId: key,
      gateway: 'gw',
      upstream,
      modelId,
    });
    assert.equal(cls.authLayer, 'upstream-route');
    assert.equal(cls.cause, 'auth_scope_unknown');
    assert.equal(cls.resetTime, null);
    const sibling = { ...failed, modelId: `${upstream}/other`, offeringId: 'a2' };
    assert.equal(Boolean(sameFailureDomain(sibling, failed, cls)), false);
    assert.equal(Boolean(sameFailureDomain(B, failed, cls)), false);
  });
}

test('the error tag counts only when it matches the failed route', () => {
  const body = realErrors[0][2];
  assert.ok(upstreamAuthSignal(body, { modelId: 'cc/claude-opus-5-5' }));
  assert.equal(upstreamAuthSignal(body, { modelId: 'cc/another' }), null);
  assert.equal(upstreamAuthSignal(body, { modelId: 'vinh' }), null);
  assert.equal(upstreamAuthSignal('[401]: unauthorized', { modelId: 'cc/x' }), null);
  assert.equal(classify({ body, modelId: 'up-a/other' }).authLayer, null);
});

test('a stored connection failure blocks only routes on that connection', () => {
  const data = {
    cooldowns: {
      k: {
        scope: 'connection',
        connectionId: 'c1',
        gateway: 'gw',
        blockReason: '401',
        blockedAt: new Date().toISOString(),
        lastStatus: 'blocked',
        resetTime: Date.now() + 60000,
      },
    },
  };
  const opts = { loadQuotaState: false };
  assert.equal(
    evidence.isCandidateBlocked(data, { ...A2, connectionId: 'c1' }, opts).blocked,
    true
  );
  assert.equal(
    evidence.isCandidateBlocked(data, { ...A2, connectionId: 'c2' }, opts).blocked,
    false
  );
  assert.equal(evidence.isCandidateBlocked(data, B, opts).blocked, false);
});

const scanRow = (over) => ({
  source: 'gw',
  scope: 'gw::up-a',
  upstream: 'up-a',
  code: 'AUTH',
  status: 401,
  at: new Date().toISOString(),
  ttlMs: 3600000,
  ...over,
});
const scanned = (row, c) =>
  evidence.isCandidateBlocked({}, c, { quotaState: { scopes: { 'gw::up-a': row } } }).blocked;

test('a scanned 401 on one model blocks that route only, not its upstream', () => {
  const row = scanRow({ model: 'up-a/m' });
  assert.equal(scanned(row, A), true);
  assert.equal(scanned(row, A2), false);
  assert.equal(scanned(row, B), false);
});

test('an upstream row with no probed model still blocks that upstream', () => {
  const row = scanRow({});
  assert.equal(scanned(row, A2), true);
  assert.equal(scanned(row, B), false);
});

test('a direct source keeps its old auth behaviour, even with a tagged error', () => {
  const route = {
    harness: 'opencode',
    gateway: 'd',
    upstream: 'd',
    accountId: 'k',
    modelId: 'd/m',
  };
  const cls = classifyFailure({
    httpStatus: 401,
    body: '[d/m] [401]: expired',
    accountId: 'k',
    gateway: 'd',
    upstream: 'd',
    modelId: 'd/m',
  });
  assert.equal(cls.scope, 'account');
  assert.equal(Boolean(sameFailureDomain({ ...route, modelId: 'd/n' }, route, cls)), true);
  const row = {
    source: 'd',
    scope: 'd',
    upstream: 'd',
    model: 'd/m',
    code: 'AUTH',
    status: 401,
    at: new Date().toISOString(),
    ttlMs: 3600000,
  };
  const quotaState = { scopes: { d: row, 'd::d': row } };
  const sibling = { ...route, modelId: 'd/n' };
  assert.equal(evidence.isCandidateBlocked({}, sibling, { quotaState }).blocked, true);
});

test('a connection layer without a confirmed ID stays unknown', () => {
  const cls = classify({ authLayer: 'connection' });
  assert.equal(cls.scope, 'unknown');
  assert.equal(cls.cause, 'auth_scope_unknown');
  assert.equal(cls.connectionId, null);
});

test('a combo route cannot tell which member failed, so it stays unknown', () => {
  const body = realErrors[0][2];
  const cls = classifyFailure({
    httpStatus: 401,
    body,
    accountId: key,
    gateway: 'gw',
    upstream: 'vinh',
    modelId: 'vinh',
  });
  assert.equal(cls.cause, 'auth_scope_unknown');
  assert.equal(cls.authLayer, null);
});
