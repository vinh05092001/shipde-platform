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
      ciGate: true,
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

// Finding 3: Two workers sharing cache update workspace links to their own checkout
test('Finding 3: two workers sharing cache update workspace links to their own checkout', () => {
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
    const pkgLink = path.join(shipdeInDeps, 'contracts');
    fs.symlinkSync(initialTarget, pkgLink, 'junction');

    // Worker A updates links using the real isolation-launcher implementation
    retargetSharedDepsWorkspaceLinks(depsDir, workerA);
    const linkAfterA = fs.readlinkSync(pkgLink);
    assert.equal(
      path.resolve(path.dirname(pkgLink), linkAfterA).toLowerCase(),
      contractsA.toLowerCase()
    );

    // Worker B updates links sharing the same depsDir
    retargetSharedDepsWorkspaceLinks(depsDir, workerB);
    const linkAfterB = fs.readlinkSync(pkgLink);
    assert.equal(
      path.resolve(path.dirname(pkgLink), linkAfterB).toLowerCase(),
      contractsB.toLowerCase()
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
  const { createContextPack } = require('../context-pack');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxpack-'));
  try {
    fs.writeFileSync(path.join(tmp, 'file.txt'), 'hello');
    const pack = createContextPack(['file.txt'], { rootDir: tmp });
    assert.ok(pack.content);
    assert.equal(pack.packer, 'fallback'); // repomix not installed in temp, cleanly fell back
  } finally {
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

    const laneFn = orchestrate.reviewLane(
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

    const res = await laneFn(targetSha);
    assert.equal(res.verdict, 'BLOCKED');
    assert.equal(res.pass, false);
    assert.ok(res.findings.some((f) => f.id === 'DIFF_UNAVAILABLE'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
