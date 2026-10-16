'use strict';

// The PR contract accepts Controller goal Work Item ids (GOAL-<GOAL>-<n>).
// Live 16/10: PR #356 [GOAL-AUTOCLAW-REPOS-1] failed the contract gate because
// the title pattern only knew FEAT-*, TASK-FOUND-* and TASK-AI-*.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..', '..');
const script = path.join(repo, 'docs', 'product-spec', 'scripts', 'validate_pr_contract.py');
const python = ['python', 'python3'].find(
  (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0
);

function titleErrors(title) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-contract-'));
  try {
    const event = path.join(dir, 'event.json');
    fs.writeFileSync(
      event,
      JSON.stringify({ pull_request: { title, body: '', base: { ref: 'main' } } })
    );
    const res = spawnSync(python, [script, '--event', event], { cwd: repo, encoding: 'utf8' });
    return (res.stdout + res.stderr)
      .split(/\r?\n/)
      .filter((line) => line.includes('PR title must contain exactly one'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a goal Work Item id satisfies the PR title rule', { skip: !python }, () => {
  assert.deepEqual(titleErrors('[GOAL-AUTOCLAW-REPOS-1] Tool manifest reports real evidence'), []);
});

test(
  'existing Work Item ids still satisfy it and a title without one still fails',
  { skip: !python },
  () => {
    assert.deepEqual(titleErrors('[TASK-AI-142] Something'), []);
    assert.deepEqual(titleErrors('[FEAT-AUTH-05] Something'), []);
    assert.equal(titleErrors('No work item here').length, 1);
    assert.equal(titleErrors('[GOAL-AUTOCLAW-REPOS] missing the item number').length, 1);
  }
);
