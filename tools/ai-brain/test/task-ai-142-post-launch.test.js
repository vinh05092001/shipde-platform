'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runOrchestration, headShaOf, verifyCommitSha, ItemStatus } = require('../orchestrate');
const { readSessionId } = require('../executor');
const { candidateKey } = require('../candidates');
const { getHarness } = require('../harness');
const { readLaunchResult } = require('../isolation-launcher');
const { provisionReviewRoot } = require('../orchestrate');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'task-ai-142-post-launch-'));
}

function makeTempRepo() {
  const dir = tmpDir('repo-');
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  git(['init', '-q']);
  git(['config', 'user.email', 'worker@shipde.test']);
  git(['config', 'user.name', 'Worker']);
  fs.writeFileSync(path.join(dir, 'payload.txt'), 'base content\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return { dir, sha: git(['rev-parse', 'HEAD']).stdout.trim() };
}

function addCommit(repoDir, message) {
  fs.appendFileSync(path.join(repoDir, 'payload.txt'), 'more content\n');
  const git = (args) =>
    spawnSync('git', args, { cwd: repoDir, encoding: 'utf8', windowsHide: true });
  git(['add', '.']);
  git(['commit', '-q', '-m', message || 'worker commit']);
  return git(['rev-parse', 'HEAD']).stdout.trim();
}

function sampleCandidate(overrides) {
  const c = Object.assign(
    {
      harness: 'opencode',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'codex',
      quotaScope: 'codex',
      modelId: 'ninerouter/ag/gemini-3.1-pro-low',
      source: 'oc',
      kind: 'agent-cli',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 64000 },
      evidence: [{ status: 'passed', kind: 'WORK_ITEM_PASS', proofLevel: 'WORK_ITEM_PASS' }],
      quality: 99,
      cost: 1,
    },
    overrides || {}
  );
  c.candidateKey = candidateKey(c);
  return c;
}

function sampleRegistry() {
  return {
    sources: [
      {
        id: '9router',
        endpoint: 'https://gateway.example/v1',
        credential: { env: 'NINEROUTER_API_KEY' },
      },
    ],
    dispatch: {
      providers: {
        oc: { harness: 'opencode-direct', provider: 'opencode' },
      },
    },
  };
}

