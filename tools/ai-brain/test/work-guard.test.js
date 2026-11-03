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

// Windows/macOS compare paths case-insensitively; a Linux filesystem does not, and
// the checkout-comparison test needs both behaviours on whatever host runs it.
function withCaseInsensitiveFs(value, fn) {
  const prev = process.env.WORK_GUARD_CASE_INSENSITIVE;
  if (value === undefined) delete process.env.WORK_GUARD_CASE_INSENSITIVE;
  else process.env.WORK_GUARD_CASE_INSENSITIVE = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.WORK_GUARD_CASE_INSENSITIVE;
    else process.env.WORK_GUARD_CASE_INSENSITIVE = prev;
  }
}

// A git stub that can make the conflict inspection itself fail, not just report
// conflicts: an inspection that never ran is not evidence of a clean tree.
function gitFailingDiff() {
  const map = {
    'rev-parse --show-toplevel': { status: 0, stdout: '/w/p-task-ai-165\n' },
    'symbolic-ref --quiet --short HEAD': { status: 0, stdout: 'feat/task-ai-165-ci\n' },
    'rev-parse HEAD': { status: 0, stdout: 'abc\n' },
  };
  return (args) => {
    if (args.join(' ') === 'diff --name-only --diff-filter=U') return { status: 128, stdout: '' };
    return map[args.join(' ')] || { status: 1, stdout: '' };
  };
}

function fakeGit(map) {
  return (args) => {
    const r = map[args.join(' ')];
    return r === undefined
      ? { status: 1, stdout: '' }
      : typeof r === 'string'
        ? { status: 0, stdout: r }
        : r;
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
  const r = g.checkWorkspace({
    cwd: '/w/p-task-ai-165',
    expectedRoot: '/w/p-task-ai-165',
    workItemId: 'TASK-AI-165',
    git: okGit('feat/task-ai-165-ci'),
  });
  assert.equal(r.ok, true);
  assert.equal(r.head, 'abc');
});

test('workspace on another item branch is WRONG_BRANCH (165 on 155)', () => {
  const r = g.checkWorkspace({
    cwd: '/w/p-task-ai-165',
    workItemId: 'TASK-AI-165',
    git: okGit('feat/task-ai-155-web-data-table'),
  });
  assert.deepEqual(
    [r.ok, r.cause, r.branch],
    [false, g.Cause.WRONG_BRANCH, 'feat/task-ai-155-web-data-table']
  );
});

test('id prefix does not match a longer id (TASK-AI-16 vs task-ai-165)', () => {
  const r = g.checkWorkspace({
    cwd: '/w',
    workItemId: 'TASK-AI-16',
    branchPattern: /^(feat|fix)\/task-ai-16-/,
    git: okGit('feat/task-ai-165-ci'),
  });
  assert.equal(r.cause, g.Cause.WRONG_BRANCH);
});

test('cwd in a different checkout is CWD_MISMATCH', () => {
  const r = g.checkWorkspace({
    cwd: '/w/x',
    expectedRoot: '/w/p-task-ai-160',
    workItemId: 'TASK-AI-165',
    git: okGit('feat/task-ai-165-ci'),
  });
  assert.equal(r.cause, g.Cause.CWD_MISMATCH);
});

test('unmerged files are MERGE_CONFLICT, detached head is refused', () => {
  const c = fakeGit({
    'rev-parse --show-toplevel': '/w',
    'diff --name-only --diff-filter=U': 'a.csv\n',
  });
  assert.equal(g.checkWorkspace({ cwd: '/w', workItemId: 'X', git: c }).cause, g.Cause.CONFLICT);
  const d = fakeGit({ 'rev-parse --show-toplevel': '/w', 'diff --name-only --diff-filter=U': '' });
  assert.equal(
    g.checkWorkspace({ cwd: '/w', workItemId: 'X', git: d }).cause,
    g.Cause.DETACHED_HEAD
  );
});

