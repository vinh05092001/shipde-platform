'use strict';

/**
 * TASK-AI-171 R2: ONE validated execute target for every execute path.
 *
 * E2 (--profile) and E3 (--plan / executePlan) must use the same
 * resolveExecuteTarget result as E1: a refusal leaves zero reservations,
 * zero adapter and zero runner calls; a valid target is what the launcher
 * actually uses; a forged {ok:true} object is refused; a pure dry run
 * spawns no git.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { dispatchCommand } = require('../cli');
const { executePlan } = require('../executor');
const { loadSources } = require('../sources');
const { resolveExecuteTarget, isValidTarget } = require('../execute-target');

const NOW = Date.parse('2026-09-30T00:00:00.000Z');
const VALID_40_HEX = '0123456789abcdef0123456789abcdef01234567';
const FAKE_40_HEX = 'fedcba9876543210fedcba9876543210fedcba98';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cand(over) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli-171-et',
      gateway: 'gw-171-et',
      upstream: 'up-171-et',
      accountId: 'acct-171-et',
      quotaScope: 'acct-171-et',
      modelId: 'up-171-et/model-171-et',
      qualifiedRoles: ['author.foundation'],
      capabilities: { contextWindow: 200000 },
      cost: 5,
      quality: 80,
      latencyMs: 30000,
    },
    over || {}
  );
}

function profile(over) {
  return Object.assign(
    {
      taskId: 'TASK-AI-171-ET',
      role: 'writer',
      complexity: 'short',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      contextSize: 64000,
      expectedDuration: 600000,
      latencyPriority: 'normal',
      qualityFloor: 0,
      costCeiling: 1000,
      requiredHarness: null,
      forbiddenFailureDomains: [],
      resourceCeiling: 4,
      currentWorkload: 1,
    },
    over || {}
  );
}

function hermeticEnv() {
  const env = Object.assign({}, process.env);
  delete env.TYPESAFE_API_KEY;
  return env;
}

function reservationCount(storePath) {
  if (!fs.existsSync(storePath)) return 0;
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  return Object.keys(store.reservations || {}).length;
}

describe('TASK-AI-171 R2: E2 --profile uses the one validated execute target', () => {
  let dirs;
  beforeEach(() => {
    dirs = {
      root: tmpDir('ai171-et-root-'),
      other: tmpDir('ai171-et-other-'),
      evidence: tmpDir('ai171-et-evidence-'),
      decisions: tmpDir('ai171-et-decisions-'),
      home: tmpDir('ai171-et-home-'),
    };
    dirs.storePath = path.join(dirs.home, 'quota.json');
    fs.writeFileSync(dirs.storePath, '{}');
  });
  afterEach(() => {
    for (const k of ['root', 'other', 'evidence', 'decisions', 'home']) {
      try {
        fs.rmSync(dirs[k], { recursive: true, force: true });
      } catch {}
    }
  });

  async function runProfile(args, over) {
    const profileFile = path.join(dirs.root, 'profile.json');
    fs.writeFileSync(profileFile, JSON.stringify(profile()));
    let exitCode = null;
    const errors = [];
    const deps = Object.assign(
      {
        candidates: [cand()],
        evidenceDir: dirs.evidence,
        decisionDir: dirs.decisions,
        home: dirs.home,
        env: hermeticEnv(),
        jevHttpClient: () => {
          throw new Error('JEV_NETWORK_DISABLED_IN_TESTS');
        },
        storePath: dirs.storePath,
        now: NOW,
        reservations: [],
        headrooms: {},
        log: () => {},
        error: (s) => errors.push(String(s)),
        exit: (c) => {
          exitCode = c;
        },
      },
      over || {}
    );
    const result = await dispatchCommand(Object.assign({ profile: profileFile }, args), deps);
    return { result, exitCode, errors };
  }

  test('E2 invalid base: refused before any reservation, zero launcher calls', async () => {
    let launches = 0;
    const { result, exitCode } = await runProfile(
      { execute: true, launch: true, cwd: dirs.root },
      {
        gitRoot: () => dirs.root,
        commitExists: () => false,
        baseSha: FAKE_40_HEX,
        launcher: async () => {
          launches += 1;
          return { status: 'completed' };
        },
      }
    );
    assert.equal(exitCode, 1);
    assert.equal(result.refused, 'BASE_SHA_UNRESOLVED');
    assert.equal(launches, 0);
    assert.equal(reservationCount(dirs.storePath), 0, 'zero recordReservation calls');
  });

  test('E2 rootDir=A / treePath=B two-repo conflict: refused, zero effects', async () => {
    let launches = 0;
    const { result, exitCode } = await runProfile(
      { execute: true, launch: true },
      {
        rootDir: dirs.root,
        treePath: dirs.other,
        gitRoot: (d) => path.resolve(d),
        commitExists: () => true,
        baseSha: VALID_40_HEX,
        launcher: async () => {
          launches += 1;
          return { status: 'completed' };
        },
      }
    );
    assert.equal(exitCode, 1);
    assert.equal(result.refused, 'TARGET_WORKTREE_CONFLICT');
    assert.equal(launches, 0);
    assert.equal(reservationCount(dirs.storePath), 0);
  });

  test('P1-1 direct: deps.rootDir=A with no args.root/args.cwd plus deps.treePath=B produces TARGET_WORKTREE_CONFLICT', () => {
    const target = resolveExecuteTarget(
      { execute: true },
      {
        rootDir: dirs.root,
        treePath: dirs.other,
        gitRoot: (d) => path.resolve(d),
        commitExists: () => true,
        baseSha: VALID_40_HEX,
      }
    );
    assert.equal(target.ok, false);
    assert.equal(target.code, 'TARGET_WORKTREE_CONFLICT');
  });

  test('E2 valid target: the default launcher hands result cwd / baseSha to the adapter', async () => {
    const jobs = [];
    const fakeAdapter = {
      id: 'hermes',
      command: 'hermes',
      launch: (job) => {
        jobs.push(job);
        return ['fake-run'];
      },
    };
    const { result, exitCode } = await runProfile(
      { execute: true, launch: true, cwd: dirs.root },
      {
        gitRoot: () => dirs.root,
        commitExists: () => true,
        baseSha: VALID_40_HEX,
        getHarness: () => fakeAdapter,
      }
    );
    assert.equal(exitCode, 0);
    assert.equal(jobs.length, 1, 'adapter launched once');
    assert.equal(jobs[0].cwd, dirs.root);
    assert.equal(jobs[0].base, VALID_40_HEX);
    assert.equal(jobs[0].baseSha, VALID_40_HEX);
    assert.equal(result.launchRequest.cwd, dirs.root);
    assert.equal(reservationCount(dirs.storePath), 1);
  });

  test('E2 profile dry run makes zero git / child_process calls', async (t) => {
    const cp = require('node:child_process');
    const calls = [];
    for (const api of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
      t.mock.method(cp, api, (...a) => {
        calls.push(api + ' ' + String(a[0]));
        throw new Error('CHILD_PROCESS_FORBIDDEN: ' + api);
      });
    }
    const { exitCode } = await runProfile({ 'dry-run': true }, { dryRunOffline: true });
    assert.equal(exitCode, 0);
    assert.deepEqual(calls, []);
    assert.equal(reservationCount(dirs.storePath), 0);
  });

  test('dry-run git spies installed BEFORE requiring execute-target.js verify zero git calls at load and run', () => {
    const cp = require('node:child_process');
    const script = `
      const cp = require('node:child_process');
      const calls = [];
      for (const api of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
        cp[api] = (...a) => { calls.push(api); throw new Error('CHILD_PROCESS_FORBIDDEN: ' + api); };
      }
      const { resolveExecuteTarget } = require('./execute-target');
      const res = resolveExecuteTarget({}, {});
      if (!res.ok || res.origin !== 'dry-run' || calls.length > 0) process.exit(1);
    `;
    const res = cp.spawnSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
  });
});

describe('TASK-AI-171 R2: E3 executePlan refuses without a validated target', () => {
  const registry = loadSources();
  const plan = () => ({
    assignments: [
      {
        workItemId: 'TASK-AI-99',
        role: 'author.foundation',
        branch: 'feat/task-ai-99-x',
        accountId: 'ninerouter',
        provider: 'oc',
        model: 'kr/claude-sonnet-4.5-agentic',
        alternatives: [],
      },
    ],
    deferred: [],
    utilisation: { maxImplementation: 2 },
  });
  const okRun = () => {
    const calls = [];
    const run = (adapter, args, options) => {
      args.options = options;
      calls.push(args);
      return { exitCode: 0, stdout: '{"id":"sess-171","status":"running"}\n', stderr: '' };
    };
    run.calls = calls;
    return run;
  };

  test('forged {ok:true} target object is refused with zero runner calls', () => {
    const run = okRun();
    const forged = Object.freeze({
      ok: true,
      baseSha: VALID_40_HEX,
      origin: 'explicit',
      targetRepo: os.tmpdir(),
      cwd: os.tmpdir(),
    });
    assert.equal(isValidTarget(forged), false);
    const res = executePlan(plan(), {
      registry,
      run,
      dryRun: false,
      executeTarget: forged,
      decisionDir: tmpDir('ai171-et-dec-'),
    });
    assert.equal(res.refusal, 'EXECUTE_TARGET_FORGED');
    assert.equal(run.calls.length, 0);
    assert.equal(res.summary.launched, 0);
  });

  test('direct executePlan with an unresolvable target is refused, zero runner calls', () => {
    const run = okRun();
    const notGit = tmpDir('ai171-et-notgit-');
    try {
      const res = executePlan(plan(), {
        registry,
        run,
        dryRun: false,
        cwd: notGit,
        gitRoot: () => {
          throw new Error('not a git repository');
        },
        decisionDir: tmpDir('ai171-et-dec-'),
      });
      assert.equal(res.refusal, 'TARGET_WORKTREE_UNRESOLVED');
      assert.equal(run.calls.length, 0);
    } finally {
      fs.rmSync(notGit, { recursive: true, force: true });
    }
  });

  test('direct executePlan with a resolved but invalid base is refused, zero runner calls', () => {
    const run = okRun();
    const dir = tmpDir('ai171-et-repo-');
    try {
      const res = executePlan(plan(), {
        registry,
        run,
        dryRun: false,
        cwd: dir,
        baseSha: FAKE_40_HEX,
        gitRoot: () => dir,
        commitExists: () => false,
        decisionDir: tmpDir('ai171-et-dec-'),
      });
      assert.equal(res.refusal, 'BASE_SHA_UNRESOLVED');
      assert.equal(run.calls.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('valid frozen target: the launch vector carries the target cwd and pinned SHA', () => {
    const run = okRun();
    const dir = tmpDir('ai171-et-repo-');
    try {
      const target = resolveExecuteTarget(
        { execute: true, cwd: dir, 'base-sha': VALID_40_HEX },
        { gitRoot: () => dir, commitExists: () => true }
      );
      assert.equal(target.ok, true);
      assert.ok(Object.isFrozen(target));
      const res = executePlan(plan(), {
        registry,
        run,
        dryRun: false,
        base: 'main',
        executeTarget: target,
        decisionDir: tmpDir('ai171-et-dec-'),
      });
      assert.equal(res.summary.launched, 1);
      const args = run.calls[0];
      assert.equal(args[args.indexOf('--cwd') + 1], dir);
      assert.equal(args[args.indexOf('--base') + 1], VALID_40_HEX, 'never the branch name main');
      assert.ok(args.options, 'runner options passed as third argument');
      assert.equal(args.options.cwd, dir);
      assert.equal(args.options.baseSha, VALID_40_HEX);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('P2-4: executePlan with valid opts.base launches that SHA', () => {
    const run = okRun();
    const dir = tmpDir('ai171-p2-4-valid-');
    try {
      const res = executePlan(plan(), {
        registry,
        run,
        dryRun: false,
        cwd: dir,
        base: VALID_40_HEX,
        gitRoot: () => dir,
        commitExists: () => true,
        decisionDir: tmpDir('ai171-p2-4-dec-'),
      });
      assert.equal(res.summary.launched, 1);
      assert.equal(run.calls[0].options.baseSha, VALID_40_HEX);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('P2-4: executePlan with invalid opts.base is refused with zero runner calls', () => {
    const run = okRun();
    const dir = tmpDir('ai171-p2-4-inv-');
    try {
      const res = executePlan(plan(), {
        registry,
        run,
        dryRun: false,
        cwd: dir,
        base: 'invalid-branch-name',
        gitRoot: () => dir,
        commitExists: () => false,
        decisionDir: tmpDir('ai171-p2-4-dec-'),
      });
      assert.equal(res.summary.launched, 0);
      assert.equal(res.summary.refused, 1);
      assert.equal(res.refusal, 'BASE_SHA_UNRESOLVED');
      assert.equal(run.calls.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('P1-2: CLI dispatch --plan --execute --isolated-worker passes validated target baseSha and cwd to runner', () => {
    const dir = tmpDir('ai171-et-iso-');
    const isoMod = require('../isolation-launcher');
    const origIso = isoMod.getIsolatedLauncher;
    let capturedRunnerOptions = null;
    let runnerCalls = 0;
    isoMod.getIsolatedLauncher = () => (adapter, args, options) => {
      runnerCalls += 1;
      capturedRunnerOptions = options;
      if (!options || !options.baseSha) {
        throw new Error(
          'ISOLATION_BASE_SHA_MISSING: the caller must pin the base SHA to provision'
        );
      }
      return {
        exitCode: 0,
        stdout:
          '{"type":"step_start"}\n{"type":"text","part":{"text":"done"}}\n{"type":"step_finish"}\n',
        completionNonce: 'nonce-171-iso',
        stderr: '',
      };
    };
    try {
      const planFile = path.join(dir, 'plan.json');
      fs.writeFileSync(planFile, JSON.stringify(plan()));
      let exitCode = null;
      const res = dispatchCommand(
        {
          plan: planFile,
          execute: true,
          cwd: dir,
          'isolated-worker': true,
          'base-sha': VALID_40_HEX,
        },
        {
          gitRoot: () => dir,
          commitExists: () => true,
          decisionDir: dir,
          log: () => {},
          error: () => {},
          exit: (c) => {
            exitCode = c;
          },
        }
      );
      assert.equal(exitCode, 0);
      assert.equal(runnerCalls, 1);
      assert.ok(capturedRunnerOptions);
      assert.equal(capturedRunnerOptions.cwd, dir);
      assert.equal(capturedRunnerOptions.baseSha, VALID_40_HEX);
    } finally {
      isoMod.getIsolatedLauncher = origIso;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('P1-3: executePlan with dry-run executeTarget passed to dryRun=false is refused with zero runner calls', () => {
    const run = okRun();
    const dryRunTarget = resolveExecuteTarget({}, {});
    assert.equal(dryRunTarget.origin, 'dry-run');
    const res = executePlan(plan(), {
      registry,
      run,
      dryRun: false,
      executeTarget: dryRunTarget,
      decisionDir: tmpDir('ai171-et-dec-'),
    });
    assert.equal(res.summary.launched, 0);
    assert.equal(res.summary.refused, 1);
    assert.ok(res.refusal, 'refusal reason must be set');
    assert.equal(run.calls.length, 0, 'zero runner calls');
  });

  test('CLI --plan with an invalid base exits 1 with zero runner calls', () => {
    const run = okRun();
    const dir = tmpDir('ai171-et-plan-');
    try {
      const planFile = path.join(dir, 'plan.json');
      fs.writeFileSync(planFile, JSON.stringify(plan()));
      let exitCode = null;
      const res = dispatchCommand(
        { plan: planFile, execute: true, cwd: dir, 'base-sha': FAKE_40_HEX },
        {
          run,
          gitRoot: () => dir,
          commitExists: () => false,
          decisionDir: dir,
          log: () => {},
          error: () => {},
          exit: (c) => {
            exitCode = c;
          },
        }
      );
      assert.equal(exitCode, 1);
      assert.equal(res.refusal, 'BASE_SHA_UNRESOLVED');
      assert.equal(run.calls.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('CLI --plan dry run makes zero git / child_process calls', (t) => {
    const dir = tmpDir('ai171-et-plan-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const planFile = path.join(dir, 'plan.json');
    fs.writeFileSync(planFile, JSON.stringify(plan()));
    const cp = require('node:child_process');
    const calls = [];
    for (const api of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
      t.mock.method(cp, api, (...a) => {
        calls.push(api + ' ' + String(a[0]));
        throw new Error('CHILD_PROCESS_FORBIDDEN: ' + api);
      });
    }
    const run = okRun();
    dispatchCommand(
      { plan: planFile, 'dry-run': true },
      { run, decisionDir: dir, log: () => {}, error: () => {}, exit: () => {} }
    );
    assert.deepEqual(calls, []);
    assert.equal(run.calls.length, 0);
  });
});