for (const gatePass of [true, false, 'repair-refused', 'repair-throw']) {
  test(`H3 post-launch live path: real launcher result, repair gate ${gatePass}`, async () => {
    const host = makeTempRepo();
    const worker = makeTempRepo();
    const checkpointFile = path.join(tmpDir(), 'checkpoint.json');
    let launches = 0;
    let gates = 0;
    let finalSha;
    let repairHead;
    let initialSha;
    let completedUsageFile;
    let completedJob;
    let repairUsageFile;
    let completedPathDuringRepair;
    let reviewed;
    const options = {
      isolatedWorker: true,
      cwd: host.dir,
      workerRoot: worker.dir,
      baseSha: worker.sha,
      checkpointFile,
      decisionDir: tmpDir(),
      evidenceDir: tmpDir(),
      candidates: [sampleCandidate()],
      registry: sampleRegistry(),
      specs: [{ id: 'H3-LIVE', files: ['a.js'], acceptanceCriteria: ['complete'] }],
      routeProbe: async () => ({ ok: true, status: 200 }),
      hostGate: () => ({ pass: ++gates > 1 && gatePass === true, failures: ['brain gate'] }),
      run: (job) => {
        if (launches++) {
          repairHead = job.retainWorkerHead;
          repairUsageFile = job.usageFile;
          completedPathDuringRepair = completedJob.usageFile;
        } else {
          completedUsageFile = job.usageFile;
          completedJob = job;
        }
        if (launches === 2 && gatePass === 'repair-throw') {
          throw new Error('WORKER_HEAD_MISMATCH: dirty tree');
        }
        if (launches === 2 && gatePass === 'repair-refused') {
          const file = path.join(tmpDir(), 'refused.json');
          fs.writeFileSync(
            file,
            JSON.stringify({
              completed: true,
              completionNonce: 'nonce',
              exitCode: 1,
              stderr: 'WORKER_HEAD_MISMATCH: dirty tree',
            })
          );
          return readLaunchResult(file, 'nonce', { status: 0 });
        }
        finalSha = addCommit(worker.dir, `launch ${launches}`);
        if (launches === 1) initialSha = finalSha;
        const file = path.join(tmpDir(), 'launch.json');
        fs.writeFileSync(
          file,
          JSON.stringify({
            completed: true,
            completionNonce: 'nonce',
            exitCode: 0,
            stdout: JSON.stringify({
              type: 'step_finish',
              sessionID: `ses_live_${launches}`,
              part: {
                tokens: { input: 10, output: 5 },
              },
            }),
          })
        );
        // Use the production isolated launch result parser, including its
        // absent artifact/isolation flags, rather than inventing a result.
        return readLaunchResult(file, 'nonce', { status: 0 });
      },
      tests: () => ({ pass: true }),
      reviewer: (arg) => {
        const sha = typeof arg === 'string' ? arg : arg.sha;
        reviewed = sha;
        const reviewRoot = path.join(tmpDir(), 'review');
        provisionReviewRoot(worker.dir, reviewRoot, sha);
        assert.equal(headShaOf(reviewRoot, { workerWritable: false }), sha);
        return { pass: true, sha, verdict: 'PASS', findings: [] };
      },
    };
    const result = await runOrchestration('live shape', options);
    assert.equal(launches, 2);
    assert.equal(
      result.sessions[0].sessionId,
      typeof gatePass === 'string' ? 'ses_live_1' : 'ses_live_2'
    );
    assert.equal(result.sessions[0].headSha, finalSha);
    assert.equal(repairHead, initialSha);
    assert.notEqual(repairUsageFile, completedUsageFile);
    assert.equal(completedPathDuringRepair, completedUsageFile);
    assert.equal(
      result.sessions[0].usageReport,
      typeof gatePass === 'string' ? completedUsageFile : repairUsageFile
    );
    assert.equal(JSON.parse(fs.readFileSync(completedUsageFile)).session_id, 'ses_live_1');
    const step = JSON.parse(fs.readFileSync(checkpointFile)).liveSteps['H3-LIVE'];
    assert.equal(step.launch.workerSha, finalSha);
    assert.equal(verifyCommitSha(worker.dir, finalSha), finalSha);
    if (gatePass === true) assert.equal(reviewed, finalSha);
    else {
      assert.equal(reviewed, undefined);
      assert.equal(step.reason, 'HOST_GATE_FAILED');
      await runOrchestration('live shape', options);
      assert.equal(launches, 2, 'a failed host gate must not relaunch or enter review on resume');
      assert.equal(reviewed, undefined);
    }
    const outcomes = fs
      .readdirSync(options.decisionDir)
      .filter((file) => file.endsWith('.jsonl'))
      .flatMap((file) =>
        fs.readFileSync(path.join(options.decisionDir, file), 'utf8').trim().split('\n')
      )
      .map((line) => JSON.parse(line))
      .filter((row) => row.stage === 'writer-launch-result');
    assert.deepEqual(
      outcomes.map((row) => row.kind),
      ['writer', 'host-gate-repair']
    );
    assert.equal(outcomes[0].sessionId, 'ses_live_1');
    assert.equal(
      outcomes[1].exitCode,
      gatePass === 'repair-throw' ? -1 : gatePass === 'repair-refused' ? 1 : 0
    );
    assert.equal(outcomes[0].runId, outcomes[1].runId);
    if (gatePass === 'repair-throw') assert.match(outcomes[1].stderr, /WORKER_HEAD_MISMATCH/);
  });
}

test('TASK-AI-142 Fix 1: readSessionId accepts isolated launch result sessionId and handles null adapter', () => {
  const job = { isolatedWorker: true };
  const res = { exitCode: 0, sessionId: 'ses_ec9cf2230fferFI7e1B1EGNGdJ' };

  // Adapter is null (as happens with harness 'opencode' when not mapped)
  const nullAdapterRes = readSessionId(null, job, res);
  assert.strictEqual(nullAdapterRes.id, 'ses_ec9cf2230fferFI7e1B1EGNGdJ');
  assert.strictEqual(nullAdapterRes.cause, null);

  // Adapter is opencode-direct
  const directAdapter = getHarness('opencode-direct');
  const directRes = readSessionId(directAdapter, job, res);
  assert.strictEqual(directRes.id, 'ses_ec9cf2230fferFI7e1B1EGNGdJ');
  assert.strictEqual(directRes.cause, null);

  // Adapter is hermes
  const hermesAdapter = getHarness('hermes');
  const hermesRes = readSessionId(hermesAdapter, job, res);
  assert.strictEqual(hermesRes.id, 'ses_ec9cf2230fferFI7e1B1EGNGdJ');
  assert.strictEqual(hermesRes.cause, null);

  // When session id is missing for isolated launch, returns named cause never undefined
  const missingRes = readSessionId(null, job, { exitCode: 0 });
  assert.strictEqual(missingRes.id, null);
  assert.strictEqual(missingRes.cause, 'HARNESS_NO_SESSION_ID');

  // When not isolated and adapter is null, returns HARNESS_UNKNOWN
  const nonIsolatedMissing = readSessionId(null, { isolatedWorker: false }, { exitCode: 0 });
  assert.strictEqual(nonIsolatedMissing.id, null);
  assert.strictEqual(nonIsolatedMissing.cause, 'HARNESS_UNKNOWN');
});

