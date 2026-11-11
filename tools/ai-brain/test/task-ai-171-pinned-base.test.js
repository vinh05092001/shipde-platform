'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { dispatchCommand } = require('../cli');
const { candidateKey } = require('../discovery/identity');
const { headSha } = require('../facts');

const FAKE_40_HEX = '0123456789abcdef0123456789abcdef01234567';

function makeCandidate(
  modelId = 'test-model',
  upstream = 'test-provider',
  accountId = 'test-account'
) {
  const c = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: 'test-gateway',
    upstream,
    accountId,
    quotaScope: accountId,
    modelId,
    cost: 1,
    quality: 90,
    qualifiedRoles: ['author.foundation'],
  };
  c.candidateKey = candidateKey(c);
  return c;
}

function createTargetRepoEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-base-repo-'));
  execFileSync('git', ['init', dir], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test User'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'file.txt'), 'initial commit content\n');
  execFileSync('git', ['-C', dir, 'add', 'file.txt'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'commit', '-m', 'Initial commit in target repo'], {
    stdio: 'ignore',
  });
  const realSha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

  const pFile = path.join(dir, 'prompt.md');
  const qFile = path.join(dir, 'quota.json');
  const hFile = path.join(dir, 'health.json');
  fs.writeFileSync(pFile, 'Test prompt for pinned base\n');
  fs.writeFileSync(qFile, '{}');
  fs.writeFileSync(hFile, JSON.stringify({ version: 1, paths: {}, events: [] }));

  const cand = makeCandidate();
  let capturedLaunchJob = null;
  const fakeAdapter = {
    id: 'test-harness',
    command: 'test-cmd',
    launch: (job) => {
      capturedLaunchJob = job;
      return ['fake-harness-run', job.prompt];
    },
    sessionIdFrom: () => 'fake-session-123',
  };

  let exitCode = null;
  const getDeps = (extra = {}) => ({
    candidates: [cand],
    now: Date.now(),
    maxAttempts: 1,
    concurrency: 1,
    quotaStateFile: qFile,
    routeHealthFile: hFile,
    home: dir,
    decisionDir: dir,
    evidenceDir: dir,
    log: () => {},
    error: () => {},
    exit: (code) => {
      exitCode = code;
    },
    ...extra,
  });

  const getArgs = (extra = {}) => ({
    execute: true,
    json: true,
    root: dir,
    cwd: dir,
    'prompt-file': pFile,
    item: 'TASK-AI-171-PINNED-BASE',
    ...extra,
  });

  return {
    dir,
    realSha,
    fakeAdapter,
    getCapturedJob: () => capturedLaunchJob,
    getDeps,
    getArgs,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

describe('TASK-AI-171: Immutable local base commit pinning and target worktree resolution', () => {
  test('1. Branch name supplied as base is refused with BASE_SHA_UNRESOLVED before any launcher call', () => {
    const env = createTargetRepoEnv();
    try {
      let launcherCalls = 0;
      const runner = () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      };
      const deps = env.getDeps({ run: runner, harnessAdapter: env.fakeAdapter });
      const res = dispatchCommand(env.getArgs({ 'base-sha': 'main' }), deps);

      assert.equal(launcherCalls, 0, 'zero launcher calls when branch name supplied as base');
      assert.equal(res.exitCode, 1);
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefused, 'refusal reason must be BASE_SHA_UNRESOLVED');
    } finally {
      env.cleanup();
    }
  });

  test('2. Fake 40-hex SHA absent from target repo is refused with BASE_SHA_UNRESOLVED before any launcher call', () => {
    const env = createTargetRepoEnv();
    try {
      let launcherCalls = 0;
      const runner = () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      };
      const deps = env.getDeps({ run: runner, harnessAdapter: env.fakeAdapter });
      const res = dispatchCommand(env.getArgs({ 'base-sha': FAKE_40_HEX }), deps);

      assert.equal(launcherCalls, 0, 'zero launcher calls when fake 40-hex SHA supplied');
      assert.equal(res.exitCode, 1);
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefused, 'refusal reason must be BASE_SHA_UNRESOLVED');
    } finally {
      env.cleanup();
    }
  });

  test('3. Real commit in target repo is accepted and equals both adapter base and runner baseSha', () => {
    const env = createTargetRepoEnv();
    try {
      let runnerOpts = null;
      const runner = (adapter, launchArgs, opts) => {
        runnerOpts = opts;
        return { exitCode: 0, stdout: JSON.stringify({ status: 'completed' }) };
      };
      const deps = env.getDeps({ run: runner, harnessAdapter: env.fakeAdapter });
      const res = dispatchCommand(env.getArgs({ 'base-sha': env.realSha }), deps);

      assert.equal(res.exitCode, 0);
      const job = env.getCapturedJob();
      assert.ok(job, 'adapter.launch must be called');
      assert.equal(job.base, env.realSha, 'adapter base must equal real commit in target repo');
      assert.equal(
        runnerOpts?.baseSha,
        env.realSha,
        'runner baseSha must equal real commit in target repo'
      );
      assert.equal(
        job.base,
        runnerOpts?.baseSha,
        'both adapter base and runner baseSha must be identical'
      );
    } finally {
      env.cleanup();
    }
  });

  test('4. Tool-repo-only commit absent from target repo is refused with BASE_SHA_UNRESOLVED with no fallback to tool repo', () => {
    const env = createTargetRepoEnv();
    try {
      let launcherCalls = 0;
      const runner = () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      };
      const toolRepoSha = headSha('HEAD', process.cwd());
      assert.ok(
        toolRepoSha && /^[0-9a-f]{40}$/i.test(toolRepoSha),
        'tool repo must have a valid commit'
      );
      assert.notEqual(
        toolRepoSha,
        env.realSha,
        'tool repo commit must differ from target repo commit'
      );

      // 4a: Explicit tool repo SHA supplied to dispatch targeting target repo -> refused
      const deps = env.getDeps({ run: runner, harnessAdapter: env.fakeAdapter });
      const res = dispatchCommand(env.getArgs({ 'base-sha': toolRepoSha }), deps);

      assert.equal(
        launcherCalls,
        0,
        'zero launcher calls when tool repo SHA is supplied for target repo'
      );
      assert.equal(res.exitCode, 1);
      const isRefusedExplicit =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefusedExplicit, 'refusal reason must be BASE_SHA_UNRESOLVED');

      // 4b: No explicit base supplied, target repo has no origin/main -> must NOT fall back to tool repo
      const resNoBase = dispatchCommand(env.getArgs(), deps);
      assert.equal(launcherCalls, 0, 'zero launcher calls when target repo has no resolvable base');
      assert.equal(resNoBase.exitCode, 1);
      const isRefusedNoFallback =
        resNoBase.refusal === 'BASE_SHA_UNRESOLVED' ||
        resNoBase.reason === 'BASE_SHA_UNRESOLVED' ||
        resNoBase.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(
        isRefusedNoFallback,
        'refusal reason must be BASE_SHA_UNRESOLVED when target repo lacks base'
      );
    } finally {
      env.cleanup();
    }
  });

  test('5. Execute with branch feat/offline-replay and no base is refused with BASE_SHA_UNRESOLVED before any launcher call', () => {
    const env = createTargetRepoEnv();
    try {
      let launcherCalls = 0;
      const runner = () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      };
      const deps = env.getDeps({ run: runner, harnessAdapter: env.fakeAdapter });
      const res = dispatchCommand(env.getArgs({ branch: 'feat/offline-replay' }), deps);

      assert.equal(
        launcherCalls,
        0,
        'zero launcher calls when branch feat/offline-replay supplied with no base'
      );
      assert.equal(res.exitCode, 1);
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefused, 'refusal reason must be BASE_SHA_UNRESOLVED');
    } finally {
      env.cleanup();
    }
  });

  test('6. Execute with branch task-ai-171-offline-replay and injected discoveryCatalogue without valid base is refused before launcher call', () => {
    const env = createTargetRepoEnv();
    try {
      let launcherCalls = 0;
      const runner = () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      };
      const cand = makeCandidate();
      const deps = env.getDeps({
        run: runner,
        harnessAdapter: env.fakeAdapter,
        discoveryCatalogue: { candidates: [cand] },
      });
      const res = dispatchCommand(env.getArgs({ branch: 'task-ai-171-offline-replay' }), deps);

      assert.equal(
        launcherCalls,
        0,
        'zero launcher calls when branch task-ai-171-offline-replay has no real commit in repo'
      );
      assert.equal(res.exitCode, 1);
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefused, 'refusal reason must be BASE_SHA_UNRESOLVED');
    } finally {
      env.cleanup();
    }
  });

  test('7. Pure --dry-run (execute omitted) makes zero git/child_process calls and returns a decision', (t) => {
    const env = createTargetRepoEnv();
    t.after(env.cleanup);
    const cp = require('node:child_process');
    const calls = [];
    for (const api of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
      t.mock.method(cp, api, (...callArgs) => {
        calls.push(api + ' ' + String(callArgs[0]));
        throw new Error('CHILD_PROCESS_FORBIDDEN: ' + api);
      });
    }
    const { resolveExecuteBase } = require('../cli');
    const dryArgs = { 'dry-run': true, root: env.dir, 'base-sha': FAKE_40_HEX };
    const base = resolveExecuteBase({ targetWorktree: env.dir, args: dryArgs });
    assert.deepEqual(base, { ok: true, baseSha: null, origin: 'dry-run', targetRepo: null });

    let launcherCalls = 0;
    const deps = env.getDeps({
      run: () => {
        launcherCalls += 1;
        return { exitCode: 0, stdout: '' };
      },
      harnessAdapter: env.fakeAdapter,
    });
    const { execute: _omitted, ...pureDryRun } = env.getArgs({ 'dry-run': true });
    const res = dispatchCommand(pureDryRun, deps);
    assert.equal(res.exitCode, 0);
    assert.ok(res.decision && res.decision.chosen, 'dry-run yields a decision');
    assert.equal(launcherCalls, 0);
    assert.deepEqual(calls, [], 'pure dry-run never spawns git or any child process');
  });

  test('8. execute=true with an invalid base is still refused even when a dry-run flag is present', () => {
    const env = createTargetRepoEnv();
    try {
      const { resolveExecuteBase } = require('../cli');
      for (const extra of [{}, { 'dry-run': true }, { dryRun: true }]) {
        const res = resolveExecuteBase({
          targetWorktree: env.dir,
          args: { execute: true, root: env.dir, 'base-sha': FAKE_40_HEX, ...extra },
        });
        assert.equal(res.ok, false);
        assert.equal(res.code, 'BASE_SHA_UNRESOLVED');
      }
    } finally {
      env.cleanup();
    }
  });

  test('9. Production git-root resolver (no injected seam) still refuses a non-git target and a fake SHA', () => {
    const env = createTargetRepoEnv();
    const notGit = fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-base-not-git-'));
    try {
      const { resolveExecuteBase } = require('../cli');
      const badTarget = resolveExecuteBase({
        targetWorktree: notGit,
        args: { execute: true, root: notGit, 'base-sha': env.realSha },
      });
      assert.equal(badTarget.ok, false);
      assert.equal(badTarget.code, 'TARGET_WORKTREE_UNRESOLVED');

      const fakeSha = resolveExecuteBase({
        targetWorktree: env.dir,
        args: { execute: true, root: env.dir, 'base-sha': FAKE_40_HEX },
      });
      assert.equal(fakeSha.ok, false);
      assert.equal(fakeSha.code, 'BASE_SHA_UNRESOLVED');
    } finally {
      fs.rmSync(notGit, { recursive: true, force: true });
      env.cleanup();
    }
  });

  test('10. An injected git root must be a non-empty absolute path and cannot bypass the conflict check', () => {
    const env = createTargetRepoEnv();
    try {
      const { resolveExecuteBase } = require('../cli');
      const args = { execute: true, root: env.dir, 'base-sha': env.realSha };
      for (const bad of ['', '   ', 'relative/root', null, 42]) {
        const res = resolveExecuteBase({
          targetWorktree: env.dir,
          args,
          deps: { gitRoot: () => bad },
        });
        assert.equal(res.code, 'TARGET_WORKTREE_UNRESOLVED', JSON.stringify(bad));
      }
      const other = path.join(os.tmpdir(), 'pinned-base-other-root');
      const conflict = resolveExecuteBase({
        targetWorktree: env.dir,
        args,
        deps: {
          treePath: os.tmpdir(),
          gitRoot: (dir) => (path.resolve(dir) === path.resolve(env.dir) ? env.dir : other),
          commitExists: () => true,
        },
      });
      assert.equal(conflict.code, 'TARGET_WORKTREE_CONFLICT');
    } finally {
      env.cleanup();
    }
  });

  // P1-1: checkpoint resume with invalid base is refused
  test('11. Checkpoint resume with invalid base is refused — zero reservation, adapter, runner calls', () => {
    const env = createTargetRepoEnv();
    const quotaStore = require('../quota-store');
    const origRecord = quotaStore.recordReservation;
    let reservationCalls = 0;
    quotaStore.recordReservation = (...args) => {
      reservationCalls += 1;
      return origRecord(...args);
    };
    try {
      let adapterCalls = 0;
      let runnerCalls = 0;

      const trackingAdapter = {
        id: 'test-harness',
        command: 'test-cmd',
        launch: (job) => {
          adapterCalls += 1;
          return ['fake-harness-run', job.prompt];
        },
        sessionIdFrom: () => 'fake-session-123',
      };

      const runner = () => {
        runnerCalls += 1;
        return { exitCode: 0, stdout: '' };
      };

      // Write a checkpoint file that has a chosen candidate — triggers resume path
      const cand = makeCandidate();
      const ckFile = path.join(env.dir, 'checkpoint-resume.json');
      fs.writeFileSync(
        ckFile,
        JSON.stringify({
          chosen: candidateKey(cand),
          harness: 'hermes',
          source: 'test-provider',
          accountId: 'test-account',
          modelId: 'test-model',
        })
      );

      const deps = env.getDeps({
        run: runner,
        harnessAdapter: trackingAdapter,
        checkpointFile: ckFile,
        // Supply an invalid base SHA via deps — should be refused even on resume
        baseSha: FAKE_40_HEX,
      });

      // No explicit --base-sha arg — the checkpoint resume path skips the
      // if(!finalChosenKey) block which contains resolveExecuteBase.
      // The bug is that resolvedBaseSha remains undefined on the resume path.
      const res = dispatchCommand(env.getArgs({ 'base-sha': FAKE_40_HEX }), deps);

      assert.equal(res.exitCode, 1, 'checkpoint resume with invalid base must exit 1');
      assert.equal(reservationCalls, 0, 'zero recordReservation calls on checkpoint resume with invalid base');
      assert.equal(adapterCalls, 0, 'zero adapter calls on invalid base during checkpoint resume');
      assert.equal(runnerCalls, 0, 'zero runner calls on invalid base during checkpoint resume');
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefused, 'refusal reason must be BASE_SHA_UNRESOLVED on checkpoint resume');
    } finally {
      quotaStore.recordReservation = origRecord;
      env.cleanup();
    }
  });

  // P1-2: deps.baseSha / deps.base / deps.repoSha without explicit targets and a verifier
  // returning false must be refused before reservation/launch
  test('12. deps.baseSha without explicit targets and commitExists returning false is refused', () => {
    const env = createTargetRepoEnv();
    try {
      let runnerCalls = 0;
      const runner = () => {
        runnerCalls += 1;
        return { exitCode: 0, stdout: '' };
      };

      // No explicit --root or treePath; target comes from deps.rootDir.
      // deps.baseSha is a valid 40-hex but commitExists returns false.
      const deps = env.getDeps({
        run: runner,
        harnessAdapter: env.fakeAdapter,
        rootDir: env.dir,
        baseSha: FAKE_40_HEX,
        gitRoot: () => env.dir,
        commitExists: () => false,
      });

      // Remove root and cwd from args so explicitTargets is empty and target comes from deps.rootDir
      const args = env.getArgs();
      delete args.root;
      delete args.cwd;

      const res = dispatchCommand(args, deps);

      assert.equal(runnerCalls, 0, 'zero runner calls when deps.baseSha fails commitExists');
      assert.equal(res.exitCode, 1, 'must refuse when deps.baseSha fails verification');
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(
        isRefused,
        'refusal reason must be BASE_SHA_UNRESOLVED for unverified deps.baseSha'
      );
    } finally {
      env.cleanup();
    }
  });

  test('13. deps.base without explicit targets and commitExists returning false is refused', () => {
    const env = createTargetRepoEnv();
    try {
      let runnerCalls = 0;
      const runner = () => {
        runnerCalls += 1;
        return { exitCode: 0, stdout: '' };
      };

      const deps = env.getDeps({
        run: runner,
        harnessAdapter: env.fakeAdapter,
        rootDir: env.dir,
        base: FAKE_40_HEX,
        gitRoot: () => env.dir,
        commitExists: () => false,
      });

      const args = env.getArgs();
      delete args.root;
      delete args.cwd;

      const res = dispatchCommand(args, deps);

      assert.equal(runnerCalls, 0, 'zero runner calls when deps.base fails commitExists');
      assert.equal(res.exitCode, 1);
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(isRefused, 'refusal reason must be BASE_SHA_UNRESOLVED for unverified deps.base');
    } finally {
      env.cleanup();
    }
  });

  test('14. deps.repoSha without explicit targets and commitExists returning false is refused', () => {
    const env = createTargetRepoEnv();
    try {
      let runnerCalls = 0;
      const runner = () => {
        runnerCalls += 1;
        return { exitCode: 0, stdout: '' };
      };

      const deps = env.getDeps({
        run: runner,
        harnessAdapter: env.fakeAdapter,
        rootDir: env.dir,
        repoSha: FAKE_40_HEX,
        gitRoot: () => env.dir,
        commitExists: () => false,
      });

      const args = env.getArgs();
      delete args.root;
      delete args.cwd;

      const res = dispatchCommand(args, deps);

      assert.equal(runnerCalls, 0, 'zero runner calls when deps.repoSha fails commitExists');
      assert.equal(res.exitCode, 1);
      const isRefused =
        res.refusal === 'BASE_SHA_UNRESOLVED' ||
        res.reason === 'BASE_SHA_UNRESOLVED' ||
        res.outcome?.reason === 'BASE_SHA_UNRESOLVED';
      assert.ok(
        isRefused,
        'refusal reason must be BASE_SHA_UNRESOLVED for unverified deps.repoSha'
      );
    } finally {
      env.cleanup();
    }
  });

  // P1-3: two-repo test (root=A, cwd=B) -> conflict refusal
  test('15. Two-repo conflict: root=A, cwd=B with different git roots is refused with TARGET_WORKTREE_CONFLICT', () => {
    const env = createTargetRepoEnv();
    // Create a second, independent git repo for cwd
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-base-repo-B-'));
    execFileSync('git', ['init', dirB], { stdio: 'ignore' });
    execFileSync('git', ['-C', dirB, 'config', 'user.name', 'Test User'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dirB, 'config', 'user.email', 'test@example.com'], {
      stdio: 'ignore',
    });
    fs.writeFileSync(path.join(dirB, 'file.txt'), 'repo B content\n');
    execFileSync('git', ['-C', dirB, 'add', 'file.txt'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dirB, 'commit', '-m', 'Initial commit in repo B'], {
      stdio: 'ignore',
    });

    const quotaStore = require('../quota-store');
    const origRecord = quotaStore.recordReservation;
    let reservationCalls = 0;
    quotaStore.recordReservation = (...args) => {
      reservationCalls += 1;
      return origRecord(...args);
    };

    try {
      let adapterCalls = 0;
      let runnerCalls = 0;

      const trackingAdapter = {
        id: 'test-harness',
        command: 'test-cmd',
        launch: (job) => {
          adapterCalls += 1;
          return ['fake-harness-run', job.prompt];
        },
        sessionIdFrom: () => 'fake-session-123',
      };

      const runner = () => {
        runnerCalls += 1;
        return { exitCode: 0, stdout: '' };
      };

      const deps = env.getDeps({
        run: runner,
        harnessAdapter: trackingAdapter,
      });

      // root=A (env.dir), cwd=B (dirB) — different repos
      const res = dispatchCommand(
        env.getArgs({ root: env.dir, cwd: dirB, 'base-sha': env.realSha }),
        deps
      );

      assert.equal(res.exitCode, 1, 'two-repo conflict must exit 1');
      assert.equal(reservationCalls, 0, 'zero recordReservation calls on two-repo conflict');
      assert.equal(adapterCalls, 0, 'zero adapter calls on two-repo conflict');
      assert.equal(runnerCalls, 0, 'zero runner calls on two-repo conflict');
      const isRefused =
        res.refusal === 'TARGET_WORKTREE_CONFLICT' ||
        res.reason === 'TARGET_WORKTREE_CONFLICT' ||
        res.outcome?.reason === 'TARGET_WORKTREE_CONFLICT';
      assert.ok(isRefused, 'refusal reason must be TARGET_WORKTREE_CONFLICT');
    } finally {
      quotaStore.recordReservation = origRecord;
      fs.rmSync(dirB, { recursive: true, force: true });
      env.cleanup();
    }
  });
});
