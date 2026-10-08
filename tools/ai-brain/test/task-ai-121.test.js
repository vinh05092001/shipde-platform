'use strict';

/**
 * Ship Dễ — TASK-AI-121: launch infrastructure failures are reported as local,
 * and the worker timeout is configurable.
 *
 * Uses the harness pattern of task-ai-114.test.js / task-ai-120.test.js
 * (runOrchestration with real temp git repos and an injected launcher that
 * throws the isolated launcher's own errors).
 *
 * LF-R01: when the isolated launcher throws (or refuses) for
 *   ISOLATION_VERDICT_STALE / _MISSING / _INVALID, ISOLATION_CHECKOUT_FAILED,
 *   PROVISION_BASE_MISMATCH, a worker-root removal failure (EPERM/EBUSY) or
 *   'Failed to clone repository', the decision log "failed" entry carries
 *   detail = the real error message (first 300 chars, no secrets) and cause
 *   launch_config with scope local; failureDomain is null and the candidate is
 *   added to no exclusion set and no evidence cooldown.
 *
 * LF-R02: a stale or missing isolation verdict stops the run immediately with
 *   status BLOCKED, the real reason and the human action
 *   "run scripts/ai/isolation/Test-WorkerIsolation.ps1". No second candidate
 *   and no later work item is launched.
 *
 * LF-R03: `--worker-timeout-min N` on `orchestrate` (1..240, default 30)
 *   reaches the isolated launcher as workerTimeoutMs for writer, reviewer and
 *   repair launches, and is recorded in the run log.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { runOrchestration, resolveLauncher } = require('../orchestrate');
const { candidateKey } = require('../candidates');
const cli = require('../cli');

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const NOW = Date.parse('2026-10-08T12:00:00Z');
const HUMAN_ACTION = 'run scripts/ai/isolation/Test-WorkerIsolation.ps1';

const VERDICT_PATH = 'C:\\Users\\gumac\\AppData\\Local\\ShipDe\\isolation-verdict.json';
const STALE_MSG = 'ISOLATION_VERDICT_STALE: ' + VERDICT_PATH + ' is older than 24h';
const MISSING_MSG = 'ISOLATION_VERDICT_MISSING: Cannot find ' + VERDICT_PATH;
const INVALID_MSG = 'ISOLATION_VERDICT_INVALID: policyHash mismatch or missing';
const CHECKOUT_MSG =
  'ISOLATION_CHECKOUT_FAILED: Failed to checkout HEAD SHA in worker root: ' + 'a'.repeat(40);
const PROVISION_MSG =
  'PROVISION_BASE_MISMATCH: provisioned worker root HEAD (' +
  'b'.repeat(40) +
  ') does not match requested base SHA ' +
  'a'.repeat(40);
const REMOVE_MSG = "EPERM: operation not permitted, unlink 'C:\\Users\\gumac\\ShipDe\\worker-root'";
const CLONE_MSG = 'Failed to clone repository';

function tmpDir(prefix) {
  const upstreamDir = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
  fs.mkdirSync(upstreamDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(upstreamDir, prefix));
  dirs.push(dir);
  return dir;
}

function cand(id, role, over) {
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
      cost: 1,
    },
    over || {}
  );
}

function outcomeOf(log, id) {
  return (log.outcomes || []).find((entry) => entry.workItemId === id) || null;
}

function decisionRecords(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()) {
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/)) {
      if (line.trim()) out.push(JSON.parse(line));
    }
  }
  return out;
}

function failedRecords(dir) {
  return decisionRecords(dir).filter((r) => r.stage === 'failed');
}

function liveStepOf(file, id) {
  const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (checkpoint.liveSteps && checkpoint.liveSteps[id]) || null;
}

/** One real git repository with a base commit. */
function makeRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const git = (args) => {
    const result = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(
      result.status,
      0,
      (result.stderr || result.stdout || '') + ' [' + args.join(' ') + ']'
    );
    return (result.stdout || '').trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'task-ai-121@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-121 test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'base']);
  return { dir, git, base: git(['rev-parse', 'HEAD']) };
}

