'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ciGate = require('../ci-gate');
const { getDispatchConfig } = require('../sources');
const { scanAllQuotas, isQuotaScanDue } = require('../quota-scan');
const { createPlanningServices } = require('../planning-services');
const { getIsolatedLauncher } = require('../isolation-launcher');
const decisions = require('../decisions');

// Finding 1: CI bypass on resume
test('Finding 1: resume after draft publication does not skip CI verification and blocks on CI failure', async () => {
  const orchestrate = require('../orchestrate');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-resume-test-'));
  try {
    const workItemId = 'FEAT-RESUME-01';
    const sha = '1'.repeat(40);
    const checkpointFile = path.join(dir, 'checkpoint.json');
    const checkpointData = {
      reviews: [
        {
          workItemId,
          sha,
          reviewedSha: sha,
          verdict: 'PASS',
          reviewer: 'test-reviewer',
          openFindings: 0,
          reviewRounds: 1,
          branch: 'feat/test-resume',
          draftTitle: 'test draft',
        },
      ],
      liveSteps: {
        [workItemId]: {
          publication: {
            status: orchestrate.PublicationStatus.PUBLISHED_DRAFT,
            branch: 'feat/test-resume',
            result: { number: 42, branch: 'feat/test-resume' },
          },
        },
      },
    };
    fs.writeFileSync(checkpointFile, JSON.stringify(checkpointData), 'utf8');

    let ciCalled = false;
    const ghRunner = (args) => {
      ciCalled = true;
      if (args[0] === 'pr') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            headRefOid: sha,
            statusCheckRollup: [{ name: 'contract', status: 'COMPLETED', conclusion: 'FAILURE' }],
          }),
          stderr: '',
        };
      }
      if (args[0] === 'run') {
        return { exitCode: 0, stdout: 'FAIL: build failed', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    };

    const result = await orchestrate.runOrchestration(workItemId, {
      specs: [{ id: workItemId }],
      checkpointFile,
      decisionDir: dir,
      ghRunner,
      ciSleep: async () => {},
      ciPollIntervalMs: 1,
      ciTimeoutMs: 100,
    });

    assert.equal(ciCalled, true, 'CI gate must be called on resume');
    const outcome = (result.outcomes || []).find((o) => o.workItemId === workItemId);
    assert.ok(outcome, 'Outcome must be recorded for resumed item');
    assert.equal(outcome.status, orchestrate.ItemStatus.BLOCKED);
    assert.equal(outcome.reasonCode, 'CI_GATE_FAILED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Finding 2: Missing required checks and SKIPPED/NEUTRAL fail closed
test('Finding 2: missing required checks return PENDING; SKIPPED or NEUTRAL return FAIL', () => {
  const SHA = 'a'.repeat(40);
  const required = ['contract', 'application-gate'];

  // Only unrelated check present
  const unrelatedRollup = [{ name: 'unrelated', status: 'COMPLETED', conclusion: 'SUCCESS' }];
  const r1 = ciGate.classifyRollup(unrelatedRollup, required);
  assert.equal(r1.state, 'PENDING', 'Missing required checks must return PENDING');

  // One required check missing
  const partialRollup = [{ name: 'contract', status: 'COMPLETED', conclusion: 'SUCCESS' }];
  const r2 = ciGate.classifyRollup(partialRollup, required);
  assert.equal(r2.state, 'PENDING');

  // SKIPPED conclusion
  const skippedRollup = [
    { name: 'contract', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'application-gate', status: 'COMPLETED', conclusion: 'SKIPPED' },
  ];
  const r3 = ciGate.classifyRollup(skippedRollup, required);
  assert.equal(r3.state, 'FAIL', 'SKIPPED required check must return FAIL');

  // NEUTRAL conclusion
  const neutralRollup = [
    { name: 'contract', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    { name: 'application-gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ];
  const r4 = ciGate.classifyRollup(neutralRollup, required);
  assert.equal(r4.state, 'FAIL', 'NEUTRAL check must return FAIL');

  // Both SUCCESS
  const successRollup = [
    { name: 'contract', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'application-gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ];
  const r5 = ciGate.classifyRollup(successRollup, required);
  assert.equal(r5.state, 'PASS');

  // Finding 9: Path-filtered skip on unrelated check must NOT fail
  const pathFilteredRollup = [
    { name: 'contract', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'application-gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'product-spec-validation', status: 'COMPLETED', conclusion: 'SKIPPED' },
  ];
  const r6 = ciGate.classifyRollup(pathFilteredRollup, required);
  assert.equal(r6.state, 'PASS', 'Path-filtered unrelated check must stay non-failing');
});

// Finding 3: Provisioning is per-worker; shared cache stays immutable and worker 1 links keep pointing to worker 1 after worker 2 is provisioned
test('Finding 3: two workers sharing cache keep independent workspace links pointing to their own checkout', () => {
  const { retargetSharedDepsWorkspaceLinks } = require('../isolation-launcher');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-deps-test-'));
  try {
    const depsDir = path.join(tmp, 'deps');
    const workerA = path.join(tmp, 'workerA');
    const workerB = path.join(tmp, 'workerB');

    const contractsA = path.join(workerA, 'packages', 'contracts');
    const contractsB = path.join(workerB, 'packages', 'contracts');
    fs.mkdirSync(contractsA, { recursive: true });
    fs.mkdirSync(contractsB, { recursive: true });

    const shipdeInDeps = path.join(depsDir, 'packages', 'contracts', 'node_modules', '@shipde');
    fs.mkdirSync(shipdeInDeps, { recursive: true });

    // Initial link in shared deps points to deps itself
    const initialTarget = path.join(depsDir, 'packages', 'contracts');
    fs.mkdirSync(initialTarget, { recursive: true });
    const pkgLinkInDeps = path.join(shipdeInDeps, 'contracts');
    fs.symlinkSync(initialTarget, pkgLinkInDeps, 'junction');

    // Worker A provisions links using the isolation-launcher implementation
    retargetSharedDepsWorkspaceLinks(depsDir, workerA);

    // Shared deps must remain untouched and immutable
    const depsLinkTarget = path.resolve(
      path.dirname(pkgLinkInDeps),
      fs.readlinkSync(pkgLinkInDeps)
    );
    assert.equal(
      depsLinkTarget.toLowerCase(),
      initialTarget.toLowerCase(),
      'Shared deps cache entry must remain immutable'
    );

    // Worker A link resolves to Worker A's checkout
    const pkgLinkA = path.join(
      workerA,
      'packages',
      'contracts',
      'node_modules',
      '@shipde',
      'contracts'
    );
    assert.ok(fs.existsSync(pkgLinkA), 'Worker A workspace link must exist in worker checkout');
    const linkAfterA = fs.readlinkSync(pkgLinkA);
    assert.equal(
      path.resolve(path.dirname(pkgLinkA), linkAfterA).toLowerCase(),
      contractsA.toLowerCase(),
      'Worker A workspace link must point to worker A'
    );

    // Worker B provisions links sharing the same depsDir
    retargetSharedDepsWorkspaceLinks(depsDir, workerB);

    // Shared deps must still remain untouched and immutable
    assert.equal(
      path.resolve(path.dirname(pkgLinkInDeps), fs.readlinkSync(pkgLinkInDeps)).toLowerCase(),
      initialTarget.toLowerCase(),
      'Shared deps cache entry must stay immutable after worker B provision'
    );

    // Worker B link resolves to Worker B's checkout
    const pkgLinkB = path.join(
      workerB,
      'packages',
      'contracts',
      'node_modules',
      '@shipde',
      'contracts'
    );
    assert.ok(fs.existsSync(pkgLinkB), 'Worker B workspace link must exist in worker checkout');
    const linkAfterB = fs.readlinkSync(pkgLinkB);
    assert.equal(
      path.resolve(path.dirname(pkgLinkB), linkAfterB).toLowerCase(),
      contractsB.toLowerCase(),
      'Worker B workspace link must point to worker B'
    );

    // Concurrent/sequential isolation: Worker A's link MUST STILL resolve to Worker A's checkout!
    const linkAfterBForA = fs.readlinkSync(pkgLinkA);
    assert.equal(
      path.resolve(path.dirname(pkgLinkA), linkAfterBForA).toLowerCase(),
      contractsA.toLowerCase(),
      'Worker A workspace link must still point to worker A after worker B is provisioned'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Finding 4: Unknown author fails closed
test('Finding 4: unknown author fails closed for independent review', async () => {
  const services = createPlanningServices();
  const sha = '2'.repeat(40);

  // Calling reviewAtSha without authorKey fails closed
  const r1 = await services.reviewAtSha({
    workItemId: 'FEAT-UNKNOWN-01',
    sha,
    authorKey: null,
  });
  assert.equal(r1.verdict, 'BLOCKED');
  assert.match(r1.reason, /AUTHOR_UNKNOWN/);

  // Calling reviewPullRequest without author evidence fails closed
  const r2 = await services.reviewPullRequest({
    pr: 99,
    sha,
    authorKey: null,
    gh: () => ({
      ok: true,
      stdout: JSON.stringify({
        headRefOid: sha,
        title: '[FEAT-UNKNOWN-01] test',
        headRefName: 'feat/x',
      }),
      stderr: '',
    }),
    git: () => ({ ok: true, stdout: '', stderr: '' }),
  });
  assert.equal(r2.verdict, 'BLOCKED');
  assert.match(r2.reason, /AUTHOR_UNKNOWN/);
});

// Finding 5: Secret redaction in diagnostics and CI logs
test('Finding 5: bearer tokens are redacted in launcher diagnostics and CI logs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-test-'));
  try {
    const rawSecret = 'Bearer sk-synthetic-token-1234567890';
    ciGate.writeCiFailure(dir, 'FEAT-SECRET-01', {
      sha: '3'.repeat(40),
      failed: ['verify'],
      log: 'Failed authentication: ' + rawSecret,
    });
    const findings = ciGate.ciFindingsFor(dir, 'FEAT-SECRET-01', '3'.repeat(40));
    assert.equal(findings.length, 1);
    assert.doesNotMatch(findings[0].detail, /sk-synthetic-token/);
    assert.match(findings[0].detail, /\[REDACTED_SECRET\]/);

    const saved = JSON.parse(
      fs.readFileSync(path.join(dir, 'ci-failure-FEAT-SECRET-01.json'), 'utf8')
    );
    assert.doesNotMatch(saved.log, /sk-synthetic-token/);
    assert.match(saved.log, /\[REDACTED_SECRET\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Finding 6: Historical events from other root/SHA/run/freshness do not authorize dirty commit
test('Finding 6: historical events from other root/SHA/run/freshness do not authorize dirty commit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-events-test-'));
  try {
    const launcherModule = require('../isolation-launcher');
    const s = {
      workItemId: 'FEAT-HIST-01',
      workerRoot: path.join(dir, 'target-worker'),
      baseSha: '4'.repeat(40),
      retainWorkerHead: '4'.repeat(40),
      decisionDir: dir,
      runId: 'RUN-CURRENT',
    };
    const extra = {
      workerRoot: s.workerRoot,
      retainedHeadSha: s.baseSha,
      runId: s.runId,
    };

    // 1. Foreign worker root must be rejected
    decisions.recordDecision(
      {
        stage: 'writer-launch-result',
        workItemId: 'FEAT-HIST-01',
        workerRoot: path.join(dir, 'other-worker'),
        sha: s.baseSha,
        runId: s.runId,
        at: new Date().toISOString(),
      },
      { dir }
    );
    assert.equal(launcherModule.retainedRootHasOwnWriterRecord(s, extra), false);

    // 2. Foreign SHA must be rejected
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    decisions.recordDecision(
      {
        stage: 'writer-launch-result',
        workItemId: 'FEAT-HIST-01',
        workerRoot: s.workerRoot,
        sha: '9'.repeat(40),
        runId: s.runId,
        at: new Date().toISOString(),
      },
      { dir }
    );
    assert.equal(launcherModule.retainedRootHasOwnWriterRecord(s, extra), false);

    // 3. Foreign runId must be rejected
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    decisions.recordDecision(
      {
        stage: 'writer-launch-result',
        workItemId: 'FEAT-HIST-01',
        workerRoot: s.workerRoot,
        sha: s.baseSha,
        runId: 'OTHER-RUN',
        at: new Date().toISOString(),
      },
      { dir }
    );
    assert.equal(launcherModule.retainedRootHasOwnWriterRecord(s, extra), false);

    // 4. Stale record must be rejected
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    decisions.recordDecision(
      {
        stage: 'writer-launch-result',
        workItemId: 'FEAT-HIST-01',
        workerRoot: s.workerRoot,
        sha: s.baseSha,
        runId: s.runId,
        at: new Date(Date.now() - 4000000).toISOString(),
      },
      { dir }
    );
    assert.equal(launcherModule.retainedRootHasOwnWriterRecord(s, extra), false);

    // 5. Bare record lacking workerRoot/sha/runId/timestamp must be rejected
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    decisions.recordDecision(
      {
        stage: 'writer-launch-result',
        workItemId: 'FEAT-HIST-01',
      },
      { dir }
    );
    assert.equal(launcherModule.retainedRootHasOwnWriterRecord(s, extra), false);

    // 6. Matching fresh record with all required fields is accepted
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    decisions.recordDecision(
      {
        stage: 'writer-launch-result',
        workItemId: 'FEAT-HIST-01',
        workerRoot: s.workerRoot,
        sha: s.baseSha,
        runId: s.runId,
        at: new Date().toISOString(),
      },
      { dir }
    );
    assert.equal(launcherModule.retainedRootHasOwnWriterRecord(s, extra), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Finding 7: Generic PR reviewer receives actual Work Item requirements
test('Finding 7: generic PR reviewer receives actual Work Item requirements, not plan-doc criteria', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-contract-test-'));
  try {
    const itemDir = path.join(dir, 'docs', 'product-spec', 'work-items');
    fs.mkdirSync(itemDir, { recursive: true });
    const workItemId = 'FEAT-CONTRACT-01';
    const itemContent = `# FEAT-CONTRACT-01 — Custom Feature

| Field | Value |
| --- | --- |
| Allowed paths | \`apps/api/custom.js\`, \`packages/contracts/spec.json\` |

## Acceptance
| Criterion | Details |
| User can create | API returns 201 |
`;
    fs.writeFileSync(path.join(itemDir, workItemId + '.md'), itemContent, 'utf8');

    let receivedItem = null;
    const services = createPlanningServices({
      rootDir: dir,
      selectCandidate: async () => ({ chosen: 'test-reviewer' }),
      reviewLane: (o, item) => {
        receivedItem = item;
        return async () => ({ verdict: 'PASS', reviewer: 'test-reviewer', findings: [] });
      },
    });

    // Implementation review (isPlanReview = false)
    await services.reviewAtSha({
      workItemId,
      sha: '5'.repeat(40),
      baseSha: '0'.repeat(40),
      authorKey: 'test-author',
      authorRoot: dir,
      isPlanReview: false,
    });

    assert.ok(receivedItem, 'Review lane must receive an item');
    assert.ok(
      receivedItem.allowedPaths.includes('apps/api/custom.js'),
      'Must load actual allowed paths from Work Item'
    );
    assert.ok(receivedItem.allowedPaths.includes('packages/contracts/spec.json'));
    assert.ok(
      receivedItem.acceptanceCriteria.some((ac) => ac.includes('API returns 201')),
      'Must load actual acceptance criteria'
    );

    // Planning review (isPlanReview = true)
    receivedItem = null;
    await services.reviewAtSha({
      workItemId,
      sha: '5'.repeat(40),
      baseSha: '0'.repeat(40),
      authorKey: 'test-author',
      authorRoot: dir,
      isPlanReview: true,
    });
    assert.ok(receivedItem, 'Review lane must receive an item');
    assert.ok(
      receivedItem.allowedPaths.includes(
        'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv'
      )
    );
    assert.ok(
      receivedItem.acceptanceCriteria[0].includes(
        'Only the Work Item document and the register row'
      )
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Finding 8: No-route limits read via getDispatchConfig
test('Finding 8: blockedNoRoute limits are exposed via getDispatchConfig and read from registry', () => {
  const cfg = getDispatchConfig();
  assert.equal(typeof cfg.blockedNoRouteTimeoutMs, 'number');
  assert.equal(typeof cfg.blockedNoRoutePollIntervalMs, 'number');
  assert.equal(cfg.blockedNoRouteTimeoutMs, 3600000);
  assert.equal(cfg.blockedNoRoutePollIntervalMs, 30000);

  // Custom registry values
  const custom = getDispatchConfig({
    dispatch: {
      blockedNoRouteTimeoutMs: 120000,
      blockedNoRoutePollIntervalMs: 5000,
    },
  });
  assert.equal(custom.blockedNoRouteTimeoutMs, 120000);
  assert.equal(custom.blockedNoRoutePollIntervalMs, 5000);
});

// Finding 9: scanAllQuotas respects ifDue
test('Finding 9: scanAllQuotas respects ifDue and skips scanning when fresh', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-ifdue-test-'));
  try {
    const quotaFile = path.join(tmp, 'quota-state.json');
    const now = Date.now();
    const freshState = {
      updatedAt: new Date(now - 1000).toISOString(),
      scopes: {
        'test-src': { code: 'HEALTHY', at: new Date(now - 1000).toISOString() },
      },
    };
    fs.writeFileSync(quotaFile, JSON.stringify(freshState), 'utf8');

    // With ifDue: true, when last scan was 1 second ago, it should be gated
    const result = await scanAllQuotas({
      quotaStateFile: quotaFile,
      ifDue: true,
      now,
      intervalMin: 60,
    });
    assert.equal(result.gated, true, 'Scan must be gated when fresh');
    assert.equal(result.count, 0, 'No scopes scanned when gated');

    // Without ifDue, scan is not gated
    let probeCalled = false;
    const resultUnforced = await scanAllQuotas({
      quotaStateFile: quotaFile,
      ifDue: false,
      now,
      registry: { sources: [] },
    });
    assert.equal(resultUnforced.gated, undefined);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 3 Finding 1 (P0): Hook enforcement in planning-services
test('Round 3 Finding 1: defaultGit enforces installed pre-commit hook on commit and fails closed if missing', () => {
  const { defaultGit } = require('../planning-services');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-hook-test-'));
  try {
    const cp = require('node:child_process');
    cp.execSync('git init', { cwd: tmp, stdio: 'pipe' });
    // Without pre-commit hook, defaultGit commit must fail closed
    const res = defaultGit(tmp, ['commit', '-m', 'test']);
    assert.equal(res.ok, false);
    assert.match(res.stderr, /HOOK_CHECK_FAILED: installed pre-commit hook missing/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 3 Finding 2 (P0): Verification is not weakened
test('Round 3 Finding 2: verification command does not strip pnpm install or set TURBO_ENV_MODE/IS_WEBPACK_TEST', () => {
  const orchestrate = require('../orchestrate');
  let capturedCmd = null;
  let capturedEnv = null;
  const mockSpawnSync = (cmd, opts) => {
    capturedCmd = cmd;
    capturedEnv = opts ? opts.env : {};
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const oldVal = process.env.pnpm_config_verify_deps_before_run;
  delete process.env.pnpm_config_verify_deps_before_run;
  try {
    orchestrate.runVerificationCommand(
      { verification: { command: 'pnpm install --frozen-lockfile && pnpm test' } },
      {
        isolatedWorker: true,
        workerRoot: os.tmpdir(),
        spawnSync: mockSpawnSync,
      }
    );
    assert.match(capturedCmd, /^pnpm\s+install/i, 'Must not strip leading pnpm install');
    assert.equal(capturedEnv.TURBO_ENV_MODE, undefined, 'Must not set TURBO_ENV_MODE');
    assert.equal(capturedEnv.IS_WEBPACK_TEST, undefined, 'Must not set IS_WEBPACK_TEST');
    assert.equal(capturedEnv.pnpm_config_verify_deps_before_run, undefined);
  } finally {
    if (oldVal !== undefined) process.env.pnpm_config_verify_deps_before_run = oldVal;
  }
});

// Round 3 Finding 3 (P0): CLI does not force agy-pool for isolated worker
test('Round 3 Finding 3: cli orchestrate with --isolated-worker does not force agy-pool', async () => {
  const cli = require('../cli');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
  try {
    const specsFile = path.join(tmp, 'specs.json');
    fs.writeFileSync(specsFile, JSON.stringify([{ id: 'FEAT-CLI-01' }]));
    const args = {
      'isolated-worker': true,
      goal: 'test goal',
      specs: specsFile,
      _: ['orchestrate', 'FEAT-CLI-01'],
    };
    await cli.orchestrateCommand(args, {
      registry: { sources: [] },
      discoveryDataDir: tmp,
      exit: () => {},
      log: () => {},
      runOrchestration: async () => ({ status: 'COMPLETED', outcomes: [] }),
    });
    assert.equal(args['external-workers'], undefined, 'Must not force external-workers=agy-pool');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 3 Finding 6 (P1): agy-pool-runtime has no NODE_TEST_CONTEXT branch and uses config
test('Round 3 Finding 6: agy-pool-runtime uses configured timeout and has no NODE_TEST_CONTEXT branch', () => {
  const pool = require('../agy-pool-runtime');
  const timeout = pool.poolTimeoutMs({
    registry: { dispatch: { agyPoolTimeoutMs: 75000 } },
  });
  assert.equal(timeout, 75000, 'Must use configured timeout without 1000ms test clamp');
});

// Round 3 Finding 7 (P1): defaultGh and defaultPublishPlan have no test-mode bypass
test('Round 3 Finding 7: defaultGh and defaultPublishPlan have no test-mode bypass', async () => {
  const { defaultGh, defaultPublishPlan } = require('../planning-services');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-plan-test-'));
  try {
    // defaultGh executes real spawn (not returning mock gh)
    const ghRes = defaultGh(tmp, ['--version']);
    // Either exits with code 0 (if gh installed) or fails to spawn/execute, but stderr is not 'mock gh: test mode'
    assert.doesNotMatch(ghRes.stderr, /mock gh: test mode/);

    // defaultPublishPlan does not return simulated: true
    const plan = { branch: 'feat/test', headSha: 'a'.repeat(40), workerRoot: tmp };
    const pubRes = await defaultPublishPlan({
      workItemId: 'FEAT-PUB-01',
      plan,
      rootDir: tmp,
      git: () => ({ ok: false, stderr: 'network disabled' }),
      gh: () => ({ ok: false, stdout: '', stderr: 'gh disabled' }),
      base: 'main',
    });
    assert.equal(pubRes.simulated, undefined, 'Must not return simulated: true in test mode');
    assert.equal(pubRes.ok, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 3 Finding 8 (P1): ci-gate and next-runner fail closed on invalid or missing limits
test('Round 3 Finding 8: awaitCi and next-runner fail closed on invalid or missing poll/timeout limits', async () => {
  // awaitCi with invalid timeout fails closed
  const res = await ciGate.awaitCi({
    dispatch: { ciGate: { pollIntervalMs: 'invalid', timeoutMs: 0 } },
  });
  assert.equal(res.state, 'CONFIG_ERROR');
  assert.match(res.reason, /INVALID_CI_GATE_CONFIG/);

  // fetchFailedLog without maxLogChars throws error
  assert.throws(() => ciGate.fetchFailedLog([], { maxLogChars: null }), /INVALID_CI_GATE_CONFIG/);

  // next-runner with invalid limits throws error
  const nextRunner = require('../next-runner');
  await assert.rejects(
    () =>
      nextRunner.nextLoop(
        {},
        {
          registry: { dispatch: { blockedNoRouteTimeoutMs: -1, blockedNoRoutePollIntervalMs: 0 } },
        }
      ),
    /DISPATCH_CONFIG_INVALID|INVALID_DISPATCH_CONFIG/
  );
});

// Round 3 Finding 10 (P1): Review/writer integrity: strict JSON parsing, no prose object extraction
test('Round 3 Finding 10: writer-schema and poolResultText reject embedded JSON in prose', () => {
  const schemaApi = require('../writer-schema');
  const schema = {
    type: 'object',
    required: ['candidateKey', 'nonce', 'status', 'artifacts'],
    properties: {
      candidateKey: { type: 'string', enum: ['key1'] },
      nonce: { type: 'string', enum: ['nonce1'] },
      status: { type: 'string', enum: ['completed'] },
      artifacts: { type: 'array', items: { type: 'string' } },
    },
  };
  const proseWithJson =
    'Here is the result: {"candidateKey":"key1","nonce":"nonce1","status":"completed","artifacts":[]} hope this helps!';
  const validated = schemaApi.validate(proseWithJson, schema);
  assert.equal(validated.ok, false, 'Embedded JSON in prose must be rejected');
  assert.equal(validated.reason, 'WRITER_RESULT_INVALID_JSON');

  const envelopeWithProse = JSON.stringify({
    response: 'Some prose {"verdict":"CHANGES_REQUIRED","sha":"deadbeef"} more text',
  });
  const poolText = schemaApi.poolResultText(envelopeWithProse);
  assert.equal(poolText, 'Some prose {"verdict":"CHANGES_REQUIRED","sha":"deadbeef"} more text');
});

// Round 3 Finding 11 (P1): Reviewer independence checks full identity and rejects author mismatch
test('Round 3 Finding 11: isReviewerIndependent checks full identity dimensions and reviewPullRequest rejects author mismatch', async () => {
  const { isReviewerIndependent, createPlanningServices } = require('../planning-services');
  const author = 'opencode::api::gw-1::up-1::acct-1::scope-1::model-1';
  // Same harness
  const sameHarness = 'opencode::api::gw-2::up-2::acct-2::scope-2::model-2';
  assert.equal(
    isReviewerIndependent(author, sameHarness),
    false,
    'Same harness must not be independent'
  );

  // Same account
  const sameAccount = 'codex::cli::gw-2::up-2::acct-1::scope-2::model-2';
  assert.equal(
    isReviewerIndependent(author, sameAccount),
    false,
    'Same account must not be independent'
  );

  // Same upstream
  const sameUpstream = 'claude::cli::gw-2::up-1::acct-2::scope-2::model-2';
  assert.equal(
    isReviewerIndependent(author, sameUpstream),
    false,
    'Same upstream must not be independent'
  );

  // Same gateway
  const sameGateway = 'hermes::cli::gw-1::up-2::acct-2::scope-2::model-2';
  assert.equal(
    isReviewerIndependent(author, sameGateway),
    false,
    'Same gateway must not be independent'
  );

  // Distinct full identity
  const distinct = 'codex::cli::gw-2::up-2::acct-2::scope-2::model-2';
  assert.equal(
    isReviewerIndependent(author, distinct),
    true,
    'Distinct identity must be independent'
  );

  // reviewPullRequest rejects caller-supplied author that mismatches decision log
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-indep-test-'));
  try {
    const decisionDir = path.join(tmpDir, 'decisions');
    decisions.recordDecision(
      { workItemId: 'FEAT-PR-01', stage: 'dispatch', chosen: author },
      { dir: decisionDir }
    );
    const svc = createPlanningServices({
      rootDir: tmpDir,
      decisionDir,
      gh: () => ({
        ok: true,
        stdout: JSON.stringify({
          headRefOid: 'a'.repeat(40),
          baseRefOid: 'b'.repeat(40),
          title: '[FEAT-PR-01] test',
          headRefName: 'feat/test',
        }),
      }),
      git: () => ({ ok: true, stdout: '' }),
    });
    const res = await svc.reviewPullRequest({
      pr: '1',
      sha: 'a'.repeat(40),
      workItemId: 'FEAT-PR-01',
      authorKey: 'codex::cli::gw-spoof::up-spoof::acct-spoof::scope-spoof::model-spoof',
    });
    assert.equal(res.verdict, 'BLOCKED');
    assert.match(res.reason, /AUTHOR_MISMATCH/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Round 3 Finding 12 (P1): Host gate diff bounds and failure confirmation persistence
test('Round 3 Finding 12: host gate diff checks entire diff and failed confirmation stays failed', () => {
  const orchestrate = require('../orchestrate');
  const baseSha = 'a'.repeat(40);
  const headOut = { status: 1, stdout: 'not ok 1 - failure-a\n' };
  const baseOut = { status: 0, stdout: 'ok 1 - baseline\n' };
  const rerunPass = { status: 0, stdout: 'ℹ pass 1\n' };
  let calls = 0;
  const spawnSync = (cmd, args) => {
    if (cmd === 'git') return { status: 0, stdout: baseSha + '\n', stderr: '' };
    calls++;
    if (calls === 1) return headOut; // full suite run on HEAD
    if (calls === 2) return baseOut; // baseline run
    return rerunPass; // single rerun
  };
  const res = orchestrate.runHostBrainGate({ baseSha }, { spawnSync, baseCache: new Map() });
  assert.equal(res.pass, false, 'Suite failure that passes alone must still FAIL the gate');
  assert.deepEqual(res.newFailures, ['failure-a']);
});

// Round 3 Finding 13 (P1): Isolation launcher avoids hardcoded worker paths and uses staging deps cache
test('Round 3 Finding 13: isolation launcher script template uses per-launch paths and no hardcoded npm/codex', () => {
  const launcher = require('../isolation-launcher');
  const script = launcher.buildWorkerLaunchScript({
    workerUsername: 'TestWorker',
    workerRoot: 'C:\\CustomWorker\\Root',
    exeFile: 'test.exe',
    exePrefixArgs: [],
    payloadArgsPath: 'payload.json',
    completionMarkerPath: 'marker.json',
    completionNonce: 'nonce',
    usageLogPath: 'usage.log',
  });
  assert.doesNotMatch(script, /"C:\\ShipDeWorker\\npm"/);
  assert.doesNotMatch(script, /"C:\\ShipDeWorker\\codex-home"/);
  assert.match(script, /CODEX_HOME/);
});

// Round 3 Finding 14 (P1): context-pack and context7 use shell: false and argument vectors
test('Round 3 Finding 14: context-pack and context7 use shell: false and array args', async () => {
  const cp = require('node:child_process');
  const contextPack = require('../context-pack');
  const context7 = require('../context7');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxpack-'));
  const origSpawnSync = cp.spawnSync;
  const origSpawn = cp.spawn;
  const origRepomixBin = process.env.SHIPDE_REPOMIX_BIN;
  try {
    const fakeBin = path.join(tmp, process.platform === 'win32' ? 'repomix.cmd' : 'repomix');
    fs.writeFileSync(fakeBin, 'fake');
    process.env.SHIPDE_REPOMIX_BIN = fakeBin;
    fs.writeFileSync(path.join(tmp, 'file.txt'), 'hello');
    let packSpawnArgs = null;
    let packSpawnOpts = null;
    cp.spawnSync = (cmd, args, opts) => {
      packSpawnArgs = args;
      packSpawnOpts = opts;
      return { status: 1, stdout: '', stderr: 'mocked' };
    };

    const pack = contextPack.createContextPack([{ allowedPaths: ['file.txt'] }], {
      root: tmp,
      outputDir: tmp,
    });
    assert.ok(pack.content);
    assert.equal(pack.packer, 'fallback'); // repomix mock status 1, cleanly fell back
    assert.ok(Array.isArray(packSpawnArgs), 'packSpawnArgs must be an array');
    assert.ok(packSpawnArgs.includes('--include'), 'packSpawnArgs must include --include');
    assert.ok(packSpawnArgs.includes('--output'), 'packSpawnArgs must include --output');
    assert.strictEqual(packSpawnOpts.shell, false, 'repomix spawnSync must use shell: false');
    assert.strictEqual(packSpawnOpts.cwd, tmp, 'repomix spawnSync cwd must be root');

    const ctx7Calls = [];
    cp.spawn = (cmd, args, opts) => {
      ctx7Calls.push({ cmd, args, opts });
      const EventEmitter = require('node:events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      process.nextTick(() => {
        child.stdout.emit('data', JSON.stringify([{ id: 'zod/zod', title: 'Zod' }]));
        child.emit('close', 0);
      });
      return child;
    };

    await context7.lookupDocs('zod', 'schema');
    assert.ok(ctx7Calls.length > 0, 'context7 must execute command');
    for (const call of ctx7Calls) {
      assert.ok(Array.isArray(call.args), 'context7 must pass arguments as an array');
      assert.equal(call.opts.shell, false, 'context7 must specify shell: false');
    }
  } finally {
    cp.spawnSync = origSpawnSync;
    cp.spawn = origSpawn;
    if (origRepomixBin !== undefined) {
      process.env.SHIPDE_REPOMIX_BIN = origRepomixBin;
    } else {
      delete process.env.SHIPDE_REPOMIX_BIN;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 3 Finding 15 (P1): getOpenRuns reads intake store when records is set without intakeDir
test('Round 3 Finding 15: getOpenRuns does not collapse to [] when records is set without intakeDir', () => {
  const nextRunner = require('../next-runner');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openruns-test-'));
  try {
    const intakeDir = path.join(tmp, 'tools', 'ai-brain', 'data', 'intake');
    fs.mkdirSync(path.join(intakeDir, 'run-1', 'decisions'), { recursive: true });
    fs.writeFileSync(
      path.join(intakeDir, 'run-1', 'run.lock'),
      JSON.stringify({ pid: process.pid, startedAt: Date.now() })
    );
    const runs = nextRunner.getOpenRuns({ rootDir: tmp, records: [{ work_item_id: 'TASK-1' }] });
    assert.equal(runs.length, 1, 'Must detect live run from default intake path');
    assert.equal(runs[0].pid, process.pid);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 3 Finding 17 (P2): ninerouter-combo restricts HTTP to loopback
test('Round 3 Finding 17: ninerouter-combo rejects non-loopback hosts', async () => {
  const combo = require('../ninerouter-combo');
  await assert.rejects(
    () => combo.syncWriterCombo({ host: 'evil.attacker.com', models: ['m1'] }),
    /NON_LOOPBACK_HOST/
  );
});

// Round 3 Finding 19 (P2): Diff cap from dispatch config and fail closed on diff error
test('Round 3 Finding 19: orchestrate reviewLane fails closed with DIFF_UNAVAILABLE on diff error', async () => {
  const orchestrate = require('../orchestrate');
  const cp = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-fail-test-'));
  try {
    const repoDir = path.join(tmp, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    cp.execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });
    cp.execSync('git config commit.gpgsign false', { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, 'init.txt'), 'initial\n', 'utf8');
    cp.execSync('git add init.txt', { cwd: repoDir, stdio: 'ignore' });
    cp.execSync('git commit -m "initial commit"', { cwd: repoDir, stdio: 'ignore' });
    const baseSha = cp.execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'some new changes\n', 'utf8');
    cp.execSync('git add file.txt', { cwd: repoDir, stdio: 'ignore' });
    cp.execSync('git commit -m "commit 2"', { cwd: repoDir, stdio: 'ignore' });
    const targetSha = cp.execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

    const cand = {
      candidateKey: 'codex::cli::gw-rev::up-rev::acct-rev::scope-rev::model-rev',
      harness: 'codex',
      provider: 'codex',
      model: 'test-model',
    };

    // Case 1: Bad ref fails closed with DIFF_UNAVAILABLE
    const badLaneFn = orchestrate.reviewLane(
      {
        cwd: repoDir,
        workerRoot: repoDir,
        reviewerIdentity: cand.candidateKey,
        maxReviewDiffChars: 20,
      },
      { id: 'TASK-REV-1', files: [] },
      { candidateKey: 'writer-1', baseSha: '0'.repeat(40), worktree: repoDir },
      {},
      {},
      async () => ({ exitCode: 0, stdout: '{"verdict":"PASS"}' }),
      tmp,
      Date.now(),
      [cand],
      {},
      { dispatch: { maxReviewDiffChars: 20 } }
    );
    const res1 = await badLaneFn(targetSha);
    assert.equal(res1.verdict, 'BLOCKED');
    assert.equal(res1.pass, false);
    assert.ok(res1.findings.some((f) => f.id === 'DIFF_UNAVAILABLE'));

    // Case 2: Missing/NaN maxReviewDiffChars fails closed with DIFF_UNAVAILABLE
    const nanLaneFn = orchestrate.reviewLane(
      {
        cwd: repoDir,
        workerRoot: repoDir,
        reviewerIdentity: cand.candidateKey,
        maxReviewDiffChars: NaN,
      },
      { id: 'TASK-REV-1', files: [] },
      { candidateKey: 'writer-1', baseSha, worktree: repoDir },
      {},
      {},
      async () => ({ exitCode: 0, stdout: '{"verdict":"PASS"}' }),
      tmp,
      Date.now(),
      [cand],
      {},
      {}
    );
    const res2 = await nanLaneFn(targetSha);
    assert.equal(res2.verdict, 'BLOCKED');
    assert.equal(res2.pass, false);
    assert.ok(res2.findings.some((f) => f.id === 'DIFF_UNAVAILABLE'));

    // Case 3: Real diff exceeding cap writes .shipde/review-diff.patch without isolatedWorker
    const capLaneFn = orchestrate.reviewLane(
      {
        cwd: repoDir,
        workerRoot: repoDir,
        reviewerIdentity: cand.candidateKey,
        maxReviewDiffChars: 10,
      },
      { id: 'TASK-REV-1', files: [] },
      { candidateKey: 'writer-1', baseSha, worktree: repoDir },
      {},
      {},
      async () => ({ exitCode: 0, stdout: '{"verdict":"PASS","sha":"' + targetSha + '"}' }),
      tmp,
      Date.now(),
      [cand],
      {},
      { dispatch: { maxReviewDiffChars: 10 } }
    );
    const res3 = await capLaneFn(targetSha);
    assert.equal(res3.verdict, 'PASS');
    const reviewWorkerRoot = repoDir + '-review';
    const patchFile = path.join(reviewWorkerRoot, '.shipde', 'review-diff.patch');
    assert.ok(fs.existsSync(patchFile), 'review-diff.patch must be created when diff cap exceeded');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 4 Finding 1 (P0): CI gate has no test-only skip branch
test('Round 4 Finding 1: runOrchestration CI gate is not skipped under simulate or test mode', async () => {
  const orchestrate = require('../orchestrate');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-no-skip-'));
  try {
    const workItemId = 'FEAT-CI-GATE-01';
    const sha = '2'.repeat(40);
    const checkpointFile = path.join(tmp, 'checkpoint.json');
    const checkpointData = {
      reviews: [
        {
          workItemId,
          sha,
          reviewedSha: sha,
          verdict: 'PASS',
          reviewer: 'test-reviewer',
          openFindings: 0,
          reviewRounds: 1,
          branch: 'feat/test-ci-gate',
          draftTitle: 'test draft',
        },
      ],
      liveSteps: {
        [workItemId]: {
          publication: {
            status: orchestrate.PublicationStatus.PUBLISHED_DRAFT,
            branch: 'feat/test-ci-gate',
            result: { number: 99, branch: 'feat/test-ci-gate', simulated: true },
          },
        },
      },
    };
    fs.writeFileSync(checkpointFile, JSON.stringify(checkpointData), 'utf8');

    let ciEvaluated = false;
    const ciGate = require('../ci-gate');
    const originalAwaitCi = ciGate.awaitCi;
    ciGate.awaitCi = async (opts) => {
      ciEvaluated = true;
      return {
        state: 'FAIL',
        sha: opts.sha,
        failed: ['contract'],
        reason: 'simulated failure',
      };
    };

    try {
      // Pass simulate: true and testMode: true without ghRunner and without ciGate: true
      const result = await orchestrate.runOrchestration(workItemId, {
        specs: [{ id: workItemId }],
        checkpointFile,
        decisionDir: tmp,
        // No ghRunner supplied: old predicate (!isSimulatedOrTestMode || Boolean(o.ghRunner) || o.ciGate === true) skipped CI
        simulate: true,
        testMode: true,
        ciSleep: async () => {},
        ciPollIntervalMs: 1,
        ciTimeoutMs: 100,
      });

      assert.equal(
        ciEvaluated,
        true,
        'CI gate must be evaluated even with simulate: true / testMode: true and no ghRunner'
      );
      const outcome = (result.outcomes || []).find((o) => o.workItemId === workItemId);
      assert.ok(outcome, 'Outcome must be recorded');
      assert.equal(outcome.status, orchestrate.ItemStatus.BLOCKED);
      assert.equal(outcome.reasonCode, 'CI_GATE_FAILED');
    } finally {
      ciGate.awaitCi = originalAwaitCi;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 4 Finding 2 (P0): defaultGit rejects core.hooksPath override and --no-verify
test('Round 4 Finding 2: defaultGit rejects core.hooksPath override and --no-verify bypass', () => {
  const { defaultGit } = require('../planning-services');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hooks-bypass-'));
  try {
    const cp = require('node:child_process');
    cp.execSync('git init -b main', { cwd: tmp, stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: tmp, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: tmp, stdio: 'ignore' });

    // 1. core.hooksPath=NUL bypass attempt
    const r1 = defaultGit(tmp, ['-c', 'core.hooksPath=NUL', 'commit', '-m', 'bypass']);
    assert.equal(r1.ok, false);
    assert.match(
      r1.stderr,
      /HOOK_CHECK_FAILED: core.hooksPath bypass or --no-verify is prohibited/
    );

    // 2. core.hooksPath=/dev/null bypass attempt
    const r2 = defaultGit(tmp, ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'bypass']);
    assert.equal(r2.ok, false);
    assert.match(
      r2.stderr,
      /HOOK_CHECK_FAILED: core.hooksPath bypass or --no-verify is prohibited/
    );

    // 3. --no-verify bypass attempt
    const r3 = defaultGit(tmp, ['commit', '--no-verify', '-m', 'bypass']);
    assert.equal(r3.ok, false);
    assert.match(
      r3.stderr,
      /HOOK_CHECK_FAILED: core.hooksPath bypass or --no-verify is prohibited/
    );

    // 4. -n short form bypass attempt
    const r4 = defaultGit(tmp, ['commit', '-n', '-m', 'bypass']);
    assert.equal(r4.ok, false);
    assert.match(
      r4.stderr,
      /HOOK_CHECK_FAILED: core.hooksPath bypass or --no-verify is prohibited/
    );

    // 5. -qn combined short form bypass attempt
    const r5 = defaultGit(tmp, ['commit', '-qn', '-m', 'bypass']);
    assert.equal(r5.ok, false);
    assert.match(
      r5.stderr,
      /HOOK_CHECK_FAILED: core.hooksPath bypass or --no-verify is prohibited/
    );

    // 6. -nq combined short form bypass attempt
    const r6 = defaultGit(tmp, ['commit', '-nq', '-m', 'bypass']);
    assert.equal(r6.ok, false);
    assert.match(
      r6.stderr,
      /HOOK_CHECK_FAILED: core.hooksPath bypass or --no-verify is prohibited/
    );

    // 7. -an combined short form bypass attempt
    const r7 = defaultGit(tmp, ['commit', '-an', '-m', 'bypass']);
    assert.equal(r7.ok, false);
    assert.match(
      r7.stderr,
      /HOOK_CHECK_FAILED: core.hooksPath bypass or --no-verify is prohibited/
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 4 Finding 3 (P1): agy-pool launcher authorization requires externalWorkers and explicit permission
test('Round 4 Finding 3: resolveLauncher refuses agy-pool without externalWorkers and explicit permission', () => {
  const orchestrate = require('../orchestrate');
  const mockLauncher = () => ({ exitCode: 0 });

  // 1. Registry has source with writerEnabled: true, but externalWorkers is empty
  const launcher1 = orchestrate.resolveLauncher(
    {
      registry: {
        sources: [{ id: 'agy-pool', writerEnabled: true }],
        dispatch: {},
      },
      externalWorkers: '',
    },
    mockLauncher
  );
  const res1 = launcher1({ harness: 'agy-pool', accountId: 'pool-acct' });
  assert.equal(res1.exitCode, 1);
  assert.match(res1.stderr, /LAUNCH_REFUSED: agy-pool writer is disabled by configuration/);

  // 2. externalWorkers has agy-pool, but explicit permission (allowAgyPoolWriter / dispatch.agyPoolWriterEnabled) is unset
  const launcher2 = orchestrate.resolveLauncher(
    {
      registry: {
        sources: [{ id: 'agy-pool', writerEnabled: true }],
        dispatch: {},
      },
      externalWorkers: 'agy-pool',
    },
    mockLauncher
  );
  const res2 = launcher2({ harness: 'agy-pool', accountId: 'pool-acct' });
  assert.equal(res2.exitCode, 1);
  assert.match(res2.stderr, /LAUNCH_REFUSED: agy-pool writer is disabled by configuration/);
});

test('agy-pool external selection without dispatch configuration does not authorize launch', (t) => {
  const orchestrate = require('../orchestrate');
  const harness = require('../harness');
  let launched = false;
  t.mock.method(harness, 'getHarness', () => {
    launched = true;
    throw new Error('unauthorized harness lookup');
  });
  for (const options of [
    { externalWorkers: 'agy-pool' },
    { externalWorkers: 'agy-pool', registry: { sources: [] } },
    { externalWorkers: 'agy-pool', dispatch: { agyPoolWriterEnabled: false } },
  ]) {
    const launcher = orchestrate.resolveLauncher(options, () => {
      launched = true;
    });
    const result = launcher({ harness: 'agy-pool', isReview: true });
    assert.equal(result.exitCode, 1);
    assert.match(result.refusal, /WRITER_LAUNCH_NOT_AUTHORIZED/);
  }
  assert.equal(launched, false, 'authorization must precede any harness or worker launch');
});

test('completed checkpoints with missing or invalid receipts block completion and dependents', async (t) => {
  const orchestrate = require('../orchestrate');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'completed-receipt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const reviews of [[], [{ workItemId: 'A', sha: 'invalid', verdict: 'PASS' }]]) {
    const checkpointFile = path.join(dir, 'checkpoint.json');
    fs.writeFileSync(checkpointFile, JSON.stringify({ completed: ['A'], reviews }));
    const calls = [];
    const result = await orchestrate.runOrchestration('resume completed receipt', {
      specs: [{ id: 'A' }, { id: 'B', dependencies: ['A'] }],
      checkpointFile,
      decisionDir: dir,
      publication: { publish: () => calls.push('publish') },
      mergeAfterPublish: true,
      run: (job) => calls.push(job.workItemId),
    });
    const outcome = result.outcomes.find((entry) => entry.workItemId === 'A');
    assert.equal(outcome.status, orchestrate.ItemStatus.BLOCKED);
    assert.equal(outcome.reasonCode, 'CHECKPOINT_RECEIPT_INVALID');
    assert.ok(!result.reconciliation.completed.includes('A'));
    assert.ok(!result.reconciliation.completed.includes('B'));
    assert.deepEqual(calls, [], 'no dependent launch or publication is authorized');
    assert.deepEqual(result.merges || [], []);
  }
});

test('published draft without PR number or injected runner still requires CI', async (t) => {
  const cp = require('node:child_process');
  const orchestrate = require('../orchestrate');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-missing-ci-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir);
  cp.execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
  cp.execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'base\n');
  cp.execSync('git add . && git commit -m "base"', { cwd: repoDir, stdio: 'ignore' });
  const baseSha = cp.execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
  const checkpointFile = path.join(dir, 'checkpoint.json');

  const writerCand = {
    harness: 'hermes',
    accessPath: 'cli-64a',
    gateway: '9router',
    upstream: 'kgw',
    accountId: 'codex',
    quotaScope: 'codex',
    modelId: 'ninerouter/kgw/nvidia/nemotron-3-super-120b-a12b:free',
    source: '9router',
    kind: 'router',
    qualifiedRoles: ['author.foundation'],
    capabilities: { contextWindow: 64000 },
    cost: 1,
    quality: 95,
  };
  const reviewerCand = {
    harness: 'hermes',
    accessPath: 'cli-64a',
    gateway: '9router',
    upstream: 'ocz',
    accountId: 'codex',
    quotaScope: 'codex',
    modelId: 'ninerouter/ocz/big-pickle',
    source: '9router',
    kind: 'router',
    qualifiedRoles: ['reviewer.primary'],
    capabilities: { contextWindow: 64000 },
    cost: 1,
    quality: 80,
  };

  const res1 = await orchestrate.runOrchestration('setup', {
    specs: [{ id: 'A', files: ['a.txt'], acceptanceCriteria: ['a works'] }],
    checkpointFile,
    decisionDir: dir,
    workerRoot: repoDir,
    baseSha,
    candidates: [writerCand, reviewerCand],
    ranking: { headrooms: { codex: { status: 'available' } } },
    tests: () => ({
      pass: true,
      command: 'node -e "process.exit(0)"',
      baseExitCode: 1,
      headExitCode: 0,
      detail: '',
      baseOutput: '',
    }),
    run: (job) => {
      if (job.usageFile) {
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-' + Date.now() }));
      }
      if (job.isReview) {
        fs.writeFileSync(
          job.verdictFile || path.join(job.cwd, 'verdict.json'),
          JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
        );
        return { exitCode: 0, stdout: 'review pass' };
      }
      fs.writeFileSync(path.join(job.cwd, 'a.txt'), 'changed\n');
      cp.execSync('git add . && git commit -m "commit"', { cwd: job.cwd, stdio: 'ignore' });
      return { exitCode: 0, stdout: 'done' };
    },
  });
  assert.equal(res1.outcomes[0].status, 'completed');

  const ckpt = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  const sha = ckpt.reviews[0].sha;
  ckpt.liveSteps = {
    A: {
      publication: {
        status: orchestrate.PublicationStatus.PUBLISHED_DRAFT,
        branch: 'feat/missing-pr',
        result: {},
      },
    },
  };
  fs.writeFileSync(checkpointFile, JSON.stringify(ckpt), 'utf8');

  let checked = false;
  t.mock.method(ciGate, 'awaitCi', async (options) => {
    checked = true;
    assert.equal(options.sha, sha);
    assert.equal(options.prNumber, undefined);
    assert.equal(options.ghRunner, undefined);
    return { state: 'MISSING', sha };
  });
  const result = await orchestrate.runOrchestration('missing CI metadata', {
    specs: [{ id: 'A' }],
    checkpointFile,
    decisionDir: dir,
  });
  assert.equal(checked, true);
  assert.equal(result.reviews[0].ci.state, 'MISSING');
  const outcome = result.outcomes.find((entry) => entry.workItemId === 'A');
  assert.equal(outcome.status, orchestrate.ItemStatus.BLOCKED);
  assert.equal(outcome.reasonCode, 'CI_GATE_FAILED');
  assert.ok(!result.reconciliation.completed.includes('A'));
});

// Round 4 Finding 4 (P1): dispatch does not load evidence from target workspace --root
test('Round 4 Finding 4: dispatch evidenceDir is loaded from controller store, not hostile --root', async () => {
  const cli = require('../cli');
  const orchestrate = require('../orchestrate');
  const evidence = require('../evidence');
  const hostileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostile-evidence-'));
  const origLoadEvidence = evidence.loadEvidence;
  let observedEvidenceDir = null;
  evidence.loadEvidence = (dir) => {
    observedEvidenceDir = dir;
    return origLoadEvidence(dir);
  };
  try {
    const plantedDir = path.join(hostileDir, 'tools', 'ai-brain', 'data', 'evidence');
    fs.mkdirSync(plantedDir, { recursive: true });
    fs.writeFileSync(path.join(plantedDir, 'planted.json'), '{"planted":true}', 'utf8');
    const profileFile = path.join(hostileDir, 'test-profile.json');
    const validProfile = orchestrate.buildTaskProfile({
      id: 'TASK-PROFILE-TEST',
      role: 'writer',
    });
    fs.writeFileSync(profileFile, JSON.stringify(validProfile), 'utf8');

    let output = '';
    const stdout = {
      write: (msg) => {
        output += msg;
      },
    };
    await cli.dispatchProfileCommand(
      { root: hostileDir, profile: 'test-profile.json', stdout },
      { candidates: [], exit: () => {} }
    );
    assert.ok(observedEvidenceDir, 'loadEvidence must be called');
    assert.ok(
      !observedEvidenceDir.startsWith(hostileDir),
      `evidenceDir must not come from hostile root, got: ${observedEvidenceDir}`
    );
    assert.equal(
      observedEvidenceDir,
      path.join(__dirname, '..', 'data', 'evidence'),
      'evidenceDir must be controller evidence store'
    );
    assert.doesNotMatch(output, /planted/);
  } finally {
    evidence.loadEvidence = origLoadEvidence;
    fs.rmSync(hostileDir, { recursive: true, force: true });
  }
});

// Round 4 Finding 5 (P1): runHostBrainGate does not short-circuit on empty diff
test('Round 4 Finding 5: runHostBrainGate runs the test suite and does not return pass on empty diff', () => {
  const orchestrate = require('../orchestrate');
  const cp = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'host-gate-diff-'));
  const origSpawnSync = cp.spawnSync;
  try {
    const baseSha = '3'.repeat(40);
    let suiteExecuted = false;
    cp.spawnSync = (cmd, args, opts) => {
      if (args && args.includes('--test')) {
        suiteExecuted = true;
        return { status: 0, stdout: 'ℹ pass 1\nℹ fail 0\n', stderr: '' };
      }
      return origSpawnSync(cmd, args, opts);
    };

    const res = orchestrate.runHostBrainGate(
      { baseSha, workerRoot: tmp },
      { baseCache: new Map() }
    );
    assert.equal(
      suiteExecuted,
      true,
      'Brain test suite must be executed even with clean or empty diff'
    );
    assert.doesNotMatch(res.summary.join('\n'), /no changes in worker diff/);
  } finally {
    cp.spawnSync = origSpawnSync;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 4 Finding 6 (P1): reviewLane diff cap fails closed on missing/NaN and applies without isolatedWorker
test('Round 4 Finding 6: reviewLane enforces diff cap without isolatedWorker and fails closed on invalid cap', async () => {
  const orchestrate = require('../orchestrate');
  const cp = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-diff-cap-'));
  try {
    const repoDir = path.join(tmp, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    cp.execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });
    cp.execSync('git config commit.gpgsign false', { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, 'init.txt'), 'hello world\n', 'utf8');
    cp.execSync('git add init.txt', { cwd: repoDir, stdio: 'ignore' });
    cp.execSync('git commit -m "commit 1"', { cwd: repoDir, stdio: 'ignore' });
    const baseSha = cp.execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

    fs.writeFileSync(
      path.join(repoDir, 'init.txt'),
      'hello world modified line\nand another line\n',
      'utf8'
    );
    cp.execSync('git add init.txt', { cwd: repoDir, stdio: 'ignore' });
    cp.execSync('git commit -m "commit 2"', { cwd: repoDir, stdio: 'ignore' });
    const targetSha = cp.execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

    const cand = {
      candidateKey: 'codex::cli::gw-rev::up-rev::acct-rev::scope-rev::model-rev',
      harness: 'codex',
      provider: 'codex',
      model: 'test-model',
    };

    // 1. Missing or undefined maxReviewDiffChars fails closed
    const noCapLane = orchestrate.reviewLane(
      {
        cwd: repoDir,
        workerRoot: repoDir,
        reviewerIdentity: cand.candidateKey,
      },
      { id: 'TASK-REV-CAP', files: [] },
      { candidateKey: 'writer-1', baseSha, worktree: repoDir },
      {},
      {},
      async () => ({ exitCode: 0, stdout: '{"verdict":"PASS"}' }),
      tmp,
      Date.now(),
      [cand],
      {},
      { dispatch: {} }
    );
    const resNoCap = await noCapLane(targetSha);
    assert.equal(resNoCap.verdict, 'BLOCKED');
    assert.ok(resNoCap.findings.some((f) => f.id === 'DIFF_UNAVAILABLE'));

    // 2. Cap is enforced without isolatedWorker
    const capLane = orchestrate.reviewLane(
      {
        cwd: repoDir,
        workerRoot: repoDir,
        reviewerIdentity: cand.candidateKey,
        maxReviewDiffChars: 5,
        isolatedWorker: false,
      },
      { id: 'TASK-REV-CAP', files: [] },
      { candidateKey: 'writer-1', baseSha, worktree: repoDir },
      {},
      {},
      async () => ({ exitCode: 0, stdout: JSON.stringify({ verdict: 'PASS', sha: targetSha }) }),
      tmp,
      Date.now(),
      [cand],
      {},
      { dispatch: { maxReviewDiffChars: 5 } }
    );
    const resCap = await capLane(targetSha);
    assert.equal(resCap.verdict, 'PASS');
    const reviewWorkerRoot = repoDir + '-review';
    const patchFile = path.join(reviewWorkerRoot, '.shipde', 'review-diff.patch');
    assert.ok(fs.existsSync(patchFile), 'review-diff.patch must be written when cap exceeded');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 4 Finding 7 (P1): implementation review fails closed on missing or invalid Work Item
test('Round 4 Finding 7: reviewAtSha fails closed when Work Item is missing or missing allowedPaths/criteria', async () => {
  const { createPlanningServices } = require('../planning-services');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-review-fail-closed-'));
  try {
    const services = createPlanningServices({
      rootDir: tmp,
      decisionDir: path.join(tmp, 'decisions'),
    });

    // 1. Missing Work Item file
    const resMissing = await services.reviewAtSha({
      workItemId: 'FEAT-NONEXISTENT',
      sha: '4'.repeat(40),
      baseSha: '5'.repeat(40),
      authorKey: 'writer-key',
      authorRoot: tmp,
      isPlanReview: false,
    });
    assert.equal(resMissing.verdict, 'BLOCKED');
    assert.match(resMissing.reason, /WORK_ITEM_NOT_FOUND/);

    // 2. Work Item file with empty allowed paths
    const itemDir = path.join(tmp, 'docs', 'product-spec', 'work-items');
    fs.mkdirSync(itemDir, { recursive: true });
    fs.writeFileSync(
      path.join(itemDir, 'FEAT-EMPTY-PATHS.md'),
      '# Empty Paths\n\nNo paths table here.\n',
      'utf8'
    );

    const resEmpty = await services.reviewAtSha({
      workItemId: 'FEAT-EMPTY-PATHS',
      sha: '4'.repeat(40),
      baseSha: '5'.repeat(40),
      authorKey: 'writer-key',
      authorRoot: tmp,
      isPlanReview: false,
    });
    assert.equal(resEmpty.verdict, 'BLOCKED');
    assert.match(resEmpty.reason, /WORK_ITEM_INVALID/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 4 Finding 8 (P1): retained root repair refuses to commit secrets or paths outside allowedPaths
test('Round 4 Finding 8: retained root repair fails closed on dirty .env or dirty path outside allowedPaths', async () => {
  const { getIsolatedLauncher, getFolderHash } = require('../isolation-launcher');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retained-repair-secrets-'));
  try {
    const cp = require('node:child_process');
    const hostCwd = path.join(tmp, 'host');
    const workerRoot = path.join(tmp, 'worker');
    fs.mkdirSync(hostCwd, { recursive: true });
    fs.mkdirSync(workerRoot, { recursive: true });

    // Initialize host repo with init.txt and tracked .env
    cp.execSync('git init -b main', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git config commit.gpgsign false', { cwd: hostCwd, stdio: 'ignore' });
    fs.writeFileSync(path.join(hostCwd, 'init.txt'), 'init\n', 'utf8');
    fs.writeFileSync(path.join(hostCwd, '.env'), 'SECRET_BASE=init\n', 'utf8');
    cp.execSync('git add init.txt .env', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git commit -m "init"', { cwd: hostCwd, stdio: 'ignore' });
    const headSha = cp.execSync('git rev-parse HEAD', { cwd: hostCwd, encoding: 'utf8' }).trim();

    // Install functioning pre-commit hook in host repo (.git/hooks/pre-commit)
    const hooksDir = cp
      .execSync('git rev-parse --path-format=absolute --git-path hooks', {
        cwd: hostCwd,
        encoding: 'utf8',
      })
      .trim();
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookFile = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookFile, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    // Clone worker
    cp.execSync(`git clone ${hostCwd} ${workerRoot}`, { stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: workerRoot, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: workerRoot, stdio: 'ignore' });

    // 1. Test dirty secret file (.env) alone:
    fs.writeFileSync(path.join(workerRoot, '.env'), 'SECRET_API_KEY=leak\n', 'utf8');

    const decisions = require('../decisions');
    const decisionDir = path.join(tmp, 'decisions');
    fs.mkdirSync(decisionDir, { recursive: true });
    decisions.recordDecision(
      {
        stage: 'writer-launch-result',
        workItemId: 'FEAT-RETAIN-01',
        workerRoot,
        worktree: workerRoot,
        sha: headSha,
        baseSha: headSha,
        runId: 'RUN-1',
        at: new Date().toISOString(),
        detail: 'writer output',
      },
      { dir: decisionDir }
    );

    const verdictPath = path.join(tmp, 'verdict.json');
    const isoDir = path.join(hostCwd, 'scripts', 'ai', 'isolation');
    fs.mkdirSync(isoDir, { recursive: true });
    fs.writeFileSync(path.join(isoDir, 'policy.txt'), 'policy', 'utf8');
    fs.writeFileSync(
      verdictPath,
      JSON.stringify({
        worktree: hostCwd,
        verdict: 'CLOSED',
        timestamp: new Date().toISOString(),
        policyHash: getFolderHash(isoDir),
        sid: 'SID-TEST',
        details: { Test: 'PASS' },
      }),
      'utf8'
    );

    const opts1 = {
      baseSha: headSha,
      retainWorkerHead: headSha,
      cwd: hostCwd,
      hostCwd,
      workerRoot,
      decisionDir,
      workItemId: 'FEAT-RETAIN-01',
      verdictPath,
      getWorkerSid: () => 'SID-TEST',
      verifyBoundary: () => true,
      runId: 'RUN-1',
      dispatchConfig: { retainedRootMaxAgeMs: 60000 },
      allowedPaths: ['init.txt'],
    };

    // Secret file must cause refusal even with functioning hooks and valid allowedPaths
    await assert.rejects(
      () => Promise.resolve().then(() => getIsolatedLauncher()({ id: 'test' }, null, opts1)),
      /WORKER_HEAD_MISMATCH.*is dirty.*(WORKER_COMMIT_REFUSED: dirty tree contains sensitive files|sensitive files)/
    );

    let workerHead = cp
      .execSync('git rev-parse HEAD', { cwd: workerRoot, encoding: 'utf8' })
      .trim();
    assert.equal(workerHead, headSha, 'HEAD must not advance by committing secrets');

    // Restore .env to committed contents and test dirty unauthorized file alone
    fs.writeFileSync(path.join(workerRoot, '.env'), 'SECRET_BASE=init\n', 'utf8');
    cp.execSync('git checkout -- .env', { cwd: workerRoot, stdio: 'ignore' });
    fs.writeFileSync(path.join(workerRoot, 'unauthorized.txt'), 'illegal content\n', 'utf8');

    const opts2 = {
      ...opts1,
      workItemId: 'FEAT-RETAIN-01',
      allowedPaths: ['docs/product-spec/work-items/FEAT-RETAIN-01.md'],
    };

    // Unauthorized file outside allowedPaths must cause refusal attributable to that unauthorized path
    await assert.rejects(
      () => Promise.resolve().then(() => getIsolatedLauncher()({ id: 'test' }, null, opts2)),
      /WORKER_HEAD_MISMATCH.*is dirty.*(WORKER_COMMIT_REFUSED: dirty file unauthorized\.txt outside allowed paths|unauthorized\.txt)/
    );

    workerHead = cp.execSync('git rev-parse HEAD', { cwd: workerRoot, encoding: 'utf8' }).trim();
    assert.equal(workerHead, headSha, 'HEAD must not advance by committing unauthorized file');

    // Assert that .git/info/exclude contains .env and credential patterns
    const excludeFile = path.join(workerRoot, '.git', 'info', 'exclude');
    assert.ok(fs.existsSync(excludeFile));
    const excludeText = fs.readFileSync(excludeFile, 'utf8');
    assert.ok(excludeText.includes('.env'));
    assert.ok(excludeText.includes('*credential*'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 5 Finding 1 (P0): CI gate disabled via ciGate: false or config blocks completion
test('Round 5 Finding 1: CI gate disabled via ciGate: false or config blocks completion', async () => {
  const orchestrate = require('../orchestrate');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-disabled-'));
  try {
    const workItemId = 'FEAT-CI-DIS-01';
    const checkpointFile = path.join(tmp, 'checkpoint.json');
    const sha = '1'.repeat(40);
    const checkpointData = {
      reviews: [
        {
          workItemId,
          sha,
          verdict: 'PASS',
          reviewer: 'test-reviewer',
          openFindings: 0,
          reviewRounds: 1,
          branch: 'feat/test-ci-gate',
          draftTitle: 'test draft',
        },
      ],
      liveSteps: {
        [workItemId]: {
          publication: {
            status: orchestrate.PublicationStatus.PUBLISHED_DRAFT,
            branch: 'feat/test-ci-gate',
            result: { number: 99, branch: 'feat/test-ci-gate' },
          },
        },
      },
    };
    fs.writeFileSync(checkpointFile, JSON.stringify(checkpointData), 'utf8');

    // 1. ciGate: false explicitly passed
    const res1 = await orchestrate.runOrchestration(workItemId, {
      specs: [{ id: workItemId }],
      checkpointFile,
      decisionDir: tmp,
      ciGate: false,
    });
    const outcome1 = (res1.outcomes || []).find((o) => o.workItemId === workItemId);
    assert.ok(outcome1, 'Outcome 1 must be recorded');
    assert.equal(outcome1.status, orchestrate.ItemStatus.BLOCKED);
    assert.equal(outcome1.reasonCode, 'CI_GATE_DISABLED');

    // 2. dispatch config ciGate.enabled: false
    const res2 = await orchestrate.runOrchestration(workItemId, {
      specs: [{ id: workItemId }],
      checkpointFile,
      decisionDir: tmp,
      dispatch: { ciGate: { enabled: false } },
    });
    const outcome2 = (res2.outcomes || []).find((o) => o.workItemId === workItemId);
    assert.ok(outcome2, 'Outcome 2 must be recorded');
    assert.equal(outcome2.status, orchestrate.ItemStatus.BLOCKED);
    assert.equal(outcome2.reasonCode, 'CI_GATE_DISABLED');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 5 Finding 2 (P0): defaultGit rejects ANY core.hooksPath override anywhere in argv
test('Round 5 Finding 2: defaultGit rejects ANY core.hooksPath override anywhere in argv', () => {
  const { defaultGit } = require('../planning-services');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hooks-r5-'));
  try {
    const cp = require('node:child_process');
    cp.execSync('git init -b main', { cwd: tmp, stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: tmp, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: tmp, stdio: 'ignore' });

    const validHookDir = path.join(tmp, 'valid-hooks');
    fs.mkdirSync(validHookDir, { recursive: true });
    const hookScript = path.join(validHookDir, 'pre-commit');
    fs.writeFileSync(hookScript, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    // 1. Multiple overrides: valid directory followed by NUL override
    const r1 = defaultGit(tmp, [
      '-c',
      `core.hooksPath=${validHookDir}`,
      '-c',
      'core.hooksPath=NUL',
      'commit',
      '-m',
      'bypass',
    ]);
    assert.equal(r1.ok, false);
    assert.match(
      r1.stderr,
      /HOOK_CHECK_FAILED: core\.hooksPath bypass or --no-verify is prohibited/
    );

    // 2. Arbitrary executable hook override
    const r2 = defaultGit(tmp, ['-c', `core.hooksPath=${validHookDir}`, 'commit', '-m', 'bypass']);
    assert.equal(r2.ok, false);
    assert.match(
      r2.stderr,
      /HOOK_CHECK_FAILED: core\.hooksPath bypass or --no-verify is prohibited/
    );

    // 3. --config-env=core.hooksPath form
    const r3 = defaultGit(tmp, ['--config-env=core.hooksPath=SOME_ENV', 'commit', '-m', 'bypass']);
    assert.equal(r3.ok, false);
    assert.match(
      r3.stderr,
      /HOOK_CHECK_FAILED: core\.hooksPath bypass or --no-verify is prohibited/
    );

    // 4. --config-env core.hooksPath form (separate args)
    const r4 = defaultGit(tmp, [
      '--config-env',
      'core.hooksPath=SOME_ENV',
      'commit',
      '-m',
      'bypass',
    ]);
    assert.equal(r4.ok, false);
    assert.match(
      r4.stderr,
      /HOOK_CHECK_FAILED: core\.hooksPath bypass or --no-verify is prohibited/
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 5 Finding 12 (P1): controllerGit redacts subprocess output in thrown exceptions
test('Round 5 Finding 12: controllerGit redacts credentials in subprocess errors', () => {
  const { controllerGit } = require('../isolation-launcher');
  const secretToken = 'ghp_secretTokenVal1234567890';
  process.env.TEST_SECRET_TOKEN = secretToken;
  try {
    const gitWithSecret = controllerGit({
      run: () => ({
        status: 1,
        stderr: `fatal: remote rejected token ${secretToken} denied`,
        stdout: `Authorization: Bearer ${secretToken}`,
      }),
      failure: 'CUSTOM_GIT_FAILURE',
    });
    assert.throws(
      () => gitWithSecret(['push']),
      (err) => {
        assert.ok(
          !err.message.includes(secretToken),
          'Error message must not contain secret token'
        );
        assert.ok(
          err.message.includes('[REDACTED_SECRET]'),
          'Error message must contain redacted placeholder'
        );
        return true;
      }
    );
  } finally {
    delete process.env.TEST_SECRET_TOKEN;
  }
});

// Round 5 Finding 8 & 13 & 14: retained root recovery with functioning hook, wildcard scopes, and fails closed on missing contract
test('Round 5 Finding 13: retained root recovery succeeds with wildcard allowedPaths and functioning pre-commit hook', async () => {
  const { getIsolatedLauncher, getFolderHash } = require('../isolation-launcher');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retained-repair-wildcard-'));
  try {
    const cp = require('node:child_process');
    const hostCwd = path.join(tmp, 'host');
    const workerRoot = path.join(tmp, 'worker');
    fs.mkdirSync(hostCwd, { recursive: true });
    fs.mkdirSync(workerRoot, { recursive: true });

    // Host repo setup with functioning pre-commit hook
    cp.execSync('git init -b main', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git config commit.gpgsign false', { cwd: hostCwd, stdio: 'ignore' });
    fs.writeFileSync(path.join(hostCwd, 'init.txt'), 'init\n', 'utf8');
    cp.execSync('git add init.txt', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git commit -m "init"', { cwd: hostCwd, stdio: 'ignore' });
    const headSha = cp.execSync('git rev-parse HEAD', { cwd: hostCwd, encoding: 'utf8' }).trim();

    // Create functioning pre-commit hook in host repo (.git/hooks/pre-commit)
    const hooksDir = cp
      .execSync('git rev-parse --path-format=absolute --git-path hooks', {
        cwd: hostCwd,
        encoding: 'utf8',
      })
      .trim();
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookFile = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookFile, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    // Clone worker
    cp.execSync(`git clone ${hostCwd} ${workerRoot}`, { stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: workerRoot, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: workerRoot, stdio: 'ignore' });

    // Plant dirty file matching wildcard: docs/product-spec/example.md
    const docDir = path.join(workerRoot, 'docs', 'product-spec');
    fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, 'example.md'), '# Example Spec\n', 'utf8');

    const decisions = require('../decisions');
    const decisionDir = path.join(tmp, 'decisions');
    fs.mkdirSync(decisionDir, { recursive: true });
    decisions.recordDecision(
      {
        stage: 'writer-launch-result',
        workItemId: 'FEAT-WILDCARD-01',
        workerRoot,
        worktree: workerRoot,
        sha: headSha,
        baseSha: headSha,
        runId: 'RUN-1',
        at: new Date().toISOString(),
        detail: 'writer output',
      },
      { dir: decisionDir }
    );

    const verdictPath = path.join(tmp, 'verdict.json');
    const isoDir = path.join(hostCwd, 'scripts', 'ai', 'isolation');
    fs.mkdirSync(isoDir, { recursive: true });
    fs.writeFileSync(path.join(isoDir, 'policy.txt'), 'policy', 'utf8');
    fs.writeFileSync(
      verdictPath,
      JSON.stringify({
        worktree: hostCwd,
        verdict: 'CLOSED',
        timestamp: new Date().toISOString(),
        policyHash: getFolderHash(isoDir),
        sid: 'SID-TEST',
        details: { Test: 'PASS' },
      }),
      'utf8'
    );

    const opts = {
      baseSha: headSha,
      retainWorkerHead: headSha,
      cwd: hostCwd,
      hostCwd,
      workerRoot,
      decisionDir,
      workItemId: 'FEAT-WILDCARD-01',
      verdictPath,
      getWorkerSid: () => 'SID-TEST',
      verifyBoundary: () => true,
      runId: 'RUN-1',
      dispatchConfig: { retainedRootMaxAgeMs: 60000 },
      allowedPaths: ['docs/product-spec/**'],
    };

    // With wildcard support, this should recover and NOT throw WORKER_HEAD_MISMATCH!
    // It should commit the dirty file.
    getIsolatedLauncher()({ id: 'test' }, null, opts);
    const workerHead = cp
      .execSync('git rev-parse HEAD', { cwd: workerRoot, encoding: 'utf8' })
      .trim();
    assert.notEqual(workerHead, headSha, 'HEAD must advance with committed repair');
    const commitMsg = cp
      .execSync('git log -1 --format=%s', { cwd: workerRoot, encoding: 'utf8' })
      .trim();
    assert.equal(commitMsg, 'Restore interrupted writer work');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Round 5 Finding 8: retained root recovery fails closed when allowedPaths contract is missing or empty', async () => {
  const { getIsolatedLauncher, getFolderHash } = require('../isolation-launcher');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retained-repair-empty-contract-'));
  try {
    const cp = require('node:child_process');
    const hostCwd = path.join(tmp, 'host');
    const workerRoot = path.join(tmp, 'worker');
    fs.mkdirSync(hostCwd, { recursive: true });
    fs.mkdirSync(workerRoot, { recursive: true });

    cp.execSync('git init -b main', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git config commit.gpgsign false', { cwd: hostCwd, stdio: 'ignore' });
    fs.writeFileSync(path.join(hostCwd, 'init.txt'), 'init\n', 'utf8');
    cp.execSync('git add init.txt', { cwd: hostCwd, stdio: 'ignore' });
    cp.execSync('git commit -m "init"', { cwd: hostCwd, stdio: 'ignore' });
    const headSha = cp.execSync('git rev-parse HEAD', { cwd: hostCwd, encoding: 'utf8' }).trim();

    const hooksDir = cp
      .execSync('git rev-parse --path-format=absolute --git-path hooks', {
        cwd: hostCwd,
        encoding: 'utf8',
      })
      .trim();
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookFile = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookFile, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    cp.execSync(`git clone ${hostCwd} ${workerRoot}`, { stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: workerRoot, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: workerRoot, stdio: 'ignore' });

    // Plant dirty file in worker
    fs.writeFileSync(path.join(workerRoot, 'dirty.txt'), 'some dirty work\n', 'utf8');

    const decisions = require('../decisions');
    const decisionDir = path.join(tmp, 'decisions');
    fs.mkdirSync(decisionDir, { recursive: true });
    decisions.recordDecision(
      {
        stage: 'writer-launch-result',
        workItemId: 'FEAT-EMPTY-CONTRACT-01',
        workerRoot,
        worktree: workerRoot,
        sha: headSha,
        baseSha: headSha,
        runId: 'RUN-1',
        at: new Date().toISOString(),
        detail: 'writer output',
      },
      { dir: decisionDir }
    );

    const verdictPath = path.join(tmp, 'verdict.json');
    const isoDir = path.join(hostCwd, 'scripts', 'ai', 'isolation');
    fs.mkdirSync(isoDir, { recursive: true });
    fs.writeFileSync(path.join(isoDir, 'policy.txt'), 'policy', 'utf8');
    fs.writeFileSync(
      verdictPath,
      JSON.stringify({
        worktree: hostCwd,
        verdict: 'CLOSED',
        timestamp: new Date().toISOString(),
        policyHash: getFolderHash(isoDir),
        sid: 'SID-TEST',
        details: { Test: 'PASS' },
      }),
      'utf8'
    );

    const opts = {
      baseSha: headSha,
      retainWorkerHead: headSha,
      cwd: hostCwd,
      hostCwd,
      workerRoot,
      decisionDir,
      workItemId: 'FEAT-EMPTY-CONTRACT-01',
      verdictPath,
      getWorkerSid: () => 'SID-TEST',
      verifyBoundary: () => true,
      runId: 'RUN-1',
      dispatchConfig: { retainedRootMaxAgeMs: 60000 },
      allowedPaths: [], // explicitly empty allowedPaths!
    };

    // Empty allowedPaths contract must fail closed: cannot commit dirty files!
    await assert.rejects(
      () => Promise.resolve().then(() => getIsolatedLauncher()({ id: 'test' }, null, opts)),
      /WORKER_HEAD_MISMATCH/
    );

    const workerHead = cp
      .execSync('git rev-parse HEAD', { cwd: workerRoot, encoding: 'utf8' })
      .trim();
    assert.equal(workerHead, headSha, 'HEAD must NOT advance when allowedPaths contract is empty');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Round 7 Finding 16 (P1): defaultGit hook enforcement must not skip non-string argv tokens
test('Round 7 Finding 16: defaultGit hook enforcement coerces/rejects non-string argv tokens and fails closed', () => {
  const { defaultGit } = require('../planning-services');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hooks-r7-'));
  try {
    const cp = require('node:child_process');
    cp.execSync('git init -b main', { cwd: tmp, stdio: 'ignore' });
    cp.execSync('git config user.name "Test"', { cwd: tmp, stdio: 'ignore' });
    cp.execSync('git config user.email "test@example.com"', { cwd: tmp, stdio: 'ignore' });

    // 1. Non-string token carrying core.hooksPath override (boxed String)
    const r1 = defaultGit(tmp, ['-c', new String('core.hooksPath=NUL'), 'commit', '-m', 'bypass']);
    assert.equal(r1.ok, false);
    assert.match(
      r1.stderr,
      /HOOK_CHECK_FAILED: core\.hooksPath bypass or --no-verify is prohibited/
    );

    // 2. Non-string token carrying core.hooksPath with --config-env
    const r2 = defaultGit(tmp, [
      '--config-env',
      new String('core.hooksPath=SOME_ENV'),
      'commit',
      '-m',
      'bypass',
    ]);
    assert.equal(r2.ok, false);
    assert.match(
      r2.stderr,
      /HOOK_CHECK_FAILED: core\.hooksPath bypass or --no-verify is prohibited/
    );

    // 3. Non-string token carrying combined short-form no-verify (-qn)
    const r3 = defaultGit(tmp, ['commit', new String('-qn'), '-m', 'bypass']);
    assert.equal(r3.ok, false);
    assert.match(
      r3.stderr,
      /HOOK_CHECK_FAILED: core\.hooksPath bypass or --no-verify is prohibited/
    );

    // 4. Non-string token carrying long-form no-verify (--no-verify)
    const r4 = defaultGit(tmp, ['commit', new String('--no-verify'), '-m', 'bypass']);
    assert.equal(r4.ok, false);
    assert.match(
      r4.stderr,
      /HOOK_CHECK_FAILED: core\.hooksPath bypass or --no-verify is prohibited/
    );

    // 5. Non-string token for commit verb itself with no-verify
    const r5 = defaultGit(tmp, [new String('commit'), new String('-n'), '-m', 'bypass']);
    assert.equal(r5.ok, false);
    assert.match(
      r5.stderr,
      /HOOK_CHECK_FAILED: core\.hooksPath bypass or --no-verify is prohibited/
    );

    // 6. Non-string token with throwing toString fails closed
    const r6 = defaultGit(tmp, [
      'commit',
      {
        toString() {
          throw new Error('evil argument');
        },
      },
      '-m',
      'bypass',
    ]);
    assert.equal(r6.ok, false);
    assert.match(r6.stderr, /HOOK_CHECK_FAILED/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Round 8 Finding 1: published checkpoint entries retain receipt validation and do not adopt launch/passedRef fallback SHAs', async () => {
  const orchestrate = require('../orchestrate');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r8-f1-receipt-'));
  try {
    const workItemId = 'FEAT-R8-RECEIPT-01';
    const launchSha = '2'.repeat(40);
    const passedSha = '3'.repeat(40);
    const checkpointFile = path.join(tmp, 'checkpoint.json');

    // Checkpoint has publication in liveSteps, but NO review record
    const checkpointData = {
      liveSteps: {
        [workItemId]: {
          launch: {
            workerSha: launchSha,
          },
          passedRef: `refs/shipde/passed/${workItemId}/${passedSha}`,
          publication: {
            status: orchestrate.PublicationStatus.PUBLISHED_DRAFT,
            branch: 'feat/test-r8',
            result: { number: 99, branch: 'feat/test-r8' },
          },
        },
      },
    };
    fs.writeFileSync(checkpointFile, JSON.stringify(checkpointData), 'utf8');

    const result = await orchestrate.runOrchestration(workItemId, {
      specs: [{ id: workItemId }],
      checkpointFile,
      decisionDir: tmp,
      ciSleep: async () => {},
      ciPollIntervalMs: 1,
      ciTimeoutMs: 10,
    });

    const review = result.reviews && result.reviews[0];
    assert.ok(review, 'review entry reconstructed from checkpoint');
    assert.match(
      String(review.checkpointReviewError || ''),
      /NO_REVIEWED_COMMIT: missing review record in checkpoint/,
      'receipt validation was not bypassed for published checkpoint'
    );
    assert.equal(
      review.sha,
      null,
      'reviewed SHA must not fall back to launch.workerSha or passedRef'
    );
    assert.equal(
      review.reviewedSha,
      null,
      'reviewed SHA must not fall back to launch.workerSha or passedRef'
    );

    const outcome = (result.outcomes || []).find((o) => o.workItemId === workItemId);
    assert.ok(outcome, 'outcome must exist for work item');
    assert.equal(outcome.status, orchestrate.ItemStatus.BLOCKED, 'completion must be refused');
    assert.equal(outcome.reasonCode, 'CHECKPOINT_RECEIPT_INVALID');
    assert.equal(result.publications[0].status, orchestrate.PublicationStatus.REFUSED);
    assert.match(String(result.publications[0].reason), /missing review record in checkpoint/);
    assert.deepEqual(result.merges || [], [], 'merge must be refused');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
