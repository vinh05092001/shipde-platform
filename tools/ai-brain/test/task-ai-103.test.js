'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const cli = require('../cli');
const candidatesApi = require('../candidates');
const routing = require('../routing');

function candidate(overrides = {}) {
  return {
    harness: 'harness-a',
    accessPath: 'access-a',
    gateway: 'gateway-a',
    upstream: 'upstream-a',
    accountId: 'account-a',
    modelId: 'model-a',
    ...overrides,
  };
}

function expectedCanonicalMatch(left, right, scope, cause) {
  if (scope === 'harness' && cause === 'launch_config') return false;
  if (scope === 'gateway') {
    if (!left.gateway || !right.gateway || left.gateway === '*' || right.gateway === '*')
      return false;
    return (
      routing.canonicalFailureDomain(left.gateway) === routing.canonicalFailureDomain(right.gateway)
    );
  }
  if (scope === 'upstream') {
    if (left.gateway === '*' || right.gateway === '*') return false;
    return routing.failureDomainOf(left) === routing.failureDomainOf(right);
  }
  if (scope === 'account') {
    return Boolean(
      left.accountId &&
      right.accountId &&
      left.accountId !== '*' &&
      right.accountId !== '*' &&
      routing.canonicalFailureDomain(left.accountId) ===
        routing.canonicalFailureDomain(right.accountId)
    );
  }
  if (scope === 'model' || scope === 'candidate') {
    return (
      routing.failureDomainOf(left) === routing.failureDomainOf(right) &&
      Boolean(
        (left.modelId || left.model) &&
        (left.modelId || left.model) === (right.modelId || right.model)
      )
    );
  }
  if (scope === 'access_path')
    return Boolean(left.accessPath && left.accessPath === right.accessPath);
  if (scope === 'harness') return Boolean(left.harness && left.harness === right.harness);
  return false;
}

function blocked(candidateValue, failedValue, scope, cause) {
  return cli.sameFailureDomain(candidateValue, failedValue, { scope, cause });
}

describe('TASK-AI-103 canonical failure-domain blocking', () => {
  test('gateway scope blocks only candidates on the same gateway', () => {
    const failed = candidate();
    assert.equal(blocked(candidate({ upstream: 'upstream-b' }), failed, 'gateway'), true);
    assert.equal(blocked(candidate({ gateway: 'gateway-b' }), failed, 'gateway'), false);
  });

  test('upstream scope includes gateway and upstream but not account', () => {
    const failed = candidate();
    assert.equal(blocked(candidate({ accountId: 'account-b' }), failed, 'upstream'), true);
    assert.equal(blocked(candidate({ gateway: 'gateway-b' }), failed, 'upstream'), false);
    assert.equal(blocked(candidate({ upstream: 'upstream-b' }), failed, 'upstream'), false);
  });

  test('account scope matches only the same concrete account', () => {
    const failed = candidate();
    assert.equal(blocked(candidate(), failed, 'account'), true);
    assert.equal(blocked(candidate({ accountId: 'account-b' }), failed, 'account'), false);
    assert.equal(blocked(candidate({ accountId: '*' }), failed, 'account'), false);
    assert.equal(blocked(failed, candidate({ accountId: '*' }), 'account'), false);
  });

  test('model and candidate scopes require both the same route and model', () => {
    const failed = candidate();
    for (const scope of ['model', 'candidate']) {
      assert.equal(blocked(candidate(), failed, scope), true);
      assert.equal(blocked(candidate({ gateway: 'gateway-b' }), failed, scope), false);
      assert.equal(blocked(candidate({ modelId: 'model-b' }), failed, scope), false);
    }
  });

  test('launch-config harness scope does not block a candidate', () => {
    const failed = candidate();
    assert.equal(blocked(candidate(), failed, 'harness', 'launch_config'), false);
  });

  test('cli blocking decisions agree with routing canonical decisions for every scope', () => {
    const failed = candidate();
    const comparisons = [
      ['gateway', candidate({ upstream: 'upstream-b' })],
      ['gateway', candidate({ gateway: 'gateway-b' })],
      ['upstream', candidate({ accountId: 'account-b' })],
      ['upstream', candidate({ gateway: 'gateway-b' })],
      ['account', candidate()],
      ['account', candidate({ accountId: '*' })],
      ['model', candidate()],
      ['model', candidate({ modelId: 'model-b' })],
      ['candidate', candidate({ gateway: 'gateway-b' })],
      ['candidate', candidate({ modelId: 'model-b' })],
      ['access_path', candidate({ accessPath: 'access-b' })],
      ['harness', candidate({ harness: 'harness-b' })],
      ['harness', candidate()],
      ['unknown', candidate()],
    ];
    for (const [scope, other] of comparisons) {
      const cause = scope === 'harness' ? 'launch_config' : undefined;
      assert.equal(
        blocked(other, failed, scope, cause),
        expectedCanonicalMatch(other, failed, scope, cause),
        `${scope}: canonical scope comparison`
      );
    }
  });

  test('applying the same failure twice preserves block metadata and leaves other domains open', () => {
    const failed = candidate();
    const sameDomain = candidate({ accountId: 'account-b' });
    const otherDomain = candidate({ gateway: 'gateway-b' });
    const entries = [failed, sameDomain, otherDomain];
    const failedKeys = new Set([candidatesApi.candidateKey(failed)]);
    const classification = { scope: 'upstream', cause: 'upstream_rate_limit' };

    cli.applyFailureBlocks(entries, failedKeys, failed, classification, true, cli.LIVE_BLOCK_CODES);
    const metadata = {
      blocked: sameDomain.blocked,
      blockReason: sameDomain.blockReason,
      blockScope: sameDomain.blockScope,
    };
    cli.applyFailureBlocks(entries, failedKeys, failed, classification, true, cli.LIVE_BLOCK_CODES);

    assert.deepEqual(
      {
        blocked: sameDomain.blocked,
        blockReason: sameDomain.blockReason,
        blockScope: sameDomain.blockScope,
      },
      metadata
    );
    assert.equal(failed.blockReason, cli.LIVE_BLOCK_CODES.failed);
    assert.equal(otherDomain.blocked, undefined);
  });
});
