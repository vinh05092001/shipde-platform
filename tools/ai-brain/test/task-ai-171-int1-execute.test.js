'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { dispatchCommand, main } = require('../cli');
const { candidateKey, parseCandidateKey } = require('../discovery/identity');
const routeHealthApi = require('../route-health');

function makeCandidate(modelId, upstream, accountId, cost = 1, quality = 90) {
  const c = { harness: 'hermes', accessPath: 'cli', gateway: '9router' };
  Object.assign(c, { upstream, accountId, quotaScope: accountId, modelId, cost, quality });
  c.qualifiedRoles = ['author.foundation'];
  c.candidateKey = candidateKey(c);
  return c;
}

function createTestHarness() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-171-int1-'));
  const dirs = ['decisions', 'evidence', 'worktree'].map((d) => {
    const p = path.join(tempDir, d);
    fs.mkdirSync(p, { recursive: true });
    return p;
  });
  const promptFile = path.join(tempDir, 'task-prompt.md');
  const quotaStateFile = path.join(tempDir, 'quota-state.json');
  const routeHealthFile = path.join(tempDir, 'model-route-health.json');
  fs.writeFileSync(promptFile, 'Prompt for TASK-AI-171 INT-1 execution test\n', 'utf8');
  fs.writeFileSync(quotaStateFile, JSON.stringify({ accounts: {} }), 'utf8');
  const gwRec = { modelId: 'm-alpha', routeId: '9router', status: 'AVAILABLE', nextCheckAt: null };
  routeHealthApi.saveStore(routeHealthFile, {
    version: 1,
    updatedAt: new Date().toISOString(),
    paths: { 'm-alpha|9router': gwRec },
    events: [],
  });
  return {
    tempDir,
    decisionDir: dirs[0],
    evidenceDir: dirs[1],
    tempWorktree: dirs[2],
    promptFile,
    quotaStateFile,
    routeHealthFile,
    deps: (now, candidates) => ({
      candidates,
      now,
      quotaStateFile,
      routeHealthFile,
      home: tempDir,
      decisionDir: dirs[0],
      evidenceDir: dirs[1],
      maxAttempts: 1,
      concurrency: 1,
    }),
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

describe('TASK-AI-171 INT-1: Controller execute launch, argv identity, and outcome feedback', () => {
  let env;
  beforeEach(() => {
    env = createTestHarness();
  });
  afterEach(() => {
    env.cleanup();
  });

  test('INT-1: execute launches chosen candidate with argv identity, records failure to route-health, and feeds next selection', () => {
    const candidateA = makeCandidate('m-alpha', 'ag', 'ag', 1, 90);
    const candidateB = makeCandidate('m-beta', 'other-provider', 'mock-scope-b', 2, 80);
    const now = Date.now();
    let exitCode = -1;
    let launchedArgs = null;
    const capturedLogs = [];
    const baseDeps = env.deps(now, [candidateA, candidateB]);

    const res = dispatchCommand(
      {
        execute: true,
        json: true,
        cwd: env.tempWorktree,
        'prompt-file': env.promptFile,
        item: 'TASK-AI-171-TEST',
      },
      {
        ...baseDeps,
        run: (adapter, launchArgs, opts) => {
          launchedArgs = { adapter, launchArgs, opts };
          return { exitCode: 1, stderr: 'No active credentials for provider: ag', elapsedMs: 150 };
        },
        exit: (code) => {
          exitCode = code;
        },
        log: (msg) => capturedLogs.push(msg),
      }
    );

    assert.equal(exitCode, 1);
    assert.ok(res && res.chosen === candidateA.candidateKey);
    const chosenIdentity = parseCandidateKey(res.chosen);
    assert.deepEqual(res.launchedArgvIdentity, chosenIdentity);
    assert.ok(
      launchedArgs?.launchArgs.some((a) => String(a).includes('Prompt for TASK-AI-171 INT-1'))
    );

    const parsed = capturedLogs
      .map((e) => {
        try {
          return JSON.parse(e);
        } catch {}
      })
      .find((e) => e?.chosen);
    assert.ok(
      parsed &&
        parsed.chosen === candidateA.candidateKey &&
        parsed.outcome.status === 'failed' &&
        parsed.recorded
    );
    assert.deepEqual(parsed.launchedArgvIdentity, chosenIdentity);

    // Stub fails with "No active credentials for provider: ag" -> route-health record written
    const store = routeHealthApi.loadStore(env.routeHealthFile);
    const recA = store.paths['m-alpha|ag'];
    assert.ok(recA && recA.status !== 'AVAILABLE');
    assert.ok(Date.parse(recA.nextCheckAt) > now);
    assert.equal(res.recorded.key, 'm-alpha|ag');
    assert.equal(res.recorded.status, recA.status);

    // Next dry-run rejects candidateA and keeps candidateB (P1: gateway AVAILABLE does not mask ag failure)
    const dryRun = dispatchCommand(
      { 'dry-run': true, json: true, item: 'TASK-AI-171-TEST' },
      { ...baseDeps, now: now + 1000, allowUnprobedCandidates: true, exit: () => {}, log: () => {} }
    );
    const rejected = dryRun?.decision?.rejected?.find(
      (r) => r.offeringId === candidateA.candidateKey
    );
    assert.ok(rejected && rejected.reason === recA.status);
    assert.equal(dryRun.decision.chosen, candidateB.candidateKey);
    assert.ok(dryRun.decision.candidates.some((c) => c.offeringId === candidateB.candidateKey));
  });

  test('INT-1: CLI entrypoint main(["dispatch", "--execute", "--json", ...]) returns structured output, masks emails, and validates worker outcome', () => {
    const candidateA = makeCandidate('m-alpha', 'ag', 'operator@example.com', 1, 90);
    const now = Date.now();
    let exitCode = -1;
    const capturedLogs = [];

    const res = main(
      [
        'dispatch',
        '--execute',
        '--json',
        '--cwd',
        env.tempWorktree,
        '--prompt-file',
        env.promptFile,
        '--item',
        'TASK-AI-171-TEST',
      ],
      {
        ...env.deps(now, [candidateA]),
        run: () => ({
          exitCode: 0,
          stdout: JSON.stringify({
            candidateKey: 'suggested-route',
            explanation: 'worker output',
          }),
        }),
        exit: (code) => {
          exitCode = code;
        },
        log: (msg) => capturedLogs.push(msg),
      }
    );

    assert.ok(exitCode === 0 && res?.chosen);
    // P2: email account is masked in launchedArgvIdentity and chosen
    assert.doesNotMatch(res.launchedArgvIdentity.account, /operator@example\.com/);
    assert.doesNotMatch(res.chosen, /operator@example\.com/);
    // P2: worker stdout deliverable is validated; outcome still names launched candidate with valid status
    assert.equal(res.outcome.candidateKey, res.chosen);
    assert.equal(res.outcome.status, 'completed');

    const parsed = capturedLogs
      .map((e) => {
        try {
          return JSON.parse(e);
        } catch {}
      })
      .find((e) => e?.chosen);
    assert.ok(
      parsed && parsed.outcome.status === 'completed' && parsed.outcome.candidateKey === res.chosen
    );
    assert.doesNotMatch(parsed.launchedArgvIdentity.account, /operator@example\.com/);

    // Valid worker outcome matching candidateKey and status is preserved
    const validOutcome = { candidateKey: res.chosen, status: 'completed' };
    const res2 = dispatchCommand(
      { execute: true, json: true, item: 'TASK-AI-171-TEST' },
      {
        ...env.deps(now, [candidateA]),
        run: () => ({ exitCode: 0, stdout: JSON.stringify(validOutcome) }),
        exit: () => {},
        log: () => {},
      }
    );
    assert.equal(res2.outcome.candidateKey, res.chosen);
    assert.equal(res2.outcome.status, 'completed');
  });

  test('INT-1: worker stdout spoofed JSON success with non-zero exit is rejected as failure', () => {
    const candidateA = makeCandidate('m-alpha', 'ag', 'operator@example.com', 1, 90);
    const now = Date.now();
    let exitCode = -1;
    const res = dispatchCommand(
      {
        execute: true,
        json: true,
        cwd: env.tempWorktree,
        'prompt-file': env.promptFile,
        item: 'TASK-AI-171-TEST',
      },
      {
        ...env.deps(now, [candidateA]),
        run: () => ({
          exitCode: 1,
          stdout: JSON.stringify({
            candidateKey: candidateA.candidateKey,
            status: 'passed',
          }),
          stderr: 'Worker process crashed',
        }),
        exit: (code) => {
          exitCode = code;
        },
        log: () => {},
      }
    );

    assert.equal(exitCode, 1);
    assert.equal(res.outcome.status, 'failed');
    assert.equal(res.outcome.candidateKey, res.chosen);
    assert.deepEqual(res.launchedArgvIdentity, parseCandidateKey(res.chosen));
  });
});