test('TASK-AI-142 Acceptance: isolated result with sessionId and commit in temp clone -> session accepted, recorded workerSha equals clone HEAD, item proceeds past launch', async () => {
  const hostRepo = makeTempRepo();
  const workerRepo = makeTempRepo();
  const workerCommitSha = addCommit(workerRepo.dir, 'commit c3ccec7c');
  assert.notStrictEqual(hostRepo.sha, workerCommitSha, 'worker commit differs from host HEAD');

  const decisionDir = tmpDir('decision-');
  const evidenceDir = tmpDir('evidence-');
  const checkpointFile = path.join(tmpDir('ckpt-'), 'checkpoint.json');
  const candidate = sampleCandidate();

  let reviewCalledWithSha = null;

  const result = await runOrchestration('test goal for task-ai-142', {
    isolatedWorker: true,
    cwd: hostRepo.dir,
    workerRoot: workerRepo.dir,
    baseSha: hostRepo.sha,
    sha: hostRepo.sha,
    decisionDir,
    evidenceDir,
    checkpointFile,
    candidates: [candidate],
    specs: [{ id: 'TASK-AI-142-FEAT', files: ['a.js'], acceptanceCriteria: ['item completes'] }],
    registry: sampleRegistry(),
    hostGate: () => ({ pass: true, failures: [] }),
    routeProbe: async () => ({ ok: true, status: 200, body: 'OK' }),
    run: (job) => ({
      exitCode: 0,
      stdout: 'the worker finished work\n',
      stderr: '',
      sessionId: 'ses_ec9cf2230fferFI7e1B1EGNGdJ',
      workerRoot: workerRepo.dir,
      workerSha: workerCommitSha,
    }),
    tests: () => ({ pass: true }),
    reviewer: (arg) => {
      reviewCalledWithSha = typeof arg === 'string' ? arg : arg && arg.sha;
      return {
        pass: true,
        sha: reviewCalledWithSha,
        verdict: 'PASS',
        findings: [],
      };
    },
    repairer: (findings, sha) => ({ sha }),
  });

  // 1. Session accepted (not NO_LIVE_SESSION)
  assert.ok(result.sessions && result.sessions.length > 0, 'a session must be recorded');
  const sess = result.sessions[0];
  assert.strictEqual(sess.sessionId, 'ses_ec9cf2230fferFI7e1B1EGNGdJ');

  // 2. Recorded workerSha equals that clone HEAD
  assert.strictEqual(sess.headSha, workerCommitSha, 'session headSha must equal worker clone HEAD');

  // Check checkpoint liveSteps
  const ckpt = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  const step = ckpt.liveSteps['TASK-AI-142-FEAT'];
  assert.ok(step && step.launch, 'checkpoint must have launch step');
  assert.strictEqual(step.launch.sessionId, 'ses_ec9cf2230fferFI7e1B1EGNGdJ');
  assert.strictEqual(
    step.launch.workerSha,
    workerCommitSha,
    'recorded workerSha in checkpoint must equal clone HEAD'
  );

  // 3. Item proceeds past launch to review
  assert.strictEqual(
    reviewCalledWithSha,
    workerCommitSha,
    'review must be called with the worker commit SHA'
  );
  assert.strictEqual(result.launches[0].outcome, 'launched');
});

