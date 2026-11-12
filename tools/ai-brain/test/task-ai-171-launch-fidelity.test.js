'use strict';

// TASK-AI-171 launch fidelity: dispatch --execute launches exactly the offering
// the Controller chose, or refuses. Invented ids only; no network.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const ranking = require('../ranking');

function cand(name, extra = {}) {
  return {
    harness: 'paseo',
    accessPath: 'http',
    upstream: 'test-' + name,
    accountId: '9router',
    quotaScope: 'test-' + name,
    gateway: '',
    modelId: 'test-' + name + '/invented-' + name,
    source: '9router',
    status: 'passed',
    evidence: [{ level: 3, status: 'passed' }],
    blocked: false,
    sharedQuota: 'unknown',
    qualifiedRoles: ['author.foundation'],
    ...extra,
  };
}

const ctx = (extra = {}) => ({
  workItemId: 'TASK-TEST-LF',
  role: 'author.foundation',
  kind: 'author.foundation',
  dryRun: true,
  ...extra,
});

function keyOf(decision, name) {
  return decision.candidates.find((c) => c.upstream === 'test-' + name).offeringId;
}

describe('pinned offering (finding 1)', () => {
  test('an eligible pinned offering wins even when another ranks higher', () => {
    const free = ranking.rankAndRecord([cand('a'), cand('b')], ctx());
    const other = free.chosen === keyOf(free, 'a') ? 'b' : 'a';
    const pinnedKey = keyOf(free, other);

    const pinned = ranking.rankAndRecord(
      [cand('a'), cand('b')],
      ctx({ pinnedOffering: pinnedKey })
    );
    assert.equal(pinned.chosen, pinnedKey);
    assert.equal(pinned.pinnedOffering, pinnedKey);
  });

  test('a pinned offering that fails a gate is refused, never replaced', () => {
    const free = ranking.rankAndRecord([cand('a'), cand('b')], ctx());
    const blockedKey = keyOf(free, 'a');

    const decision = ranking.rankAndRecord(
      [cand('a', { blocked: true, blockReason: 'quota exhausted' }), cand('b')],
      ctx({ pinnedOffering: blockedKey })
    );
    assert.equal(decision.chosen, null, 'no other candidate is picked');
    assert.equal(decision.reasonCode, 'OFFERING_NOT_ELIGIBLE');
    assert.match(decision.reason, /^REFUSED: OFFERING_NOT_ELIGIBLE: /);
  });

  test('an unknown pinned offering is refused as not found', () => {
    const decision = ranking.rankAndRecord(
      [cand('a'), cand('b')],
      ctx({ pinnedOffering: 'paseo::http::::test-x::9router::test-x::test-x/none' })
    );
    assert.equal(decision.chosen, null);
    assert.equal(decision.reasonCode, 'OFFERING_NOT_FOUND');
  });

  test('without a pin, selection is unchanged', () => {
    const a = ranking.rankAndRecord([cand('a'), cand('b')], ctx());
    const b = ranking.rankAndRecord([cand('a'), cand('b')], ctx({ pinnedOffering: undefined }));
    assert.equal(a.chosen, b.chosen);
    assert.equal(b.pinnedOffering, undefined);
  });
});

// ── Finding 1 through the real dispatch --execute argv ─────────────────
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dispatchCommand } = require('../cli');
const { candidateKey } = require('../discovery/identity');
const routeHealthApi = require('../route-health');

const VALID_40_HEX = '0123456789abcdef0123456789abcdef01234567';

function execCand(modelId, upstream, cost, quality, extra = {}) {
  const c = { harness: 'hermes', accessPath: 'cli', gateway: '9router' };
  Object.assign(c, { upstream, accountId: upstream, quotaScope: upstream, modelId });
  Object.assign(c, { cost, quality, qualifiedRoles: ['author.foundation'] }, extra);
  c.candidateKey = candidateKey(c);
  return c;
}

