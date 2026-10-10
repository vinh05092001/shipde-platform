'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  eligibleCandidates,
  loadItems,
  runAutomaticQualification,
  runAutoCli,
} = require('../qualification-auto');
const { nextLoop } = require('../next-runner');

const SHA = 'a'.repeat(40);
const fixtures = [];
const CANDIDATE = {
  candidateKey: 'hermes::cli::gw::up::acct::acct::model',
  commit: SHA,
  harness: 'hermes',
  accessPath: 'cli',
  gateway: 'gw',
  upstream: 'up',
  accountId: 'acct',
  quotaScope: 'acct',
  modelId: 'model',
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
    recordEvidence: (candidateKey, candidate, proof) =>
      evidence.push({ candidateKey, candidate, proof }),
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
  assert.equal(evidence[0].candidateKey, CANDIDATE.candidateKey);
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

test('qualification evidence is bound to candidate commit and exact candidate key', async () => {
  const f = fixture();
  const candidate = { ...CANDIDATE, commit: 'c'.repeat(40) };
  let recordedKey;
  let runnerArgs;
  await runAutomaticQualification({
    candidates: [candidate],
    itemsFile: f.itemsFile,
    usageFile: f.usageFile,
    now: Date.parse('2026-10-10T12:00:00Z'),
    recordEvidence: (key, item, proof) => {
      recordedKey = key;
      assert.equal(item, candidate);
      assert.equal(proof.commit, candidate.commit);
    },
    runIsolatedReviewed: async (args) => {
      runnerArgs = args;
      return {
        verdict: 'PASS',
        sha: candidate.commit,
        reviewedSha: candidate.commit,
        reviewer: 'reviewer',
        independent: true,
      };
    },
  });
  assert.equal(runnerArgs.expectedCommit, candidate.commit);
  assert.equal(recordedKey, candidate.candidateKey);

  let recorded = false;
  await runAutomaticQualification({
    candidates: [candidate],
    itemsFile: f.itemsFile,
    usageFile: path.join(f.dir, 'other.json'),
    now: Date.parse('2026-10-10T12:00:00Z'),
    recordEvidence: () => {
      recorded = true;
    },
    runIsolatedReviewed: async () => ({
      verdict: 'PASS',
      sha: SHA,
      reviewedSha: SHA,
      reviewer: 'reviewer',
      independent: true,
    }),
  });
  assert.equal(recorded, false);
});

test('qualification runner output can never request an automatic merge', async () => {
  const f = fixture();
  const result = await runAutomaticQualification({
    candidates: [CANDIDATE],
    itemsFile: f.itemsFile,
    usageFile: f.usageFile,
    now: Date.parse('2026-10-10T12:00:00Z'),
    recordEvidence: () => {},
    runIsolatedReviewed: async () => ({
      verdict: 'PASS',
      sha: SHA,
      reviewedSha: SHA,
      reviewer: 'reviewer',
      independent: true,
      autoMerge: true,
      merge: true,
    }),
  });
  assert.equal(Object.hasOwn(result, 'autoMerge'), false);
  assert.equal(Object.hasOwn(result, 'merge'), false);
});

test('missing isolated reviewer fails closed with a ran qualification result', async () => {
  const result = await runAutomaticQualification({ candidates: [CANDIDATE] });
  assert.equal(result.reason, 'QUALIFICATION_RUNNER_UNAVAILABLE');
  assert.equal(result.ran, true);
  assert.deepEqual(result.qualified, []);
});

test('evidence module fallback records the exact candidate proof', async () => {
  const f = fixture();
  const proof = await runAutomaticQualification({
    candidates: [CANDIDATE],
    itemsFile: f.itemsFile,
    usageFile: f.usageFile,
    evidenceDir: f.dir,
    runIsolatedReviewed: async () => ({
      verdict: 'PASS',
      sha: SHA,
      reviewedSha: SHA,
      reviewer: 'reviewer',
      independent: true,
    }),
  });
  assert.equal(proof.qualified.length, 1);
  const evidence = require('../evidence');
  const records = evidence.loadEvidence(f.dir);
  assert.ok(
    records.combinations.some(
      (combo) =>
        require('../candidates').candidateKey(combo) === CANDIDATE.candidateKey &&
        combo.evidence.some(
          (record) => record.proofLevel === 'WORK_ITEM_PASS' && record.commit === SHA
        )
    )
  );
});

test('loadItems rejects malformed qualification definitions', () => {
  const f = fixture();
  fs.writeFileSync(f.itemsFile, JSON.stringify([{ id: 'bad', kind: 'product', risk: 'high' }]));
  assert.throws(() => loadItems(f.itemsFile), /QUALIFICATION_ITEMS_INVALID/);
});

test('auto CLI accepts only exact --auto argv token', async () => {
  const f = fixture();
  const candidatesFile = path.join(f.dir, 'candidates.json');
  fs.writeFileSync(candidatesFile, JSON.stringify([]));
  assert.equal(await runAutoCli(['--auto-foo', '--candidates', candidatesFile], {}), 2);
  assert.equal(await runAutoCli(['--candidates', '--auto', candidatesFile], {}), 2);
  assert.equal(await runAutoCli(['--auto', '--candidates'], {}), 2);
  assert.equal(await runAutoCli(['--auto', '--auto', '--candidates', candidatesFile], {}), 2);
  assert.equal(
    await runAutoCli(['--auto', '--candidates', candidatesFile, '--items', f.itemsFile], {
      usageFile: f.usageFile,
      runIsolatedReviewed: async () => null,
      out: () => {},
    }),
    0
  );
});

test('next loop accepts completed qualification slot when no product item is ready', async () => {
  const logs = [];
  const result = await nextLoop(
    {
      maxIterations: 1,
      rootDir: process.cwd(),
      records: [],
      qualificationSlot: async () => ({
        status: 'completed',
        ran: true,
        selected: 1,
        qualified: [],
      }),
    },
    {
      existsSync: () => false,
      items: [],
      log: (line) => logs.push(line),
      now: Date.parse('2026-10-10T12:00:00Z'),
    }
  );
  assert.equal(result.qualification.ran, true);
  assert.equal(result.completed, true);
  assert.ok(logs.some((line) => line.includes('QUALIFICATION_SLOT')));
});