test('same head/base/input is not reviewed twice; new head, base or input reopens', () => {
  const L = new g.ProgressLedger({ file: path.join(tmp(), 'l.json') });
  const fp = g.fingerprint({ headSha: 'h1', baseSha: 'b1', inputs: 'ci:red' });
  assert.equal(L.admit('A', 'review', fp).ok, true);
  L.record('A', 'review', fp, 'CHANGES_REQUIRED', { tokens: 100 });
  assert.equal(L.admit('A', 'review', fp).cause, g.Cause.NO_PROGRESS);
  assert.equal(
    L.admit('A', 'review', g.fingerprint({ headSha: 'h2', baseSha: 'b1', inputs: 'ci:red' })).ok,
    true
  );
  assert.equal(
    L.admit('A', 'review', g.fingerprint({ headSha: 'h1', baseSha: 'b2', inputs: 'ci:red' })).ok,
    true
  );
  assert.equal(
    L.admit('A', 'review', g.fingerprint({ headSha: 'h1', baseSha: 'b1', inputs: 'ci:green' })).ok,
    true
  );
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
  const L = new g.ProgressLedger({
    file,
    limits: { item: { attempts: 2, tokens: 1000 }, goal: { ms: 5000 } },
  });
  L.record('A', 'review', 'f1', 'CHANGES_REQUIRED', { tokens: 400 });
  L.record('A', 'repair', 'f2', 'DONE', {});
  assert.equal(L.admit('A', 'review', 'f3').cause, g.Cause.ATTEMPTS_EXHAUSTED);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(s.items.A.spent.tokens, 400);
  assert.equal(s.items.A.spent.tokensUnknown, 1);
  L.record('B', 'review', 'f1', 'X', { ms: 6000 });
  assert.equal(L.admit('C', 'review', 'f1').cause, g.Cause.GOAL_EXHAUSTED);
});

test('result from a previous job is rejected', () => {
  assert.equal(g.acceptResult({ jobId: 'j2' }, { jobId: 'j1' }).cause, g.Cause.JOB_MISMATCH);
  assert.equal(g.acceptResult({ jobId: 'j2' }, {}).cause, g.Cause.JOB_UNBOUND);
  assert.equal(g.acceptResult({ jobId: 'j2' }, { jobId: 'j2' }).ok, true);
});

test('cleanup cannot mask the real exit code', async () => {
  const r = await g.runWithCleanup(
    async () => ({ exitCode: 1 }),
    async () => {
      throw new Error('rm failed');
    }
  );
  assert.equal(r.exitCode, 1);
  assert.match(r.cleanupError, /rm failed/);
  await assert.rejects(
    g.runWithCleanup(
      async () => {
        throw new Error('worker crashed');
      },
      async () => {}
    ),
    /worker crashed/
  );
});

test('CLI: refused admit exits 3, record then admit same input is NO_PROGRESS', () => {
  const ledger = path.join(tmp(), 'l.json');
  const cli = path.join(__dirname, '..', 'work-guard.js');
  const base = [
    '--ledger',
    ledger,
    '--item',
    'A',
    '--stage',
    'review',
    '--head',
    'h1',
    '--base',
    'b1',
  ];
  assert.equal(
    spawnSync(process.execPath, [cli, 'admit', ...base, '--pid', String(process.pid)]).status,
    0
  );
  assert.equal(
    spawnSync(process.execPath, [cli, 'record', ...base, '--outcome', 'CHANGES_REQUIRED']).status,
    0
  );
  const r = spawnSync(process.execPath, [cli, 'admit', ...base, '--pid', String(process.pid)], {
    encoding: 'utf8',
  });
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
    }
  );
  assert.equal(r.status, Status.BLOCKED);
  assert.equal(tests, 1);
  assert.equal(reviews, 1);
});

