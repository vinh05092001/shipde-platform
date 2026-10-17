'use strict';

// After carry-over merges the previous attempt's work into a fresh checkout,
// the provisioned HEAD is the merge commit; its first parent must be the
// requested base. Live 17/10: GOAL-G-F622511E-1 failed PROVISION_BASE_MISMATCH
// on every retry because the merge commit was compared with the base directly.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { provisionedHeadMatchesBase } = require('../isolation-launcher');

function git(cwd, args) {
  const res = cp.spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
    }),
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim();
}

test('a carry-over merge on top of the base matches; anything else does not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carry-base-'));
  try {
    git(dir, ['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n');
    git(dir, ['add', 'a.txt']);
    git(dir, ['commit', '-q', '-m', 'base']);
    const base = git(dir, ['rev-parse', 'HEAD']);

    git(dir, ['checkout', '-q', '-b', 'previous']);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'previous attempt\n');
    git(dir, ['add', 'b.txt']);
    git(dir, ['commit', '-q', '-m', 'previous attempt']);

    git(dir, ['checkout', '-q', '--detach', base]);
    git(dir, ['merge', '-q', '--no-ff', '--no-edit', 'previous']);
    const merged = git(dir, ['rev-parse', 'HEAD']);

    git(dir, ['checkout', '-q', '--orphan', 'other']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', 'unrelated']);
    const unrelated = git(dir, ['rev-parse', 'HEAD']);

    assert.equal(provisionedHeadMatchesBase(dir, base, base, 'none'), true);
    assert.equal(provisionedHeadMatchesBase(dir, merged, base, 'merged'), true);
    assert.equal(provisionedHeadMatchesBase(dir, merged, base, 'none'), false);
    assert.equal(provisionedHeadMatchesBase(dir, unrelated, base, 'merged'), false);
    assert.equal(provisionedHeadMatchesBase(dir, null, base, 'merged'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