test('TASK-AI-142 Fix 2: isolated launch where worker SHA cannot be verified records WORKER_SHA_UNVERIFIED instead of wrong SHA', async () => {
  const hostRepo = makeTempRepo();
  const emptyWorkerDir = tmpDir('empty-worker-');
  const decisionDir = tmpDir('decision-');
  const checkpointFile = path.join(tmpDir('ckpt-'), 'checkpoint.json');
  const candidate = sampleCandidate();

  const wrongHostSha = hostRepo.sha;
  let reviewerCalled = false;

  await runOrchestration('test goal with unverified worker SHA', {
    isolatedWorker: true,
    cwd: hostRepo.dir,
    workerRoot: emptyWorkerDir,
    baseSha: hostRepo.sha,
    sha: wrongHostSha,
    decisionDir,
    checkpointFile,
    candidates: [candidate],
    registry: sampleRegistry(),
    specs: [
      { id: 'TASK-AI-142-UNVERIFIED', files: ['a.js'], acceptanceCriteria: ['item completes'] },
    ],
    hostGate: () => ({ pass: true, failures: [] }),
    routeProbe: async () => ({ ok: true, status: 200, body: 'OK' }),
    run: (job) => ({
      exitCode: 0,
      stdout: 'completed without repo',
      stderr: '',
      sessionId: 'ses_mock_unverified',
      workerRoot: emptyWorkerDir,
    }),
    tests: () => ({ pass: false }),
    reviewer: () => {
      reviewerCalled = true;
      return { pass: false, verdict: 'BLOCKED' };
    },
  });

  const ckpt = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  const step = ckpt.liveSteps['TASK-AI-142-UNVERIFIED'];
  assert.ok(step && step.launch, 'checkpoint must have launch step');
  // It must NOT record wrong host SHA (which does not exist in worker root)
  assert.notStrictEqual(step.launch.workerSha, wrongHostSha, 'must not record wrong host SHA');
  assert.strictEqual(step.launch.workerSha, null, 'workerSha must be null when unverified');
  assert.strictEqual(step.launch.reason, 'WORKER_SHA_UNVERIFIED');
  assert.strictEqual(
    reviewerCalled,
    false,
    'must not proceed to review when worker SHA is unverified'
  );
});

test('TASK-AI-142 Review finding: isolated launch with no resolvable clone -> WORKER_SHA_UNVERIFIED, no job.cwd SHA recorded', async () => {
  const hostRepo = makeTempRepo();
  const decisionDir = tmpDir('decision-');
  const checkpointFile = path.join(tmpDir('ckpt-'), 'checkpoint.json');
  const candidate = sampleCandidate();

  let reviewCalled = false;

  const result = await runOrchestration('test goal with unresolvable worker clone', {
    isolatedWorker: true,
    cwd: hostRepo.dir,
    baseSha: hostRepo.sha,
    sha: hostRepo.sha,
    // Unresolvable worker clone: points to a non-existent directory
    workerRoot: path.join(tmpDir('nonexistent-clone-'), 'missing'),
    decisionDir,
    checkpointFile,
    candidates: [candidate],
    registry: sampleRegistry(),
    specs: [
      { id: 'TASK-AI-142-NO-CLONE', files: ['a.js'], acceptanceCriteria: ['item completes'] },
    ],
    hostGate: () => ({ pass: true, failures: [] }),
    routeProbe: async () => ({ ok: true, status: 200, body: 'OK' }),
    run: (job) => ({
      exitCode: 0,
      stdout: 'worker ran but clone cannot be resolved',
      stderr: '',
      sessionId: 'ses_mock_no_clone',
      // Untrusted launch-result fields attempting to override must be ignored
      workerRoot: hostRepo.dir,
      workerSha: hostRepo.sha,
    }),
    tests: () => ({ pass: true }),
    reviewer: () => {
      reviewCalled = true;
      return { pass: true, verdict: 'PASS' };
    },
  });

  const ckpt = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  const step = ckpt.liveSteps['TASK-AI-142-NO-CLONE'];
  assert.ok(step && step.launch, 'checkpoint must have launch step');
  assert.strictEqual(step.launch.workerSha, null, 'workerSha must be null');
  assert.strictEqual(step.launch.reason, 'WORKER_SHA_UNVERIFIED');
  assert.notStrictEqual(step.launch.workerSha, hostRepo.sha, 'must never record job.cwd SHA');

  // Verify session does not record hostRepo.sha / job.cwd SHA
  const sess = result.sessions && result.sessions[0];
  assert.ok(sess, 'session must be recorded');
  assert.strictEqual(sess.headSha, undefined);
  assert.strictEqual(sess.workerShaReason, 'WORKER_SHA_UNVERIFIED');

  // Must not proceed to review
  assert.strictEqual(reviewCalled, false, 'must not proceed to review');

  // Outcome must be BLOCKED with WORKER_SHA_UNVERIFIED
  const itemOutcome = result.outcomes.find((o) => o.workItemId === 'TASK-AI-142-NO-CLONE');
  assert.ok(itemOutcome, 'outcome must be recorded');
  assert.strictEqual(itemOutcome.status, ItemStatus.BLOCKED);
  assert.strictEqual(itemOutcome.reason, 'WORKER_SHA_UNVERIFIED');
});