function commitIn(repo, name, content) {
  fs.writeFileSync(path.join(repo.dir, name), content);
  repo.git(['add', '.']);
  repo.git(['commit', '-q', '-m', 'work ' + name]);
  return repo.git(['rev-parse', 'HEAD']);
}

function writeUsage(job, state) {
  if (job.usageFile) {
    fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
    fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-' + state.calls.length }));
  }
}

/**
 * Shared run options: the given candidates, an injected launcher, a real repo
 * as the worker root and an evidence bag the run must not cool anything down
 * in. `config.run` decides what a launch does.
 */
function launchHarness(specs, config) {
  const state = { calls: [], reviewCalls: 0 };
  const writer = cand('writer', 'author.foundation', { cost: 0.1 });
  const writer2 = cand('writer2', 'author.foundation', { cost: 0.2 });
  const reviewerA = cand('reviewera', 'reviewer.primary');
  const candidates = config.twoWriters ? [writer, writer2, reviewerA] : [writer, reviewerA];
  const run = (job) => {
    state.calls.push({
      workItemId: job.workItemId,
      isReview: Boolean(job.isReview),
      isRepair: Boolean(job.labels && job.labels.repairOf),
      candidateKey: job.candidateKey,
      workerTimeoutMs: job.workerTimeoutMs,
    });
    writeUsage(job, state);
    return config.run(job, state);
  };
  const evidenceData = config.evidenceData || {};
  const opts = {
    specs,
    candidates,
    registry: { sources: [] },
    checkpointFile: config.checkpointFile,
    decisionDir: config.decisionDir,
    usageDir: config.usageDir,
    now: NOW,
    workerRoot: config.host.dir,
    baseSha: config.host.base,
    evidenceData,
    ranking: {
      headrooms: {
        'acct-writer': { status: 'available' },
        'acct-writer2': { status: 'available' },
        'acct-reviewera': { status: 'available' },
      },
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    measureFailBefore: () => ({ command: 'test', exitCode: 1 }),
    run,
  };
  if (config.workerTimeoutMs) opts.workerTimeoutMs = config.workerTimeoutMs;
  return {
    state,
    writer,
    writer2,
    reviewerA,
    writerKey: candidateKey(writer),
    writer2Key: candidateKey(writer2),
    evidenceData,
    opts,
  };
}

/** Every "failed" entry must carry the real message and blame nothing. */
function assertLocalFailureRecords(decisionDir, message, writerKeys) {
  const failed = failedRecords(decisionDir);
  assert.ok(failed.length > 0, 'the decision log must carry failed entries');
  for (const record of failed) {
    assert.equal(
      record.detail,
      message,
      'detail is the real error message: ' + JSON.stringify(record)
    );
    assert.equal(
      record.cause,
      'launch_config',
      'cause is launch_config: ' + JSON.stringify(record)
    );
    assert.equal(record.failureScope, 'local', 'scope is local: ' + JSON.stringify(record));
    for (const field of ['excluded', 'excludedSet']) {
      if (Array.isArray(record[field])) {
        for (const key of writerKeys) {
          assert.ok(
            !record[field].includes(key),
            record.stage +
              ' must not exclude the blameless candidate: ' +
              JSON.stringify(record[field])
          );
        }
      }
    }
  }
}

function assertNoEvidenceCooldown(evidenceData, writerKeys) {
  const cooldowns = (evidenceData && evidenceData.cooldowns) || {};
  assert.deepEqual(
    Object.keys(cooldowns),
    [],
    'a local infrastructure failure sets no evidence cooldown: ' + JSON.stringify(cooldowns)
  );
  const upstream = (evidenceData && evidenceData.upstreamStatus) || {};
  assert.deepEqual(Object.keys(upstream), [], 'no upstream cooldown either');
  for (const key of writerKeys) assert.equal(cooldowns[key], undefined);
}

test('LF-R01: a local launch infrastructure failure keeps the real message and blames nothing', async () => {
  const messages = [INVALID_MSG, CHECKOUT_MSG, PROVISION_MSG, REMOVE_MSG, CLONE_MSG];
  for (const message of messages) {
    const dir = tmpDir('task-ai-121-r01-');
    const host = makeRepo(path.join(dir, 'host'));
    const checkpointFile = path.join(dir, 'checkpoint.json');
    const f = launchHarness([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
      host,
      checkpointFile,
      decisionDir: path.join(dir, 'decisions'),
      usageDir: path.join(dir, 'usage'),
      run: () => {
        throw new Error(message);
      },
    });

    const log = await runOrchestration('LF-R01 ' + message.slice(0, 24), f.opts);

    assertLocalFailureRecords(f.opts.decisionDir, message, [f.writerKey, f.writer2Key]);
    assertNoEvidenceCooldown(f.evidenceData, [f.writerKey]);

    const failure = ((liveStepOf(checkpointFile, 'A') || {}).failures || [])[0];
    assert.ok(failure, 'the launch failure is checkpointed');
    assert.equal(failure.failureDomain, null, 'failureDomain is null');
    assert.equal(failure.failureScope, 'local');
    assert.equal(failure.cause, 'launch_config');

    const chosen = (log.selections || []).filter(
      (s) => s.workItemId === 'A' && s.decision && s.decision.chosen
    );
    assert.ok(
      chosen.length >= 2 && chosen[0].decision.chosen === chosen[1].decision.chosen,
      'the same candidate stays selectable after a local failure (' + message.slice(0, 24) + ')'
    );
  }
});

test('LF-R01: the failed detail is the first 300 chars of the message with secrets redacted', async () => {
  const message = 'PROVISION_BASE_MISMATCH: token sk-supersecret123 leaked ' + 'x'.repeat(350);
  const dir = tmpDir('task-ai-121-r01-detail-');
  const host = makeRepo(path.join(dir, 'host'));
  const f = launchHarness([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    host,
    checkpointFile: path.join(dir, 'checkpoint.json'),
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    run: () => {
      throw new Error(message);
    },
  });

  await runOrchestration('LF-R01 detail cap', f.opts);

  const failed = failedRecords(f.opts.decisionDir);
  assert.ok(failed.length > 0, 'the decision log must carry failed entries');
  for (const record of failed) {
    assert.equal(record.detail.length, 300, 'detail is capped at 300 chars');
    assert.ok(record.detail.startsWith('PROVISION_BASE_MISMATCH:'), record.detail.slice(0, 60));
    assert.ok(
      record.detail.includes('[REDACTED_SECRET]'),
      'the secret is redacted: ' + record.detail.slice(0, 80)
    );
    assert.ok(!record.detail.includes('sk-supersecret123'), 'no secret in the detail');
  }
});

test('LF-R02: a stale isolation verdict stops the run at the first launch', async () => {
  const dir = tmpDir('task-ai-121-r02-stale-');
  const host = makeRepo(path.join(dir, 'host'));
  const checkpointFile = path.join(dir, 'checkpoint.json');
  const f = launchHarness(
    [
      { id: 'A', files: ['a.js'], verification: { command: 'test' } },
      { id: 'B', files: ['b.js'], verification: { command: 'test' } },
    ],
    {
      host,
      twoWriters: true,
      checkpointFile,
      decisionDir: path.join(dir, 'decisions'),
      usageDir: path.join(dir, 'usage'),
      run: () => {
        throw new Error(STALE_MSG);
      },
    }
  );

  const log = await runOrchestration('LF-R02 stale verdict', f.opts);

  assert.equal(
    f.state.calls.length,
    1,
    'every candidate would fail the same way, so none is tried twice: ' +
      JSON.stringify(f.state.calls)
  );
  assert.equal(log.status, 'BLOCKED', JSON.stringify(log.reconciliation));

  for (const id of ['A', 'B']) {
    const outcome = outcomeOf(log, id);
    assert.equal(outcome.status, 'blocked', JSON.stringify(outcome));
    assert.ok(
      String(outcome.reason).startsWith('ISOLATION_VERDICT_STALE'),
      'reason is ISOLATION_VERDICT_STALE: ' + String(outcome.reason)
    );
    assert.equal(outcome.reasonCode, 'ISOLATION_VERDICT_STALE');
    assert.equal(outcome.humanAction, HUMAN_ACTION);
  }

  assertLocalFailureRecords(f.opts.decisionDir, STALE_MSG, [f.writerKey, f.writer2Key]);
  assertNoEvidenceCooldown(f.evidenceData, [f.writerKey, f.writer2Key]);
});

test('LF-R02: a missing isolation verdict stops the run the same way', async () => {
  const dir = tmpDir('task-ai-121-r02-missing-');
  const host = makeRepo(path.join(dir, 'host'));
  const f = launchHarness(
    [
      { id: 'A', files: ['a.js'], verification: { command: 'test' } },
      { id: 'B', files: ['b.js'], verification: { command: 'test' } },
    ],
    {
      host,
      twoWriters: true,
      checkpointFile: path.join(dir, 'checkpoint.json'),
      decisionDir: path.join(dir, 'decisions'),
      usageDir: path.join(dir, 'usage'),
      run: () => {
        throw new Error(MISSING_MSG);
      },
    }
  );

  const log = await runOrchestration('LF-R02 missing verdict', f.opts);

  assert.equal(f.state.calls.length, 1, 'no second candidate is launched');
  assert.equal(log.status, 'BLOCKED');
  for (const id of ['A', 'B']) {
    const outcome = outcomeOf(log, id);
    assert.equal(outcome.status, 'blocked');
    assert.ok(
      String(outcome.reason).startsWith('ISOLATION_VERDICT_MISSING'),
      'reason is ISOLATION_VERDICT_MISSING: ' + String(outcome.reason)
    );
    assert.equal(outcome.reasonCode, 'ISOLATION_VERDICT_MISSING');
    assert.equal(outcome.humanAction, HUMAN_ACTION);
  }
  assertLocalFailureRecords(f.opts.decisionDir, MISSING_MSG, [f.writerKey, f.writer2Key]);
});

test('LF-R03: --worker-timeout-min reaches the run as workerTimeoutMs', async () => {
  const dir = tmpDir('task-ai-121-r03-cli-');
  const specsFile = path.join(dir, 'specs.json');
  fs.writeFileSync(
    specsFile,
    JSON.stringify([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }])
  );
  const seen = [];
  const deps = {
    log: () => {},
    exit: () => {},
    candidates: [],
    registry: { sources: [] },
    accounts: [],
    registryAccounts: [],
    listAccounts: () => [],
    runOrchestration: async (_goal, opts) => {
      seen.push(opts);
      return {
        status: 'COMPLETED',
        reconciliation: { total: 1, completed: ['A'], blocked: [], deferred: [] },
        publications: [],
        outcomes: [],
      };
    },
  };
  const argsFor = (min) =>
    Object.assign(
      { _: ['orchestrate'], goal: 'LF-R03 flag', specs: specsFile },
      min === undefined ? {} : { 'worker-timeout-min': min }
    );

  await cli.orchestrateCommand(argsFor('45'), deps);
  assert.equal(seen[0].workerTimeoutMs, 45 * 60 * 1000, '45 minutes in ms');
  await cli.orchestrateCommand(argsFor(), deps);
  assert.equal(seen[1].workerTimeoutMs, 30 * 60 * 1000, 'the default is 30 minutes');
  await cli.orchestrateCommand(argsFor('1'), deps);
  assert.equal(seen[2].workerTimeoutMs, 60 * 1000, 'the lower bound is 1 minute');
  await cli.orchestrateCommand(argsFor('240'), deps);
  assert.equal(seen[3].workerTimeoutMs, 240 * 60 * 1000, 'the upper bound is 240 minutes');

  for (const bad of ['0', '241', 'abc', true]) {
    const before = seen.length;
    const res = await cli.orchestrateCommand(argsFor(bad), deps);
    assert.equal(res.exitCode, 2, 'a flag outside 1..240 is refused: ' + String(bad));
    assert.equal(seen.length, before, 'a refused flag runs nothing: ' + String(bad));
  }
});