function harness(lowStatus = 'AVAILABLE') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-'));
  const wt = path.join(dir, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  const pFile = path.join(dir, 'p.md');
  const qFile = path.join(dir, 'q.json');
  const hFile = path.join(dir, 'h.json');
  fs.writeFileSync(pFile, 'Prompt for launch fidelity\n');
  fs.writeFileSync(qFile, '{}');
  routeHealthApi.saveStore(hFile, {
    version: 1,
    paths: {
      'm-high|9router': { modelId: 'm-high', routeId: '9router', status: 'AVAILABLE' },
      'm-low|9router': { modelId: 'm-low', routeId: '9router', status: lowStatus },
    },
    events: [],
  });
  const run = (cands, runner, extraArgs = {}, extraDeps = {}) => {
    let exitCode = -1;
    const res = dispatchCommand(
      {
        execute: true,
        json: true,
        cwd: wt,
        'prompt-file': pFile,
        item: 'TASK-AI-171-LF',
        ...extraArgs,
      },
      {
        candidates: cands,
        now: Date.now(),
        maxAttempts: 1,
        concurrency: 1,
        quotaStateFile: qFile,
        routeHealthFile: hFile,
        home: dir,
        decisionDir: dir,
        evidenceDir: dir,
        gitRoot: () => dir,
        commitExists: () => true,
        baseSha: VALID_40_HEX,
        // Isolated from the runtime tree: no scoring policy, as on a clean checkout.
        scoringPolicyFile: path.join(dir, 'no-scoring-policy.json'),
        run: runner,
        exit: (c) => {
          exitCode = c;
        },
        log: () => {},
        ...extraDeps,
      }
    );
    return { res, exitCode };
  };
  return { run, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('pinned offering through dispatch --execute --offering', () => {
  test('the pinned lower-ranked offering is launched, not the higher one', () => {
    const h = harness();
    try {
      const hi = execCand('m-high', 'up-high', 1, 95);
      const lo = execCand('m-low', 'up-low', 1, 75);
      const launched = [];
      const runner = (adapter, launchArgs) => {
        launched.push(launchArgs.join(' '));
        return { exitCode: 0, stdout: '{}', elapsedMs: 5 };
      };
      const free = h.run([hi, lo], () => ({ exitCode: 0, stdout: '{}', elapsedMs: 5 }));
      assert.equal(free.res.chosen, hi.candidateKey, 'unpinned picks the higher candidate');

      const { res } = h.run([hi, lo], runner, { offering: lo.candidateKey });
      assert.equal(res.chosen, lo.candidateKey);
      assert.equal(launched.length, 1);
      assert.ok(launched[0].includes('m-low'), 'the launch argv carries the pinned model');
    } finally {
      h.cleanup();
    }
  });

  test('an ineligible pinned offering is refused without any launch', () => {
    const h = harness('NO_CREDIT');
    try {
      const hi = execCand('m-high', 'up-high', 1, 95);
      const lo = execCand('m-low', 'up-low', 1, 75);
      let calls = 0;
      const { res, exitCode } = h.run(
        [hi, lo],
        () => {
          calls += 1;
          return { exitCode: 0, stdout: '{}' };
        },
        { offering: lo.candidateKey }
      );
      assert.equal(calls, 0, 'no runner call');
      assert.equal(exitCode, 1);
      assert.match(String(res.outcome && res.outcome.reason), /^OFFERING_NOT_(ELIGIBLE|FOUND)/);
      assert.notEqual(res.chosen, hi.candidateKey, 'never the other candidate');
    } finally {
      h.cleanup();
    }
  });

  test('a pinned offering that fails at launch is not replaced on retry', () => {
    const h = harness();
    try {
      const hi = execCand('m-high', 'up-high', 1, 95);
      const lo = execCand('m-low', 'up-low', 1, 75);
      const launched = [];
      const runner = (adapter, launchArgs) => {
        launched.push(launchArgs.join(' '));
        return { exitCode: 1, stderr: 'upstream failed', elapsedMs: 5 };
      };
      const { exitCode } = h.run(
        [hi, lo],
        runner,
        { offering: lo.candidateKey },
        { maxAttempts: 3 }
      );
      assert.equal(exitCode, 1);
      assert.ok(launched.length >= 1);
      assert.ok(
        launched.every((a) => a.includes('m-low') && !a.includes('m-high')),
        'only the pinned model was ever launched'
      );
    } finally {
      h.cleanup();
    }
  });
});

// ── Findings 3-4: one path rule and an honest launch outcome ───────────
const { routeLaunchStep } = require('../route-launch');

function launchEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-rl-'));
  const wt = path.join(dir, 'wt');
  fs.mkdirSync(path.join(wt, '.oc'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.oc', 'task.md'), 'task\n');
  const spawns = [];
  const spawn = (cmd, args, opts) => {
    const listeners = {};
    const child = {
      pid: 1,
      unref: () => {},
      on: (ev, fn) => ((listeners[ev] = fn), child),
      emit: (ev, ...d) => listeners[ev] && listeners[ev](...d),
    };
    spawns.push({ args, opts, child });
    return child;
  };
  const sha = '1111222233334444555566667777888899990000';
  const deps = {
    spawn,
    fs,
    mainTree: dir,
    logsDir: path.join(dir, 'logs'),
    repoSha: sha,
    execFileSync: () => sha,
    error: () => {},
  };
  const decision = { chosen: 'hermes::cli::9router::up::acc::acc::m-x' };
  return {
    dir,
    wt,
    spawns,
    deps,
    decision,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe('route launch path rule (finding 3)', () => {
  test('relative cwd and task resolve once against the invocation directory', () => {
    const e = launchEnv();
    try {
      routeLaunchStep(
        e.decision,
        { item: 'T', cwd: 'wt', task: 'wt/.oc/task.md', invocationCwd: e.dir },
        e.deps
      );
      const args = e.spawns[0].args;
      assert.equal(args[args.indexOf('--cwd') + 1], e.wt);
      assert.equal(args[args.indexOf('--prompt-file') + 1], path.join(e.wt, '.oc', 'task.md'));
    } finally {
      e.cleanup();
    }
  });

  test('a path that does not exist is refused before any spawn', () => {
    const e = launchEnv();
    try {
      const res = routeLaunchStep(
        e.decision,
        { item: 'T', cwd: 'no-such-dir', task: 'x.md', invocationCwd: e.dir },
        e.deps
      );
      assert.equal(res.launched, false);
      assert.equal(res.reason, 'TARGET_PATH_INVALID');
      assert.equal(res.exitCode, 1);
      assert.equal(e.spawns.length, 0);
    } finally {
      e.cleanup();
    }
  });
});

describe('route launch outcome (finding 4)', () => {
  const start = (e) =>
    routeLaunchStep(
      e.decision,
      { item: 'T', cwd: e.wt, task: path.join(e.wt, '.oc', 'task.md') },
      e.deps
    );

  test('a dispatch refusal is reported as refused, never launched', async () => {
    const e = launchEnv();
    try {
      const res = start(e);
      assert.equal(res.launched, false);
      assert.equal(res.status, 'subprocess_started');
      fs.writeFileSync(
        res.launchRecord.log,
        'Dispatch refused: TARGET_WORKTREE_UNRESOLVED (target worktree x not a git repository)\n'
      );
      e.spawns[0].child.emit('close', 1);
      const out = await res.completion;
      assert.equal(out.launched, false);
      assert.equal(out.status, 'refused');
      assert.equal(out.reason, 'TARGET_WORKTREE_UNRESOLVED');
      assert.equal(out.exitCode, 1);
    } finally {
      e.cleanup();
    }
  });

  test('exit 0 without a launch receipt is an unknown state, not success', async () => {
    const e = launchEnv();
    try {
      const res = start(e);
      fs.writeFileSync(res.launchRecord.log, '{"chosen":"k"}\n');
      e.spawns[0].child.emit('close', 0);
      const out = await res.completion;
      assert.equal(out.launched, false);
      assert.equal(out.status, 'launch_state_unknown');
    } finally {
      e.cleanup();
    }
  });

  test('a custom launcher that reports a refusal is not counted as launched', () => {
    const e = launchEnv();
    try {
      const res = routeLaunchStep(
        e.decision,
        { item: 'T', cwd: e.wt, task: path.join(e.wt, '.oc', 'task.md') },
        { ...e.deps, launcher: () => ({ launched: false, exitCode: 1, reason: 'REFUSED_X' }) }
      );
      assert.equal(res.launched, false);
      assert.equal(res.status, 'refused');
      assert.equal(res.reason, 'REFUSED_X');
    } finally {
      e.cleanup();
    }
  });
});

describe('route launch reads the result after close (review P1)', () => {
  test('exit before the receipt is flushed does not decide the outcome; close does', async () => {
    const e = launchEnv();
    try {
      const res = routeLaunchStep(
        e.decision,
        { item: 'T', cwd: e.wt, task: path.join(e.wt, '.oc', 'task.md') },
        e.deps
      );
      fs.writeFileSync(res.launchRecord.log, '');
      e.spawns[0].child.emit('exit', 0);
      fs.writeFileSync(
        res.launchRecord.log,
        JSON.stringify({ outcome: { status: 'completed', sessionId: 'late-1' } }) + '\n'
      );
      e.spawns[0].child.emit('close', 0);
      const out = await res.completion;
      assert.equal(out.launched, true);
      assert.equal(out.status, 'worker_launched');
      assert.equal(out.sessionId, 'late-1');
    } finally {
      e.cleanup();
    }
  });
});
