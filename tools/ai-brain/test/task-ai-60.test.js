'use strict';

/**
 * Ship Dễ — TASK-AI-60 autonomous planning and repair loop (dry-run) tests.
 *
 * Tests 15-30. No network, no real agents; only injected fakes and real pure
 * modules. No state is written outside os.tmpdir().
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { plan, findCycle } = require('../planner');
const { compilePrompt, PUBLISHER_BOUNDARY } = require('../prompt-compiler');
const { classifySession, Status } = require('../supervisor');
const { runReviewLoop } = require('../review-loop');
const { runOrchestration } = require('../orchestrate');
const { candidateKey } = require('../candidates');
const { resumeReceipt } = require('./helpers/resume-receipt');

const NOW = Date.parse('2026-09-28T00:00:00Z');

function cand(over) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli-a',
      gateway: 'gw-a',
      upstream: 'up-a',
      accountId: 'acct-a',
      quotaScope: 'acct-a',
      modelId: 'up-a/model-a',
      source: 'gw-a',
      kind: 'router',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 64000 },
      cost: 1,
    },
    over || {}
  );
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-60-'));
}

// A run pins the commit it is reviewing, and TASK-AI-64 R07 makes the reviewer
// name the commit it read, so the shared stub echoes the SHA it was handed.
const SIM_SHA = 'a'.repeat(40);

/**
 * A launch in the live shape: it writes the durable `--usage-file` report the loop
 * requires, because a launch that produced no durable report is not a live run
 * (AI-64-R04) and completes nothing.
 */
function durableLaunch(extra) {
  return (job) => {
    if (job && typeof job.usageFile === 'string') {
      fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sim-session' }), 'utf8');
    }
    return Object.assign({ exitCode: 0, stdout: 'the agent changed production code' }, extra || {});
  };
}

const SIM = {
  run: durableLaunch(),
  tests: () => ({ pass: true }),
  reviewer: (sha) => ({ pass: true, sha: typeof sha === 'string' ? sha : SIM_SHA, findings: [] }),
  repairer: (findings, sha) => ({ sha: sha || SIM_SHA }),
};

