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
