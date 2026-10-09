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

test('22 restart reads the checkpoint and does not redo completed steps', async () => {
  const calls = [];
  // TASK-AI-64: the checkpoint file is the only resume input, so the completed
  // item is on disk where a real run would read it. The assertion is unchanged.
  const checkpoint = path.join(tmpDir(), 'checkpoint.json');
  fs.writeFileSync(
    checkpoint,
    JSON.stringify({ schemaVersion: 1, step: 'live_review', completed: ['A'] })
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
      review: () => ({ pass: true, sha: 'head', findings: [] }),
      repair: () => ({ sha: 'head' }),
    }
  );
  assert.equal(result.status, 'COMPLETED');
  const repair = result.rounds.find((r) => r.stage === 'repair');
  assert.ok(repair);
  assert.equal(repair.cause, 'UPSTREAM_AUTH_403');
});

test('26 repair over budget -> BLOCKED', async () => {
  const result = await runReviewLoop(
    { sha: 'head', budget: 1 },
    {
      runTests: () => ({ pass: false, cause: 'TEST_FAILURE' }),
      review: () => ({ pass: true, sha: 'head' }),
      // TASK-AI-64: the old `(findings, sha) => ({ sha })` default repair is
      // gone, so the seam this test drives on purpose is supplied explicitly.
      repair: (findings, sha) => ({ sha }),
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