test('15 planner makes a valid DAG', () => {
  const result = plan('ship a feature', {
    specs: [
      { id: 'A', files: ['a.js'], dependencies: [], acceptanceCriteria: ['a works'] },
      { id: 'B', files: ['b.js'], dependencies: ['A'], acceptanceCriteria: ['b works'] },
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.workItems.length, 2);
  assert.deepEqual(result.workItems[1].dependencies, ['A']);
  assert.equal(result.workItems[0].roleRequirement.role, 'author.foundation');
  assert.equal(result.workItems[0].proofFloor, 'NONE');
});

test('goal planner defaults missing proof floors to NONE for authors and keeps reviewer gates', () => {
  const result = plan('g', {
    specs: [
      { id: 'AUTHOR', role: 'author.foundation', files: ['a.js'], acceptanceCriteria: ['a'] },
      { id: 'REVIEW', role: 'reviewer', files: ['b.js'], acceptanceCriteria: ['b'] },
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.workItems[0].proofFloor, 'NONE');
  assert.equal(result.workItems[1].proofFloor, 'WORK_ITEM_PASS');
});

test('16 dependency cycle rejected', () => {
  const result = plan('g', {
    specs: [
      { id: 'A', dependencies: ['B'] },
      { id: 'B', dependencies: ['A'] },
    ],
  });
  assert.ok(result.errors.some((e) => e.startsWith('DEPENDENCY_CYCLE')));
  assert.equal(result.workItems.length, 0);
});

test('17 two slices owning one file detected', () => {
  const result = plan('g', {
    specs: [
      { id: 'A', files: ['shared.js'] },
      { id: 'B', files: ['shared.js'] },
    ],
  });
  assert.ok(result.errors.some((e) => e.startsWith('FILE_OWNED_TWICE')));
});

test('18 prompt has full scope, tests and acceptance', () => {
  const prompt = compilePrompt(
    {
      id: 'A',
      allowedPaths: ['a.js'],
      acceptanceCriteria: ['a works'],
      verification: { command: 'node --test' },
      dependencies: [],
    },
    { goal: 'ship a feature', specText: 'the spec text' }
  );
  assert.ok(prompt.includes('Work Item: A'));
  assert.ok(prompt.includes('Goal: ship a feature'));
  assert.ok(prompt.includes('Source spec: the spec text'));
  assert.ok(prompt.includes('Allowed files: a.js'));
  assert.ok(prompt.includes('Acceptance criteria:'));
  assert.ok(prompt.includes('a works'));
  assert.ok(prompt.includes('Tests: node --test'));
  assert.ok(prompt.includes('Publisher boundary'));
  assert.ok(prompt.includes('never merge'));
});

test('19 prompt carries the pinned candidateKey', () => {
  const prompt = compilePrompt({ id: 'A' }, { candidateKey: 'hermes::cli::gw::up::acct::up::m' });
  assert.ok(prompt.includes('Pinned candidateKey: hermes::cli::gw::up::acct::up::m'));
});

test('20 empty SUCCESS not counted completed', () => {
  assert.equal(classifySession({ exitCode: 0, output: '' }), Status.COMPLETED_EMPTY);
  assert.notEqual(classifySession({ exitCode: 0, output: '' }), Status.COMPLETED_WITH_ARTIFACT);
});

test('21 no-progress session stalled', () => {
  const verdict = classifySession(
    { startedAt: new Date(NOW - 20 * 60 * 1000).toISOString(), progress: {} },
    { now: NOW, stallMs: 15 * 60 * 1000 }
  );
  assert.equal(verdict, Status.STALLED);
});

test('22 restart reads the checkpoint and does not redo completed steps', async (t) => {
  const calls = [];
  // TASK-AI-64: the checkpoint file is the only resume input, so the completed
  // item is on disk where a real run would read it. The assertion is unchanged.
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (args) => {
    const result = require('node:child_process').spawnSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-q']);
  git(['config', 'user.name', 'Resume fixture']);
  git(['config', 'user.email', 'resume@shipde.test']);
  fs.writeFileSync(path.join(dir, 'a.js'), 'before');
  git(['add', 'a.js']);
  git(['commit', '-qm', 'base']);
  const baseSha = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(dir, 'a.js'), 'after');
  git(['commit', '-qam', 'completed A']);
  const sha = git(['rev-parse', 'HEAD']);
  const receipt = resumeReceipt(
    {
      workItemId: 'A',
      sha,
      baseSha,
      workerRoot: dir,
      publishCwd: dir,
      branch: 'feat/a',
      draftTitle: 'Completed A',
      writerCandidateKey: candidateKey(cand()),
      reviewer: candidateKey(cand({ gateway: 'review', upstream: 'review', accountId: 'review' })),
      review: { verdict: 'PASS', rounds: [{ findings: [] }], repairCount: 0 },
    },
    path.join(dir, 'receipt-decisions')
  );
  const checkpoint = path.join(dir, 'checkpoint.json');
  fs.writeFileSync(
    checkpoint,
    JSON.stringify({ schemaVersion: 1, step: 'live_review', completed: ['A'], reviews: [receipt] })
  );
  const launch = durableLaunch();
  const result = await runOrchestration('g', {
    specs: [
      { id: 'A', files: ['a.js'] },
      { id: 'B', files: ['b.js'] },
    ],
    candidates: [cand()],
    checkpointFile: checkpoint,
    decisionDir: tmpDir(),
    sha: SIM_SHA,
    run: (job) => {
      calls.push(job.workItemId);
      return launch(job);
    },
    tests: SIM.tests,
    reviewer: SIM.reviewer,
    repairer: SIM.repairer,
  });
  assert.deepEqual(calls, ['B']);
  assert.ok(result.reconciliation.completed.includes('A'));
  assert.ok(result.reconciliation.completed.includes('B'));

  fs.writeFileSync(
    checkpoint,
    JSON.stringify({
      completed: ['A'],
      reviews: [{ ...receipt, draftTitle: 'tampered title' }],
    })
  );
  const rejected = await runOrchestration('invalid completed receipt', {
    specs: [{ id: 'A' }],
    checkpointFile: checkpoint,
    decisionDir: path.join(dir, 'rejected'),
    run: () => assert.fail('an invalid completed receipt must not relaunch work'),
  });
  const outcome = rejected.outcomes.find((entry) => entry.workItemId === 'A');
  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.reasonCode, 'CHECKPOINT_RECEIPT_INVALID');
  assert.match(outcome.reason, /receipt integrity mismatch/);
  assert.ok(!rejected.reconciliation.completed.includes('A'));
});

test('23 old-SHA review not accepted for a new SHA', async () => {
  const result = await runReviewLoop(
    { sha: 'newsha', budget: 3 },
    {
      runTests: () => ({ pass: true }),
      review: () => ({ pass: true, sha: 'oldsha' }),
      // TASK-AI-64: the loop has no default repair gate any more (a missing gate
      // is a refusal, AI-64-P08), so the seam this test does not exercise is
      // still supplied. The assertion under test is unchanged.
      repair: (findings, sha) => ({ sha }),
    }
  );
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.rounds.some((r) => r.cause === 'STALE_REVIEW_SHA'));
});

test('24 PASS with findings rejected', async () => {
  const result = await runReviewLoop(
    { sha: 'newsha', budget: 3 },
    {
      runTests: () => ({ pass: true }),
      // TASK-AI-64 R07: a review now names the commit it read, so the review
      // under test names 'newsha' too. Same assertion, live review shape.
      review: () => ({ pass: true, sha: 'newsha', findings: [{ id: 1 }] }),
      repair: (findings, sha) => ({ sha }),
    }
  );
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.rounds.some((r) => r.cause === 'PASS_WITH_FINDINGS_REJECTED'));
});

test('25 CI failure creates a repair task with the right cause', async () => {
  let call = 0;
  const result = await runReviewLoop(
    { sha: 'head', budget: 3 },
    {
      runTests: () => {
        call += 1;
        return call === 1 ? { pass: false, cause: 'UPSTREAM_AUTH_403' } : { pass: true };
      },
      review: (sha) => ({
        pass: true,
        sha: typeof sha === 'string' ? sha : 'head-repaired',
        findings: [],
      }),
      repair: () => ({ sha: 'head-repaired' }),
    }
  );
  assert.equal(result.status, 'COMPLETED');
  const repair = result.rounds.find((r) => r.stage === 'repair');
  assert.ok(repair);
  assert.equal(repair.cause, 'UPSTREAM_AUTH_403');
  assert.equal(result.finalSha, 'head-repaired');
});

test('26 repair over budget -> BLOCKED', async () => {
  let repairRound = 0;
  const result = await runReviewLoop(
    { sha: 'head', budget: 1 },
    {
      runTests: () => ({ pass: false, cause: 'TEST_FAILURE' }),
      review: (sha) => ({ pass: true, sha }),
      // TASK-AI-64: the old `(findings, sha) => ({ sha })` default repair is
      // gone, so the seam this test drives on purpose is supplied explicitly.
      // Every attempt advances the SHA to test budget exhaustion rather than
      // stopping early on REPAIR_NO_PROGRESS.
      repair: (findings, sha) => {
        repairRound += 1;
        return { sha: `${sha}-r${repairRound}` };
      },
    }
  );
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.rounds.some((r) => r.cause === 'REPAIR_BUDGET_EXHAUSTED'));
});

