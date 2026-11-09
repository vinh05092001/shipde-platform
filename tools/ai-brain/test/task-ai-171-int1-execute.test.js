'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { dispatchCommand, main } = require('../cli');
const { candidateKey, parseCandidateKey } = require('../discovery/identity');
const routeHealthApi = require('../route-health');
const routeLaunchApi = require('../route-launch');

function makeCandidate(modelId, upstream, accountId, cost = 1, quality = 90) {
  const c = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: '9router',
    upstream,
    accountId,
    quotaScope: accountId,
    modelId,
    qualifiedRoles: ['author.foundation'],
    cost,
    quality,
  };
  c.candidateKey = candidateKey(c);
  return c;
}

function createTestHarness() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-171-int1-'));
  const decisionDir = path.join(tempDir, 'decisions');
  const evidenceDir = path.join(tempDir, 'evidence');
  const tempWorktree = path.join(tempDir, 'worktree');
  const promptFile = path.join(tempDir, 'task-prompt.md');
  const quotaStateFile = path.join(tempDir, 'quota-state.json');
  const routeHealthFile = path.join(tempDir, 'model-route-health.json');

  fs.mkdirSync(decisionDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(tempWorktree, { recursive: true });
  fs.writeFileSync(promptFile, 'Prompt for TASK-AI-171 INT-1 execution test\n', 'utf8');
  fs.writeFileSync(quotaStateFile, JSON.stringify({ accounts: {} }), 'utf8');
  routeHealthApi.saveStore(routeHealthFile, {
    version: 1,
    updatedAt: new Date().toISOString(),
    paths: {},
    events: [],
  });

  return {
    tempDir,
    decisionDir,
    evidenceDir,
    tempWorktree,
    promptFile,
    quotaStateFile,
    routeHealthFile,
    deps: (now, candidates) => ({
      candidates,
      quotaStateFile,
      decisionDir,
      evidenceDir,
      routeHealthFile,
      now,
      home: tempDir,
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
    assert.equal(res.launchedArgvIdentity.modelId, 'm-alpha');
    assert.equal(res.launchedArgvIdentity.upstream, 'ag');
    assert.equal(res.launchedArgvIdentity.harness, 'hermes');
    assert.ok(
      launchedArgs?.launchArgs.some((a) => String(a).includes('Prompt for TASK-AI-171 INT-1'))
    );

    const jsonLog = capturedLogs.find((e) => {
      try {
        return JSON.parse(e)?.chosen;
      } catch {
        return false;
      }
    });
    assert.ok(jsonLog);
    const parsed = JSON.parse(jsonLog);
    assert.equal(parsed.chosen, candidateA.candidateKey);
    assert.deepEqual(parsed.launchedArgvIdentity, chosenIdentity);
    assert.equal(parsed.outcome.status, 'failed');
    assert.ok(parsed.recorded);

    // Stub fails with "No active credentials for provider: ag" -> route-health record written
    const store = routeHealthApi.loadStore(env.routeHealthFile);
    const recA = store.paths['m-alpha|ag'];
    assert.ok(recA && recA.status !== 'AVAILABLE');
    assert.ok(Date.parse(recA.nextCheckAt) > now);
    assert.equal(res.recorded.key, 'm-alpha|ag');
    assert.equal(res.recorded.status, recA.status);

    // Next dry-run rejects candidateA and keeps candidateB
    const dryRun = dispatchCommand(
      { 'dry-run': true, json: true, item: 'TASK-AI-171-TEST' },
      { ...baseDeps, now: now + 1000, allowUnprobedCandidates: true, exit: () => {}, log: () => {} }
    );
    const rejected = dryRun?.decision?.rejected?.find(
      (r) => r.offeringId === candidateA.candidateKey
    );
    assert.ok(rejected);
    assert.equal(rejected.reason, recA.status);
    assert.equal(dryRun.decision.chosen, candidateB.candidateKey);
    assert.ok(dryRun.decision.candidates.some((c) => c.offeringId === candidateB.candidateKey));
  });

  test('INT-1: CLI entrypoint main(["dispatch", "--execute", "--json", ...]) returns structured output and honors --prompt-file', () => {
    const candidateA = makeCandidate('m-alpha', 'ag', 'ag', 1, 90);
    const now = Date.now();
    let exitCode = -1;
    let stubCalled = false;
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
        run: () => {
          stubCalled = true;
          return { exitCode: 0, stdout: JSON.stringify({ status: 'completed' }) };
        },
        exit: (code) => {
          exitCode = code;
        },
        log: (msg) => capturedLogs.push(msg),
      }
    );

    assert.ok(stubCalled && exitCode === 0 && res?.chosen === candidateA.candidateKey);
    assert.deepEqual(res.launchedArgvIdentity, parseCandidateKey(candidateA.candidateKey));
    assert.equal(res.outcome.status, 'completed');
    const jsonLog = capturedLogs.find((e) => {
      try {
        return JSON.parse(e)?.chosen;
      } catch {
        return false;
      }
    });
    assert.ok(jsonLog && JSON.parse(jsonLog).outcome.status === 'completed');
  });

  test('INT-2 Item 1 behavioural proof: routeLaunchStep captures spawn and enforces chosen null vs chosen candidate', () => {
    const logsDir = path.join(env.tempDir, 'route-logs');
    fs.mkdirSync(logsDir, { recursive: true });

    const spawnCalls = [];
    const fakeSpawn = (cmd, args, opts) => {
      spawnCalls.push({ cmd, args, opts });
      return { pid: 4242, unref: () => {} };
    };

    let exitCode = null;
    const fakeExit = (code) => {
      exitCode = code;
    };
    const loggedErrors = [];
    const fakeError = (msg) => loggedErrors.push(msg);

    // Case 1: decision with chosen = null -> 0 spawns and NO_CONTROLLER_CHOICE reason
    const nullDecision = {
      chosen: null,
      reason: 'REFUSED: no candidate qualifies under quota or route constraints',
      ranking: [],
    };
    const nullRes = routeLaunchApi.routeLaunchStep(
      nullDecision,
      { item: 'TASK-AI-171-NULL', cwd: env.tempWorktree, task: env.promptFile },
      {
        spawn: fakeSpawn,
        exit: fakeExit,
        error: fakeError,
        logsDir,
        mainTree: path.resolve(__dirname, '../../..'),
      }
    );

    assert.equal(spawnCalls.length, 0, 'zero spawns on chosen = null');
    assert.equal(exitCode, 3, 'exits with code 3 on chosen = null');
    assert.equal(nullRes.launched, false);
    assert.equal(nullRes.spawns, 0);
    assert.match(nullRes.reason, /NO_CONTROLLER_CHOICE/);
    assert.ok(loggedErrors.some((e) => e.includes('NO_CONTROLLER_CHOICE')));

    // Case 2: decision with a chosen candidate -> exactly 1 spawn whose argv identity equals decision.chosen
    const candidateA = makeCandidate('m-alpha', 'ag', 'ag', 1, 90);
    const chosenDecision = {
      chosen: candidateA.candidateKey,
      candidates: [candidateA],
      ranking: [{ candidateKey: candidateA.candidateKey, score: 90 }],
    };
    exitCode = null;
    const chosenRes = routeLaunchApi.routeLaunchStep(
      chosenDecision,
      { item: 'TASK-AI-171-CHOSEN', cwd: env.tempWorktree, task: env.promptFile },
      {
        spawn: fakeSpawn,
        exit: fakeExit,
        error: fakeError,
        logsDir,
        mainTree: path.resolve(__dirname, '../../..'),
      }
    );

    assert.equal(spawnCalls.length, 1, 'exactly one spawn on chosen candidate');
    assert.equal(chosenRes.launched, true);
    assert.equal(chosenRes.spawns, 1);
    assert.equal(chosenRes.choice, candidateA.candidateKey);

    const spawnCall = spawnCalls[0];
    const candidateIndex = spawnCall.args.indexOf('--candidate');
    assert.ok(candidateIndex !== -1, '--candidate flag present in spawn args');
    const argvCandidate = spawnCall.args[candidateIndex + 1];
    assert.equal(argvCandidate, chosenDecision.chosen);
    assert.deepEqual(parseCandidateKey(argvCandidate), chosenRes.argvIdentity);

    // Verify runtime provenance in route-log.jsonl
    const logFile = path.join(logsDir, 'route-log.jsonl');
    assert.ok(fs.existsSync(logFile), 'route-log.jsonl written');
    const lines = fs
      .readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);

    const nullLog = lines.find((l) => l.item === 'TASK-AI-171-NULL');
    assert.ok(
      nullLog && nullLog.choice === null && nullLog.repoSha && path.isAbsolute(nullLog.treePath)
    );
    assert.match(nullLog.noControllerChoice, /NO_CONTROLLER_CHOICE/);

    const chosenLog = lines.find((l) => l.item === 'TASK-AI-171-CHOSEN');
    assert.ok(
      chosenLog &&
        chosenLog.choice.key === candidateA.candidateKey &&
        chosenLog.repoSha &&
        path.isAbsolute(chosenLog.treePath)
    );
  });
});
