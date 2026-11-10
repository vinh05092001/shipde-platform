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

function makeCandidate(modelId, upstream, accountId, cost = 1, quality = 90, extra = {}) {
  const c = { harness: 'hermes', accessPath: 'cli', gateway: '9router' };
  Object.assign(c, { upstream, accountId, quotaScope: accountId, modelId });
  Object.assign(c, { cost, quality, qualifiedRoles: ['author.foundation'] }, extra);
  c.candidateKey = candidateKey(c);
  return c;
}

const parseJsonLog = (logs) =>
  logs
    .map((e) => {
      try {
        return JSON.parse(e);
      } catch {}
    })
    .find((e) => e?.chosen);

function createTestHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'int1-'));
  const wt = path.join(dir, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  const [pFile, qFile, hFile] = ['p.md', 'q.json', 'h.json'].map((f) => path.join(dir, f));
  fs.writeFileSync(pFile, 'Prompt for TASK-AI-171 INT-1\n');
  fs.writeFileSync(qFile, '{}');
  routeHealthApi.saveStore(hFile, {
    version: 1,
    paths: { 'm-alpha|9router': { modelId: 'm-alpha', routeId: '9router', status: 'AVAILABLE' } },
    events: [],
  });
  const testDeps = (now, candidates, extra = {}) =>
    Object.assign(
      { candidates, now, maxAttempts: 1, concurrency: 1 },
      {
        quotaStateFile: qFile,
        routeHealthFile: hFile,
        home: dir,
        decisionDir: dir,
        evidenceDir: dir,
      },
      extra
    );
  return {
    dir,
    wt,
    pFile,
    qFile,
    hFile,
    testDeps,
    execArgs: (extra = {}) => ({
      execute: true,
      json: true,
      cwd: wt,
      'prompt-file': pFile,
      item: 'TASK-AI-171-TEST',
      ...extra,
    }),
    dryArgs: () => ({ 'dry-run': true, json: true, item: 'TASK-AI-171-TEST' }),
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

function runDispatch(env, cands, runFn, now = Date.now(), extraArgs = {}) {
  let exitCode = -1;
  const logs = [];
  const res = dispatchCommand(
    env.execArgs(extraArgs),
    Object.assign(env.testDeps(now, cands), {
      run: runFn,
      exit: (c) => {
        exitCode = c;
      },
      log: (m) => logs.push(m),
    })
  );
  return { res, exitCode, jsonLog: parseJsonLog(logs) };
}

describe('TASK-AI-171 INT-1: Controller execute launch, argv identity, and outcome feedback', () => {
  let env;
  beforeEach(() => {
    env = createTestHarness();
  });
  afterEach(() => {
    process.exitCode = 0;
    env.cleanup();
  });

  test('INT-1: execute launches chosen candidate with argv identity, records failure to route-health, and feeds next selection', () => {
    const cA = makeCandidate('m-alpha', 'ag', 'ag');
    const cB = makeCandidate('m-beta', 'other-provider', 'mock-scope-b', 2, 80);
    const now = Date.now();
    let launched = null;

    const runner = (adapter, launchArgs, opts) => {
      launched = { adapter, launchArgs, opts };
      return { exitCode: 1, stderr: 'No active credentials for provider: ag', elapsedMs: 150 };
    };
    const { res, exitCode, jsonLog } = runDispatch(env, [cA, cB], runner, now);

    assert.equal(exitCode, 1);
    assert.equal(res?.chosen, cA.candidateKey);
    const chosenIdentity = parseCandidateKey(res.chosen);
    assert.deepEqual(res.launchedArgvIdentity, chosenIdentity);
    assert.ok(launched?.launchArgs.some((a) => String(a).includes('Prompt for TASK-AI-171 INT-1')));

    assert.equal(jsonLog?.chosen, cA.candidateKey);
    assert.equal(jsonLog?.outcome?.status, 'failed');
    assert.ok(jsonLog?.recorded);
    assert.deepEqual(jsonLog.launchedArgvIdentity, chosenIdentity);

    const store = routeHealthApi.loadStore(env.hFile);
    const recA = store.paths['m-alpha|ag'];
    assert.ok(recA && recA.status !== 'AVAILABLE');
    assert.ok(Date.parse(recA.nextCheckAt) > now);
    assert.equal(res.recorded.key, 'm-alpha|ag');
    assert.equal(res.recorded.status, recA.status);

    const dryRun = dispatchCommand(env.dryArgs(), {
      ...env.testDeps(now + 1000, [cA, cB]),
      allowUnprobedCandidates: true,
      exit: () => {},
      log: () => {},
    });
    const rej = dryRun?.decision?.rejected?.find((r) => r.offeringId === cA.candidateKey);
    assert.equal(rej?.reason, recA.status);
    assert.equal(dryRun.decision.chosen, cB.candidateKey);
    assert.ok(dryRun.decision.candidates.some((c) => c.offeringId === cB.candidateKey));
  });

  test('INT-1: CLI entrypoint main(["dispatch", "--execute", "--json", ...]) returns structured output, masks emails, and validates worker outcome', () => {
    const cA = makeCandidate('m-alpha', 'ag', 'operator@example.com');
    const now = Date.now();
    let exitCode = -1;
    const logs = [];

    const argv =
      `dispatch --execute --json --item TASK-AI-171-TEST --cwd ${env.wt} --prompt-file ${env.pFile}`.split(
        ' '
      );
    const runner = () => ({
      exitCode: 0,
      stdout: JSON.stringify({ candidateKey: 'suggested-route', explanation: 'worker output' }),
    });
    const res = main(argv, {
      ...env.testDeps(now, [cA]),
      run: runner,
      exit: (c) => {
        exitCode = c;
      },
      log: (m) => logs.push(m),
    });

    assert.ok(exitCode === 0 && res?.chosen);
    assert.doesNotMatch(res.launchedArgvIdentity.account, /operator@example\.com/);
    assert.doesNotMatch(res.chosen, /operator@example\.com/);
    assert.equal(res.outcome.candidateKey, res.chosen);
    assert.equal(res.outcome.status, 'completed');
    assert.deepEqual(res.outcome.payload, {
      candidateKey: 'suggested-route',
      explanation: 'worker output',
    });

    const jsonLog = parseJsonLog(logs);
    assert.equal(jsonLog?.outcome?.status, 'completed');
    assert.equal(jsonLog?.outcome?.candidateKey, res.chosen);
    assert.doesNotMatch(jsonLog?.launchedArgvIdentity?.account, /operator@example\.com/);

    // Negative test (Review P2 2 / Item 4): worker prints {"candidateKey":"<different key>","status":"passed"} on success -> outcome keeps candidate & executor status
    const diffRunner = () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        candidateKey: 'different-key',
        status: 'passed',
        exitCode: 42,
        failureScope: 'worker-scope',
      }),
    });
    const { res: resDiff } = runDispatch(env, [cA], diffRunner, now);
    assert.equal(resDiff.exitCode, 0);
    assert.equal(resDiff.outcome.candidateKey, res.chosen);
    assert.equal(resDiff.outcome.status, 'completed');
    assert.deepEqual(resDiff.outcome.payload, {
      candidateKey: 'different-key',
      status: 'passed',
      exitCode: 42,
      failureScope: 'worker-scope',
    });
  });

  test('INT-1: worker stdout spoofed JSON success with non-zero exit is rejected as failure', () => {
    const cA = makeCandidate('m-alpha', 'ag', 'operator@example.com');
    const runner = () => ({
      exitCode: 1,
      stdout: JSON.stringify({ candidateKey: cA.candidateKey, status: 'passed' }),
      stderr: 'Worker process crashed',
    });
    const { res, exitCode, jsonLog } = runDispatch(env, [cA], runner);
    assert.equal(exitCode, 1);
    assert.equal(res.outcome.status, 'failed');
    assert.equal(res.outcome.candidateKey, res.chosen);
    assert.deepEqual(res.launchedArgvIdentity, parseCandidateKey(res.chosen));
    assert.ok(res.failedAttempts?.length > 0);

    // Negative test (Review P2 1): failure receipts deeply mask raw account in failedAttempts
    assert.doesNotMatch(JSON.stringify(res), /operator@example\.com/);
    const f0 = res.failedAttempts[0];
    assert.doesNotMatch(f0.launchedArgvIdentity.account, /operator@example\.com/);
    assert.doesNotMatch(f0.candidate.accountId, /operator@example\.com/);
    assert.doesNotMatch(f0.key, /operator@example\.com/);
    if (jsonLog) assert.doesNotMatch(JSON.stringify(jsonLog), /operator@example\.com/);
  });

  test('INT-1: isolated dispatch reaches isolation launcher seam, preserves candidate options, persists receipt before launch, and forbids fallback on failure', (t) => {
    const isoMod = require('../isolation-launcher');
    const decisionsStore = require('../decisions');
    const cIso = makeCandidate('m-iso-high', 'up-iso', 'acc-iso', 1, 95, {
      harness: 'paseo',
      effort: 'high',
    });
    const now = Date.now();
    let isoLauncherCalls = 0;
    let ordinaryCalls = 0;
    let received = null;
    let persistedBeforeLaunch = false;

    t.mock.method(isoMod, 'getIsolatedLauncher', () => (adapter, launchArgs, options) => {
      isoLauncherCalls++;
      received = { adapter, launchArgs, options };
      const records = decisionsStore.readDecisions({ dir: options?.decisionDir });
      persistedBeforeLaunch = records.some(
        (r) => r.stage === decisionsStore.Stage.LAUNCHED && r.chosen === cIso.candidateKey
      );
      throw new Error('ISOLATION_PROVISIONING_HOOK_FAILED');
    });

    let exitCode = -1;
    const logs = [];
    const argv =
      `dispatch --execute --json --isolated-worker --item TASK-AI-171-TEST --cwd ${env.wt} --prompt-file ${env.pFile}`.split(
        ' '
      );
    const res = main(argv, {
      ...env.testDeps(now, [cIso]),
      run: () => {
        ordinaryCalls++;
        return { exitCode: 0, stdout: 'ordinary' };
      },
      exit: (c) => {
        exitCode = c;
      },
      log: (m) => logs.push(m),
    });

    // 1. Reaches isolated launcher seam & 0 ordinary spawns on failure (no fallback)
    assert.equal(isoLauncherCalls, 1);
    assert.equal(ordinaryCalls, 0);
    assert.equal(exitCode, 1);
    assert.equal(res?.outcome?.status, 'failed');
    assert.match(res?.outcome?.reason || '', /ISOLATION_PROVISIONING_HOOK_FAILED/);

    // 2. Chosen model/account/harness/effort unchanged in isolated launcher call
    assert.equal(received.adapter.id, cIso.harness);
    assert.equal(received.options.modelId, cIso.modelId);
    assert.equal(received.options.accountId, cIso.accountId);
    assert.equal(received.options.effort, cIso.effort);

    // 3. Receipt persisted before launch
    assert.equal(persistedBeforeLaunch, true);
  });

  test('INT-1: routeLaunchStep behaviour: chosen = null refuses spawn; chosen candidate launches exactly one spawn with matching argv identity', () => {
    const logsDir = path.join(env.dir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const childCalls = [];
    const fakeSpawn = (cmd, args, opts) => {
      const listeners = {};
      const child = {
        pid: 4242,
        unref: () => {},
        on: (ev, fn) => {
          listeners[ev] = fn;
          return child;
        },
        emit: (ev, ...data) => {
          if (listeners[ev]) listeners[ev](...data);
        },
      };
      childCalls.push({ type: 'spawn', cmd, args, opts, child });
      return child;
    };
    const fakeExecFileSync = (cmd, args, opts) => {
      childCalls.push({ type: 'execFileSync', cmd, args, opts });
      return '1111222233334444555566667777888899990000';
    };
    let exitCode = null;
    const fakeExit = (code) => {
      exitCode = code;
    };
    const loggedErrors = [];
    const fakeError = (msg) => loggedErrors.push(msg);
    let closedFd = null;
    const trackingFs = {
      ...fs,
      closeSync: (fd) => {
        closedFd = fd;
        return fs.closeSync(fd);
      },
    };
    const stepDeps = {
      spawn: fakeSpawn,
      execFileSync: fakeExecFileSync,
      exit: fakeExit,
      error: fakeError,
      fs: trackingFs,
      logsDir,
      mainTree: path.resolve(__dirname, '../../..'),
    };

    // Case 1: decision with chosen = null -> 0 child processes of any kind, NO_CONTROLLER_CHOICE reason, no process.exit
    const nullDecision = {
      chosen: null,
      reason: 'REFUSED: no candidate qualifies under quota or route constraints',
      ranking: [],
    };
    const nullRes = routeLaunchApi.routeLaunchStep(
      nullDecision,
      { item: 'TASK-AI-171-NULL', cwd: env.wt, task: env.pFile },
      stepDeps
    );

    assert.equal(childCalls.length, 0, 'zero child_process calls of any kind on chosen = null');
    assert.equal(exitCode, null, 'never calls process.exit itself on chosen = null');
    assert.equal(nullRes.launched, false);
    assert.equal(nullRes.spawns, 0);
    assert.equal(nullRes.reason, 'NO_CONTROLLER_CHOICE');
    assert.ok(nullRes.detail && nullRes.detail.includes('REFUSED'));
    assert.ok(loggedErrors.some((e) => e.includes('NO_CONTROLLER_CHOICE')));

    const candidateA = makeCandidate('m-alpha', 'ag', 'ag', 1, 90);
    const chosenDecision = {
      chosen: candidateA.candidateKey,
      candidates: [candidateA],
      ranking: [{ candidateKey: candidateA.candidateKey, score: 90 }],
    };

    // Case 2: unavailable git -> zero dispatch spawns, PROVENANCE_UNAVAILABLE
    const badGitDeps = {
      ...stepDeps,
      execFileSync: () => {
        throw new Error('git not found');
      },
    };
    const noGitRes = routeLaunchApi.routeLaunchStep(
      chosenDecision,
      { item: 'TASK-AI-171-NO-GIT', cwd: env.wt, task: env.pFile },
      badGitDeps
    );
    assert.equal(noGitRes.launched, false);
    assert.equal(noGitRes.reason, 'PROVENANCE_UNAVAILABLE');
    assert.equal(
      childCalls.filter((c) => c.type === 'spawn').length,
      0,
      'zero dispatch on unavailable git'
    );

    // Case 3: unwritable log -> zero dispatch spawns, PROVENANCE_UNAVAILABLE
    const unwritableFs = {
      ...fs,
      mkdirSync: fs.mkdirSync.bind(fs),
      appendFileSync: () => {
        throw new Error('EACCES: permission denied');
      },
    };
    const unwritableLogDeps = {
      ...stepDeps,
      fs: unwritableFs,
    };
    const badLogRes = routeLaunchApi.routeLaunchStep(
      chosenDecision,
      { item: 'TASK-AI-171-BAD-LOG', cwd: env.wt, task: env.pFile },
      unwritableLogDeps
    );
    assert.equal(badLogRes.launched, false);
    assert.equal(badLogRes.reason, 'PROVENANCE_UNAVAILABLE');
    assert.equal(
      childCalls.filter((c) => c.type === 'spawn').length,
      0,
      'zero dispatch on unwritable log'
    );

    // Case 4: custom launcher mutual exclusivity -> launcher spawns once and returns undefined => exactly 1 dispatch
    let launcherSpawnCount = 0;
    const customLauncher = (payload, cwd, taskFile, item, launchDeps) => {
      launcherSpawnCount += 1;
      launchDeps.spawn('dummy-launcher', ['arg']);
      return undefined;
    };
    const launcherDeps = {
      ...stepDeps,
      launcher: customLauncher,
    };
    const customRes = routeLaunchApi.routeLaunchStep(
      chosenDecision,
      { item: 'TASK-AI-171-CUSTOM-LAUNCHER', cwd: env.wt, task: env.pFile },
      launcherDeps
    );
    assert.equal(launcherSpawnCount, 1, 'custom launcher invoked once');
    assert.equal(customRes.launched, false);
    assert.equal(customRes.reason, 'INVALID_LAUNCHER_RESULT');
    const customSpawns = childCalls.filter((c) => c.type === 'spawn');
    assert.equal(customSpawns.length, 1, 'launcher spawned once and fallback never dispatched');
    childCalls.length = 0; // reset for subsequent cases

    // Case 5: spawn failure closes parent log descriptor
    let closedOnFail = null;
    const failFs = {
      ...fs,
      closeSync: (fd) => {
        closedOnFail = fd;
        return fs.closeSync(fd);
      },
    };
    const throwSpawn = () => {
      throw new Error('EAGAIN: resource temporarily unavailable');
    };
    const failSpawnDeps = {
      ...stepDeps,
      spawn: throwSpawn,
      fs: failFs,
    };
    const failRes = routeLaunchApi.routeLaunchStep(
      chosenDecision,
      { item: 'TASK-AI-171-FAIL-SPAWN', cwd: env.wt, task: env.pFile },
      failSpawnDeps
    );
    assert.equal(failRes.launched, false);
    assert.equal(failRes.reason, 'SPAWN_ERROR');
    assert.ok(closedOnFail !== null, 'parent closed descriptor on spawn failure');

    // Case 6: chosen candidate launches exactly 1 spawn with --offering and provenance persisted BEFORE spawn
    let logPersistedBeforeSpawn = false;
    const trackingSpawn = (cmd, args, opts) => {
      const logFile = path.join(logsDir, 'route-log.jsonl');
      logPersistedBeforeSpawn =
        fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes('TASK-AI-171-CHOSEN');
      return fakeSpawn(cmd, args, opts);
    };
    closedFd = null;
    const chosenDeps = {
      ...stepDeps,
      spawn: trackingSpawn,
    };
    const chosenRes = routeLaunchApi.routeLaunchStep(
      chosenDecision,
      { item: 'TASK-AI-171-CHOSEN', cwd: env.wt, task: env.pFile },
      chosenDeps
    );

    assert.equal(chosenRes.launched, true);
    assert.equal(chosenRes.spawns, 1);
    assert.equal(chosenRes.choice, candidateA.candidateKey);
    assert.equal(logPersistedBeforeSpawn, true, 'provenance record persisted BEFORE dispatch');
    assert.ok(closedFd !== null, 'parent closed log descriptor after successful spawn');

    const spawnCalls = childCalls.filter((c) => c.type === 'spawn');
    assert.equal(spawnCalls.length, 1, 'exactly one dispatch spawn');
    const spawnCall = spawnCalls[0];
    const offeringIndex = spawnCall.args.indexOf('--offering');
    assert.ok(offeringIndex !== -1, '--offering flag present in spawn args');
    const argvCandidate = spawnCall.args[offeringIndex + 1];
    assert.equal(argvCandidate, chosenDecision.chosen);
    assert.deepEqual(parseCandidateKey(argvCandidate), chosenRes.argvIdentity);

    // Case 7: asynchronous child spawn failure ('error' event) handled and recorded
    assert.doesNotThrow(() => {
      spawnCall.child.emit('error', new Error('ASYNC_EAGAIN'));
    });

    // Verify runtime provenance in route-log.jsonl
    const logFile = path.join(logsDir, 'route-log.jsonl');
    assert.ok(fs.existsSync(logFile), 'route-log.jsonl written');
    const lines = fs
      .readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    const nullLog = lines.find((l) => l.item === 'TASK-AI-171-NULL');
    assert.ok(nullLog && nullLog.choice === null && path.isAbsolute(nullLog.treePath));
    assert.match(nullLog.noControllerChoice, /NO_CONTROLLER_CHOICE/);

    const chosenLog = lines.find((l) => l.item === 'TASK-AI-171-CHOSEN' && l.choice);
    assert.ok(
      chosenLog &&
        chosenLog.choice.key === candidateA.candidateKey &&
        chosenLog.repoSha &&
        path.isAbsolute(chosenLog.treePath)
    );

    const asyncFailLog = lines.find(
      (l) => l.item === 'TASK-AI-171-CHOSEN' && l.status === 'spawn_failed'
    );
    assert.ok(asyncFailLog, 'async spawn error recorded to route log');
    assert.match(asyncFailLog.error, /ASYNC_EAGAIN/);
  });
});
