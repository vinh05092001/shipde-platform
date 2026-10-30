'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  attachReceiptIntegrity,
  extractCheckpointReview,
  verifyReceiptIntegrity,
  draftTitleForItem,
} = require('../orchestrate');

const SHA = 'e'.repeat(40);

function receipt(draftTitle) {
  return attachReceiptIntegrity({
    workItemId: 'FEAT-X-01',
    sha: SHA,
    baseSha: 'a'.repeat(40),
    verdict: 'PASS',
    reviewer: 'r',
    writerCandidateKey: 'w',
    workerRoot: 'C:\w',
    publishCwd: 'C:/p',
    branch: 'feat/feat-x-01',
    draftTitle,
    tests: null,
    reviewRounds: 1,
    repairCount: 0,
    openFindings: 0,
    decisionLog: { dir: 'd' },
  });
}

test('a stored receipt whose title ends in a space still verifies after checkpoint extraction', () => {
  const stored = receipt('[FEAT-X-01] A title cut at the limit ');
  assert.strictEqual(verifyReceiptIntegrity(stored), null);
  const rec = extractCheckpointReview({ reviews: [stored] }, 'FEAT-X-01');
  assert.strictEqual(verifyReceiptIntegrity(rec), null);
});

test('a tampered title is still refused', () => {
  const stored = receipt('[FEAT-X-01] Title ');
  stored.draftTitle = '[FEAT-X-01] Other';
  const rec = extractCheckpointReview({ reviews: [stored] }, 'FEAT-X-01');
  assert.match(verifyReceiptIntegrity(rec), /integrity mismatch/);
});

test('a truncated draft title never ends in whitespace', () => {
  const title = draftTitleForItem({ id: 'FEAT-X-01', outcome: 'word '.repeat(30) });
  assert.ok(title.length <= 72);
  assert.strictEqual(title, title.trimEnd());
});

test('a reviewer key with no gateway segment is a valid 7-part key, but other empty segments are not', () => {
  const { candidateKeyParts } = require('../review-manifest');
  assert.ok(
    candidateKeyParts('agy-pool::ShipDe\ShipDe-agy06::::antigravity::agy06::agy06:gemini::m')
  );
  assert.strictEqual(candidateKeyParts('a::b::c::::e::f::g'), null);
  assert.strictEqual(candidateKeyParts('a::b::c::d::e::f'), null);
});