test('codex 8fa765f: default branch match is bounded (TASK-AI-16 vs task-ai-165)', () => {
  assert.equal(
    g.checkWorkspace({ cwd: '/w', workItemId: 'TASK-AI-16', git: okGit('feat/task-ai-165-ci') })
      .cause,
    g.Cause.WRONG_BRANCH
  );
  assert.equal(
    g.checkWorkspace({ cwd: '/w', workItemId: 'TASK-AI-16', git: okGit('feat/task-ai-16-x') }).ok,
    true
  );
  assert.equal(
    g.checkWorkspace({ cwd: '/w', workItemId: 'AI-165', git: okGit('feat/task-ai-165-ci') }).ok,
    true
  );
});

test('codex 8fa765f: alternating inputs F1, F2, F1 do not reopen F1', () => {
  const L = new g.ProgressLedger({ file: path.join(tmp(), 'l.json') });
  L.record('A', 'review', 'F1', 'CHANGES_REQUIRED', {});
  L.record('A', 'review', 'F2', 'CHANGES_REQUIRED', {});
  assert.equal(L.admit('A', 'review', 'F1').cause, g.Cause.NO_PROGRESS);
});

test('codex 8fa765f: frozen worker result survives a failing cleanup', async () => {
  const r = await g.runWithCleanup(
    async () => Object.freeze({ exitCode: 7 }),
    async () => {
      throw new Error('rm failed');
    }
  );
  assert.equal(r.exitCode, 7);
  assert.match(r.cleanupError, /rm failed/);
});

test('codex 8fa765f: returning to a tested SHA does not re-run its tests', async () => {
  const { runReviewLoop, Status } = require('../review-loop');
  const shas = ['s2', 's1', 's3'];
  const tested = [];
  const reviewed = [];
  const r = await runReviewLoop(
    { sha: 's1', budget: 3 },
    {
      runTests: () => {
        // shas[0] is the SHA the upcoming repair will produce; once the queue is
        // empty the next repair returns no SHA and the loop stops.
        const sha = shas.length ? shas[0] : 'no-more';
        tested.push(sha);
        return { pass: false, findings: [{ id: 'T' }] };
      },
      review: (sha) => {
        reviewed.push(sha);
        return { pass: true, sha };
      },
      repair: () => ({ sha: shas.shift() }),
    }
  );
  // s1 is the entry SHA and is tested once; s2 once for the first repair. Returning
  // to s1 buys no second test run of s1, and the final repair with no SHA stops the
  // loop even though its tests were bought first (they are never run again).
  assert.deepEqual(tested, ['s2', 's1', 'no-more']);
  assert.equal(tested.filter((s) => s === 's1').length, 1);
  // No SHA ever passed tests, so no review was bought at all.
  assert.deepEqual(reviewed, []);
  assert.equal(r.status, Status.BLOCKED);
  assert.equal(r.repairCount, 4);
});

test('codex a820c19: corrupt ledger fails closed', () => {
  const file = path.join(tmp(), 'l.json');
  fs.writeFileSync(file, '{"items":{"A":{"bloc');
  const L = new g.ProgressLedger({ file });
  assert.throws(() => L.admit('A', 'review', 'F'), /LEDGER_CORRUPT/);
});

test('codex a820c19: frozen worker exception survives a failing cleanup', async () => {
  const e = Object.freeze(new Error('worker crashed'));
  await assert.rejects(
    g.runWithCleanup(
      async () => {
        throw e;
      },
      async () => {
        throw new Error('rm');
      }
    ),
    /worker crashed/
  );
});

test('lock: second owner refused; only owner releases; live holder never superseded', () => {
  const f = path.join(tmp(), 'lane.lock');
  const live = { pidAlive: () => true };
  assert.equal(g.acquireLock(f, { jobId: 'j1', pid: 111 }, live).ok, true);
  const second = g.acquireLock(f, { jobId: 'j2', pid: 222 }, live);
  assert.deepEqual(
    [second.ok, second.cause, second.holder.jobId],
    [false, g.Cause.LOCK_HELD, 'j1']
  );
  assert.equal(g.releaseLock(f, { jobId: 'j2' }).cause, g.Cause.LOCK_NOT_OWNER);
  assert.equal(g.lockHolder(f).jobId, 'j1');
  assert.equal(g.releaseLock(f, { jobId: 'j1' }).ok, true);
  assert.equal(g.lockHolder(f), null);
  assert.equal(g.acquireLock(f, { jobId: 'j3', pid: 333 }, live).ok, true);
});

