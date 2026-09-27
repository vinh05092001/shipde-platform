'use strict';

/**
 * Ship Dễ — Failure Classifier Outcome Path Integration Tests
 *
 * Tests the connection between the failure classifier and the outcome path:
 *   - an outer 503 wrapping 402 cools down the upstream and leaves another upstream eligible;
 *   - a 401 on one account leaves another account on the same upstream eligible;
 *   - a 404 excludes that model on that access path only;
 *   - an unrecognised failure cools down only its own candidate;
 *   - a spawn failure is recorded with no httpStatus;
 *   - after a failure is classified, the chooser's next ranking reflects it.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const evidence = require('../evidence');
const candidates = require('../candidates');
const ranking = require('../ranking');

describe('failure classifier outcome path', () => {
  test('an outer 503 wrapping 402 cools down the upstream and leaves another upstream eligible', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-wrap402-'));
    const candA = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'upstream-a',
      accountId: '*',
      quotaScope: 'upstream-a',
      modelId: 'upstream-a/model-1',
    };
    const candB = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'upstream-b',
      accountId: '*',
      quotaScope: 'upstream-b',
      modelId: 'upstream-b/model-2',
    };

    // Outer 503 wrapping 402 on upstream-a
    evidence.recordProbe(dir, candA, {
      status: 'failed',
      httpStatus: 503,
      body: '[upstream-a/model-1] [402]: {"error": "the provider has run out of credit"}',
    });

    const data = evidence.loadEvidence(dir);

    // upstream-a is cooled down / blocked with 402 cause and upstream scope
    const blockA = evidence.isCandidateBlocked(data, candA);
    assert.equal(blockA.blocked, true, 'candA must be blocked');
    assert.equal(blockA.scope, 'upstream', 'scope must be upstream');
    assert.match(blockA.reason, /402|credit_exhausted/, 'reason must reflect innermost 402 cause');

    const upBlockA = evidence.isUpstreamBlocked(data, 'upstream-a');
    assert.equal(upBlockA.blocked, true, 'upstream-a must be blocked');
    assert.equal(upBlockA.scope, 'upstream', 'upstream-a scope must be upstream');

    // upstream-b is NOT blocked and remains eligible
    const blockB = evidence.isCandidateBlocked(data, candB);
    assert.equal(blockB.blocked, false, 'candB on upstream-b must remain eligible');

    const upBlockB = evidence.isUpstreamBlocked(data, 'upstream-b');
    assert.equal(upBlockB.blocked, false, 'upstream-b must not be blocked');
  });

  test('a 401 on one account leaves another account on the same upstream eligible', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-acc401-'));
    const candA = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-4o',
    };
    const candB = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-2',
      quotaScope: 'acc-2',
      modelId: 'gh/gpt-4o',
    };

    // Outer 503 wrapping 401 on acc-1
    evidence.recordProbe(dir, candA, {
      status: 'failed',
      httpStatus: 503,
      body: '[gh/gpt-4o] [401]: {"error": "Unauthorized: invalid token for acc-1"}',
    });

    const data = evidence.loadEvidence(dir);

    // Candidate A (acc-1) is blocked with account scope
    const blockA = evidence.isCandidateBlocked(data, candA);
    assert.equal(blockA.blocked, true, 'candA (acc-1) must be blocked');
    assert.equal(blockA.scope, 'account', 'scope must be account, not upstream');

    // Upstream gh is NOT blocked
    const upBlock = evidence.isUpstreamBlocked(data, 'gh');
    assert.equal(upBlock.blocked, false, 'upstream gh must not be blocked by single account 401');

    // Candidate B (acc-2) on the same upstream gh is eligible
    const blockB = evidence.isCandidateBlocked(data, candB);
    assert.equal(blockB.blocked, false, 'candB (acc-2) on same upstream must remain eligible');
  });

  test('a 404 excludes that model on that access path only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-404-'));
    const candA = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: '*',
      quotaScope: 'gh',
      modelId: 'gh/gpt-4.1-2025-04-14',
    };
    const candB = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: '*',
      quotaScope: 'gh',
      modelId: 'gh/gpt-4o',
    };
    const candC = {
      harness: 'opencode',
      accessPath: 'cli',
      gateway: '',
      upstream: 'gh',
      accountId: '*',
      quotaScope: 'gh',
      modelId: 'gh/gpt-4.1-2025-04-14',
    };

    // 404 (outer 503 wrapping 404 or direct 404) on candA
    evidence.recordProbe(dir, candA, {
      status: 'failed',
      httpStatus: 503,
      body: '[9router/gh/gpt-4.1-2025-04-14] [404]: Model not found',
    });

    const data = evidence.loadEvidence(dir);

    // candA is blocked on that access path
    const blockA = evidence.isCandidateBlocked(data, candA);
    assert.equal(blockA.blocked, true, 'candA must be excluded');
    assert.equal(blockA.scope, 'access_path', 'scope must be access_path');

    // candB on the same access path with a different model is NOT blocked
    const blockB = evidence.isCandidateBlocked(data, candB);
    assert.equal(
      blockB.blocked,
      false,
      'candB (different model on same access path) must remain eligible'
    );

    // candC on a different access path with the same model is NOT blocked
    const blockC = evidence.isCandidateBlocked(data, candC);
    assert.equal(
      blockC.blocked,
      false,
      'candC (same model on different access path) must remain eligible'
    );

    // Upstream gh is NOT blocked
    const upBlock = evidence.isUpstreamBlocked(data, 'gh');
    assert.equal(upBlock.blocked, false, 'upstream gh must not be blocked by a 404');
  });

  test('an unrecognised failure cools down only its own candidate', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-unknown-'));
    const candA = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-4o',
    };
    const candB = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-3.5',
    };

    // Unrecognised failure on candA
    evidence.recordProbe(dir, candA, {
      status: 'failed',
      httpStatus: 500,
      body: 'Internal server error: unexpected panic in worker runtime',
    });

    const data = evidence.loadEvidence(dir);

    // candA is blocked
    const blockA = evidence.isCandidateBlocked(data, candA);
    assert.equal(blockA.blocked, true, 'candA must be cooled down');
    assert.ok(
      blockA.scope === 'unknown' || blockA.scope === 'candidate',
      'scope must be unknown/candidate'
    );

    // candB (sibling candidate) is NOT blocked
    const blockB = evidence.isCandidateBlocked(data, candB);
    assert.equal(
      blockB.blocked,
      false,
      'candB must NOT be cooled down by candA unrecognised failure'
    );

    // Upstream is NOT blocked
    const upBlock = evidence.isUpstreamBlocked(data, 'gh');
    assert.equal(upBlock.blocked, false, 'upstream gh must not be blocked');

    // Expired after 5 minutes cooldown
    const future = Date.now() + 5 * 60 * 1000 + 1000;
    const blockAExpired = evidence.isCandidateBlocked(data, candA, { now: future });
    assert.equal(blockAExpired.blocked, false, 'unknown cooldown must expire after 5 minutes');
  });

  test('a spawn failure is recorded with no httpStatus', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-spawn-'));
    const candA = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-4o',
    };

    // Spawn failure: process exit with no HTTP response
    evidence.recordProbe(dir, candA, {
      status: 'failed',
      exitCode: 127,
      stderr: 'spawn ENOENT: executable not found',
    });

    const data = evidence.loadEvidence(dir);
    const evList = evidence.getEvidence(data, candA);
    assert.equal(evList.length, 1);
    const evItem = evList[0];

    // Must carry no httpStatus
    assert.equal('httpStatus' in evItem, false, 'evidence item must have no httpStatus property');
    assert.equal(evItem.httpStatus, undefined, 'httpStatus must be undefined');

    // Must record process exit
    assert.equal(evItem.exitCode, 127, 'exitCode must be recorded as 127');
    assert.equal(evItem.status, 'failed');

    // Candidate is cooled down
    const blockA = evidence.isCandidateBlocked(data, candA);
    assert.equal(blockA.blocked, true, 'candA must be cooled down after spawn failure');
  });

  test("after a failure is classified, the chooser's next ranking reflects it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-rank-'));
    const cand1 = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-4o',
      qualifiedRoles: ['author.foundation'],
      cost: 10,
    };
    const cand2 = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'kr',
      accountId: 'acc-2',
      quotaScope: 'acc-2',
      modelId: 'kr/claude-sonnet',
      qualifiedRoles: ['author.foundation'],
      cost: 20,
    };

    // Initial state: both are eligible, cand1 ranks first (lower cost, equal otherwise)
    const evData0 = evidence.loadEvidence(dir);
    const annotated0 = candidates.annotateCandidates([cand1, cand2], evData0);
    const decision0 = ranking.rankAndRecord(annotated0, {
      workItemId: 'TASK-RANK-01',
      role: 'author.foundation',
      dryRun: true,
      explorationBudget: 1,
    });
    assert.equal(decision0.chosen, candidates.candidateKey(cand1), 'cand1 chosen initially');

    // cand1 fails with classified 404 model not found
    evidence.recordProbe(dir, cand1, {
      status: 'failed',
      httpStatus: 404,
      body: 'Model not found: gh/gpt-4o',
    });

    // Next loop: re-load evidence, annotate candidates, and re-rank
    const evData1 = evidence.loadEvidence(dir);
    const annotated1 = candidates.annotateCandidates([cand1, cand2], evData1);
    assert.equal(annotated1[0].blocked, true, 'cand1 must be marked blocked');
    assert.equal(annotated1[1].blocked, false, 'cand2 must remain unblocked');

    const decision1 = ranking.rankAndRecord(annotated1, {
      workItemId: 'TASK-RANK-01-retry',
      role: 'author.foundation',
      dryRun: true,
      explorationBudget: 1,
    });

    // Next ranking reflects the failure: cand1 is rejected as blocked, cand2 is chosen
    assert.equal(
      decision1.chosen,
      candidates.candidateKey(cand2),
      'cand2 chosen after cand1 failure'
    );
    const rej1 = decision1.rejected.find((r) => r.offeringId === candidates.candidateKey(cand1));
    assert.ok(rej1, 'cand1 must appear in rejected list');
    assert.match(
      rej1.reason,
      /alias_mismatch|404|blocked/,
      'rejection reason reflects the classified failure'
    );
  });
});