test('LF-R03: workerTimeoutMs reaches writer, reviewer and repair launches and the run log', async () => {
  const dir = tmpDir('task-ai-121-r03-plumb-');
  const host = makeRepo(path.join(dir, 'host'));
  const f = launchHarness([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }], {
    host,
    workerTimeoutMs: 45 * 60 * 1000,
    checkpointFile: path.join(dir, 'checkpoint.json'),
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    run: (job, state) => {
      if (job.isReview) {
        state.reviewCalls += 1;
        const verdict =
          state.reviewCalls === 1
            ? {
                sha: job.baseSha,
                verdict: 'CHANGES_REQUIRED',
                findings: [{ id: 'F-1', open: true, detail: 'needs a repair' }],
              }
            : { sha: job.baseSha, verdict: 'PASS', findings: [] };
        fs.writeFileSync(
          job.verdictFile || path.join(job.cwd, 'verdict.json'),
          JSON.stringify(verdict)
        );
        return { exitCode: 0, stdout: 'review ' + state.reviewCalls };
      }
      const name =
        (job.labels && job.labels.repairOf ? 'repair-' : 'change-') + state.calls.length + '.js';
      commitIn(host, name, 'done\n');
      return { exitCode: 0, stdout: 'worker completed' };
    },
  });

  const log = await runOrchestration('LF-R03 timeout plumbing', f.opts);

  assert.equal(log.workerTimeoutMs, 45 * 60 * 1000, 'the run log records the timeout');
  assert.equal(outcomeOf(log, 'A').status, 'completed');

  const writers = f.state.calls.filter((c) => !c.isReview && !c.isRepair);
  const reviews = f.state.calls.filter((c) => c.isReview);
  const repairs = f.state.calls.filter((c) => c.isRepair);
  assert.ok(writers.length >= 1, 'a writer launched');
  assert.equal(reviews.length, 2, 'one refused round plus one passing round');
  assert.equal(repairs.length, 1, 'a repair launched');
  for (const call of f.state.calls) {
    assert.equal(
      call.workerTimeoutMs,
      45 * 60 * 1000,
      'every launch carries the timeout: ' + JSON.stringify(call)
    );
  }
});

