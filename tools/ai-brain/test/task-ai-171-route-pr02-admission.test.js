'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assembleForDispatch } = require('../cli');
const { candidateKey } = require('../candidates');
const { launchFromDecision } = require('../route-handoff');
const registry = {
  sources: [],
  dispatch: { providers: {} },
};
const row = (over = {}) => ({
  harness: 'paseo',
  accessPath: 'cli',
  gateway: 'fixture-router',
  upstream: 'vendor',
  source: 'fixture-router',
  accountId: 'lane-a',
  quotaScope: 'lane-a',
  modelId: 'vendor/Case/mini:free',
  ...over,
});
const assemble = (candidates, over = {}) =>
  assembleForDispatch({ candidates: [] }, [], registry, {
    candidates,
    evidenceData: {},
    offerings: [],
    registryAccounts: [],
    discoverPool: false,
    routeHealth: { version: 1, paths: {}, events: [] },
    probeEvidence: (modelId, route) =>
      candidates.some(
        (candidate) =>
          candidate.modelId === modelId &&
          candidate.gateway === route.id &&
          candidate.accountId === route.accountId
      ),
    ...over,
  });

test('PR02: delimiter and percent components cannot collapse separate route identities', () => {
  const { mergeCandidates } = require('../candidates');
  const { parseCandidateKey } = require('../discovery/identity');
  const a = row({ accountId: 'lane::part', quotaScope: 'quota', modelId: 'vendor/A%3A::B' });
  const b = row({ accountId: 'lane', quotaScope: 'part::quota', modelId: a.modelId });
  assert.equal(mergeCandidates([a], [b]).length, 2);
  assert.equal(parseCandidateKey(candidateKey(a)).modelId, a.modelId);
  assert.equal(parseCandidateKey(candidateKey(a)).account, a.accountId);
  const boundary = row({ accessPath: 'http://fixture.invalid/v1', accountId: ':lane:' });
  assert.equal(parseCandidateKey(candidateKey(boundary)).account, boundary.accountId);
  assert.equal(parseCandidateKey(candidateKey(boundary)).accessPath, boundary.accessPath);
});
