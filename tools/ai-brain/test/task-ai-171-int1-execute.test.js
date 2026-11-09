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
  Object.assign(c, { upstream, accountId, quotaScope: accountId, modelId });
  Object.assign(c, { cost, quality, qualifiedRoles: ['author.foundation'] });
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
  const execArgs = () => ({
    execute: true,
    json: true,
    cwd: wt,
    'prompt-file': pFile,
    item: 'TASK-AI-171-TEST',
  });
  const dryArgs = () => ({ 'dry-run': true, json: true, item: 'TASK-AI-171-TEST' });
  const deps = (now, candidates) => ({
    candidates,
    now,
    quotaStateFile: qFile,
    routeHealthFile: hFile,
    home: dir,
    decisionDir: dir,
    evidenceDir: dir,
    maxAttempts: 1,
    concurrency: 1,
  });
  return {
    dir,
    wt,
    pFile,
    hFile,
    execArgs,
    dryArgs,
    deps,
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
    assert.deepEqual(res.outcome.payload, {
      candidateKey: 'suggested-route',
      explanation: 'worker output',
    });

    const jsonLog = parseJsonLog(logs);
    assert.equal(jsonLog?.outcome?.status, 'completed');
    assert.equal(jsonLog?.outcome?.candidateKey, res.chosen);
    assert.doesNotMatch(jsonLog?.launchedArgvIdentity?.account, /operator@example\.com/);

    // Negative test (Review P2 2): worker prints a different candidateKey on success -> outcome retains launched candidate
    const diffRunner = () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        candidateKey: 'untrusted-spoofed-route',
        status: 'completed',
        exitCode: 99,
      }),
    });
    const { res: resDiff } = runDispatch(env, [cA], diffRunner, now);
    assert.equal(resDiff.exitCode, 0);
    assert.equal(resDiff.outcome.candidateKey, res.chosen);
    assert.equal(resDiff.outcome.status, 'completed');
    assert.equal(resDiff.outcome.payload.candidateKey, 'untrusted-spoofed-route');

    // Negative test (Review P2 2): worker prints matching candidateKey but conflicting status/scope -> executor status/exit win
    const conflictRunner = () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        candidateKey: res.chosen,
        status: 'worker-status-compromised',
        exitCode: 42,
        failureScope: 'worker-scope',
      }),
    });
    const { res: resConflict } = runDispatch(env, [cA], conflictRunner, now);
    assert.equal(resConflict.exitCode, 0);
    assert.equal(resConflict.outcome.candidateKey, res.chosen);
    assert.equal(resConflict.outcome.status, 'completed');
    assert.equal(resConflict.outcome.payload.status, 'worker-status-compromised');
    assert.equal(resConflict.outcome.payload.exitCode, 42);
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

    // Negative test (Review P2 1): failure receipts still expose raw account via failedAttempts
    const rawReceiptStr = JSON.stringify(res);
    assert.doesNotMatch(rawReceiptStr, /operator@example\.com/);
    assert.doesNotMatch(
      res.failedAttempts[0].launchedArgvIdentity.account,
      /operator@example\.com/
    );
    assert.doesNotMatch(res.failedAttempts[0].candidate.accountId, /operator@example\.com/);
    assert.doesNotMatch(res.failedAttempts[0].key, /operator@example\.com/);
    if (jsonLog) {
      assert.doesNotMatch(JSON.stringify(jsonLog), /operator@example\.com/);
    }
  });
});
