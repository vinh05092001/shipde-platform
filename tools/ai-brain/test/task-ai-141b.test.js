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
const { assertIsolationClosed } = require('../intake');
const cli = require('../cli');

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
    isolationVerdict: { verdict: 'CLOSED' },
    now: Date.parse('2026-10-10T12:00:00Z'),
    recordEvidence: (candidateKey, candidate, proof) =>
      evidence.push({ candidateKey, candidate, proof }),
    runIsolatedReviewed: async () => ({
      verdict: 'PASS',
      sha: SHA,
      reviewedSha: SHA,
      reviewer: 'independent-reviewer',
      independent: true,
      workItemId: 'QUALIFY-01',
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

test('qualification receipt is matched to the selected configured item id', async () => {
  const f = fixture();
  const evidence = [];
  const result = await runAutomaticQualification({
    candidates: [CANDIDATE],
    itemsFile: f.itemsFile,
    usageFile: f.usageFile,
    now: Date.parse('2026-10-10T12:00:00Z'),
    isolationVerdict: { verdict: 'CLOSED' },
    recordEvidence: (...args) => evidence.push(args),
    runIsolatedReviewed: async () => ({
      verdict: 'PASS',
      sha: SHA,
      reviewedSha: SHA,
      reviewer: 'independent-reviewer',
      independent: true,
      workItemId: 'QUALIFY-01',
    }),
  });
  assert.equal(result.qualified.length, 1);
  assert.equal(evidence.length, 1);
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
      workItemId: 'QUALIFY-01',
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
      isolationVerdict: { verdict: 'CLOSED' },
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
    isolationVerdict: { verdict: 'CLOSED' },
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
        workItemId: 'QUALIFY-01',
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
      workItemId: 'QUALIFY-01',
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
    isolationVerdict: { verdict: 'CLOSED' },
    recordEvidence: () => {},
    runIsolatedReviewed: async () => ({
      verdict: 'PASS',
      sha: SHA,
      reviewedSha: SHA,
      reviewer: 'reviewer',
      independent: true,
      workItemId: 'QUALIFY-01',
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
    isolationVerdict: { verdict: 'CLOSED' },
    runIsolatedReviewed: async () => ({
      verdict: 'PASS',
      sha: SHA,
      reviewedSha: SHA,
      reviewer: 'reviewer',
      independent: true,
      workItemId: 'QUALIFY-01',
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
      assertIsolationClosed: () => ({ verdict: 'CLOSED' }),
      out: () => {},
    }),
    0
  );
});

test('auto CLI builds candidates from live intake inputs when candidates are omitted', async () => {
  const f = fixture();
  let built = false;
  const candidate = { ...CANDIDATE };
  const code = await runAutoCli(['--auto', '--items', f.itemsFile], {
    usageFile: f.usageFile,
    buildCandidates: async () => {
      built = true;
      return [candidate];
    },
    assertIsolationClosed: () => ({ verdict: 'CLOSED' }),
    runIsolatedReviewed: async () => null,
    out: () => {},
  });
  assert.equal(code, 0);
  assert.equal(built, true);
});

test('auto CLI treats a stale isolation verdict as a completed refusal', async () => {
  const f = fixture();
  let ran = false;
  const code = await runAutoCli(['--auto', '--items', f.itemsFile], {
    assertIsolationClosed: () => {
      const error = new Error('stale');
      error.code = 'ISOLATION_VERDICT_STALE';
      throw error;
    },
    buildCandidates: () => {
      ran = true;
      return [CANDIDATE];
    },
    out: () => {},
  });
  assert.equal(code, 1);
  assert.equal(ran, false);
});

test('qualification isolation requires a fresh CLOSED verdict', () => {
  const now = Date.now();
  const stat = () => ({ mtimeMs: now });
  assert.equal(
    assertIsolationClosed({ now, stat, readFile: () => '{"verdict":"CLOSED"}' }).verdict,
    'CLOSED'
  );
  assert.throws(
    () =>
      assertIsolationClosed({
        now,
        stat: () => ({ mtimeMs: now - 90000000 }),
        readFile: () => '{"verdict":"CLOSED"}',
      }),
    /ISOLATION_VERDICT_STALE/
  );
  assert.throws(
    () => assertIsolationClosed({ now, stat, readFile: () => '{"verdict":"OPEN"}' }),
    /ISOLATION_VERDICT_NOT_CLOSED/
  );
});

test('qualification coordinator refuses proof without a CLOSED verdict', async () => {
  const f = fixture();
  let recorded = false;
  const result = await runAutomaticQualification({
    candidates: [CANDIDATE],
    itemsFile: f.itemsFile,
    usageFile: f.usageFile,
    runIsolatedReviewed: async () => ({
      verdict: 'PASS',
      sha: SHA,
      reviewedSha: SHA,
      reviewer: 'reviewer',
      independent: true,
    }),
    recordEvidence: () => {
      recorded = true;
    },
  });
  assert.equal(result.reason, 'ISOLATION_VERDICT_NOT_CLOSED');
  assert.equal(recorded, false);
});

test('default isolated qualification adapter uses isolated orchestration and exact reviewed receipt', async () => {
  const { runIsolatedReviewed } = require('../intake');
  const f = fixture();
  const reviewed = [];
  const result = await runIsolatedReviewed(
    {
      candidate: CANDIDATE,
      candidateKey: CANDIDATE.candidateKey,
      expectedCommit: SHA,
      item: {
        id: 'QUALIFY-TEST',
        kind: 'qualification',
        risk: 'low',
        acceptanceCriteria: ['review'],
      },
    },
    {
      root: f.dir,
      now: Date.now(),
      verdictPath: path.join(f.dir, 'verdict.json'),
      stat: () => ({ mtimeMs: Date.parse('2026-10-10T12:00:00Z') }),
      readFile: () => '{"verdict":"CLOSED"}',
      accounts: [],
      registry: {},
      runOrchestration: async (goal, options) => {
        reviewed.push({ goal, options });
        return {
          status: 'COMPLETED',
          checkpoint: {
            reviews: [
              {
                workItemId: 'QUALIFY-TEST',
                verdict: 'PASS',
                sha: SHA,
                reviewer: 'hermes::cli::gw2::up2::acct2::acct2::model2',
              },
            ],
          },
        };
      },
    }
  );
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.sha, SHA);
  assert.equal(result.reviewedSha, SHA);
  assert.equal(result.independent, true);
  assert.equal(reviewed[0].options.isolatedWorker, true);
  assert.equal(reviewed[0].options.autoMerge, false);
  assert.equal(reviewed[0].options.publication, null);
  assert.equal(reviewed[0].options.candidates.length, 1);
  assert.equal(reviewed[0].options.reviewerIdentity, undefined);
  assert.equal(reviewed[0].options.specs[0].allowedPaths.length, 0);
  assert.equal(reviewed[0].options.specs[0].verification, null);
});

test('production candidate builder uses intake catalogue/accounts and Controller ranking', () => {
  const fsx = require('fs');
  const path = require('path');
  const root = process.cwd();
  const intakeRoot = path.join(root, 'tools', 'ai-brain', 'data', 'intake');
  const runDir = path.join(intakeRoot, 'fixture-qualification-live');
  fsx.mkdirSync(runDir, { recursive: true });
  fsx.writeFileSync(path.join(runDir, 'catalogue.json'), JSON.stringify(['ag/gemini-test-model']));
  fsx.writeFileSync(
    path.join(runDir, 'accounts.json'),
    JSON.stringify([{ id: 'agy-pool-1', provider: 'antigravity', models: ['gemini-test-model'] }])
  );
  const oldListAccounts = require('../accounts').listAccounts;
  const oldLoadSources = require('../sources').loadSources;
  const oldGenerate = require('../candidates').generateCandidates;
  const oldAnnotate = require('../candidates').annotateCandidates;
  const oldEvidence = require('../evidence').loadEvidence;
  const oldRank = require('../ranking').rankAndRecord;
  let inputs;
  try {
    require('../accounts').listAccounts = () => [
      { id: 'agy-pool-2', provider: 'antigravity', models: ['gemini-other'] },
    ];
    require('../sources').loadSources = () => ({ sources: [] });
    require('../candidates').generateCandidates = (value) => {
      inputs = value;
      return [CANDIDATE];
    };
    require('../candidates').annotateCandidates = (rows) => rows;
    require('../evidence').loadEvidence = () => ({});
    require('../ranking').rankAndRecord = () => ({
      rejected: [{ offeringId: CANDIDATE.candidateKey, reasonCode: 'PROOF_FLOOR_NOT_MET' }],
      ranking: [],
    });
    const candidates = cli._buildQualificationCandidates
      ? cli._buildQualificationCandidates(root)
      : null;
    assert.ok(candidates);
    assert.equal(inputs.catalogue[0], 'ag/gemini-test-model');
    assert.ok(inputs.accounts.some((account) => account.id === 'agy-pool-2'));
    assert.equal(inputs.externalWorkers, 'agy-pool');
    assert.equal(candidates[0].status, 'rejected');
    assert.deepEqual(candidates[0].rejectionReasons, ['PROOF_FLOOR_NOT_MET']);
  } finally {
    require('../accounts').listAccounts = oldListAccounts;
    require('../sources').loadSources = oldLoadSources;
    require('../candidates').generateCandidates = oldGenerate;
    require('../candidates').annotateCandidates = oldAnnotate;
    require('../evidence').loadEvidence = oldEvidence;
    require('../ranking').rankAndRecord = oldRank;
    fsx.rmSync(runDir, { recursive: true, force: true });
  }
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

test('next loop tries qualification only after PROOF_FLOOR_NOT_MET intake refusal', async () => {
  let qualifications = 0;
  const result = await nextLoop(
    { maxIterations: 1, rootDir: process.cwd(), records: [] },
    {
      existsSync: () => false,
      items: [{ work_item_id: 'FEAT-AUTH-01', status: 'READY_FOR_AUTHOR', dependencies: '' }],
      runIntake: async () => {
        const error = new Error('proof floor');
        error.code = 'PROOF_FLOOR_NOT_MET';
        throw error;
      },
      qualificationSlot: async () => {
        qualifications += 1;
        return { ran: true, status: 'completed' };
      },
      checkCandidateLanes: () => ({ available: true }),
      checkCeiling: () => ({ allowed: true }),
      log: () => {},
      now: Date.now(),
    }
  );
  assert.equal(qualifications, 1);
  assert.ok(result.qualification);
});

test('next loop does not start a qualification slot when the controller ceiling is reached', async () => {
  let qualifications = 0;
  const result = await nextLoop(
    { maxIterations: 1, rootDir: process.cwd(), records: [] },
    {
      existsSync: () => false,
      items: [{ work_item_id: 'FEAT-AUTH-01', status: 'READY_FOR_AUTHOR', dependencies: '' }],
      runIntake: async () => {
        const error = new Error('proof floor');
        error.code = 'PROOF_FLOOR_NOT_MET';
        throw error;
      },
      qualificationSlot: async () => {
        qualifications += 1;
        return { ran: true, status: 'completed' };
      },
      checkCandidateLanes: () => ({ available: true }),
      checkCeiling: () => ({ allowed: false, reason: 'WRITER_CEILING_REACHED' }),
      log: () => {},
      now: Date.now(),
    }
  );
  assert.equal(qualifications, 0);
  assert.equal(result.completed, true);
});

test('next loop does not qualify for unrelated intake errors and prioritizes FEAT items', async () => {
  const { findNextWorkItem } = require('../next-runner');
  const choice = findNextWorkItem(
    { records: [] },
    {
      items: [
        { work_item_id: 'TASK-AI-199', status: 'BACKLOG', dependencies: '' },
        { work_item_id: 'FEAT-AUTH-01', status: 'READY_FOR_AUTHOR', dependencies: '' },
      ],
      writerFor: () => null,
      isOpenRun: () => false,
    }
  );
  assert.equal(choice.item.work_item_id, 'FEAT-AUTH-01');
  let qualifications = 0;
  await nextLoop(
    { maxIterations: 1, rootDir: process.cwd(), records: [] },
    {
      existsSync: () => false,
      items: [{ work_item_id: 'FEAT-AUTH-01', status: 'READY_FOR_AUTHOR', dependencies: '' }],
      runIntake: async () => {
        throw new Error('catalogue unavailable');
      },
      qualificationSlot: async () => {
        qualifications += 1;
        return { ran: true };
      },
      checkCandidateLanes: () => ({ available: true }),
      checkCeiling: () => ({ allowed: true }),
      log: () => {},
      now: Date.now(),
    }
  );
  assert.equal(qualifications, 0);
});

test('nextCommand injects a production qualification slot by default', async () => {
  const { nextCommand } = require('../next-runner');
  const { nextCommand: cliNext } = require('../cli');
  const original = require('../qualification-auto').runAutoCli;
  let called = false;
  let qualificationConfig;
  require('../qualification-auto').runAutoCli = async (argv, deps) => {
    called =
      argv.includes('--auto') &&
      typeof deps.runIsolatedReviewed === 'function' &&
      typeof deps.buildCandidates === 'function';
    qualificationConfig = deps.config;
    return 0;
  };
  try {
    const f = fixture();
    const result = await cliNext(
      { root: f.dir, loop: true, maxIterations: 1, records: [] },
      {
        existsSync: () => false,
        items: [{ work_item_id: 'FEAT-AUTH-01', status: 'READY_FOR_AUTHOR', dependencies: '' }],
        runIntake: async () => {
          const error = new Error('proof floor');
          error.code = 'PROOF_FLOOR_NOT_MET';
          throw error;
        },
        checkCandidateLanes: () => ({ available: true }),
        checkCeiling: () => ({ allowed: true }),
        log: () => {},
        now: Date.now(),
      }
    );
    assert.equal(called, true);
    assert.deepEqual(qualificationConfig, {});
    assert.ok(result.qualification);
  } finally {
    require('../qualification-auto').runAutoCli = original;
  }
});
