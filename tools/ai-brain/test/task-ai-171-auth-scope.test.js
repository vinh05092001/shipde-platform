const { test } = require('node:test');
const assert = require('node:assert');
const { classifyFailure } = require('../failure-classifier');
const { sameFailureDomain } = require('../routing');
const evidence = require('../evidence');
const handoff = require('../route-handoff');

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

const registry = {
  sources: [{ id: 'gw', kind: 'router', servesModels: true, endpoint: 'http://127.0.0.1:1/v1' }],
  dispatch: {
    launchModes: { opencode: ['full-access'] },
    providers: { gw: { harness: 'paseo', provider: 'opencode', modelPrefix: 'gateway/' } },
  },
};
const proofOf = (c) => ({
  modelId: c.modelId,
  gateway: c.gateway,
  accountId: c.accountId,
  evidence: [{ status: 'passed', proofLevel: 'WORK_ITEM_PASS', at: new Date().toISOString() }],
});
const run = (failure, ticketOver) => {
  const decision = { workItemId: 'W', selected: 'a', candidates: [A, B] };
  const ticket = {
    workItemId: 'W',
    outputTokens: 1,
    minProof: 'HARNESS_PASS',
    maxFallbacks: 1,
    request: { prompt: 'p', branch: 'b', base: 'origin/main', cwd: 'wt', title: 't' },
    ...ticketOver,
  };
  const ctx = {
    evidenceData: { combinations: [A, B].map(proofOf) },
    ledger: {},
    now: Date.now(),
  };
  const first = handoff.firstLaunch(decision, ticket, ctx, registry);
  const next = handoff.afterFailure(
    decision,
    ticket,
    ctx,
    { offeringId: 'a', upstream: 'up-a', status: 401, ...failure },
    registry
  );
  return { first, next, ledger: ctx.ledger };
};

test('a bare 401 records AUTH_SCOPE_UNKNOWN, drops A and moves only to a screened B', () => {
  const { first, next, ledger } = run({});
  assert.equal(first.action, 'LAUNCH');
  assert.equal(ledger.failures[0].class, 'AUTH_SCOPE_UNKNOWN');
  assert.equal(next.action, 'LAUNCH');
  assert.match(next.launch.args.join(' '), /up-b\/m/);
  assert.ok(next.rejected.some((r) => r.offeringId === 'a'));
  assert.equal(ledger.fallbacksUsed, 1);
});

test('a bare 401 does not move when the ticket has no fallback left', () => {
  const { next } = run({}, { maxFallbacks: 0 });
  assert.equal(next.action, 'STOP');
  assert.equal(next.reason, 'FALLBACK_LIMIT');
});

test('a confirmed shared-key failure leaves no route on that key', () => {
  const { next, ledger } = run({ authLayer: 'gateway-key' });
  assert.equal(ledger.failures[0].class, 'GATEWAY_KEY_AUTH');
  assert.equal(next.action, 'BLOCKED');
  assert.ok(next.rejected.some((r) => r.reason === 'GATEWAY_KEY_AUTH'));
});
