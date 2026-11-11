'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { candidateKey, parseCandidateKey } = require('../discovery/identity');
const { routeLaunchStep } = require('../route-launch');
const { parseArgs } = require('../cli');

function createStepHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlaunch-')),
    wt = path.join(dir, 'wt');
  const logsDir = path.join(dir, 'logs'),
    pFile = path.join(dir, 'p.md'),
    childCalls = [],
    loggedErrors = [];
  let exitCode = null,
    closedFd = null;
  fs.mkdirSync(wt, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(pFile, 'Prompt for TASK-AI-171\n');
  const fakeSpawn = (cmd, args, opts) => {
    const listeners = {},
      child = {
        pid: 4242,
        unref: () => {},
        on: (ev, fn) => ((listeners[ev] = fn), child),
        emit: (ev, ...d) => listeners[ev] && listeners[ev](...d),
      };
    childCalls.push({ type: 'spawn', cmd, args, opts, child });
    return child;
  };
  const stepDeps = {
    spawn: fakeSpawn,
    execFileSync: (cmd, args, opts) => (
      childCalls.push({ type: 'execFileSync', cmd, args, opts }),
      '1111222233334444555566667777888899990000'
    ),
    exit: (c) => {
      exitCode = c;
    },
    error: (m) => loggedErrors.push(m),
    fs: { ...fs, closeSync: (fd) => ((closedFd = fd), fs.closeSync(fd)) },
    logsDir,
    mainTree: path.resolve(__dirname, '../../..'),
  };
  return {
    dir,
    wt,
    pFile,
    logsDir,
    logFile: path.join(logsDir, 'route-log.jsonl'),
    childCalls,
    loggedErrors,
    getExitCode: () => exitCode,
    getClosedFd: () => closedFd,
    setClosedFd: (fd) => {
      closedFd = fd;
    },
    spawns: () => childCalls.filter((c) => c.type === 'spawn'),
    execs: () => childCalls.filter((c) => c.type === 'execFileSync'),
    stepDeps,
    step: (dec, item, deps = stepDeps, opts = {}) =>
      routeLaunchStep(dec, { item, cwd: wt, task: pFile, ...opts }, deps),
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

describe('TASK-AI-171: routeLaunchStep decoupling and runtime provenance', () => {
  let env;
  const candidateA = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: '9router',
    upstream: 'ag',
    accountId: 'ag',
    quotaScope: 'ag',
    modelId: 'm-alpha',
    cost: 1,
    quality: 90,
    qualifiedRoles: ['author.foundation'],
  };
  candidateA.candidateKey = candidateKey(candidateA);
  const chosenDecision = {
    chosen: candidateA.candidateKey,
    candidates: [candidateA],
    ranking: [{ candidateKey: candidateA.candidateKey, score: 90 }],
  };

  before(() => {
    env = createStepHarness();
  });
  after(() => {
    env.cleanup();
  });

  test('Case 1-4: launch refusal on null choice, unavailable git, unwritable log, or log open failure', async () => {
    // Case 1: chosen = null refuses spawn (0 processes, NO_CONTROLLER_CHOICE, no process.exit)
    const nullDecision = {
      chosen: null,
      reason: 'REFUSED: no candidate qualifies under quota or route constraints',
      ranking: [],
    };
    const nullRes = env.step(nullDecision, 'TASK-AI-171-NULL');
    assert.equal(env.childCalls.length, 0, 'zero child calls on chosen = null');
    assert.equal(env.getExitCode(), null, 'never calls process.exit itself on chosen = null');
    assert.equal(nullRes.launched, false);
    assert.equal(nullRes.spawns, 0);
    assert.equal(nullRes.reason, 'NO_CONTROLLER_CHOICE');
    assert.ok(nullRes.detail && nullRes.detail.includes('REFUSED'));
    assert.ok(env.loggedErrors.some((e) => e.includes('NO_CONTROLLER_CHOICE')));
    const nullOutcome = await nullRes.completion;
    assert.equal(nullOutcome.launched, false);
    assert.equal(nullOutcome.reason, 'NO_CONTROLLER_CHOICE');

    // Case 2: unavailable git refuses launch with PROVENANCE_UNAVAILABLE
    const badGitDeps = {
      ...env.stepDeps,
      execFileSync: () => {
        throw new Error('git not found');
      },
    };
    const noGitRes = env.step(chosenDecision, 'TASK-AI-171-NO-GIT', badGitDeps);
    assert.equal(noGitRes.launched, false);
    assert.equal(noGitRes.reason, 'PROVENANCE_UNAVAILABLE');
    assert.equal(env.spawns().length, 0, 'zero dispatch on unavailable git');

    // Case 3: unwritable log refuses launch with PROVENANCE_UNAVAILABLE
    const badLogFs = {
      ...fs,
      mkdirSync: fs.mkdirSync.bind(fs),
      appendFileSync: () => {
        throw new Error('EACCES: permission denied');
      },
    };
    const badLogRes = env.step(chosenDecision, 'TASK-AI-171-BAD-LOG', {
      ...env.stepDeps,
      fs: badLogFs,
    });
    assert.equal(badLogRes.launched, false);
    assert.equal(badLogRes.reason, 'PROVENANCE_UNAVAILABLE');
    assert.equal(env.spawns().length, 0, 'zero dispatch on unwritable log');

    // Case 4: output log open failure refuses launch with LOG_OPEN_FAILED
    const badOpenFs = {
      ...fs,
      openSync: () => {
        throw new Error('EACCES: permission denied opening route-tag.log');
      },
    };
    const badOpenRes = env.step(chosenDecision, 'TASK-AI-171-BAD-OPEN-LOG', {
      ...env.stepDeps,
      fs: badOpenFs,
    });
    assert.equal(badOpenRes.launched, false);
    assert.equal(badOpenRes.reason, 'LOG_OPEN_FAILED');
    assert.equal(badOpenRes.spawns, 0);
    assert.ok(
      badOpenRes.detail && badOpenRes.detail.includes('Failed to open execution output log')
    );
    assert.equal(env.spawns().length, 0, 'zero dispatch spawns on log open failure');
    const logFailOutcome = await badOpenRes.completion;
    assert.equal(logFailOutcome.launched, false);
    assert.equal(logFailOutcome.reason, 'LOG_OPEN_FAILED');
  });

  test('Case 5-6: custom launcher exclusivity and failure descriptor cleanup', () => {
    // Subcase 5a: launcher spawns once and returns undefined
    let launcherSpawnCount = 0;
    const customRes = env.step(chosenDecision, 'TASK-AI-171-CUSTOM-LAUNCHER', {
      ...env.stepDeps,
      launcher: (p, c, t, i, d) => {
        launcherSpawnCount++;
        d.spawn('dummy', ['arg']);
      },
    });
    assert.equal(launcherSpawnCount, 1, 'custom launcher invoked once');
    assert.equal(customRes.launched, false);
    assert.equal(customRes.reason, 'INVALID_LAUNCHER_RESULT');
    assert.equal(customRes.spawns, 1, 'acknowledges dispatch before returning invalid');
    assert.match(customRes.detail, /launch state unknown\/failed/);
    assert.equal(customRes.status, 'launch_state_unknown/failed');
    assert.equal(env.spawns().length, 1, 'launcher spawned once and no fallback dispatch');

    // Subcase 5b: launcher spawns once and throws
    const crashRes = env.step(chosenDecision, 'TASK-AI-171-CRASH-LAUNCHER', {
      ...env.stepDeps,
      launcher: (p, c, t, i, d) => {
        d.spawn('crash', ['arg']);
        throw new Error('CRASH_AFTER_SPAWN');
      },
    });
    assert.equal(crashRes.launched, false);
    assert.equal(crashRes.reason, 'LAUNCHER_ERROR');
    assert.equal(crashRes.spawns, 1, 'acknowledges dispatch before exception');
    assert.match(crashRes.detail, /launch state unknown\/failed/);
    assert.equal(crashRes.status, 'launch_state_unknown/failed');

    // Subcase 5c: launcher fails before spawn
    const earlyFailRes = env.step(chosenDecision, 'TASK-AI-171-EARLY-FAIL', {
      ...env.stepDeps,
      launcher: () => {
        throw new Error('FAIL_BEFORE_SPAWN');
      },
    });
    assert.equal(earlyFailRes.spawns, 0, 'zero spawns when launcher fails before dispatch');
    assert.equal(earlyFailRes.status, 'failed');
    assert.doesNotMatch(earlyFailRes.detail, /launch state unknown/);

    // Case 6: spawn failure closes parent log descriptor
    env.childCalls.length = 0;
    let closedOnFail = null;
    const failRes = env.step(chosenDecision, 'TASK-AI-171-FAIL-SPAWN', {
      ...env.stepDeps,
      spawn: () => {
        throw new Error('EAGAIN: resource temporarily unavailable');
      },
      fs: { ...fs, closeSync: (fd) => ((closedOnFail = fd), fs.closeSync(fd)) },
    });
    assert.equal(failRes.launched, false);
    assert.equal(failRes.reason, 'SPAWN_ERROR');
    assert.ok(closedOnFail !== null, 'parent closed descriptor on spawn failure');

    env.childCalls.length = 0;
  });

  test('Case 7: process count contract: bounded processes on selection, argv identity, and pre-supplied repoSha', () => {
    let logPersistedBeforeSpawn = false;
    const trackingSpawn = (cmd, args, opts) => {
      const logFile = env.logFile;
      logPersistedBeforeSpawn =
        fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes('TASK-AI-171-CHOSEN');
      return env.stepDeps.spawn(cmd, args, opts);
    };
    env.setClosedFd(null);
    const chosenDeps = { ...env.stepDeps, spawn: trackingSpawn };
    const chosenRes = env.step(chosenDecision, 'TASK-AI-171-CHOSEN', chosenDeps);

    assert.equal(chosenRes.launched, false, 'a started subprocess is not yet a launch');
    assert.equal(chosenRes.status, 'subprocess_started');
    assert.equal(chosenRes.spawns, 1);
    assert.equal(chosenRes.choice, candidateA.candidateKey);
    assert.equal(logPersistedBeforeSpawn, true, 'provenance record persisted BEFORE dispatch');
    assert.ok(env.getClosedFd() !== null, 'parent closed log descriptor after successful spawn');

    assert.equal(
      env.childCalls.length,
      2,
      'exactly two child processes for selection (git + dispatch)'
    );
    assert.equal(env.execs().length, 1, 'exactly 1 synchronous git rev-parse HEAD subprocess');
    const spawnCalls = env.spawns();
    assert.equal(spawnCalls.length, 1, 'exactly 1 execution dispatch spawn');
    const spawnCall = spawnCalls[0];
    const offeringIndex = spawnCall.args.indexOf('--offering');
    assert.ok(offeringIndex !== -1, '--offering flag present in spawn args');
    const argvCandidate = spawnCall.args[offeringIndex + 1];
    assert.equal(argvCandidate, chosenDecision.chosen);
    assert.deepEqual(parseCandidateKey(argvCandidate), chosenRes.argvIdentity);

    // Subcase 7b: pre-supplied repoSha -> exactly 1 child process (0 git + 1 spawn)
    env.childCalls.length = 0;
    const preShaRes = env.step(chosenDecision, 'TASK-AI-171-PRE-SHA', {
      ...chosenDeps,
      repoSha: '2222333344445555666677778888999900001111',
    });
    assert.equal(preShaRes.launched, false, 'a started subprocess is not yet a launch');
    assert.equal(preShaRes.status, 'subprocess_started');
    assert.equal(
      env.childCalls.length,
      1,
      'exactly one child process when repoSha is pre-supplied'
    );
    assert.equal(env.childCalls[0].type, 'spawn', 'the single process is the dispatch spawn');
  });

  test('Case 8-10: asynchronous child spawn delivery and persisted runtime provenance', async () => {
    // Case 8: asynchronous child spawn error
    let callbackOutcome = null;
    const asyncChosenRes = env.step(chosenDecision, 'TASK-AI-171-ASYNC-ERR', env.stepDeps, {
      onCompletion: (outcome) => {
        callbackOutcome = outcome;
      },
    });
    assert.equal(asyncChosenRes.launched, false, 'not launched before the dispatch outcome');
    assert.equal(asyncChosenRes.status, 'subprocess_started');
    const asyncSpawnCall = env.spawns().slice(-1)[0];

    asyncSpawnCall.child.emit('error', new Error('ASYNC_EAGAIN'));

    assert.equal(
      asyncChosenRes.launched,
      false,
      'result updated to launched: false on async error'
    );
    assert.equal(asyncChosenRes.status, 'failed', 'result updated to status: failed');
    assert.equal(asyncChosenRes.reason, 'SPAWN_ERROR');
    assert.equal(asyncChosenRes.spawns, 0);

    const asyncOutcome = await asyncChosenRes.completion;
    assert.equal(
      asyncOutcome.launched,
      false,
      'awaited completion outcome reports launched: false'
    );
    assert.equal(
      asyncOutcome.status,
      'failed',
      'awaited completion outcome reports status: failed'
    );
    assert.equal(asyncOutcome.reason, 'SPAWN_ERROR');
    assert.match(asyncOutcome.detail, /ASYNC_EAGAIN/);

    assert.ok(callbackOutcome !== null, 'onCompletion callback was invoked');
    assert.equal(callbackOutcome.launched, false);
    assert.equal(callbackOutcome.status, 'failed');

    // Case 9: asynchronous child spawn success
    const asyncSuccessRes = env.step(chosenDecision, 'TASK-AI-171-ASYNC-OK', env.stepDeps);
    const successSpawnCall = env.spawns().slice(-1)[0];
    successSpawnCall.child.emit('spawn');
    fs.writeFileSync(
      asyncSuccessRes.launchRecord.log,
      JSON.stringify({ chosen: 'k', outcome: { status: 'completed', sessionId: 'sess-1' } }) + '\n'
    );
    successSpawnCall.child.emit('close', 0);
    const successOutcome = await asyncSuccessRes.completion;
    assert.equal(successOutcome.launched, true);
    assert.equal(successOutcome.status, 'worker_launched');
    assert.equal(successOutcome.sessionId, 'sess-1');
    assert.equal(successOutcome.spawns, 1);

    // Case 10: verify runtime provenance in route-log.jsonl
    const logFile = env.logFile;
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
      (l) => l.item === 'TASK-AI-171-ASYNC-ERR' && l.status === 'spawn_failed'
    );
    assert.ok(asyncFailLog, 'async spawn error recorded to route log');
    assert.match(asyncFailLog.error, /ASYNC_EAGAIN/);
  });

  test('Case 11: worker timeout forwarding, absence preservation, invalid refusal, and CLI receipt', () => {
    // (1) timeoutMs 600000 -> argv contains '--timeout-ms','600000' exactly once
    env.childCalls.length = 0;
    const resTimeout = env.step(chosenDecision, 'TASK-AI-171-SAME-ITEM', env.stepDeps, {
      timeoutMs: 600000,
    });
    assert.equal(resTimeout.launched, false, 'a started subprocess is not yet a launch');
    assert.equal(resTimeout.status, 'subprocess_started');
    assert.equal(resTimeout.spawns, 1);
    const spawns600k = env.spawns();
    assert.equal(spawns600k.length, 1);
    const argv600k = spawns600k[0].args;
    const timeoutIndices = argv600k.reduce((acc, arg, idx) => {
      if (arg === '--timeout-ms') acc.push(idx);
      return acc;
    }, []);
    assert.equal(timeoutIndices.length, 1, "argv contains '--timeout-ms' exactly once");
    assert.equal(argv600k[timeoutIndices[0] + 1], '600000');

    // Also test options.workerTimeoutMs as fallback when timeoutMs is absent
    env.childCalls.length = 0;
    const resWorkerTimeout = env.step(
      chosenDecision,
      'TASK-AI-171-WORKER-TIMEOUT-600K',
      env.stepDeps,
      {
        workerTimeoutMs: 600000,
      }
    );
    assert.equal(resWorkerTimeout.launched, false, 'a started subprocess is not yet a launch');
    assert.equal(resWorkerTimeout.status, 'subprocess_started');
    const workerSpawns = env.spawns();
    assert.equal(workerSpawns.length, 1);
    const workerArgv = workerSpawns[0].args;
    const workerTimeoutIndices = workerArgv.reduce((acc, arg, idx) => {
      if (arg === '--timeout-ms') acc.push(idx);
      return acc;
    }, []);
    assert.equal(
      workerTimeoutIndices.length,
      1,
      "workerTimeoutMs forwards '--timeout-ms' exactly once"
    );
    assert.equal(workerArgv[workerTimeoutIndices[0] + 1], '600000');

    // (2) absent -> argv identical to the current one (no --timeout-ms)
    env.childCalls.length = 0;
    const resAbsent = env.step(chosenDecision, 'TASK-AI-171-SAME-ITEM', env.stepDeps);
    assert.equal(resAbsent.launched, false, 'a started subprocess is not yet a launch');
    assert.equal(resAbsent.status, 'subprocess_started');
    const spawnsAbsent = env.spawns();
    assert.equal(spawnsAbsent.length, 1);
    const argvAbsent = spawnsAbsent[0].args;
    assert.equal(argvAbsent.includes('--timeout-ms'), false, 'no --timeout-ms in argv when absent');

    // Compare argv with and without timeoutMs (except the --timeout-ms flag pair)
    const filteredArgv600k = argv600k.filter(
      (_, idx) => idx !== timeoutIndices[0] && idx !== timeoutIndices[0] + 1
    );
    assert.deepEqual(
      filteredArgv600k,
      argvAbsent,
      'argv is identical except for the --timeout-ms pair'
    );

    // (3) invalid values (0, -1, 1.5, 'abc', NaN) -> TIMEOUT_INVALID, 0 spawns, 0 execFileSync
    const invalidValues = [0, -1, 1.5, 'abc', NaN];
    const failingGitDeps = {
      ...env.stepDeps,
      execFileSync: () => {
        throw new Error('git rev-parse HEAD failed');
      },
    };

    for (const badVal of invalidValues) {
      env.childCalls.length = 0;
      const resBad = env.step(chosenDecision, `TASK-AI-171-BAD-${badVal}`, env.stepDeps, {
        timeoutMs: badVal,
      });
      assert.equal(resBad.launched, false, `refuses on invalid timeout: ${badVal}`);
      assert.equal(resBad.reason, 'TIMEOUT_INVALID');
      assert.equal(resBad.exitCode, 1);
      assert.equal(resBad.spawns, 0);
      assert.equal(env.spawns().length, 0, `zero spawns on invalid timeout: ${badVal}`);
      assert.equal(env.execs().length, 0, `zero execFileSync on invalid timeout: ${badVal}`);
      assert.equal(env.childCalls.length, 0, `zero child calls on invalid timeout: ${badVal}`);

      // Even when deps.repoSha is NOT provided and git would fail
      env.childCalls.length = 0;
      let failingGitCalled = false;
      const gitThrowDeps = {
        ...env.stepDeps,
        execFileSync: (...args) => {
          failingGitCalled = true;
          return failingGitDeps.execFileSync(...args);
        },
      };
      const resBadGit = env.step(chosenDecision, `TASK-AI-171-BAD-GIT-${badVal}`, gitThrowDeps, {
        timeoutMs: badVal,
      });
      assert.equal(
        resBadGit.launched,
        false,
        `refuses on invalid timeout with failing git: ${badVal}`
      );
      assert.equal(resBadGit.reason, 'TIMEOUT_INVALID');
      assert.equal(resBadGit.exitCode, 1);
      assert.equal(resBadGit.spawns, 0);
      assert.equal(failingGitCalled, false, `git not called on invalid timeout: ${badVal}`);
      assert.equal(env.spawns().length, 0);
      assert.equal(env.execs().length, 0);

      // Also verify via workerTimeoutMs
      env.childCalls.length = 0;
      const resBadWorker = env.step(
        chosenDecision,
        `TASK-AI-171-BAD-WORKER-${badVal}`,
        env.stepDeps,
        {
          workerTimeoutMs: badVal,
        }
      );
      assert.equal(resBadWorker.launched, false, `refuses on invalid workerTimeoutMs: ${badVal}`);
      assert.equal(resBadWorker.reason, 'TIMEOUT_INVALID');
      assert.equal(resBadWorker.exitCode, 1);
      assert.equal(resBadWorker.spawns, 0);
      assert.equal(env.spawns().length, 0, `zero spawns on invalid workerTimeoutMs: ${badVal}`);
      assert.equal(
        env.execs().length,
        0,
        `zero execFileSync on invalid workerTimeoutMs: ${badVal}`
      );
      assert.equal(
        env.childCalls.length,
        0,
        `zero child calls on invalid workerTimeoutMs: ${badVal}`
      );

      // workerTimeoutMs with failing git
      env.childCalls.length = 0;
      let failingGitWorkerCalled = false;
      const gitThrowWorkerDeps = {
        ...env.stepDeps,
        execFileSync: (...args) => {
          failingGitWorkerCalled = true;
          return failingGitDeps.execFileSync(...args);
        },
      };
      const resBadWorkerGit = env.step(
        chosenDecision,
        `TASK-AI-171-BAD-WORKER-GIT-${badVal}`,
        gitThrowWorkerDeps,
        {
          workerTimeoutMs: badVal,
        }
      );
      assert.equal(
        resBadWorkerGit.launched,
        false,
        `refuses on invalid workerTimeoutMs with failing git: ${badVal}`
      );
      assert.equal(resBadWorkerGit.reason, 'TIMEOUT_INVALID');
      assert.equal(resBadWorkerGit.exitCode, 1);
      assert.equal(resBadWorkerGit.spawns, 0);
      assert.equal(
        failingGitWorkerCalled,
        false,
        `git not called on invalid workerTimeoutMs: ${badVal}`
      );
      assert.equal(env.spawns().length, 0);
      assert.equal(env.execs().length, 0);
    }

    // (4) CLI receipt: parse the produced argv with the same arg parser cli.js uses
    // and show workerTimeoutMs resolves to 600000
    const parsedArgs = parseArgs(argv600k);
    assert.equal(parsedArgs['timeout-ms'], '600000');
    const explicitTimeoutMs = Number(parsedArgs['timeout-ms'] || parsedArgs.timeoutMs) || undefined;
    const workerTimeoutMs = explicitTimeoutMs;
    assert.equal(workerTimeoutMs, 600000, 'CLI parser resolves workerTimeoutMs to 600000');
  });
});