test('codex 4625b50: dead holder is superseded by a new generation; racing contenders cannot both win', () => {
  const f = path.join(tmp(), 'lane.lock');
  g.acquireLock(f, { jobId: 'dead', pid: 111 }, { pidAlive: () => true });
  const dead = { pidAlive: (p) => p !== 111 };
  // two contenders both observed the dead holder; the exclusive create of g2 admits one
  const a = g.acquireLock(f, { jobId: 'A', pid: 222 }, dead);
  const b = g.acquireLock(f, { jobId: 'B', pid: 333 }, dead);
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.equal(g.lockHolder(f).jobId, 'A');
});

test('codex 4625b50: a late contender creating an old generation backs off', () => {
  const f = path.join(tmp(), 'lane.lock');
  const live = { pidAlive: () => true };
  g.acquireLock(f, { jobId: 'j1', pid: 1 }, live);
  g.releaseLock(f, { jobId: 'j1' });
  g.acquireLock(f, { jobId: 'j2', pid: 2 }, live); // g2
  // a contender that observed generation 1 creates g1 again after g2 exists
  fs.writeFileSync(f + '.g1', JSON.stringify({ jobId: 'late', pid: 9, at: 1 }));
  assert.equal(g.lockHolder(f).jobId, 'j2');
  assert.equal(g.acquireLock(f, { jobId: 'j3', pid: 3 }, live).cause, g.Cause.LOCK_HELD);
});

test('codex a820c19: reserved admission blocks a duplicate until recorded; dead reserver frees it', () => {
  const L = new g.ProgressLedger({
    file: path.join(tmp(), 'l.json'),
    limits: { goal: { attempts: 5 } },
  });
  assert.equal(L.admit('A', 'review', 'F', { reserve: true, pid: process.pid }).ok, true);
  assert.equal(
    L.admit('A', 'review', 'F', { reserve: true, pid: process.pid }).cause,
    g.Cause.NO_PROGRESS
  );
  L.record('A', 'review', 'F', 'CHANGES_REQUIRED', {});
  assert.equal(L.load().items.A.spent.attempts, 1);
  assert.equal(L.admit('A', 'review', 'G', { reserve: true, pid: 999999 }).ok, true);
  assert.equal(L.admit('A', 'review', 'G', { reserve: true, pid: process.pid }).ok, true);
  assert.throws(() => L.admit('A', 'review', 'H', { reserve: true }), /integer owner pid/);
});

test('codex a820c19: goal cap of one admits only one reserved attempt', () => {
  const L = new g.ProgressLedger({
    file: path.join(tmp(), 'l.json'),
    limits: { goal: { attempts: 1 } },
  });
  assert.equal(L.admit('A', 'review', 'F1', { reserve: true, pid: process.pid }).ok, true);
  assert.equal(
    L.admit('B', 'review', 'F2', { reserve: true, pid: process.pid }).cause,
    g.Cause.GOAL_EXHAUSTED
  );
});

test('codex 4625b50: structurally damaged ledger fails closed', () => {
  for (const bad of [
    '{"items":false,"goal":false}',
    '{"items":{"A":{"spent":{"attempts":"x"}}},"goal":{"attempts":0}}',
    '[]',
  ]) {
    const file = path.join(tmp(), 'l.json');
    fs.writeFileSync(file, bad);
    assert.throws(() => new g.ProgressLedger({ file }).admit('A', 'review', 'F'), /LEDGER_CORRUPT/);
  }
});

