'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { eligibleCandidates, runAutomaticQualification } = require('../qualification-auto');

const SHA = 'a'.repeat(40);
const fixtures = [];
const CANDIDATE = {
  candidateKey: 'hermes::cli::gw::up::acct::acct::model',
  status: 'rejected',
  rejectionReasons: ['PROOF_FLOOR_NOT_MET'],
};

function fixture() {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.task-ai-141b-'));
  fixtures.push(dir);
  const itemsFile = path.join(dir, 'items.json');
  const usageFile = path.join(dir, 'usage.json');
  fs.writeFileSync(
    itemsFile,
    JSON.stringify([
      {
        id: 'QUALIFY-01',
        kind: 'qualification',
        risk: 'low',
        acceptanceCriteria: ['review'],
      },
    ])
  );
  return { dir, itemsFile, usageFile };
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('qualification selects only candidates rejected solely below proof floor', () => {
  assert.deepEqual(
    eligibleCandidates([
      CANDIDATE,
      { ...CANDIDATE, rejectionReasons: ['PROOF_FLOOR_NOT_MET', 'QUOTA_EXHAUSTED'] },
      { ...CANDIDATE, blocked: true },
      { ...CANDIDATE, status: 'ranked' },
    ]),
    [CANDIDATE]
  );
});

test('qualification respects run and daily caps and records only exact-SHA independent PASS', async () => {
  const f = fixture();
  const evidence = [];
  const args = {
    candidates: [CANDIDATE, { ...CANDIDATE, candidateKey: 'second' }],
    itemsFile: f.itemsFile,
    usageFile: f.usageFile,
    evidenceDir: f.dir,
    config: { perRun: 2, perDay: 1 },
    now: Date.parse('2026-10-10T12:00:00Z'),
    recordEvidence: (candidate, proof) => evidence.push({ candidate, proof }),
    runIsolatedReviewed: async () => ({
      verdict: 'PASS',
      sha: SHA,
      reviewedSha: SHA,
      reviewer: 'independent-reviewer',
      independent: true,
    }),
  };
  const result = await runAutomaticQualification(args);
  assert.equal(result.selected, 1);
  assert.equal(result.qualified.length, 1);
  assert.equal(evidence[0].proof.proofLevel, 'WORK_ITEM_PASS');
  assert.equal(evidence[0].proof.reviewedSha, SHA);
  assert.equal(JSON.parse(fs.readFileSync(f.usageFile, 'utf8'))['2026-10-10'].length, 1);
});

test('no product item and no mismatched review SHA can grant evidence', async () => {
  const f = fixture();
  for (const receipt of [
    {
      verdict: 'PASS',
      sha: SHA,
      reviewedSha: 'b'.repeat(40),
      reviewer: 'reviewer',
      independent: true,
    },
    {
      verdict: 'PASS',
      sha: SHA,
      reviewedSha: SHA,
      reviewer: 'reviewer',
      independent: true,
      productItem: true,
    },
  ]) {
    let recorded = false;
    await runAutomaticQualification({
      candidates: [CANDIDATE],
      itemsFile: f.itemsFile,
      usageFile: path.join(f.dir, Math.random() + '.json'),
      now: Date.parse('2026-10-10T12:00:00Z'),
      recordEvidence: () => {
        recorded = true;
      },
      runIsolatedReviewed: async () => receipt,
    });
    assert.equal(recorded, false);
  }
});
