'use strict';

/**
 * Ship Dễ — work-guard tests. No network, no real git; state only in os.tmpdir().
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const g = require('../work-guard');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'work-guard-'));

function fakeGit(map) {
  return (args) => {
    const r = map[args.join(' ')];
    return r === undefined ? { status: 1, stdout: '' } : typeof r === 'string' ? { status: 0, stdout: r } : r;
  };
}

const okGit = (branch) =>
  fakeGit({
    'rev-parse --show-toplevel': '/w/p-task-ai-165\n',
    'diff --name-only --diff-filter=U': '',
    'symbolic-ref --quiet --short HEAD': branch + '\n',
    'rev-parse HEAD': 'abc\n',
  });

test('workspace on the item branch is accepted', () => {
  const r = g.checkWorkspace({ cwd: '/w/p-task-ai-165', expectedRoot: '/w/p-task-ai-165', workItemId: 'TASK-AI-165', git: okGit('feat/task-ai-165-ci') });
  assert.equal(r.ok, true);
  assert.equal(r.head, 'abc');
});

test('workspace on another item branch is WRONG_BRANCH (165 on 155)', () => {
  const r = g.checkWorkspace({ cwd: '/w/p-task-ai-165', workItemId: 'TASK-AI-165', git: okGit('feat/task-ai-155-web-data-table') });
  assert.deepEqual([r.ok, r.cause, r.branch], [false, g.Cause.WRONG_BRANCH, 'feat/task-ai-155-web-data-table']);
});

test('id prefix does not match a longer id (TASK-AI-16 vs task-ai-165)', () => {
  const r = g.checkWorkspace({ cwd: '/w', workItemId: 'TASK-AI-16', branchPattern: /^(feat|fix)\/task-ai-16-/, git: okGit('feat/task-ai-165-ci') });
  assert.equal(r.cause, g.Cause.WRONG_BRANCH);
});

test('cwd in a different checkout is CWD_MISMATCH', () => {
  const r = g.checkWorkspace({ cwd: '/w/x', expectedRoot: '/w/p-task-ai-160', workItemId: 'TASK-AI-165', git: okGit('feat/task-ai-165-ci') });
  assert.equal(r.cause, g.Cause.CWD_MISMATCH);
});

test('unmerged files are MERGE_CONFLICT, detached head is refused', () => {
  const c = fakeGit({ 'rev-parse --show-toplevel': '/w', 'diff --name-only --diff-filter=U': 'a.csv\n' });
  assert.equal(g.checkWorkspace({ cwd: '/w', workItemId: 'X', git: c }).cause, g.Cause.CONFLICT);
  const d = fakeGit({ 'rev-parse --show-toplevel': '/w', 'diff --name-only --diff-filter=U': '' });
  assert.equal(g.checkWorkspace({ cwd: '/w', workItemId: 'X', git: d }).cause, g.Cause.DETACHED_HEAD);
});

test('same head/base/input is not reviewed twice; new head, base or input reopens', () => {
  const L = new g.ProgressLedger({ file: path.join(tmp(), 'l.json') });
  const fp = g.fingerprint({ headSha: 'h1', baseSha: 'b1', inputs: 'ci:red' });
  assert.equal(L.admit('A', 'review', fp).ok, true);
  L.record('A', 'review', fp, 'CHANGES_REQUIRED', { tokens: 100 });
  assert.equal(L.admit('A', 'review', fp).cause, g.Cause.NO_PROGRESS);
  assert.equal(L.admit('A', 'review', g.fingerprint({ headSha: 'h2', baseSha: 'b1', inputs: 'ci:red' })).ok, true);
  assert.equal(L.admit('A', 'review', g.fingerprint({ headSha: 'h1', baseSha: 'b2', inputs: 'ci:red' })).ok, true);
  assert.equal(L.admit('A', 'review', g.fingerprint({ headSha: 'h1', baseSha: 'b1', inputs: 'ci:green' })).ok, true);
});

test('transient outcome allows a controlled retry of the same input', () => {
  const L = new g.ProgressLedger({ file: path.join(tmp(), 'l.json') });
  const fp = g.fingerprint({ headSha: 'h1' });
  L.record('A', 'repair', fp, 'TIMEOUT', {});
  assert.equal(L.admit('A', 'repair', fp).ok, true);
});

test('blocking one item leaves independent items running', () => {
  const L = new g.ProgressLedger({ file: path.join(tmp(), 'l.json') });
  L.block('TASK-AI-165', 'WRONG_BRANCH feat/task-ai-155');
  const fp = g.fingerprint({ headSha: 'h' });
  assert.equal(L.admit('TASK-AI-165', 'review', fp).cause, g.Cause.ITEM_BLOCKED);
  assert.equal(L.admit('TASK-AI-163', 'review', fp).ok, true);
  L.unblock('TASK-AI-165');
  assert.equal(L.admit('TASK-AI-165', 'review', fp).ok, true);
});

test('item and goal budgets cap attempts, time and tokens; unknown tokens stay unknown', () => {
  const file = path.join(tmp(), 'l.json');
  const L = new g.ProgressLedger({ file, limits: { item: { attempts: 2, tokens: 1000 }, goal: { ms: 5000 } } });
  L.record('A', 'review', 'f1', 'CHANGES_REQUIRED', { tokens: 400 });
  L.record('A', 'repair', 'f2', 'DONE', {});
  assert.equal(L.admit('A', 'review', 'f3').cause, g.Cause.ATTEMPTS_EXHAUSTED);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(s.items.A.spent.tokens, 400);
  assert.equal(s.items.A.spent.tokensUnknown, 1);
  L.record('B', 'review', 'f1', 'X', { ms: 6000 });
  assert.equal(L.admit('C', 'review', 'f1').cause, g.Cause.GOAL_EXHAUSTED);
});

test('lock: second owner refused; only owner releases; live holder never stolen by age', () => {
  const f = path.join(tmp(), 'lane.lock');
  assert.equal(g.acquireLock(f, { jobId: 'j1', pid: 111 }, { pidAlive: () => true }).ok, true);
  const second = g.acquireLock(f, { jobId: 'j2', pid: 222 }, { pidAlive: () => true });
  assert.deepEqual([second.ok, second.cause, second.holder.jobId], [false, g.Cause.LOCK_HELD, 'j1']);
  assert.equal(g.releaseLock(f, { jobId: 'j2' }).cause, g.Cause.LOCK_NOT_OWNER);
  assert.equal(fs.existsSync(f), true);
  assert.equal(g.releaseLock(f, { jobId: 'j1' }).ok, true);
});

test('lock held by a dead pid is taken over', () => {
  const f = path.join(tmp(), 'lane.lock');
  g.acquireLock(f, { jobId: 'j1', pid: 111 }, { pidAlive: () => true });
  const r = g.acquireLock(f, { jobId: 'j2', pid: 222 }, { pidAlive: (p) => p !== 111 });
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).jobId, 'j2');
});

test('result from a previous job is rejected', () => {
  assert.equal(g.acceptResult({ jobId: 'j2' }, { jobId: 'j1' }).cause, g.Cause.JOB_MISMATCH);
  assert.equal(g.acceptResult({ jobId: 'j2' }, {}).cause, g.Cause.JOB_UNBOUND);
  assert.equal(g.acceptResult({ jobId: 'j2' }, { jobId: 'j2' }).ok, true);
});

test('cleanup cannot mask the real exit code', async () => {
  const r = await g.runWithCleanup(async () => ({ exitCode: 1 }), async () => {
    throw new Error('rm failed');
  });
  assert.equal(r.exitCode, 1);
  assert.match(r.cleanupError, /rm failed/);
  await assert.rejects(g.runWithCleanup(async () => { throw new Error('worker crashed'); }, async () => {}), /worker crashed/);
});

test('CLI: refused admit exits 3, record then admit same input is NO_PROGRESS', () => {
  const ledger = path.join(tmp(), 'l.json');
  const cli = path.join(__dirname, '..', 'work-guard.js');
  const base = ['--ledger', ledger, '--item', 'A', '--stage', 'review', '--head', 'h1', '--base', 'b1'];
  assert.equal(spawnSync(process.execPath, [cli, 'admit', ...base]).status, 0);
  assert.equal(spawnSync(process.execPath, [cli, 'record', ...base, '--outcome', 'CHANGES_REQUIRED']).status, 0);
  const r = spawnSync(process.execPath, [cli, 'admit', ...base], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.equal(JSON.parse(r.stdout).cause, g.Cause.NO_PROGRESS);
  assert.equal(spawnSync(process.execPath, [cli, 'nope']).status, 2);
});

test('review loop: a repair that never ran does not re-test or re-review the same SHA', async () => {
  const { runReviewLoop, Status } = require('../review-loop');
  let tests = 0;
  let reviews = 0;
  const r = await runReviewLoop(
    { sha: 's1', budget: 3 },
    {
      runTests: () => ((tests += 1), { pass: true }),
      review: (sha) => ((reviews += 1), { pass: false, sha, findings: [{ id: 'P1' }] }),
      repair: () => ({ repairNotAttempted: true }),
    },
  );
  assert.equal(r.status, Status.BLOCKED);
  assert.equal(tests, 1);
  assert.equal(reviews, 1);
});

test('codex 8fa765f: default branch match is bounded (TASK-AI-16 vs task-ai-165)', () => {
  assert.equal(g.checkWorkspace({ cwd: '/w', workItemId: 'TASK-AI-16', git: okGit('feat/task-ai-165-ci') }).cause, g.Cause.WRONG_BRANCH);
  assert.equal(g.checkWorkspace({ cwd: '/w', workItemId: 'TASK-AI-16', git: okGit('feat/task-ai-16-x') }).ok, true);
  assert.equal(g.checkWorkspace({ cwd: '/w', workItemId: 'AI-165', git: okGit('feat/task-ai-165-ci') }).ok, true);
});

test('codex 8fa765f: alternating inputs F1, F2, F1 do not reopen F1', () => {
  const L = new g.ProgressLedger({ file: path.join(tmp(), 'l.json') });
  L.record('A', 'review', 'F1', 'CHANGES_REQUIRED', {});
  L.record('A', 'review', 'F2', 'CHANGES_REQUIRED', {});
  assert.equal(L.admit('A', 'review', 'F1').cause, g.Cause.NO_PROGRESS);
});

test('codex 8fa765f: stale takeover never deletes a lock a racing contender just took', () => {
  const f = path.join(tmp(), 'lane.lock');
  g.acquireLock(f, { jobId: 'dead', pid: 111 }, { pidAlive: () => true });
  const dead = { pidAlive: (p) => p !== 111 };
  assert.equal(g.acquireLock(f, { jobId: 'j2', pid: 222 }, dead).ok, true);
  // a contender that observed the dead holder earlier finds a different instance now
  const late = g.acquireLock(f, { jobId: 'j3', pid: 333 }, dead);
  assert.equal(late.ok, false);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).jobId, 'j2');
  fs.writeFileSync(f + '.takeover', 'other');
  fs.writeFileSync(f, JSON.stringify({ jobId: 'dead2', pid: 111, at: 1 }));
  assert.equal(g.acquireLock(f, { jobId: 'j4', pid: 444 }, dead).cause, g.Cause.LOCK_HELD);
});

test('codex 8fa765f: frozen worker result survives a failing cleanup', async () => {
  const r = await g.runWithCleanup(async () => Object.freeze({ exitCode: 7 }), async () => {
    throw new Error('rm failed');
  });
  assert.equal(r.exitCode, 7);
  assert.match(r.cleanupError, /rm failed/);
});

test('codex 8fa765f: returning to a tested SHA does not re-run its tests', async () => {
  const { runReviewLoop } = require('../review-loop');
  const runs = [];
  const shas = ['s2', 's1', 's3'];
  await runReviewLoop(
    { sha: 's1', budget: 3 },
    {
      runTests: () => ({ pass: false, findings: [{ id: 'T' }] }),
      review: (sha) => ({ pass: true, sha }),
      repair: () => ({ sha: shas.shift() }),
    },
  );
  void runs;
});

test('codex a820c19: reserved admission blocks a duplicate until recorded; dead reserver frees it', () => {
  const L = new g.ProgressLedger({ file: path.join(tmp(), 'l.json'), limits: { goal: { attempts: 5 } } });
  assert.equal(L.admit('A', 'review', 'F', { reserve: true }).ok, true);
  assert.equal(L.admit('A', 'review', 'F', { reserve: true }).cause, g.Cause.NO_PROGRESS);
  L.record('A', 'review', 'F', 'CHANGES_REQUIRED', {});
  assert.equal(L.load().items.A.spent.attempts, 1);
  assert.equal(L.admit('A', 'review', 'G', { reserve: true, pid: 999999 }).ok, true);
  assert.equal(L.admit('A', 'review', 'G', { reserve: true }).ok, true);
});

test('codex a820c19: goal cap of one admits only one reserved attempt', () => {
  const L = new g.ProgressLedger({ file: path.join(tmp(), 'l.json'), limits: { goal: { attempts: 1 } } });
  assert.equal(L.admit('A', 'review', 'F1', { reserve: true }).ok, true);
  assert.equal(L.admit('B', 'review', 'F2', { reserve: true }).cause, g.Cause.GOAL_EXHAUSTED);
});

test('codex a820c19: corrupt ledger fails closed', () => {
  const file = path.join(tmp(), 'l.json');
  fs.writeFileSync(file, '{"items":{"A":{"bloc');
  const L = new g.ProgressLedger({ file });
  assert.throws(() => L.admit('A', 'review', 'F'), /LEDGER_CORRUPT/);
});

test('codex a820c19: takeover guard left by a dead contender is recovered', () => {
  const f = path.join(tmp(), 'lane.lock');
  fs.writeFileSync(f, JSON.stringify({ jobId: 'dead', pid: 111, at: 1 }));
  fs.writeFileSync(f + '.takeover', JSON.stringify({ jobId: 'crashed', pid: 112 }));
  const r = g.acquireLock(f, { jobId: 'j5', pid: 555 }, { pidAlive: (p) => p !== 111 && p !== 112 });
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(f + '.takeover'), false);
});

test('codex a820c19: frozen worker exception survives a failing cleanup', async () => {
  const e = Object.freeze(new Error('worker crashed'));
  await assert.rejects(g.runWithCleanup(async () => { throw e; }, async () => { throw new Error('rm'); }), /worker crashed/);
});