test('codex e4a6705: missing counters or fingerprint containers fail closed; pid must be positive; read-only annotation', async () => {
  const file = path.join(tmp(), 'l.json');
  fs.writeFileSync(file, '{"items":{"A":{"spent":{},"stages":{"review":{}}}},"goal":{}}');
  assert.throws(() => new g.ProgressLedger({ file }).admit('A', 'review', 'F'), /LEDGER_CORRUPT/);
  const L = new g.ProgressLedger({ file: path.join(tmp(), 'l.json') });
  assert.throws(() => L.admit('A', 'review', 'F', { reserve: true, pid: 0 }), /integer owner pid/);
  assert.throws(() => L.admit('A', 'review', 'F', { reserve: true, pid: -4 }), /integer owner pid/);
  const out = Object.defineProperty({ exitCode: 7 }, 'cleanupError', {
    value: 'x',
    writable: false,
    enumerable: false,
  });
  const r = await g.runWithCleanup(
    async () => out,
    async () => {
      throw new Error('rm');
    }
  );
  assert.equal(r.exitCode, 7);
  const e = Object.defineProperty(new Error('crash'), 'cleanupError', {
    value: 1,
    writable: false,
  });
  await assert.rejects(
    g.runWithCleanup(
      async () => {
        throw e;
      },
      async () => {
        throw new Error('rm');
      }
    ),
    /crash/
  );
});

test('codex b4a4064: items need spent and stages; lock pids must be positive; usage never refunds', () => {
  for (const bad of [
    '{"items":{"A":{}},"goal":{"attempts":0,"ms":0,"tokens":0}}',
    '{"items":{"A":{"spent":{"attempts":1,"ms":0,"tokens":0}}},"goal":{"attempts":0,"ms":0,"tokens":0}}',
  ]) {
    const file = path.join(tmp(), 'l.json');
    fs.writeFileSync(file, bad);
    assert.throws(() => new g.ProgressLedger({ file }).admit('A', 'review', 'F'), /LEDGER_CORRUPT/);
  }
  const f = path.join(tmp(), 'lane.lock');
  assert.throws(() => g.acquireLock(f, { jobId: 'n', pid: -99999999 }), /positive pid/);
  fs.writeFileSync(f + '.g1', JSON.stringify({ jobId: 'bad', pid: -5, at: 1 }));
  assert.equal(
    g.acquireLock(f, { jobId: 'j', pid: 7 }, { pidAlive: () => false }).cause,
    g.Cause.LOCK_HELD
  );
  const L = new g.ProgressLedger({ file: path.join(tmp(), 'l.json') });
  assert.throws(() => L.record('A', 'review', 'F', 'X', { ms: -100 }), /invalid usage/);
  assert.throws(() => L.record('A', 'review', 'F', 'X', { tokens: -100 }), /invalid usage/);
  assert.throws(() => L.record('A', 'review', 'F', 'X', { tokens: Infinity }), /invalid usage/);
});

test('codex ee9ce83: a generation already taken and released cannot be reacquired; inherited exit code survives', async () => {
  const f = path.join(tmp(), 'lane.lock');
  const live = { pidAlive: () => true };
  g.acquireLock(f, { jobId: 'B', pid: 2 }, live);
  g.releaseLock(f, { jobId: 'B' }); // g1.released
  // A paused after choosing g1, now creates it
  fs.writeFileSync(f + '.g1', JSON.stringify({ jobId: 'A', pid: 1, at: 1 }));
  const late = g.acquireLock(f, { jobId: 'C', pid: 3 }, live);
  assert.equal(late.ok, true); // C takes g2, never g1
  assert.equal(g.lockHolder(f).jobId, 'C');
  const r = await g.runWithCleanup(
    async () => Object.create({ exitCode: 7 }),
    async () => {
      throw new Error('rm');
    }
  );
  assert.equal(r.exitCode, 7);
  assert.match(r.cleanupError, /rm/);
});

