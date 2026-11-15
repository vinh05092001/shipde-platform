'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { dispatchCommand } = require('../cli');
const evidence = require('../evidence');
const quotaStore = require('../quota-store');
const { candidateKey } = require('../candidates');

describe('Synchronous dispatch feedback remains distinct from background handoff', () => {
  assert.notEqual(require('../harness').getHarness('hermes').backgroundLaunch, true);
  let tmpDir;
  let evidenceDir;
  let home;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-wiring-'));
    evidenceDir = path.join(tmpDir, 'evidence');
    home = path.join(tmpDir, 'home');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function candidate(overrides) {
    return Object.assign(
      {
        harness: 'hermes',
        accessPath: 'http://127.0.0.1:20128/v1',
        gateway: '9router',
        upstream: 'gh',
        accountId: 'acc-1',
        quotaScope: 'acc-1',
        modelId: 'gh/gpt-4o',
        qualifiedRoles: ['author.foundation'],
        cost: 10,
        quality: 80,
      },
      overrides || {}
    );
  }

  test('no pin: dispatch picks the top-ranked eligible candidate', () => {
    const candA = candidate({
      upstream: 'gh',
      accountId: 'acc-1',
      modelId: 'gh/gpt-4o',
      cost: 5,
      quality: 90,
    });
    const candB = candidate({
      upstream: 'kr',
      accountId: 'acc-2',
      modelId: 'kr/claude-sonnet',
      cost: 50,
      quality: 70,
    });

    const calls = [];
    const run = (adapter, args) => {
      calls.push({ command: adapter.command, args });
      return { exitCode: 0, stdout: '{"session_id":"sess-01","status":"running"}' };
    };

    let exitCode = null;
    const exit = (code) => {
      exitCode = code;
    };

    const res = dispatchCommand(
      { execute: true, item: 'TASK-NO-PIN' },
      {
        candidates: [candA, candB],
        run,
        routeHealthFile: path.join(tmpDir, 'route-health.json'),
        evidenceDir,
        decisionDir: path.join(tmpDir, 'decisions'),
        home,
        exit,
        log: () => {},
      }
    );

    assert.equal(exitCode, 0, 'dispatch should exit 0 on success');
    assert.equal(calls.length, 1, 'launcher should be called exactly once');
    assert.equal(res.chosen, candidateKey(candA), 'top-ranked candidate A must be chosen');
    assert.match(
      JSON.stringify(calls[0].args),
      /gh\/gpt-4o/,
      'launcher args must name top candidate model'
    );

    // Outcome recorded as passed in evidence
    const evData = evidence.loadEvidence(evidenceDir);
    const evA = evidence.getEvidence(evData, candA);
    assert.equal(evA.length, 1);
    assert.equal(evA[0].status, 'passed');
  });

  test('first candidate launch fails with 402-inside-503 -> upstream cooled, second candidate launched, both outcomes in evidence', () => {
    const cand1 = candidate({
      upstream: 'gh',
      accountId: 'acc-gh',
      quotaScope: 'acc-gh',
      modelId: 'gh/gpt-4o',
      cost: 5,
    });
    const cand2 = candidate({
      upstream: 'kr',
      accountId: 'acc-kr',
      quotaScope: 'acc-kr',
      modelId: 'kr/claude-sonnet',
      cost: 20,
    });

    const calls = [];
    const run = (adapter, args) => {
      calls.push({ command: adapter.command, args });
      if (calls.length === 1) {
        return {
          exitCode: 1,
          httpStatus: 503,
          body: 'HTTP 503: [402]: {"message":"Payment required, budget exhausted"}',
          stderr: 'HTTP 503: [402]: {"message":"Payment required, budget exhausted"}',
        };
      }
      return { exitCode: 0, stdout: '{"session_id":"sess-fallback","status":"running"}' };
    };

    let exitCode = null;
    const exit = (code) => {
      exitCode = code;
    };

    const res = dispatchCommand(
      { execute: true, item: 'TASK-COOL-FALLBACK' },
      {
        candidates: [cand1, cand2],
        run,
        routeHealthFile: path.join(tmpDir, 'route-health.json'),
        evidenceDir,
        decisionDir: path.join(tmpDir, 'decisions'),
        home,
        exit,
        log: () => {},
        maxAttempts: 3,
      }
    );

    assert.equal(exitCode, 0, 'fallback to second candidate should succeed and exit 0');
    assert.equal(
      calls.length,
      2,
      'launcher should be invoked twice (first failed, second succeeded)'
    );
    assert.match(JSON.stringify(calls[0].args), /gh\/gpt-4o/, 'first attempt should launch cand1');
    assert.match(
      JSON.stringify(calls[1].args),
      /kr\/claude-sonnet/,
      'second attempt should launch cand2'
    );

    const evData = evidence.loadEvidence(evidenceDir);

    // Upstream gh should be marked blocked / cooled
    assert.ok(
      evData.upstreamStatus && evData.upstreamStatus.gh,
      'gh upstream status must be recorded'
    );
    assert.equal(evData.upstreamStatus.gh.lastStatus, 'blocked', 'gh upstream must be cooled');
    assert.match(
      String(evData.upstreamStatus.gh.cause).toLowerCase(),
      /credit_exhausted/,
      'cause must be credit exhausted'
    );

    // Both outcomes present in evidence
    const ev1 = evidence.getEvidence(evData, cand1);
    assert.equal(ev1.length, 1, 'cand1 must have 1 evidence record');
    assert.equal(ev1[0].status, 'failed', 'cand1 evidence must be failed');

    const ev2 = evidence.getEvidence(evData, cand2);
    assert.equal(ev2.length, 1, 'cand2 must have 1 evidence record');
    assert.equal(ev2[0].status, 'passed', 'cand2 evidence must be passed');
  });

  test('reservation released after success, failure and thrown error', () => {
    // 1. Success case
    {
      const candSuccess = candidate({ modelId: 'gh/m-success' });
      let reservedDuringLaunch = false;
      const runSuccess = () => {
        const reservations = quotaStore.getReservations({ home });
        if (Object.keys(reservations).some((k) => k.startsWith('TASK-RES-SUCCESS::')))
          reservedDuringLaunch = true;
        return { exitCode: 0, stdout: '{"session_id":"sess-res-1"}' };
      };

      dispatchCommand(
        { execute: true, item: 'TASK-RES-SUCCESS' },
        {
          candidates: [candSuccess],
          run: runSuccess,
          routeHealthFile: path.join(tmpDir, 'route-health.json'),
          evidenceDir,
          decisionDir: path.join(tmpDir, 'decisions'),
          home,
          exit: () => {},
          log: () => {},
        }
      );

      assert.equal(reservedDuringLaunch, true, 'reservation must be held during launch');
      const afterSuccess = quotaStore.getReservations({ home });
      assert.equal(
        Object.keys(afterSuccess).find((k) => k.startsWith('TASK-RES-SUCCESS::'))
          ? 'held'
          : undefined,
        undefined,
        'reservation must be released after success'
      );
    }

    // 2. Failure case
    {
      const candFail = candidate({ modelId: 'gh/m-fail' });
      let reservedDuringLaunch = false;
      const runFailure = () => {
        const reservations = quotaStore.getReservations({ home });
        if (Object.keys(reservations).some((k) => k.startsWith('TASK-RES-FAIL::')))
          reservedDuringLaunch = true;
        return { exitCode: 1, stderr: 'process error' };
      };

      dispatchCommand(
        { execute: true, item: 'TASK-RES-FAIL' },
        {
          candidates: [candFail],
          run: runFailure,
          routeHealthFile: path.join(tmpDir, 'route-health.json'),
          evidenceDir,
          decisionDir: path.join(tmpDir, 'decisions'),
          home,
          exit: () => {},
          log: () => {},
          maxAttempts: 1,
        }
      );

      assert.equal(reservedDuringLaunch, true, 'reservation must be held during launch');
      const afterFail = quotaStore.getReservations({ home });
      assert.equal(
        Object.keys(afterFail).find((k) => k.startsWith('TASK-RES-FAIL::')) ? 'held' : undefined,
        undefined,
        'reservation must be released after failure'
      );
    }

    // 3. Thrown error case
    {
      const candThrow = candidate({ modelId: 'gh/m-throw' });
      let reservedDuringLaunch = false;
      const runThrow = () => {
        const reservations = quotaStore.getReservations({ home });
        if (Object.keys(reservations).some((k) => k.startsWith('TASK-RES-THROW::')))
          reservedDuringLaunch = true;
        throw new Error('launcher crashed');
      };

      dispatchCommand(
        { execute: true, item: 'TASK-RES-THROW' },
        {
          candidates: [candThrow],
          run: runThrow,
          routeHealthFile: path.join(tmpDir, 'route-health.json'),
          evidenceDir,
          decisionDir: path.join(tmpDir, 'decisions'),
          home,
          exit: () => {},
          log: () => {},
          maxAttempts: 1,
        }
      );

      assert.equal(reservedDuringLaunch, true, 'reservation must be held during launch');
      const afterThrow = quotaStore.getReservations({ home });
      assert.equal(
        Object.keys(afterThrow).find((k) => k.startsWith('TASK-RES-THROW::')) ? 'held' : undefined,
        undefined,
        'reservation must be released after thrown error'
      );
    }
  });
});
