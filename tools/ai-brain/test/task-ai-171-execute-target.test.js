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

  test('P1-2: existing Paseo writer probe and resume both receive validated cwd, base and baseSha despite conflicting raw opts', () => {
    const decisions = require('../decisions');
    const run = okRun();
    const targetDir = tmpDir('ai171-et-val-target-');
    const rawDir = tmpDir('ai171-et-raw-cwd-');
    const decDir = tmpDir('ai171-et-resume-dec-');
    try {
      decisions.recordDecision(
        {
          stage: decisions.Stage.LAUNCHED,
          workItemId: 'TASK-AI-99',
          sessionId: 'sess-paseo-1',
          branch: 'feat/task-ai-99-x',
          harness: 'paseo',
        },
        { dir: decDir }
      );
      const target = resolveExecuteTarget(
        { execute: true, cwd: targetDir, 'base-sha': VALID_40_HEX },
        { gitRoot: () => targetDir, commitExists: () => true }
      );
      assert.equal(target.ok, true);
      const paseoPlan = {
        assignments: [
          {
            workItemId: 'TASK-AI-99',
            role: 'author.foundation',
            branch: 'feat/task-ai-99-x',
            accountId: 'ninerouter',
            harness: 'paseo',
            provider: 'oc',
            model: 'kr/claude-sonnet-4.5-agentic',
            alternatives: [],
          },
        ],
        utilisation: { maxImplementation: 2 },
      };
      const res = executePlan(paseoPlan, {
        registry,
        run,
        dryRun: false,
        cwd: rawDir,
        baseSha: '1111111111111111111111111111111111111111',
        base: 'raw-branch-conflict',
        executeTarget: target,
        decisionDir: decDir,
      });
      assert.equal(res.summary.resumed, 1);
      assert.equal(run.calls.length, 2);
      // Probe call (inspect)
      assert.equal(run.calls[0][0], 'inspect');
      assert.equal(run.calls[0].options.cwd, targetDir);
      assert.equal(run.calls[0].options.baseSha, VALID_40_HEX);
      assert.equal(run.calls[0].options.base, VALID_40_HEX);
      // Resume call (send)
      assert.equal(run.calls[1][0], 'send');
      assert.equal(run.calls[1].options.cwd, targetDir);
      assert.equal(run.calls[1].options.baseSha, VALID_40_HEX);
      assert.equal(run.calls[1].options.base, VALID_40_HEX);
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.rmSync(rawDir, { recursive: true, force: true });
      fs.rmSync(decDir, { recursive: true, force: true });
    }
  });
});
