'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { runOrchestration } = require('../orchestrate');
const { candidateKey } = require('../candidates');
const decisions = require('../decisions');
const cli = require('../cli');

const dirs = [];
const SHA = 'a'.repeat(40);
const NOW = Date.parse('2026-10-05T12:00:00Z');
const REVIEWER = 'paseo::cli::review-gw::review-up::reviewer::scope::review-model';

after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function candidate(id, role, over) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli-' + id,
      gateway: 'gw-' + id,
      upstream: 'up-' + id,
      accountId: 'acct-' + id,
      quotaScope: 'scope-' + id,
      modelId: 'model-' + id,
      source: 'gw-' + id,
      qualifiedRoles: [role],
      capabilities: { contextWindow: 64000 },
      cost: id === 'writer' ? 0.1 : id === 'alternate' ? 0.2 : 1,
    },
    over || {}
  );
}

function setup() {
  const dir = tmpDir('task-ai-105-');
  const cwd = path.join(dir, 'repo');
  fs.mkdirSync(cwd);
  const git = (args) => {
    const result = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return (result.stdout || '').trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'task-ai-105@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-105 test']);
  fs.writeFileSync(path.join(cwd, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'base']);
  const sha = git(['rev-parse', 'HEAD']);
  const checkpointFile = path.join(dir, 'checkpoint.json');
  const decisionDir = path.join(dir, 'decisions');
  const writer = candidate('writer', 'author.foundation');
  const reviewer = candidate('reviewer', 'reviewer');
  const run = (job) => {
    if (job.usageFile) {
      fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'writer-session' }));
    }
    fs.writeFileSync(path.join(cwd, 'change.js'), 'completed\n');
    git(['add', 'change.js']);
    git(['commit', '-q', '-m', 'worker completion']);
    return { exitCode: 0, stdout: 'worker completed' };
  };
  const opts = {
    specs: [{ id: 'TASK-AI-105-TEST', files: ['change.js'], verification: { command: 'test' } }],
    candidates: [writer],
    registry: { sources: [] },
    checkpointFile,
    decisionDir,
    usageDir: path.join(dir, 'usage'),
    now: NOW,
    cwd,
    git,
    workerRoot: cwd,
    baseSha: sha,
    sha,
    publisherCwd: cwd,
    branch: 'feat/task-ai-105-test',
    run,
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    reviewer: async (sha) => ({
      pass: true,
      sha,
      verdict: 'PASS',
      reviewer: REVIEWER,
      findings: [],
    }),
    repairer: async (_findings, sha) => ({ sha }),
    reviewerIdentity: candidateKey(reviewer),
    measureFailBefore: () => ({ command: 'test', exitCode: 1 }),
  };
  return { ...opts, writer, reviewer, run, runOriginal: run, dir };
}

test('CK-R01 checkpoints the selection and launch before an injected interruption', async () => {
  const f = setup();
  f.reviewer = async () => {
    const checkpoint = JSON.parse(fs.readFileSync(f.checkpointFile, 'utf8'));
    assert.ok(checkpoint.liveSteps['TASK-AI-105-TEST'].failBefore);
    throw new Error('interrupt after launch');
  };
  f.run = (job) => {
    assert.ok(fs.existsSync(f.checkpointFile), 'selection must be checkpointed before launch');
    const checkpoint = JSON.parse(fs.readFileSync(f.checkpointFile, 'utf8'));
    assert.ok(checkpoint.liveSteps && checkpoint.liveSteps['TASK-AI-105-TEST'].selection);
    if (job.usageFile)
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'writer-session' }));
    return { exitCode: 0, stdout: 'worker completed' };
  };
  await assert.rejects(runOrchestration('incremental checkpoint', f), /interrupt after launch/);
  const checkpoint = JSON.parse(fs.readFileSync(f.checkpointFile, 'utf8'));
  assert.ok(checkpoint.liveSteps['TASK-AI-105-TEST'].launch);
  assert.ok(
    fs.existsSync(f.checkpointFile + '.tmp') === false,
    'atomic rename leaves no temp file'
  );
});

