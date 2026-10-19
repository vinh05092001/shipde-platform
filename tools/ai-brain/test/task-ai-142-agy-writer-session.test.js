'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { resolveLauncher, runOrchestration } = require('../orchestrate');
const { getHarness } = require('../harness');
const { readSessionId } = require('../executor');
const pool = require('../agy-pool-runtime');
const harness = require('../harness');
const { candidateKey } = require('../candidates');
function root(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-writer-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('pool writer launch persists a real job identity and reads its prose without JSON session parsing', (t) => {
  const dir = root(t);
  let submitted;
  const adapter = getHarness('agy-pool');
  const prepare = adapter.launch.bind(adapter);
  t.mock.method(adapter, 'launch', (job) => prepare(job, { runsDir: dir }));
  t.mock.method(harness, 'runHarness', () => ({
    exitCode: 0,
    stdout: 'fixture scheduler only',
    stderr: '',
  }));
  t.mock.method(pool, 'runAdapter', (account) => {
    const accountDir = pool.accountDir(account, { runsDir: dir });
    submitted = JSON.parse(fs.readFileSync(path.join(accountDir, 'job.json'), 'utf8'));
    fs.writeFileSync(
      path.join(accountDir, 'out.txt'),
      'I inspected the work item and completed the requested changes.'
    );
    fs.writeFileSync(
      path.join(accountDir, 'result.json'),
      JSON.stringify({ state: 'ok', exitCode: 0 })
    );
    return { exitCode: 0, stdout: 'scheduled', stderr: '' };
  });
  const launch = resolveLauncher(
    {
      externalWorkers: 'agy-pool',
      runsDir: dir,
      registry: { sources: [], dispatch: { agyPoolWriterEnabled: true } },
    },
    null
  );
  const job = {
    harness: 'agy-pool',
    accountId: 'agy01',
    model: 'fixture-model',
    cwd: dir,
    prompt: 'fixture task',
  };
  const result = launch(job);
  assert.equal(result.exitCode, 0);
  assert.ok(submitted?.jobId, 'the identity belongs to the submitted pool job');
  assert.equal(result.jobId, submitted.jobId);
  assert.equal(readSessionId(getHarness('agy-pool'), job, result).id, submitted.jobId);
  assert.match(result.stdout, /completed the requested changes/);
  const receiptFile = path.join(dir, 'agy01', 'jobs', submitted.jobId.split('/')[1] + '.json');
  assert.equal(JSON.parse(fs.readFileSync(receiptFile, 'utf8')).jobId, submitted.jobId);
  const another = launch(job);
  assert.notEqual(another.jobId, result.jobId, 'account reuse never aliases two submitted jobs');
  assert.ok(fs.existsSync(receiptFile), 'the old job keeps a durable receipt');
  assert.equal(
    harness.runHarness.mock.callCount(),
    0,
    'no scheduler process is launched by the fixture'
  );
  assert.equal(
    readSessionId(getHarness('agy-pool'), job, { jobId: 'other', accountId: 'agy02' }).id,
    null
  );
  assert.equal(result.isolatedWorker, undefined, 'external pool does not claim isolation');
  assert.equal(
    readSessionId(getHarness('agy-pool'), job, { stdout: 'plain prose' }).cause,
    'HARNESS_NO_SESSION_ID'
  );
});
function candidate(name) {
  const c = {
    harness: 'paseo',
    accessPath: 'cli',
    gateway: 'fixture',
    upstream: 'fixture',
    accountId: name,
    quotaScope: name,
    modelId: 'fixture/' + name,
    source: 'fixture',
    qualifiedRoles: ['author.foundation'],
    capabilities: {},
    quality: 70,
    cost: 1,
  };
  c.candidateKey = candidateKey(c);
  return c;
}
async function runFixture(t, limit, allFail, overrides = {}) {
  const dir = root(t);
  function git(args) {
    const r = cp.spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  }
  git(['init', '-q']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@example.test']);
  fs.writeFileSync(path.join(dir, 'fixture.txt'), 'fixture');
  git(['add', '.']);
  git(['commit', '-qm', 'fixture']);
  const calls = [],
    candidates = overrides.candidates || ['high', 'low', 'other'].map(candidate);
  const checkpointFile = path.join(dir, 'checkpoint.json');
  const log = await runOrchestration('fixture goal', {
    cwd: dir,
    baseSha: git(['rev-parse', 'HEAD']),
    candidates,
    specs: [
      {
        id: 'TRIAL14',
        files: ['fixture.txt'],
        acceptanceCriteria: ['fixture pass'],
        qualityFloor: 0,
      },
    ],
    registry: { sources: [], dispatch: { maxLocalWriterFallbacks: limit } },
    checkpointFile,
    evidenceDir: path.join(dir, 'evidence'),
    decisionDir: path.join(dir, 'decisions'),
    ranking: {
      enforceKnownQuota: false,
      useStoredQuota: false,
      explorationBudget: candidates.length,
    },
    run: (job) => {
      calls.push(job.candidateKey);
      return {
        exitCode: 0,
        stdout:
          calls.length === 1 || allFail
            ? 'plain prose'
            : JSON.stringify({ id: 'pool-result-fixture' }),
        hasArtifact: true,
      };
    },
    tests: () => ({ pass: true, command: 'fixture-only', exitCode: 0 }),
    ...overrides,
  });
  return {
    log,
    calls,
    candidates,
    checkpoint: JSON.parse(fs.readFileSync(checkpointFile, 'utf8')),
  };
}
test('one local session failure selects the next equal-score writer without blaming its source', async (t) => {
  const { log, calls, candidates } = await runFixture(t, 2, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], candidateKey(candidates[0]));
  assert.equal(calls[1], candidateKey(candidates[1]));
  assert.equal(log.sessions[0]?.sessionId, 'pool-result-fixture');
});
test('local writer fallback stops at the configured limit and keeps each failure reason', async (t) => {
  const { log, calls, checkpoint } = await runFixture(t, 1, true);
  assert.equal(calls.length, 2);
  assert.match(log.outcomes[0].reason, /LOCAL_WRITER_FALLBACK_LIMIT/);
  assert.equal(log.outcomes[0].reasonCode, 'LOCAL_WRITER_FALLBACK_LIMIT');
  assert.equal(checkpoint.liveSteps.TRIAL14.failures.length, 2);
  assert.ok(
    checkpoint.liveSteps.TRIAL14.failures.every(
      (f) => f.failureScope === 'local' && f.cause === 'HARNESS_INVALID_JSON'
    )
  );
  assert.match(log.outcomes[0].reason, /HARNESS_INVALID_JSON/);
});

test('local candidate failures do not exhaust the shared upstream attempt budget', async (t) => {
  const { calls, checkpoint } = await runFixture(t, 2, true);
  assert.equal(calls.length, 3);
  assert.equal(checkpoint.liveSteps.TRIAL14.failures.length, 3);
});

test('goal orchestration uses the authorized pool submission and keeps its durable job session', async (t) => {
  const runsDir = root(t);
  const adapter = getHarness('agy-pool');
  const prepare = adapter.launch.bind(adapter);
  t.mock.method(adapter, 'launch', (job) => prepare(job, { runsDir }));
  t.mock.method(harness, 'runHarness', () => ({
    exitCode: 0,
    stdout: 'fixture scheduler only',
    stderr: '',
  }));
  let submitted;
  t.mock.method(pool, 'runAdapter', (account) => {
    const dir = pool.accountDir(account, { runsDir });
    submitted = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
    fs.writeFileSync(
      path.join(dir, 'out.txt'),
      'The requested changes are ready for verification.'
    );
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ state: 'ok', exitCode: 0 }));
    return { exitCode: 0 };
  });
  const c = { ...candidate('pool'), harness: 'agy-pool', accountId: 'agy01' };
  c.candidateKey = candidateKey(c);
  const { log } = await runFixture(t, 1, false, {
    candidates: [c],
    run: undefined,
    runsDir,
    // Without an injected run the host brain gate would run this repository's
    // whole suite from inside the test (30 minutes on Linux CI).
    hostGate: () => ({ pass: true, command: 'fixture-only', failures: [], summary: [] }),
    externalWorkers: 'agy-pool',
    registry: { sources: [], dispatch: { agyPoolWriterEnabled: true, maxLocalWriterFallbacks: 1 } },
  });
  assert.ok(submitted?.jobId);
  assert.equal(log.sessions[0]?.sessionId, submitted.jobId);
  assert.equal(harness.runHarness.mock.callCount(), 0);
});

test('a zero local fallback configuration never launches another writer', async (t) => {
  const { calls, log } = await runFixture(t, 0, true);
  assert.equal(calls.length, 1);
  assert.match(log.outcomes[0].reason, /LOCAL_WRITER_FALLBACK_LIMIT/);
  assert.equal(log.outcomes[0].reasonCode, 'LOCAL_WRITER_FALLBACK_LIMIT');
});
