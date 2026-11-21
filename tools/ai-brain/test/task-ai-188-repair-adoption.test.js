'use strict';
// TASK-AI-188: a repair can adopt a dirty retained worker root that this run's
// writer left behind. The live TASK-AI-187 run failed 3 repairs with
// WORKER_HEAD_MISMATCH because the real records never satisfied the ownership
// check. These tests use the real record writers, not hand-made records.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const decisions = require('../decisions');
const { candidateKey } = require('../candidates');
const { repairRound } = require('../orchestrate');
const { recordWriterResult } = require('../orchestrate/writer-loop');
const { retainedRootHasOwnWriterRecord } = require('../isolation-launcher');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-188-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function gitRepo(dir) {
  const git = (...args) =>
    cp
      .execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
        cwd: dir,
        encoding: 'utf8',
      })
      .trim();
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'file.js'), 'module.exports = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return git('rev-parse', 'HEAD');
}

test('a real writer-launch-result owns the dirty retained root for a repair of the same run', (t) => {
  const dir = temp(t);
  const root = path.join(dir, 'worker');
  fs.mkdirSync(root);
  const base = gitRepo(root);
  const logOpts = { dir: path.join(dir, 'decisions'), runId: 'run-188' };

  recordWriterResult(
    {
      workItemId: 'TASK-X',
      candidateKey: 'combo-key',
      model: 'ninerouter/vinh',
      harness: 'opencode-direct',
      usageFile: null,
      workerRoot: root,
      cwd: root,
      baseSha: base,
    },
    { exitCode: 0, stdout: '' },
    'writer',
    logOpts,
    {}
  );
  // The writer edited but did not commit.
  fs.writeFileSync(path.join(root, 'file.js'), 'module.exports = 2;\n');

  const [rec] = decisions
    .readDecisionsSafe(logOpts)
    .filter((r) => r.stage === 'writer-launch-result');
  assert.equal(path.resolve(rec.workerRoot), path.resolve(root));
  assert.equal(rec.sha, base);
  assert.notEqual(rec.at, undefined);

  const repairJob = {
    workItemId: 'TASK-X-repair-1',
    workerRoot: root,
    retainWorkerHead: base,
    runId: logOpts.runId,
    decisionDir: logOpts.dir,
  };
  assert.equal(
    retainedRootHasOwnWriterRecord(repairJob, {
      workerRoot: root,
      retainedHeadSha: base,
      runId: logOpts.runId,
    }),
    true
  );
  // Another run's repair still does not own it.
  assert.equal(
    retainedRootHasOwnWriterRecord(
      { ...repairJob, runId: 'other-run' },
      { workerRoot: root, retainedHeadSha: base, runId: 'other-run' }
    ),
    false
  );
});

test('the repair job handed to the launcher carries the run id', async (t) => {
  const dir = temp(t);
  const c = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: 'fixture-router',
    source: 'fixture-router',
    upstream: 'vendor',
    accountId: 'fixture-account',
    quotaScope: 'fixture-account',
    modelId: 'vendor/fixture',
    capabilities: { tools: true, jsonSchema: true, contextWindow: 64000 },
    evidence: [],
  };
  c.candidateKey = candidateKey(c);
  const item = { id: 'ITEM-188', files: ['file.js'], roleRequirement: { role: 'writer' } };
  const logOpts = { dir: path.join(dir, 'decisions'), runId: 'run-188-repair' };
  const jobs = [];
  const repair = repairRound(
    {
      cwd: dir,
      registry: { sources: [] },
      specs: [item],
      jevAsk: async () => {
        throw Error('offline');
      },
    },
    item,
    { candidateKey: c.candidateKey },
    { goal: 'fixture repair' },
    logOpts,
    async (job) => {
      jobs.push(job);
      return { exitCode: 1, stdout: '', stderr: 'fixture' };
    },
    path.join(dir, 'usage'),
    Date.now(),
    [c],
    null,
    { sources: [] }
  );
  await repair([{ id: 'F1', open: true }], 'a'.repeat(40));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].runId, 'run-188-repair');
});

test('a launched record carries enough for the ownership check through its worktree field', (t) => {
  const dir = temp(t);
  const root = path.join(dir, 'worker');
  fs.mkdirSync(root);
  const base = gitRepo(root);
  const logOpts = { dir: path.join(dir, 'decisions'), runId: 'run-188-launched' };
  decisions.recordDecision(
    {
      stage: decisions.Stage.LAUNCHED,
      workItemId: 'TASK-Y',
      runId: logOpts.runId,
      worktree: root,
      sha: base,
    },
    logOpts
  );
  assert.equal(
    retainedRootHasOwnWriterRecord(
      { workItemId: 'TASK-Y-repair-1', decisionDir: logOpts.dir, runId: logOpts.runId },
      { workerRoot: root, retainedHeadSha: base, runId: logOpts.runId }
    ),
    true
  );
});