test('round 2 #4: a failed conflict inspection refuses admission instead of passing', () => {
  const cwd = '/w/p-task-ai-165';
  const item = 'TASK-AI-165';
  // `git diff --name-only --diff-filter=U` exits nonzero (index locked, corrupt repo,
  // git crashed): the guard cannot prove the tree is clean, so AC-AI-167-01 refuses.
  const r = g.checkWorkspace({ cwd, expectedRoot: cwd, workItemId: item, git: gitFailingDiff() });
  assert.equal(r.ok, false);
  assert.equal(r.cause, g.Cause.CONFLICT_UNKNOWN);
  // A git stub that returns nothing at all for the inspection is refused too.
  const silent = fakeGit({
    'rev-parse --show-toplevel': cwd + '\n',
    'symbolic-ref --quiet --short HEAD': 'feat/task-ai-165-ci\n',
    'rev-parse HEAD': 'abc\n',
  });
  assert.equal(
    g.checkWorkspace({ cwd, expectedRoot: cwd, workItemId: item, git: silent }).cause,
    g.Cause.CONFLICT_UNKNOWN
  );
  // Control: a successful inspection with no unmerged files still admits.
  assert.equal(
    g.checkWorkspace({ cwd, expectedRoot: cwd, workItemId: item, git: okGit(item) }).ok,
    true
  );
});

test('round 2 #5: unknown token usage counts toward the token caps', () => {
  const file = path.join(tmp(), 'l.json');
  // A token-only cap, no attempt cap: only the token budget can ever refuse.
  const L = new g.ProgressLedger({ file, limits: { item: { tokens: 3000 } } });
  L.record('A', 'repair', 'f1', 'TIMEOUT', {});
  L.record('A', 'repair', 'f2', 'TIMEOUT', {});
  // Each unobserved attempt is charged the per-attempt cap (3000); the item cap is spent.
  assert.equal(L.admit('A', 'repair', 'f3').cause, g.Cause.TOKENS_EXHAUSTED);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(s.items.A.spent.tokensUnknown, 2);
  // The third admission is refused before it is charged, so the cap stops at 3000.
  assert.equal(s.items.A.spent.unknownTokens, 3000);
  assert.equal(s.items.A.spent.tokens, 0);

  // A reservation that is never recorded cannot dodge the same cap.
  const L2 = new g.ProgressLedger({
    file: path.join(tmp(), 'l.json'),
    limits: { goal: { tokens: 3000 } },
  });
  L2.admit('A', 'review', 'f1', { reserve: true, pid: process.pid });
  assert.equal(L2.admit('B', 'review', 'f2').cause, g.Cause.GOAL_EXHAUSTED);
  // A recorded reservation is not charged twice: its known usage replaces the imputation.
  const L3 = new g.ProgressLedger({
    file: path.join(tmp(), 'l.json'),
    limits: { item: { tokens: 3000 } },
  });
  L3.admit('A', 'review', 'f1', { reserve: true, pid: process.pid });
  L3.record('A', 'review', 'f1', 'CHANGES_REQUIRED', { tokens: 10 });
  const s3 = JSON.parse(fs.readFileSync(L3.file, 'utf8'));
  assert.equal(s3.items.A.spent.tokens, 10);
  assert.equal(s3.items.A.spent.unknownTokens, 0);
  assert.equal(L3.admit('A', 'review', 'f2').ok, true);
  // An unknown usage that is recorded without a cap is still only a count.
  const L4 = new g.ProgressLedger({ file: path.join(tmp(), 'l.json') });
  L4.record('A', 'review', 'f1', 'TIMEOUT', {});
  assert.equal(L4.load().items.A.spent.unknownTokens, 0);
  assert.throws(() => L4.record('A', 'review', 'f2', 'X', { tokens: -1 }), /invalid usage/);
});

