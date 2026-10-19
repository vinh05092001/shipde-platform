'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const launcher = require('../isolation-launcher');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-hook-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  });
  const git = (...args) => {
    const r = cp.spawnSync(
      'git',
      ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
      { cwd: root, env, encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q');
  git('config', 'user.name', 'fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  const file = 'docs/product-spec/work-items/GOAL-FIXTURE.md';
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), 'base\n');
  git('add', '.');
  git('commit', '-m', 'base');
  const sha = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, file), 'updated\n');
  return { root, git, sha, hook: path.join(root, '.git/hooks/pre-commit') };
}

test('metadata amend refuses a missing installed hook and preserves HEAD', (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      launcher.commitWorkerMetadata({
        hostRoot: f.root,
        workerRoot: f.root,
        workItemId: 'GOAL-FIXTURE',
      }),
    /WORKER_COMMIT_FAILED: installed pre-commit hook missing/
  );
  assert.equal(f.git('rev-parse', 'HEAD'), f.sha);
});

test('unchanged metadata needs no commit or installed hook', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'docs/product-spec/work-items/GOAL-FIXTURE.md'), 'base\n');
  assert.equal(
    launcher.commitWorkerMetadata({
      hostRoot: f.root,
      workerRoot: f.root,
      workItemId: 'GOAL-FIXTURE',
    }),
    null
  );
  assert.equal(f.git('rev-parse', 'HEAD'), f.sha);
});

for (const exit of [0, 1])
  test(`metadata amend executes installed hook (exit ${exit})`, (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.hook, `#!/bin/sh\nprintf ran > hook-ran\nexit ${exit}\n`, { mode: 0o755 });
    const run = () =>
      launcher.commitWorkerMetadata({
        hostRoot: f.root,
        workerRoot: f.root,
        workItemId: 'GOAL-FIXTURE',
      });
    if (exit) {
      assert.throws(run, /WORKER_COMMIT_FAILED: commit/);
      assert.equal(f.git('rev-parse', 'HEAD'), f.sha);
    } else {
      assert.match(run(), /^[a-f0-9]{40}$/);
      assert.notEqual(f.git('rev-parse', 'HEAD'), f.sha);
    }
    assert.equal(fs.readFileSync(path.join(f.root, 'hook-ran'), 'utf8'), 'ran');
  });

test('only the private interrupted-work save retains a hook bypass', () => {
  const source = fs.readFileSync(require.resolve('../isolation-launcher'), 'utf8');
  assert.equal((source.match(/--no-verify/g) || []).length, 1);
  assert.match(
    source.slice(
      source.indexOf('function carryOverSave'),
      source.indexOf('function carryOverRestore')
    ),
    /--no-verify/
  );
  assert.match(source, /launchResult\.localFailure = 'WORKER_COMMIT_FAILED'/);
});