test('CK-R02/03 resumes a reviewed-and-published item without another launch, review, or publish', async () => {
  const f = setup();
  f.candidates.push(f.reviewer);
  let launches = 0;
  let reviews = 0;
  let publishes = 0;
  f.run = (job) => {
    launches += 1;
    if (job.usageFile)
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'writer-session' }));
    f.runOriginal(job);
    return { exitCode: 0, stdout: 'worker completed' };
  };
  f.reviewer = async (sha) => {
    reviews += 1;
    return { pass: true, sha, verdict: 'PASS', reviewer: REVIEWER, findings: [] };
  };
  f.publication = {
    publish: () => {
      publishes += 1;
      return { number: 31 };
    },
    approvalId: 'AP-TASK-AI-105-TEST',
    remoteUrl: 'https://github.com/example/repository.git',
    branch: 'feat/task-ai-105-test',
    testMode: true,
    cwd: f.cwd,
  };
  const first = await runOrchestration('resume', f);
  assert.equal(launches, 1, JSON.stringify(first, null, 2));
  const before = JSON.parse(fs.readFileSync(f.checkpointFile, 'utf8'));
  const publication = before.liveSteps['TASK-AI-105-TEST'].publication;

  const second = await runOrchestration('resume', f);
  assert.equal(launches, 1);
  assert.equal(reviews, 1, JSON.stringify(first, null, 2));
  assert.equal(publishes, 1, JSON.stringify(first, null, 2));
  assert.deepEqual(second.publication, publication);
  assert.ok(second.resumed && second.resumed.from);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(f.checkpointFile, 'utf8')).publication,
    before.publication
  );
});

test('CK-R04 persists failed candidate identity and failure scope when selecting a fallback', async () => {
  const f = setup();
  const alternate = candidate('alternate', 'author.foundation');
  f.candidates = [f.writer, alternate];
  f.reviewerIdentity = null;
  f.reviewer = async (sha) => ({
    pass: true,
    sha,
    verdict: 'PASS',
    reviewer: REVIEWER,
    findings: [],
  });
  let attempt = 0;
  f.run = (job) => {
    attempt += 1;
    if (attempt === 1) {
      if (job.usageFile)
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'session-' + attempt }));
      return { exitCode: 1, stderr: 'connect ECONNREFUSED gateway unreachable' };
    }
    return f.runOriginal(job);
  };

  await runOrchestration('failure fallback', f);
  const step = JSON.parse(fs.readFileSync(f.checkpointFile, 'utf8')).liveSteps['TASK-AI-105-TEST'];
  assert.ok(step.failures.length, JSON.stringify(step, null, 2));
  const failure = step.failures.find((record) => record.failedCandidateKey);
  assert.ok(failure, JSON.stringify(step, null, 2));
  assert.equal(failure.failureScope, 'gateway', JSON.stringify(step.failures));
  assert.notEqual(step.launch.candidateKey, failure.failedCandidateKey);
});