test('27 a failing source does not stop a lane on another failure domain', async () => {
  const first = cand();
  const second = cand({
    accessPath: 'cli-b',
    gateway: 'gw-b',
    upstream: 'up-b',
    accountId: 'acct-b',
    quotaScope: 'acct-b',
    modelId: 'up-b/model-b',
    source: 'gw-b',
  });
  let n = 0;
  const launch = durableLaunch();
  const result = await runOrchestration('g', {
    specs: [{ id: 'A', files: ['a.js'] }],
    candidates: [first, second],
    decisionDir: tmpDir(),
    sha: SIM_SHA,
    run: (job) => {
      n += 1;
      if (n === 1) return { exitCode: 3, stderr: 'usage limit reached' };
      return launch(job);
    },
    tests: SIM.tests,
    reviewer: SIM.reviewer,
    repairer: SIM.repairer,
  });
  assert.equal(result.sessions[0].selected, candidateKey(second));
  assert.ok(result.sessions[0].fallbackReason);
  assert.ok(result.reconciliation.completed.includes('A'));
});

test('28 a worker has no merge capability', () => {
  assert.ok(/never push/i.test(PUBLISHER_BOUNDARY));
  assert.ok(/never open a Pull Request/i.test(PUBLISHER_BOUNDARY));
  assert.ok(/never merge/i.test(PUBLISHER_BOUNDARY));
});

