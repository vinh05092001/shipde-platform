'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { dispatchCommand } = require('../cli');
const { candidateKey } = require('../discovery/identity');
const routeHealthApi = require('../route-health');

function makeCandidate(modelId, upstream, accountId, cost = 1, quality = 90, extra = {}) {
  const c = { harness: 'agy-pool', accessPath: 'pool', gateway: 'agy-pool' };
  Object.assign(c, { upstream, accountId, quotaScope: accountId, modelId });
  Object.assign(c, { cost, quality, qualifiedRoles: ['author.foundation'] }, extra);
  c.candidateKey = candidateKey(c);
  return c;
}

function createTestHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-lane-'));
  const wt = path.join(dir, 'wt');
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(wt, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  const [pFile1, pFile2, qFile, hFile] = ['p1.md', 'p2.md', 'q.json', 'h.json'].map((f) =>
    path.join(dir, f)
  );
  fs.writeFileSync(pFile1, 'Prompt for task 1\n');
  fs.writeFileSync(pFile2, 'Prompt for task 2\n');
  fs.writeFileSync(qFile, '{}');
  routeHealthApi.saveStore(hFile, {
    version: 1,
    paths: { 'm-pool|agy-pool': { modelId: 'm-pool', routeId: 'agy-pool', status: 'AVAILABLE' } },
    events: [],
  });
  const prevRunsDir = process.env.AGY_POOL_RUNS_DIR;
  process.env.AGY_POOL_RUNS_DIR = runsDir;

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
    runsDir,
    pFile1,
    pFile2,
    qFile,
    hFile,
    testDeps,
    cleanup: () => {
      if (prevRunsDir !== undefined) {
        process.env.AGY_POOL_RUNS_DIR = prevRunsDir;
      } else {
        delete process.env.AGY_POOL_RUNS_DIR;
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

describe('TASK-AI-171 R3-REPRO: AGY lane ownership before launcher execution', () => {
  let env;
  beforeEach(() => {
    env = createTestHarness();
  });
  afterEach(() => {
    process.exitCode = 0;
    env.cleanup();
  });

  test('two dispatchCommand({execute:true}) calls for the same agy-pool lane: exactly one reaches launcher, other is refused with lane-busy, job.json not overwritten', () => {
    const cA = makeCandidate('m-pool', 'agy-pool', 'agy01');
    const now = Date.now();
    let launcherCalls = 0;
    let call2Result = null;
    let call2Exit = null;
    let jobOverwrittenDuringHold = false;
    const jobFile = path.join(env.runsDir, 'agy01', 'job.json');

    const runner = (adapter, launchArgs, opts) => {
      launcherCalls += 1;
      const currentCall = launcherCalls;

      if (currentCall === 1) {
        // While the first dispatch holds the lane inside the launcher, launch the second dispatch
        call2Result = dispatchCommand(
          {
            execute: true,
            json: true,
            cwd: env.wt,
            'prompt-file': env.pFile2,
            item: 'TASK-AI-171-TASK-2',
          },
          Object.assign(env.testDeps(now, [cA]), {
            run: runner,
            exit: (code) => {
              call2Exit = code;
            },
            log: () => {},
          })
        );

        if (fs.existsSync(jobFile)) {
          const currentJob = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
          if (currentJob.prompt !== 'Prompt for task 1\n') {
            jobOverwrittenDuringHold = true;
          }
        }
      }

      return {
        exitCode: 0,
        stdout: JSON.stringify({ status: 'completed' }),
      };
    };

    const call1Result = dispatchCommand(
      {
        execute: true,
        json: true,
        cwd: env.wt,
        'prompt-file': env.pFile1,
        item: 'TASK-AI-171-TASK-1',
      },
      Object.assign(env.testDeps(now, [cA]), {
        run: runner,
        exit: () => {},
        log: () => {},
      })
    );

    // AC B39 / BR lane ownership expectations:
    // 1. Exactly one dispatch reaches the launcher
    assert.equal(launcherCalls, 1, 'exactly one dispatch reaches the launcher');

    // 2. The other dispatch is refused with a lane-busy code
    assert.notEqual(call2Exit, 0, 'second dispatch must not exit 0');
    assert.match(
      call2Result?.outcome?.reason || call2Result?.stderr || '',
      /LANE_BUSY|POOL_ACCOUNT_BUSY|BUSY/i,
      'second dispatch must be refused with lane-busy code'
    );

    // 3. No shared job file overwritten while first holds the lane
    assert.equal(
      jobOverwrittenDuringHold,
      false,
      'shared job.json must not be overwritten while first holds the lane'
    );
  });
});