test('CLI orchestrateCommand checkpoints mid-run and a rerun skips completed steps', async () => {
  const f = setup();
  const specsFile = path.join(f.dir, 'cli-specs.json');
  const checkpointFile = path.join(f.dir, 'cli-checkpoint.json');
  const doneItem = 'TASK-AI-105-DONE';
  const cutItem = 'TASK-AI-105-CUT';
  fs.writeFileSync(
    specsFile,
    JSON.stringify([
      { id: doneItem, files: ['done.js'], verification: { command: 'test' } },
      { id: cutItem, files: ['cut.js'], verification: { command: 'test' } },
    ])
  );
  const writer = candidate('writer', 'author.foundation', {
    capabilities: { contextWindow: 256000, jsonSchema: true, tools: true },
    evidence: [{ status: 'passed', proofLevel: 'WORK_ITEM_PASS' }],
  });
  const head = {};
  const reviewedShas = [];
  let launches = 0;
  let measures = 0;
  const commandArgs = {
    _: ['orchestrate'],
    goal: 'CLI checkpoint resume',
    specs: specsFile,
    checkpoint: checkpointFile,
    'decision-dir': f.decisionDir,
    'evidence-dir': path.join(f.dir, 'cli-evidence'),
    'usage-dir': path.join(f.dir, 'cli-usage'),
    cwd: f.cwd,
    'worker-root': f.cwd,
    'base-sha': f.baseSha,
    sha: f.sha,
    branch: 'feat/task-ai-105-test',
  };
  const dependencies = {
    log: () => {},
    exit: () => {},
    registry: f.registry,
    candidates: [writer],
    accounts: [],
    registryAccounts: [],
    listAccounts: () => [],
    run: (job) => {
      launches += 1;
      if (job.usageFile) {
        fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'cli-session' }));
      }
      const file = job.workItemId === doneItem ? 'done.js' : 'cut.js';
      fs.writeFileSync(path.join(f.cwd, file), 'completed\n');
      f.git(['add', file]);
      f.git(['commit', '-q', '-m', 'worker completion ' + job.workItemId]);
      head[job.workItemId] = f.git(['rev-parse', 'HEAD']);
      return { exitCode: 0, stdout: 'worker completed' };
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    measureFailBefore: () => {
      measures += 1;
      if (measures === 2) {
        const onDisk = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
        assert.ok(onDisk.liveSteps[doneItem].review, 'finished item review is durable mid-run');
        assert.ok(onDisk.liveSteps[cutItem].selection, 'selection is on disk before the cut');
        assert.ok(onDisk.liveSteps[cutItem].launch, 'checkpoint is on disk after the launch step');
        assert.equal(
          fs.existsSync(checkpointFile + '.tmp'),
          false,
          'atomic rename leaves no temp file'
        );
        throw new Error('interrupt CLI after launch');
      }
      return { command: 'test', exitCode: 1 };
    },
    reviewer: async (sha) => {
      const onDisk = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
      assert.ok(
        Object.values(onDisk.liveSteps).some((step) => step.selection && step.launch),
        'CLI checkpoint exists on disk while the run is still in flight'
      );
      reviewedShas.push(sha);
      return { pass: true, sha, verdict: 'PASS', reviewer: REVIEWER, findings: [] };
    },
    now: NOW,
  };

  const cut = await cli.orchestrateCommand(commandArgs, dependencies);
  assert.equal(cut.exitCode, 1, JSON.stringify(cut.error && cut.error.message));
  assert.match(String(cut.error && cut.error.message), /interrupt CLI after launch/);
  assert.equal(launches, 2, 'both items launched once before the cut');
  assert.deepEqual(reviewedShas, [head[doneItem]], 'only the finished item was reviewed');
  const afterCut = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  assert.ok(afterCut.liveSteps[cutItem].launch, 'checkpoint survives the interrupted run');
  assert.ok(afterCut.liveSteps[doneItem].review, 'checkpoint carries the completed review');
  assert.equal(fs.existsSync(checkpointFile + '.tmp'), false, 'atomic rename leaves no temp file');

  const resumedRun = await cli.orchestrateCommand(commandArgs, dependencies);
  assert.equal(launches, 2, 'a rerun must not launch a second worker');
  assert.equal(
    reviewedShas.filter((sha) => sha === head[doneItem]).length,
    1,
    'a rerun must not review the same sha twice'
  );
  assert.equal(
    reviewedShas.length,
    2,
    'the interrupted item reaches its first review: ' +
      JSON.stringify({
        status: resumedRun.status,
        refusal: resumedRun.refusal,
        outcomes: resumedRun.outcomes,
        resumed: resumedRun.resumed,
      })
  );
  assert.equal(resumedRun.status, 'COMPLETED', JSON.stringify(resumedRun, null, 2));
  assert.ok(resumedRun.resumed && resumedRun.resumed.from, 'the run records its resumed step');

  const settled = await cli.orchestrateCommand(commandArgs, dependencies);
  assert.equal(launches, 2, 'a completed checkpoint launches nothing');
  assert.equal(reviewedShas.length, 2, 'a completed checkpoint reviews nothing again');
  assert.ok(settled.resumed && settled.resumed.from, 'a rerun still reports the resumed step');
});