test('29 plan input count = completed + blocked + deferred', async () => {
  const result = await runOrchestration('g', {
    specs: [
      { id: 'A', files: ['a.js'] },
      { id: 'B', files: ['b.js'] },
      { id: 'C', files: ['c.js'] },
    ],
    candidates: [cand()],
    decisionDir: tmpDir(),
    usageDir: tmpDir(),
    sha: SIM_SHA,
    run: SIM.run,
    tests: SIM.tests,
    reviewer: SIM.reviewer,
    repairer: SIM.repairer,
  });
  const r = result.reconciliation;
  assert.equal(r.total, 3);
  assert.equal(r.completed.length + r.blocked.length + r.deferred.length, 3);
});

test('30 no second state store or ranking engine', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'orchestrate.js'), 'utf8');
  assert.ok(src.includes("require('./ranking')"));
  assert.ok(src.includes("require('./decisions')"));
  assert.ok(src.includes('ranking.rankAndRecord'));
  assert.ok(src.includes('decisions.recordDecision'));
  assert.ok(!src.includes('function rankAndRecord'));
  assert.ok(!src.includes('function recordDecision'));
  assert.ok(!/class\s+\w*Store\b/.test(src));
});

test('31 review CHANGES_REQUIRED with unchanged repair SHA stops immediately with REPAIR_NO_PROGRESS (review 1, repair 1)', async () => {
  let reviewCalls = 0;
  let repairCalls = 0;
  const initialSha = 'a'.repeat(40);

  const result = await runReviewLoop(
    { sha: initialSha, budget: 3 },
    {
      runTests: () => ({ pass: true }),
      review: (sha) => {
        reviewCalls += 1;
        return {
          pass: false,
          sha,
          verdict: 'CHANGES_REQUIRED',
          reviewer: 'codex-reviewer',
          findings: [{ id: 'finding-1', summary: 'fix needed' }],
        };
      },
      repair: (findings, sha) => {
        repairCalls += 1;
        return { sha };
      },
    }
  );

  assert.equal(result.status, 'BLOCKED');
  assert.equal(reviewCalls, 1);
  assert.equal(repairCalls, 1);
  assert.equal(result.finalSha, initialSha);
  assert.equal(result.repairCount, 1);
  assert.equal(result.verdict, 'CHANGES_REQUIRED');
  assert.equal(result.reviewer, 'codex-reviewer');
  assert.deepEqual(result.findings, [{ id: 'finding-1', summary: 'fix needed' }]);
  assert.equal(result.rounds.at(-1).stage, 'blocked');
  assert.equal(result.rounds.at(-1).cause, 'REPAIR_NO_PROGRESS');
});

test('32 test failure with unchanged repair SHA stops immediately with REPAIR_NO_PROGRESS (repair 1, reviewer 0)', async () => {
  let reviewCalls = 0;
  let repairCalls = 0;
  const initialSha = 'a'.repeat(40);

  const result = await runReviewLoop(
    { sha: initialSha, budget: 3 },
    {
      runTests: () => ({
        pass: false,
        cause: 'TEST_FAILURE',
        findings: [{ id: 'test-failure-1', summary: 'assertion failed' }],
      }),
      review: () => {
        reviewCalls += 1;
        return { pass: true, sha: initialSha, findings: [] };
      },
      repair: (findings, sha) => {
        repairCalls += 1;
        return { sha };
      },
    }
  );

  assert.equal(result.status, 'BLOCKED');
  assert.equal(reviewCalls, 0);
  assert.equal(repairCalls, 1);
  assert.equal(result.finalSha, initialSha);
  assert.equal(result.repairCount, 1);
  assert.deepEqual(result.findings, [{ id: 'test-failure-1', summary: 'assertion failed' }]);
  assert.equal(result.rounds.at(-1).stage, 'blocked');
  assert.equal(result.rounds.at(-1).cause, 'REPAIR_NO_PROGRESS');
});

