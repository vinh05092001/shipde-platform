'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { deriveInfraFreeCommand } = require('../verification-split');
const ci = require('../ci-gate');

const SHA = 'a'.repeat(40);
const cfg = {
  infraDependentScripts: ['test', 'test:e2e'],
  infraFreeSupplements: ['contract:check', 'missing-script'],
};
const scripts = { 'contract:check': 'x', lint: 'x', test: 'x' };

test('infra-dependent scripts are deferred, free ones kept, supplements only if present', () => {
  const r = deriveInfraFreeCommand(
    'pnpm db:generate && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e',
    { config: cfg, scripts }
  );
  assert.equal(r.command, 'pnpm db:generate && pnpm lint && pnpm typecheck && pnpm contract:check');
  assert.deepEqual(r.deferred, ['test', 'test:e2e']);
  assert.deepEqual(r.added, ['contract:check']);
});

test('a command with nothing to defer is unchanged', () => {
  const r = deriveInfraFreeCommand('pnpm lint && pnpm contract:check', { config: cfg, scripts });
  assert.equal(r.command, 'pnpm lint && pnpm contract:check');
  assert.deepEqual(r.deferred, []);
  assert.deepEqual(r.added, []);
});

test('the shipped config defers DB-dependent suites', () => {
  const r = deriveInfraFreeCommand('pnpm lint && pnpm test', { scripts });
  assert.ok(r.deferred.includes('test'));
});

function gh(rollup, head = SHA, logText = 'FAIL: storage down') {
  return (args) => {
    if (args[0] === 'pr') {
      return {
        exitCode: 0,
        stdout: JSON.stringify({ headRefOid: head, statusCheckRollup: rollup }),
        stderr: '',
      };
    }
    if (args[0] === 'run') return { exitCode: 0, stdout: logText, stderr: '' };
    return { exitCode: 1, stdout: '', stderr: 'unexpected' };
  };
}

test('CI green on the exact SHA passes; red fails with the job log; pending/none never pass', () => {
  const ok = [
    { name: 'contract', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'application-gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ];
  assert.equal(ci.evaluateCi({ sha: SHA, prNumber: 1, ghRunner: gh(ok) }).state, 'PASS');

  const bad = [
    {
      name: 'contract',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/o/r/actions/runs/123/job/9',
    },
  ];
  const r = ci.evaluateCi({ sha: SHA, prNumber: 1, ghRunner: gh(bad) });
  assert.equal(r.state, 'FAIL');
  assert.match(r.log, /storage down/);

  assert.equal(
    ci.evaluateCi({ sha: SHA, prNumber: 1, ghRunner: gh([{ name: 'v', status: 'IN_PROGRESS' }]) })
      .state,
    'PENDING'
  );
  assert.equal(ci.evaluateCi({ sha: SHA, prNumber: 1, ghRunner: gh([]) }).state, 'MISSING');
  assert.equal(
    ci.evaluateCi({ sha: SHA, prNumber: 1, ghRunner: gh(ok, 'b'.repeat(40)) }).state,
    'HEAD_MOVED'
  );
});

test('missing required checks or SKIPPED/NEUTRAL checks fail closed', () => {
  // A sole unrelated success returns PENDING, not PASS
  const unrelated = [{ name: 'unrelated-job', status: 'COMPLETED', conclusion: 'SUCCESS' }];
  assert.equal(ci.evaluateCi({ sha: SHA, prNumber: 1, ghRunner: gh(unrelated) }).state, 'PENDING');

  // One required check missing returns PENDING
  const partial = [{ name: 'contract', status: 'COMPLETED', conclusion: 'SUCCESS' }];
  assert.equal(ci.evaluateCi({ sha: SHA, prNumber: 1, ghRunner: gh(partial) }).state, 'PENDING');

  // SKIPPED check returns FAIL
  const skipped = [
    { name: 'contract', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'application-gate', status: 'COMPLETED', conclusion: 'SKIPPED' },
  ];
  assert.equal(ci.evaluateCi({ sha: SHA, prNumber: 1, ghRunner: gh(skipped) }).state, 'FAIL');

  // NEUTRAL check returns FAIL
  const neutral = [
    { name: 'contract', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    { name: 'application-gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ];
  assert.equal(ci.evaluateCi({ sha: SHA, prNumber: 1, ghRunner: gh(neutral) }).state, 'FAIL');
});

test('awaitCi polls until terminal and times out as not-pass', async () => {
  let n = 0;
  const runner = (args) => {
    if (args[0] !== 'pr') return { exitCode: 1, stdout: '', stderr: '' };
    n += 1;
    const roll =
      n < 3
        ? [{ name: 'contract', status: 'IN_PROGRESS' }]
        : [
            { name: 'contract', status: 'COMPLETED', conclusion: 'SUCCESS' },
            { name: 'application-gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
          ];
    return {
      exitCode: 0,
      stdout: JSON.stringify({ headRefOid: SHA, statusCheckRollup: roll }),
      stderr: '',
    };
  };
  const done = await ci.awaitCi({
    sha: SHA,
    prNumber: 1,
    ghRunner: runner,
    sleep: async () => {},
    pollIntervalMs: 1,
    timeoutMs: 1000,
  });
  assert.equal(done.state, 'PASS');

  let t = 0;
  const stuck = await ci.awaitCi({
    sha: SHA,
    prNumber: 1,
    ghRunner: gh([{ name: 'v', status: 'QUEUED' }]),
    sleep: async () => {
      t += 10;
    },
    now: () => t,
    pollIntervalMs: 1,
    timeoutMs: 25,
  });
  assert.equal(stuck.state, 'PENDING');
  assert.equal(stuck.timedOut, true);
});

test('a recorded CI failure feeds repair findings only for that exact SHA and redacts bearer credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-'));
  try {
    const rawLog =
      'Error: Bearer sk-mysecretkey12345678 failed to authenticate token=ghp_secrettoken99999999';
    ci.writeCiFailure(dir, 'FEAT-X-01', { sha: SHA, failed: ['verify'], log: rawLog });
    const f = ci.ciFindingsFor(dir, 'FEAT-X-01', SHA);
    assert.equal(f.length, 1);
    assert.equal(f[0].id, 'CI_FAILED');
    assert.doesNotMatch(f[0].detail, /sk-mysecretkey/);
    assert.doesNotMatch(f[0].detail, /ghp_secrettoken/);
    assert.match(f[0].detail, /\[REDACTED_SECRET\]/);

    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'ci-failure-FEAT-X-01.json'), 'utf8'));
    assert.doesNotMatch(saved.log, /sk-mysecretkey/);
    assert.doesNotMatch(saved.log, /ghp_secrettoken/);
    assert.match(saved.log, /\[REDACTED_SECRET\]/);

    assert.deepEqual(ci.ciFindingsFor(dir, 'FEAT-X-01', 'c'.repeat(40)), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