test('LF-R03: the isolated launcher receives workerTimeoutMs', () => {
  const seen = [];
  const stub = (adapter, args, options) => {
    seen.push({ args, options });
    return { exitCode: 0, stdout: 'launched' };
  };
  const launcher = resolveLauncher({ workerTimeoutMs: 45 * 60 * 1000 }, stub);
  const res = launcher({
    harness: 'hermes',
    candidateKey: 'hermes::cli-x::gw-x::up-x::acct-x::scope-x::model-x',
    model: 'model-x',
    provider: 'gw-x',
    prompt: 'prompt',
    cwd: path.join('C:', 'worker'),
    hostWorktree: path.join('C:', 'host'),
    workerRoot: path.join('C:', 'worker'),
    baseSha: 'a'.repeat(40),
    branch: 'feat/task-ai-121',
    title: 'A',
  });
  assert.equal(res.exitCode, 0, JSON.stringify(res));
  assert.equal(seen.length, 1);
  assert.equal(
    seen[0].options.workerTimeoutMs,
    45 * 60 * 1000,
    'the isolated launcher is called with workerTimeoutMs'
  );
});

test('LF-R01: classifyFailure reports every launcher infrastructure error as launch_config/local', () => {
  const { classifyFailure, Cause, Scope } = require('../failure-classifier');
  for (const message of [
    STALE_MSG,
    MISSING_MSG,
    INVALID_MSG,
    CHECKOUT_MSG,
    PROVISION_MSG,
    REMOVE_MSG,
    CLONE_MSG,
  ]) {
    const result = classifyFailure({ exitCode: -1, stderr: message });
    assert.equal(result.cause, Cause.LAUNCH_CONFIG, message);
    assert.equal(result.scope, Scope.LOCAL, message);
    assert.equal(result.retryable, false, message);
  }
});