test('round 2 #6: worker own properties survive failing cleanup across JSON serialization and spread', async () => {
  const workerResult = { jobId: 'job-99', exitCode: 7, count: 42 };
  const r = await g.runWithCleanup(
    async () => workerResult,
    async () => {
      throw new Error('rmdir failed');
    }
  );
  assert.equal(r.jobId, 'job-99');
  assert.equal(r.exitCode, 7);
  assert.equal(r.count, 42);
  assert.match(r.cleanupError, /rmdir failed/);

  // Serialized handoff via JSON.stringify retains worker fields and cleanupError
  const serialized = JSON.parse(JSON.stringify(r));
  assert.equal(serialized.jobId, 'job-99');
  assert.equal(serialized.exitCode, 7);
  assert.equal(serialized.count, 42);
  assert.match(serialized.cleanupError, /rmdir failed/);

  // Object spread retains worker fields and cleanupError
  const spread = { ...r };
  assert.equal(spread.jobId, 'job-99');
  assert.equal(spread.exitCode, 7);
  assert.equal(spread.count, 42);
  assert.match(spread.cleanupError, /rmdir failed/);
});

test('round 2 #7: falsy worker exceptions are not swallowed', async () => {
  for (const falsy of [null, undefined, false, 0, '']) {
    let threw = false;
    try {
      await g.runWithCleanup(
        async () => {
          throw falsy;
        },
        async () => {}
      );
    } catch (e) {
      threw = true;
      assert.strictEqual(e, falsy);
    }
    assert.strictEqual(threw, true, `Expected worker throwing ${JSON.stringify(falsy)} to throw`);
  }
});

test('round 2 #14: unexpected liveness errors treat lock as held', () => {
  const file = path.join(tmp(), 'lock');
  fs.writeFileSync(file + '.g1', JSON.stringify({ jobId: 'j1', pid: 99999, at: Date.now() }));

  const origKill = process.kill;
  try {
    // Non-ESRCH error (e.g. EPERM or any unexpected system failure)
    process.kill = () => {
      const err = new Error('unexpected system error');
      err.code = 'EUNKNOWN';
      throw err;
    };
    const r = g.acquireLock(file, { jobId: 'j2', pid: 88888 });
    assert.equal(r.ok, false);
    assert.equal(r.cause, g.Cause.LOCK_HELD);

    // Proven dead (ESRCH) allows superseding lock
    process.kill = () => {
      const err = new Error('no such process');
      err.code = 'ESRCH';
      throw err;
    };
    const r2 = g.acquireLock(file, { jobId: 'j2', pid: 88888 });
    assert.equal(r2.ok, true);
  } finally {
    process.kill = origKill;
  }
});

test('round 2 #15: checkout comparison respects filesystem case-sensitivity', () => {
  const git = (args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') return { status: 0, stdout: '/w/Item\n' };
    if (args.join(' ') === 'diff --name-only --diff-filter=U') return { status: 0, stdout: '' };
    if (args.join(' ') === 'symbolic-ref --quiet --short HEAD')
      return { status: 0, stdout: 'feat/item-1\n' };
    if (args.join(' ') === 'rev-parse HEAD') return { status: 0, stdout: 'abc\n' };
    return { status: 1, stdout: '' };
  };

  // Case-sensitive filesystem: /w/Item !== /w/item -> CWD_MISMATCH
  withCaseInsensitiveFs('0', () => {
    const r = g.checkWorkspace({
      cwd: '/w/item',
      expectedRoot: '/w/item',
      workItemId: 'item-1',
      git,
    });
    assert.equal(r.ok, false);
    assert.equal(r.cause, g.Cause.CWD_MISMATCH);
  });

  // Case-insensitive filesystem: /w/Item === /w/item -> accepted
  withCaseInsensitiveFs('1', () => {
    const r = g.checkWorkspace({
      cwd: '/w/item',
      expectedRoot: '/w/item',
      workItemId: 'item-1',
      git,
    });
    assert.equal(r.ok, true);
  });
});
