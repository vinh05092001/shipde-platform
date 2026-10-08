'use strict';

/**
 * Ship Dễ — TASK-AI-125: tests for P2 follow-ups.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDraftBody } = require('../publisher');
const { normalizeReviewForCheckpoint } = require('../orchestrate');

test('TASK-AI-125: a finding whose id contains <x> produces a body that does not match /<[^>\\n]+>/', () => {
  const manifest = {
    verdict: 'PASS',
    reviewedCommit: '1234567890123456789012345678901234567890',
    writerCandidateKey: 'w',
    reviewerCandidateKey: 'r',
    tests: [{ command: 'npm test', result: 'pass' }],
    findings: [{ id: '<x> injected', status: 'resolved', summary: 'test' }],
  };
  const evidence = {
    workItemId: 'FEAT-1',
    reviewManifest: 'path/to/manifest',
    reviewArtifact: 'path/to/artifact',
    decisionEvidence: 'path/to/decision',
    failBefore: { command: 'test', exitCode: 1 },
    outcome: 'outcome',
  };
  const body = buildDraftBody(manifest, evidence);

  // The gate regex from the spec
  const CONTRACT_GATE_BODY_PATTERN = /<[^>\n]+>/;
  assert.ok(!CONTRACT_GATE_BODY_PATTERN.test(body), 'Body should not contain un-neutralised <...>');
  assert.ok(body.includes('‹x› injected'), 'Body should contain neutralised finding id');
});

test('TASK-AI-125: normalizeReviewForCheckpoint gives the goal-based draftTitle, not a ReferenceError and not "work item"', () => {
  const entry = {
    sha: '1234567890123456789012345678901234567890',
    item: { id: 'TASK-AI-125' },
  };
  const workItemId = 'TASK-AI-125';
  const logOpts = { goal: 'the true goal' };

  const result = normalizeReviewForCheckpoint(entry, workItemId, logOpts);
  assert.ok(result !== null);
  assert.equal(result.draftTitle, '[TASK-AI-125] the true goal');
});
