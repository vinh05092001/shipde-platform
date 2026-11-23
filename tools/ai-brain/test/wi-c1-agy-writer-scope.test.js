'use strict';

// WI-C1 scope follow-up: an agy-pool writer runs outside the isolated launcher, so its
// commit must pass the writer-scope diff check in the launcher seam itself. Root, base
// and head come from the job; nothing falls back to the Controller's checkout.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pool = require('../agy-pool-runtime');
const { resolveLauncher } = require('../orchestrate/writer-loop');

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-scope-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'fixture@example.invalid');
  git(dir, 'config', 'user.name', 'fixture');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(dir, 'other.js'), 'o\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return { dir, base: git(dir, 'rev-parse', 'HEAD') };
}

function commit(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'work ' + file);
  return git(dir, 'rev-parse', 'HEAD');
}

const quota = (claude, at) => ({
  at,
  groups: [
    {
      name: 'Claude and GPT models',
      description: 'Models within this group: Claude Opus 5.5',
      buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: claude }],
    },
  ],
});

function launch(t, job, { enabled = true } = {}) {
  t.mock.method(pool, 'submitJob', (accountId) => ({
    state: 'ok',
    exitCode: 0,
    accountId,
    jobId: accountId + '/run-1',
  }));
  t.mock.method(pool, 'readOutText', () => '{}');
  const snapshots = [quota(0.8, 1), quota(0.7, Date.now() + 60000)];
  const launcher = resolveLauncher(
    {
      externalWorkers: 'agy-pool',
      allowAgyPoolWriter: enabled,
      poolTimeoutMs: 1000,
      readAgyQuota: () => snapshots.shift(),
    },
    null
  );
  return launcher({
    harness: 'agy-pool',
    accountId: 'agy03',
    model: 'claude-opus-5.5',
    quotaScope: 'agy03:3p',
    prompt: 'fixture',
    resultSchema: {},
    labels: { workItem: 'TASK-FIXTURE', role: 'author.foundation' },
    allowedPaths: ['src/**'],
    ...job,
  });
}

test('C1 scope: an in-scope agy writer commit is accepted and becomes the worker sha', (t) => {
  const { dir, base } = repo(t);
  const head = commit(dir, 'src/b.js', 'b\n');
  const res = launch(t, { cwd: dir, baseSha: base });
  assert.equal(res.exitCode, 0);
  assert.equal(res.localFailure, undefined);
  assert.equal(res.workerSha, head);
});

test('C1 scope: an out-of-scope agy writer commit is refused and carries no worker sha', (t) => {
  const { dir, base } = repo(t);
  commit(dir, 'other.js', 'changed\n');
  const res = launch(t, { cwd: dir, baseSha: base });
  assert.equal(res.exitCode, 1);
  assert.equal(res.localFailure, 'WRITER_DIFF_OUTSIDE_SCOPE');
  assert.match(res.refusal, /^WRITER_DIFF_OUTSIDE_SCOPE: other\.js/);
  assert.equal(res.workerSha, undefined);
  assert.equal(res.retainedHeadSha, undefined);
});

test('C1 scope: missing or mismatched bindings refuse instead of falling back', (t) => {
  const { dir, base } = repo(t);
  const head = commit(dir, 'src/b.js', 'b\n');
  const missingRoot = launch(t, { cwd: path.join(dir, 'absent'), baseSha: base });
  assert.equal(missingRoot.localFailure, 'AGY_WRITER_ROOT_UNBOUND');
  const noRoot = launch(t, { baseSha: base });
  assert.equal(noRoot.localFailure, 'AGY_WRITER_ROOT_UNBOUND');
  const noBase = launch(t, { cwd: dir });
  assert.equal(noBase.localFailure, 'AGY_WRITER_BASE_UNBOUND');
  // A base the head does not descend from: an unrelated root commit in the same repo.
  git(dir, 'checkout', '-q', '--orphan', 'unrelated');
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'unrelated');
  const unrelated = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', head);
  const foreignBase = launch(t, { cwd: dir, baseSha: unrelated });
  assert.equal(foreignBase.localFailure, 'AGY_WRITER_HEAD_NOT_FROM_BASE');
  const noScope = launch(t, { cwd: dir, baseSha: base, allowedPaths: [] });
  assert.equal(noScope.localFailure, 'WRITER_SCOPE_EMPTY');
  for (const r of [missingRoot, noRoot, noBase, foreignBase, noScope]) {
    assert.equal(r.exitCode, 1);
    assert.equal(r.workerSha, undefined);
  }
});

test('C1 scope: reviewers are not scope-checked and the flag OFF path is unchanged', (t) => {
  const { dir, base } = repo(t);
  commit(dir, 'other.js', 'changed\n');
  const off = launch(t, { cwd: dir, baseSha: base }, { enabled: false });
  assert.equal(off.exitCode, 1);
  assert.match(off.refusal, /^WRITER_LAUNCH_NOT_AUTHORIZED/);
  assert.equal(off.localFailure, undefined);
  const nonWriter = launch(t, {
    cwd: dir,
    baseSha: base,
    labels: { workItem: 'TASK-FIXTURE', role: 'researcher' },
  });
  assert.equal(nonWriter.exitCode, 0);
  assert.equal(nonWriter.localFailure, undefined);
});

test('C1 scope: the recorded agy worker sha is the verified one, never the Controller sha', (t) => {
  const { nonIsolatedWorkerSha } = require('../orchestrate/writer-loop');
  const { dir, base } = repo(t);
  const head = commit(dir, 'src/b.js', 'b\n');
  const controllerSha = 'c'.repeat(40);
  const agy = { harness: 'agy-pool', cwd: dir };
  assert.deepEqual(nonIsolatedWorkerSha(agy, { exitCode: 0, workerSha: head }, controllerSha), {
    sha: head,
    unverified: false,
  });
  // Refused by scope: no sha, even though the root has a readable HEAD.
  assert.deepEqual(
    nonIsolatedWorkerSha(
      agy,
      { exitCode: 1, localFailure: 'WRITER_DIFF_OUTSIDE_SCOPE', workerSha: head },
      controllerSha
    ),
    { sha: null, unverified: false }
  );
  // A successful run without a verified sha is unverified, not the Controller's sha.
  assert.deepEqual(nonIsolatedWorkerSha(agy, { exitCode: 0 }, controllerSha), {
    sha: null,
    unverified: true,
  });
  // Other harnesses keep their existing rule.
  assert.equal(
    nonIsolatedWorkerSha({ harness: 'autoclaw', cwd: dir }, { exitCode: 0 }, controllerSha).sha,
    head
  );
  assert.equal(
    nonIsolatedWorkerSha({ harness: 'autoclaw', cwd: path.join(dir, 'absent') }, {}, controllerSha)
      .sha,
    controllerSha
  );
  assert.equal(base.length, 40);
});