test('CK-R01 every completed review round stays in the checkpoint', async () => {
  const f = setup();
  const itemId = 'TASK-AI-105-TEST';
  let reviews = 0;
  let repairs = 0;
  f.repairer = async () => {
    repairs += 1;
    fs.writeFileSync(path.join(f.cwd, 'repair-' + repairs + '.js'), 'fixed ' + repairs + '\n');
    f.git(['add', 'repair-' + repairs + '.js']);
    f.git(['commit', '-q', '-m', 'repair ' + repairs]);
    return { sha: f.git(['rev-parse', 'HEAD']) };
  };
  f.reviewer = async (sha) => {
    reviews += 1;
    if (reviews === 3) throw new Error('interrupt after review round 2');
    return {
      pass: false,
      sha,
      verdict: 'CHANGES_REQUIRED',
      reviewer: REVIEWER,
      findings: [{ id: 'R' + reviews, open: true, detail: 'round ' + reviews + ' finding' }],
    };
  };

  await assert.rejects(
    runOrchestration('review round accumulation', f),
    /interrupt after review round 2/
  );
  assert.equal(repairs, 2, 'two repair rounds run before the cut');
  const step = JSON.parse(fs.readFileSync(f.checkpointFile, 'utf8')).liveSteps[itemId];
  const rounds = (step.reviewRounds || []).map((record) => ({
    round: record.round,
    sha: record.sha,
  }));
  assert.deepEqual(
    rounds.map((record) => record.round),
    [1, 2],
    'every completed review round stays in the checkpoint: ' + JSON.stringify(rounds)
  );
  assert.equal(new Set(rounds.map((record) => record.sha)).size, 2, 'each round keeps its own sha');
});

test('CK-R03 a publication recorded in the checkpoint is returned as-is on resume', async () => {
  const f = setup();
  const itemId = 'TASK-AI-105-TEST';
  let publishes = 0;
  let launches = 0;
  f.run = (job) => {
    launches += 1;
    return f.runOriginal(job);
  };
  f.reviewer = async (sha) => ({
    pass: true,
    sha,
    verdict: 'PASS',
    reviewer: REVIEWER,
    findings: [],
  });
  f.publication = {
    publish: () => {
      publishes += 1;
      return { number: 31 };
    },
    approvalId: 'AP-TASK-AI-105-TEST',
    remoteUrl: 'https://github.com/example/repository.git',
    branch: 'feat/task-ai-105-test',
    testMode: true,
    cwd: f.cwd,
  };
  const originalWrite = cli.writeJsonFile;
  cli.writeJsonFile = (file, value) => {
    originalWrite(file, value);
    const live = value && value.liveSteps && value.liveSteps[itemId];
    if (live && live.publication) throw new Error('interrupt after the publication write');
  };
  try {
    await assert.rejects(
      runOrchestration('publish then cut', f),
      /interrupt after the publication write/
    );
  } finally {
    cli.writeJsonFile = originalWrite;
  }
  assert.equal(publishes, 1, 'the draft pull request is published once');
  const recorded = JSON.parse(fs.readFileSync(f.checkpointFile, 'utf8')).liveSteps[itemId]
    .publication;
  assert.equal(recorded.status, 'PUBLISHED_DRAFT', JSON.stringify(recorded, null, 2));
  assert.equal(
    fs.existsSync(f.checkpointFile + '.tmp'),
    false,
    'atomic rename leaves no temp file'
  );

  const resumed = await runOrchestration('publish resume', f);
  assert.equal(publishes, 1, 'a recorded publication is never published again');
  assert.equal(launches, 1, 'a recorded publication never relaunches the worker');
  assert.deepEqual(resumed.publication, recorded, 'the recorded publication is returned as-is');
  assert.equal(resumed.status, 'PUBLISHED_DRAFT', JSON.stringify(resumed, null, 2));
});

test('CK-R02 a rerun reclaims the writer claim its own checkpoint records', async () => {
  const f = setup();
  const itemId = 'TASK-AI-105-TEST';
  let launches = 0;
  let reviews = 0;
  f.run = (job) => {
    launches += 1;
    return f.runOriginal(job);
  };
  f.reviewer = async (sha) => {
    reviews += 1;
    if (reviews === 1) throw new Error('interrupt after the launched claim');
    return { pass: true, sha, verdict: 'PASS', reviewer: REVIEWER, findings: [] };
  };

  await assert.rejects(
    runOrchestration('cut after the claim', f),
    /interrupt after the launched claim/
  );
  assert.equal(launches, 1);
  const claims = decisions.openWriters({ dir: f.decisionDir, now: NOW });
  assert.ok(
    claims.some((claim) => claim.workItemId === itemId),
    'the killed run left an open writer claim'
  );

  const resumed = await runOrchestration('reclaim own claim', f);
  assert.equal(launches, 1, 'the resumed run must not launch a second worker');
  assert.equal(reviews, 2, 'the interrupted review is completed exactly once');
  assert.equal(resumed.status, 'COMPLETED', JSON.stringify(resumed, null, 2));
  assert.ok(resumed.resumed && resumed.resumed.from, 'the rerun records the step it resumed from');
});

