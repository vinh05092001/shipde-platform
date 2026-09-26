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

describe('Master-queue item 5: dispatch wiring (cli.js dispatch)', () => {
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
        harness: 'paseo',
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
      return { exitCode: 0, stdout: '{"id":"sess-01","status":"running"}' };
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
        evidenceDir,
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
      return { exitCode: 0, stdout: '{"id":"sess-fallback","status":"running"}' };
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
        evidenceDir,
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

  test('all candidates excluded -> non-zero exit listing reasons, nothing launched', () => {
    const cand1 = candidate({
      upstream: 'gh',
      accountId: 'acc-1',
      modelId: 'gh/gpt-4o',
      cooldownUntil: new Date(Date.now() + 3600000).toISOString(),
    });
    const cand2 = candidate({
      upstream: 'kr',
      accountId: 'acc-2',
      modelId: 'kr/claude-sonnet',
      cooldownUntil: new Date(Date.now() + 3600000).toISOString(),
    });

    let launcherCalled = false;
    const run = () => {
      launcherCalled = true;
      return { exitCode: 0 };
    };

    let exitCode = null;
    const exit = (code) => {
      exitCode = code;
    };

    const logs = [];
    const log = (msg) => logs.push(String(msg));

    const res = dispatchCommand(
      { execute: true, item: 'TASK-ALL-EXCLUDED' },
      {
        candidates: [cand1, cand2],
        run,
        evidenceDir,
        home,
        exit,
        log,
      }
    );

    assert.equal(exitCode, 1, 'must exit non-zero (1) when all candidates are excluded');
    assert.equal(
      launcherCalled,
      false,
      'launcher must never be called when all candidates are excluded'
    );
    assert.equal(res.exitCode, 1);
    assert.ok(
      logs.some((l) => l.includes('EXCLUDED') || l.includes('No eligible candidate')),
      'output must list exclusion reasons for candidates'
    );
  });

  test('reservation released after success, failure and thrown error', () => {
    // 1. Success case
    {
      const candSuccess = candidate({ modelId: 'gh/m-success' });
      let reservedDuringLaunch = false;
      const runSuccess = () => {
        const reservations = quotaStore.getReservations({ home });
        if (reservations['TASK-RES-SUCCESS']) reservedDuringLaunch = true;
        return { exitCode: 0, stdout: '{"id":"sess-res-1"}' };
      };

      dispatchCommand(
        { execute: true, item: 'TASK-RES-SUCCESS' },
        {
          candidates: [candSuccess],
          run: runSuccess,
          evidenceDir,
          home,
          exit: () => {},
          log: () => {},
        }
      );

      assert.equal(reservedDuringLaunch, true, 'reservation must be held during launch');
      const afterSuccess = quotaStore.getReservations({ home });
      assert.equal(
        afterSuccess['TASK-RES-SUCCESS'],
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
        if (reservations['TASK-RES-FAIL']) reservedDuringLaunch = true;
        return { exitCode: 1, stderr: 'process error' };
      };

      dispatchCommand(
        { execute: true, item: 'TASK-RES-FAIL' },
        {
          candidates: [candFail],
          run: runFailure,
          evidenceDir,
          home,
          exit: () => {},
          log: () => {},
          maxAttempts: 1,
        }
      );

      assert.equal(reservedDuringLaunch, true, 'reservation must be held during launch');
      const afterFail = quotaStore.getReservations({ home });
      assert.equal(
        afterFail['TASK-RES-FAIL'],
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
        if (reservations['TASK-RES-THROW']) reservedDuringLaunch = true;
        throw new Error('launcher crashed');
      };

      dispatchCommand(
        { execute: true, item: 'TASK-RES-THROW' },
        {
          candidates: [candThrow],
          run: runThrow,
          evidenceDir,
          home,
          exit: () => {},
          log: () => {},
          maxAttempts: 1,
        }
      );

      assert.equal(reservedDuringLaunch, true, 'reservation must be held during launch');
      const afterThrow = quotaStore.getReservations({ home });
      assert.equal(
        afterThrow['TASK-RES-THROW'],
        undefined,
        'reservation must be released after thrown error'
      );
    }
  });

  test('--dry-run launches nothing', () => {
    const cand = candidate();

    let launcherCalled = false;
    const run = () => {
      launcherCalled = true;
      return { exitCode: 0 };
    };

    let exitCode = null;
    const exit = (code) => {
      exitCode = code;
    };

    const logs = [];
    const log = (msg) => logs.push(String(msg));

    const res = dispatchCommand(
      { 'dry-run': true, item: 'TASK-DRY' },
      {
        candidates: [cand],
        run,
        evidenceDir,
        home,
        exit,
        log,
      }
    );

    assert.equal(exitCode, 0, 'dry-run should exit 0');
    assert.equal(launcherCalled, false, '--dry-run must not launch anything');
    assert.equal(res.dryRun, true);
    assert.ok(
      logs.some((l) => l.includes('Ranked candidates')),
      'dry-run must print ranked candidates'
    );
    assert.ok(
      logs.some((l) => l.includes('Chosen:')),
      'dry-run must print chosen candidate'
    );
  });

  test('explicit --model/--account/--harness pin filters candidates and is recorded as PINNED', () => {
    const candA = candidate({
      harness: 'paseo',
      accountId: 'acc-1',
      modelId: 'gh/gpt-4o',
      cost: 5,
    });
    const candB = candidate({
      harness: 'paseo',
      accountId: 'acc-2',
      modelId: 'kr/claude-sonnet',
      cost: 50,
    });

    const calls = [];
    const run = (adapter, args) => {
      calls.push({ command: adapter.command, args });
      return { exitCode: 0, stdout: '{"id":"sess-pin"}' };
    };

    let exitCode = null;
    const exit = (code) => {
      exitCode = code;
    };

    const logs = [];
    const log = (msg) => logs.push(String(msg));

    const res = dispatchCommand(
      { execute: true, item: 'TASK-PIN', model: 'kr/claude-sonnet' },
      {
        candidates: [candA, candB],
        run,
        evidenceDir,
        home,
        exit,
        log,
      }
    );

    assert.equal(exitCode, 0);
    assert.equal(
      res.chosen,
      candidateKey(candB),
      'pinned model candB must be chosen over cheaper candA'
    );
    assert.ok(
      logs.some((l) => l.includes('PINNED')),
      'output must record PINNED'
    );
  });
});
