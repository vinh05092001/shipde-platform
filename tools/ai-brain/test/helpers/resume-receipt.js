'use strict';

const crypto = require('node:crypto');
const decisions = require('../../decisions');
const { normalizeReviewForCheckpoint } = require('../../orchestrate');

// Persist the same review/completion evidence that anchors a live receipt.
function resumeReceipt(entry, dir, now) {
  entry.tests = entry.tests || {
    command: 'node --test acceptance.test.js',
    baseExitCode: 1,
    headExitCode: 0,
    outputDigest: crypto
      .createHash('sha256')
      .update('fixture fail before, pass after')
      .digest('hex'),
  };
  const options = { dir, now };
  decisions.recordDecision(
    {
      stage: decisions.Stage.REVIEW,
      workItemId: entry.workItemId,
      sha: entry.sha,
      reviewer: entry.reviewer,
      verdict: 'PASS',
      round: 1,
      roundStage: 'review',
      findings: [],
      repairCount: 0,
    },
    options
  );
  decisions.recordDecision(
    {
      stage: decisions.Stage.COMPLETED,
      workItemId: entry.workItemId,
      reviewedSha: entry.sha,
      repairCount: 0,
      tests: entry.tests,
    },
    options
  );
  return normalizeReviewForCheckpoint(entry, entry.workItemId, options);
}

module.exports = { resumeReceipt };