test('33 repair returning no SHA or empty SHA stops immediately with REPAIR_NO_PROGRESS', async () => {
  // Subcase A: review CHANGES_REQUIRED, repair returns missing sha
  {
    let reviewCalls = 0;
    let repairCalls = 0;
    const initialSha = 'a'.repeat(40);

    const result = await runReviewLoop(
      { sha: initialSha, budget: 3 },
      {
        runTests: () => ({ pass: true }),
        review: (sha) => {
          reviewCalls += 1;
          return {
            pass: false,
            sha,
            verdict: 'CHANGES_REQUIRED',
            findings: [{ id: 'f-empty-sha' }],
          };
        },
        repair: () => {
          repairCalls += 1;
          return {};
        },
      }
    );

    assert.equal(result.status, 'BLOCKED');
    assert.equal(reviewCalls, 1);
    assert.equal(repairCalls, 1);
    assert.equal(result.finalSha, initialSha);
    assert.equal(result.repairCount, 1);
    assert.deepEqual(result.findings, [{ id: 'f-empty-sha' }]);
    assert.equal(result.rounds.at(-1).stage, 'blocked');
    assert.equal(result.rounds.at(-1).cause, 'REPAIR_NO_PROGRESS');
  }

  // Subcase B: test failure, repair returns null
  {
    let reviewCalls = 0;
    let repairCalls = 0;
    const initialSha = 'b'.repeat(40);

    const result = await runReviewLoop(
      { sha: initialSha, budget: 3 },
      {
        runTests: () => ({
          pass: false,
          cause: 'LINT_FAILURE',
          findings: [{ id: 'lint-1' }],
        }),
        review: () => {
          reviewCalls += 1;
          return { pass: true, sha: initialSha, findings: [] };
        },
        repair: () => {
          repairCalls += 1;
          return null;
        },
      }
    );

    assert.equal(result.status, 'BLOCKED');
    assert.equal(reviewCalls, 0);
    assert.equal(repairCalls, 1);
    assert.equal(result.finalSha, initialSha);
    assert.equal(result.repairCount, 1);
    assert.deepEqual(result.findings, [{ id: 'lint-1' }]);
    assert.equal(result.rounds.at(-1).stage, 'blocked');
    assert.equal(result.rounds.at(-1).cause, 'REPAIR_NO_PROGRESS');
  }
});

test('34 repair producing a new SHA advances the loop and PASS confirms the new SHA', async () => {
  const initialSha = 'a'.repeat(40);
  const repairedSha = 'c'.repeat(40);
  let reviewCalls = 0;
  let repairCalls = 0;
  const reviewedShas = [];

  const result = await runReviewLoop(
    { sha: initialSha, budget: 3 },
    {
      runTests: () => ({ pass: true }),
      review: (sha) => {
        reviewCalls += 1;
        reviewedShas.push(sha);
        if (sha === initialSha) {
          return {
            pass: false,
            sha,
            verdict: 'CHANGES_REQUIRED',
            findings: [{ id: 'finding-needs-repair' }],
          };
        }
        return {
          pass: true,
          sha,
          verdict: 'PASS',
          reviewer: 'independent-codex',
          findings: [],
        };
      },
      repair: (findings, sha) => {
        repairCalls += 1;
        assert.equal(sha, initialSha);
        return { sha: repairedSha };
      },
    }
  );

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.finalSha, repairedSha);
  assert.equal(result.repairCount, 1);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.reviewer, 'independent-codex');
  assert.equal(reviewCalls, 2);
  assert.equal(repairCalls, 1);
  assert.deepEqual(reviewedShas, [initialSha, repairedSha]);
});