test('TASK-AI-142 Fix 1: isolated launch with missing session ID records named cause and never generic NO_LIVE_SESSION', async () => {
  const hostRepo = makeTempRepo();
  const workerRepo = makeTempRepo();
  const decisionDir = tmpDir('decision-');
  const checkpointFile = path.join(tmpDir('ckpt-'), 'checkpoint.json');
  const candidate = sampleCandidate();

  const result = await runOrchestration('test goal with missing session ID', {
    isolatedWorker: true,
    cwd: hostRepo.dir,
    baseSha: hostRepo.sha,
    sha: hostRepo.sha,
    decisionDir,
    checkpointFile,
    candidates: [candidate],
    registry: sampleRegistry(),
    specs: [{ id: 'TASK-AI-142-NO-ID', files: ['a.js'], acceptanceCriteria: ['item completes'] }],
    hostGate: () => ({ pass: true, failures: [] }),
    routeProbe: async () => ({ ok: true, status: 200, body: 'OK' }),
    run: (job) => {
      if (job.usageFile) {
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: null }), 'utf8');
      }
      return {
        exitCode: 0,
        stdout: 'finished with no sessionId',
        stderr: '',
        workerRoot: workerRepo.dir,
      };
    },
    tests: () => ({ pass: false }),
  });

  // Verify terminal reason is NOT generic NO_LIVE_SESSION
  const ckpt = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  const step = ckpt.liveSteps['TASK-AI-142-NO-ID'];
  assert.ok(step, 'checkpoint must have step');
  assert.notStrictEqual(step.reason, 'NO_LIVE_SESSION');
  assert.strictEqual(step.reason, 'HARNESS_NO_SESSION_ID');
});

test('H3 repair: isolated workerRoot null never retains or records the host HEAD', async () => {
  const host = makeTempRepo();
  const worker = makeTempRepo();
  const checkpointFile = path.join(tmpDir(), 'checkpoint.json');
  let launches = 0;
  let reviewed = false;
  let completedJob;
  const result = await runOrchestration('missing repair root', {
    isolatedWorker: true,
    cwd: host.dir,
    workerRoot: worker.dir,
    checkpointFile,
    decisionDir: tmpDir(),
    evidenceDir: tmpDir(),
    candidates: [sampleCandidate()],
    registry: sampleRegistry(),
    specs: [{ id: 'H3-NULL-ROOT', files: ['a.js'], acceptanceCriteria: ['complete'] }],
    routeProbe: async () => ({ ok: true, status: 200 }),
    run: (job) => {
      launches++;
      completedJob = job;
      addCommit(worker.dir, 'worker result');
      return { exitCode: 0, stdout: 'completed', sessionId: 'ses_initial', isolatedWorker: true };
    },
    hostGate: (job) => {
      // Simulate loss of controller-owned root metadata with a valid host cwd.
      job.workerRoot = null;
      job.cwd = host.dir;
      return { pass: false, failures: ['brain gate'] };
    },
    tests: () => ({ pass: true }),
    reviewer: () => {
      reviewed = true;
      return { pass: true };
    },
  });
  assert.equal(launches, 1, 'an unverified root must never launch a repair');
  assert.equal(completedJob.retainWorkerHead, undefined);
  assert.equal(reviewed, false);
  const step = JSON.parse(fs.readFileSync(checkpointFile)).liveSteps['H3-NULL-ROOT'];
  assert.equal(step.launch.workerSha, null);
  assert.equal(step.reason, 'WORKER_SHA_UNVERIFIED');
  assert.equal(result.outcomes[0].reason, 'WORKER_SHA_UNVERIFIED');
  assert.ok(!result.sessions.some((session) => session.headSha === host.sha));
});
