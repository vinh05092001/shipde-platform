'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function liveHost(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-host-'));
  fs.mkdirSync(path.join(root, 'tools/ai-brain/test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/ai-brain/test/a.test.js'), '');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const { runHostBrainGate } = require('../orchestrate');

// Live 19/10 FEAT-AUTH-05: the host checkout (hermes-live) holds live Controller state
// under tools/ai-brain/data; 7 next-runner/route-health tests failed there but passed on
// the base run's clean worktree, so the host gate reported them as new failures.
test('TASK-AI-142: the host gate runs the suite on a clean checkout of HEAD, not the live host dir', (t) => {
  const root = liveHost(t);
  const calls = [];
  const spawnSync = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts && opts.cwd });
    if (cmd === 'git') return { status: 0, stdout: 'a'.repeat(40) + '\n', stderr: '' };
    return { status: 0, stdout: 'ℹ pass 3\nℹ fail 0\n', stderr: '' };
  };
  const result = runHostBrainGate(
    {},
    { hostCwd: root, platform: 'win32', spawnSync, brainSuite: 'tools/ai-brain/test/*.test.js' }
  );
  const add = calls.find((c) => c.cmd === 'git' && c.args[0] === 'worktree' && c.args[1] === 'add');
  assert.ok(add, 'a clean worktree is created');
  assert.equal(add.args[add.args.length - 1], 'HEAD');
  const suiteRun = calls.find((c) => c.cmd !== 'git');
  assert.equal(suiteRun.cwd, add.args[add.args.length - 2]);
  assert.notEqual(suiteRun.cwd, root);
  assert.ok(
    calls.some((c) => c.cmd === 'git' && c.args[0] === 'worktree' && c.args[1] === 'remove'),
    'the clean worktree is removed'
  );
  assert.equal(result.pass, true);
});

test('TASK-AI-142: the host gate still runs in place when a clean checkout cannot be made', (t) => {
  const root = liveHost(t);
  let suiteCwd = null;
  const spawnSync = (cmd, args, opts) => {
    if (cmd === 'git')
      return args[0] === 'worktree' ? { status: 128, stderr: 'no' } : { status: 0, stdout: '' };
    suiteCwd = opts.cwd;
    return { status: 0, stdout: 'ℹ pass 1\nℹ fail 0\n', stderr: '' };
  };
  runHostBrainGate({}, { hostCwd: root, platform: 'win32', spawnSync });
  assert.equal(suiteCwd, root);
});