test('CK-R02 a claim held by another session still blocks the rerun', async () => {
  const f = setup();
  const itemId = 'TASK-AI-105-TEST';
  let launches = 0;
  let reviews = 0;
  f.run = (job) => {
    launches += 1;
    return f.runOriginal(job);
  };
  f.reviewer = async (sha) => {
    reviews += 1;
    if (reviews === 1) throw new Error('interrupt after the launched claim');
    return { pass: true, sha, verdict: 'PASS', reviewer: REVIEWER, findings: [] };
  };

  await assert.rejects(
    runOrchestration('cut after the claim', f),
    /interrupt after the launched claim/
  );
  decisions.recordDecision(
    {
      stage: decisions.Stage.LAUNCHED,
      workItemId: itemId,
      role: 'writer',
      sessionId: 'another-session',
      branch: f.branch,
    },
    { dir: f.decisionDir, now: NOW }
  );

  const blocked = await runOrchestration('foreign claim', f);
  assert.equal(blocked.status, 'BLOCKED', JSON.stringify(blocked, null, 2));
  assert.match(blocked.outcomes[0].reason, /DUPLICATE_WRITER/);
  assert.equal(launches, 1, 'a foreign claim stops the rerun before any launch');
  assert.equal(reviews, 1, 'a foreign claim stops the rerun before any review');
});

test('CK-R02 a torn checkpoint write resumes from its .tmp and is never relaunched', async () => {
  const f = setup();
  const itemId = 'TASK-AI-105-TEST';
  let launches = 0;
  let measures = 0;
  f.run = (job) => {
    launches += 1;
    return f.runOriginal(job);
  };
  f.reviewer = async (sha) => ({
    pass: true,
    sha,
    verdict: 'PASS',
    reviewer: REVIEWER,
    findings: [],
  });
  f.measureFailBefore = () => {
    measures += 1;
    if (measures === 1) throw new Error('interrupt after the launch write');
    return { command: 'test', exitCode: 1 };
  };

  await assert.rejects(runOrchestration('torn write', f), /interrupt after the launch write/);
  assert.equal(launches, 1);
  const full = fs.readFileSync(f.checkpointFile, 'utf8');
  fs.writeFileSync(f.checkpointFile + '.tmp', full);
  const doc = JSON.parse(full);
  const step = doc.liveSteps[itemId];
  assert.ok(step.launch, 'the launch record exists before the torn write is simulated');
  delete step.launch;
  step.stage = 'candidate_selected';
  fs.writeFileSync(f.checkpointFile, JSON.stringify(doc, null, 2));

  const resumed = await runOrchestration('resume from the torn write', f);
  assert.equal(launches, 1, 'the torn launch record must not be relaunched');
  assert.equal(resumed.status, 'COMPLETED', JSON.stringify(resumed, null, 2));
  assert.equal(
    fs.existsSync(f.checkpointFile + '.tmp'),
    false,
    'the resumed write replaces the stale .tmp'
  );
});

test('CK-R02 an empty checkpoint never relaunches work the decision log records as launched', async () => {
  const f = setup();
  let launches = 0;
  f.run = (job) => {
    launches += 1;
    return f.runOriginal(job);
  };
  f.reviewer = async (sha) => ({
    pass: true,
    sha,
    verdict: 'PASS',
    reviewer: REVIEWER,
    findings: [],
  });

  const first = await runOrchestration('complete once', f);
  assert.equal(first.status, 'COMPLETED', JSON.stringify(first, null, 2));
  assert.equal(launches, 1);
  fs.writeFileSync(f.checkpointFile, '{}');

  const second = await runOrchestration('empty checkpoint', f);
  assert.equal(
    launches,
    1,
    'an empty checkpoint must not relaunch a worker the decision log already launched'
  );
  assert.equal(second.status, 'BLOCKED', JSON.stringify(second, null, 2));
  assert.match(second.outcomes[0].reason, /CHECKPOINT_LAUNCH_RECORD_MISSING/);
});
