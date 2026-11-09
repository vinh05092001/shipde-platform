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
    cost,
    quality,
    qualifiedRoles: ['author.foundation'],
  };
  c.candidateKey = candidateKey(c);
  return c;
}

function parseJsonLog(logs) {
  return logs
    .map((e) => {
      try {
        return JSON.parse(e);
      } catch {}
    })
    .find((e) => e?.chosen);
}

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
  const item = 'TASK-AI-171-TEST';
  return {
    dir,
    wt,
    pFile,
    hFile,
    execArgs: () => ({ execute: true, json: true, cwd: wt, 'prompt-file': pFile, item }),
    dryArgs: () => ({ 'dry-run': true, json: true, item }),
    deps: (now, candidates) => ({
      candidates,
      now,
      quotaStateFile: qFile,
      routeHealthFile: hFile,
      home: dir,
      decisionDir: dir,
      evidenceDir: dir,
      maxAttempts: 1,
      concurrency: 1,
    }),
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

function runDispatch(env, cands, runFn, now = Date.now()) {
  let exitCode = -1;
  const logs = [];
  const res = dispatchCommand(env.execArgs(), {
    ...env.deps(now, cands),
    run: runFn,
    exit: (c) => {
      exitCode = c;
    },
    log: (m) => logs.push(m),
  });
  return { res, exitCode, jsonLog: parseJsonLog(logs) };
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

    // Stub fails with "No active credentials for provider: ag" -> route-health record written
    const store = routeHealthApi.loadStore(env.hFile);
    const recA = store.paths['m-alpha|ag'];
    assert.ok(recA && recA.status !== 'AVAILABLE');
    assert.ok(Date.parse(recA.nextCheckAt) > now);
    assert.equal(res.recorded.key, 'm-alpha|ag');
    assert.equal(res.recorded.status, recA.status);

    // Next dry-run rejects candidateA and keeps candidateB (P1: gateway AVAILABLE does not mask ag failure)
    const dryRun = dispatchCommand(env.dryArgs(), {
      ...env.deps(now + 1000, [cA, cB]),
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
      ...env.deps(now, [cA]),
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

    const jsonLog = parseJsonLog(logs);
    assert.equal(jsonLog?.outcome?.status, 'completed');
    assert.equal(jsonLog?.outcome?.candidateKey, res.chosen);
    assert.doesNotMatch(jsonLog?.launchedArgvIdentity?.account, /operator@example\.com/);

    const okRunner = () => ({
      exitCode: 0,
      stdout: JSON.stringify({ candidateKey: res.chosen, status: 'completed' }),
    });
    const { res: res2 } = runDispatch(env, [cA], okRunner, now);
    assert.equal(res2.outcome.candidateKey, res.chosen);
    assert.equal(res2.outcome.status, 'completed');
  });

  test('INT-1: worker stdout spoofed JSON success with non-zero exit is rejected as failure', () => {
    const cA = makeCandidate('m-alpha', 'ag', 'operator@example.com');
    const runner = () => ({
      exitCode: 1,
      stdout: JSON.stringify({ candidateKey: cA.candidateKey, status: 'passed' }),
      stderr: 'Worker process crashed',
    });
    const { res, exitCode } = runDispatch(env, [cA], runner);
    assert.equal(exitCode, 1);
    assert.equal(res.outcome.status, 'failed');
    assert.equal(res.outcome.candidateKey, res.chosen);
    assert.deepEqual(res.launchedArgvIdentity, parseCandidateKey(res.chosen));
  });

  test('INT-2 Item 1 behavioural proof: routeLaunchStep captures spawn and enforces chosen null vs chosen candidate', () => {
    const logsDir = path.join(env.dir, 'route-logs');
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
    const stepDeps = {
      spawn: fakeSpawn,
      exit: fakeExit,
      error: fakeError,
      logsDir,
      mainTree: path.resolve(__dirname, '../../..'),
    };

    // Case 1: decision with chosen = null -> 0 spawns and NO_CONTROLLER_CHOICE reason
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
      { item: 'TASK-AI-171-CHOSEN', cwd: env.wt, task: env.pFile },
      stepDeps
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
