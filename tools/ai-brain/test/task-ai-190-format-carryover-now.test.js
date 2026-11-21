'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const { prettierCheck, prettierEntry } = require('../orchestrate/gates');
const { carryOverSave, carryRef } = require('../isolation/carryover-exercise');
const { orchestrateCommand } = require('../cli/commands');

function git(cwd, args) {
  const res = cp.spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  return String(res.stdout || '').trim();
}

function initTempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-190-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@shipde.invalid']);
  git(dir, ['config', 'user.name', 'Ship De Test']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

test('TASK-AI-190 AC1: prettierCheck verifies raw Git blob LF bytes even when disk has CRLF', (t) => {
  let hasPrettier = true;
  try {
    prettierEntry();
  } catch {
    hasPrettier = false;
  }
  if (!hasPrettier) {
    t.skip('prettier not installed in this checkout');
    return;
  }

  const repo = initTempRepo(t);
  const filePath = path.join(repo, 'sample.js');
  const cleanLf = "'use strict';\n\nconst x = 1;\nmodule.exports = { x };\n";
  fs.writeFileSync(filePath, cleanLf, 'utf8');
  git(repo, ['add', 'sample.js']);
  git(repo, ['commit', '-m', 'clean lf commit']);
  const cleanSha = git(repo, ['rev-parse', 'HEAD']);

  // Simulate Windows core.autocrlf=true checkout on disk (CRLF)
  fs.writeFileSync(filePath, cleanLf.replace(/\n/g, '\r\n'), 'utf8');

  const diskCheck = prettierCheck([filePath]);
  assert.equal(diskCheck.status, 'FAILED', 'disk CRLF file should fail default LF prettier check');

  const blobCheck = prettierCheck([filePath], { workerRoot: repo, sha: cleanSha });
  assert.equal(blobCheck.status, 'PASSED', 'committed LF blob should pass prettierCheck');

  // Verify a genuinely unformatted committed blob still fails closed
  fs.writeFileSync(filePath, "'use strict';\nconst   y=   2\nmodule.exports={y}\n", 'utf8');
  git(repo, ['add', 'sample.js']);
  git(repo, ['commit', '-m', 'unformatted commit']);
  const badSha = git(repo, ['rev-parse', 'HEAD']);

  const badCheck = prettierCheck([filePath], { workerRoot: repo, sha: badSha });
  assert.equal(badCheck.status, 'FAILED', 'unformatted committed blob must still fail');
  assert.deepEqual(badCheck.files, [filePath]);

  // Verify a syntax error in a committed blob also fails closed (Prettier --check --stdin-filepath
  // prints [error] to stderr even when exiting 0).
  fs.writeFileSync(filePath, 'function broken( {\n', 'utf8');
  git(repo, ['add', 'sample.js']);
  git(repo, ['commit', '-m', 'syntax error commit']);
  const syntaxSha = git(repo, ['rev-parse', 'HEAD']);

  const syntaxCheck = prettierCheck([filePath], { workerRoot: repo, sha: syntaxSha });
  assert.equal(syntaxCheck.status, 'FAILED', 'syntax-error committed blob must fail closed');
  assert.deepEqual(syntaxCheck.files, [filePath]);
});

test('TASK-AI-190 AC2: carryOverSave excludes .shipde-bin while preserving allowed edits', (t) => {
  const hostRepo = initTempRepo(t);
  fs.writeFileSync(path.join(hostRepo, 'a.txt'), 'base\n', 'utf8');
  git(hostRepo, ['add', 'a.txt']);
  git(hostRepo, ['commit', '-m', 'base']);
  const baseSha = git(hostRepo, ['rev-parse', 'HEAD']);

  const workerRepo = initTempRepo(t);
  git(workerRepo, ['fetch', hostRepo, 'main']);
  git(workerRepo, ['checkout', '-b', 'feat/task-ai-190-test', 'FETCH_HEAD']);

  // Create both a legitimate edit and a .shipde-bin binary artifact, and even
  // pre-stage .shipde-bin/rtk.exe (simulating an interrupted `git add --all`).
  fs.writeFileSync(path.join(workerRepo, 'a.txt'), 'edited\n', 'utf8');
  fs.mkdirSync(path.join(workerRepo, '.shipde-bin'), { recursive: true });
  fs.writeFileSync(path.join(workerRepo, '.shipde-bin', 'rtk.exe'), Buffer.from('MZ-fake-binary'));
  git(workerRepo, ['add', '-f', '.shipde-bin/rtk.exe']);

  const saved = carryOverSave(hostRepo, workerRepo, 'feat/task-ai-190-test', baseSha);
  assert.equal(saved, true);

  const ref = carryRef('feat/task-ai-190-test');
  const filesInCarry = git(hostRepo, ['diff', '--name-only', `${baseSha}..${ref}`])
    .split(/\r?\n/)
    .filter(Boolean);
  assert.deepEqual(filesInCarry, ['a.txt']);
});

test('TASK-AI-190 AC3: orchestrateCommand forwards now only when deps.now is explicitly supplied', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-190-cmd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const specsPath = path.join(dir, 'specs.json');
  fs.writeFileSync(
    specsPath,
    JSON.stringify([
      {
        id: 'TASK-AI-190',
        title: 'test item',
        allowedPaths: ['tools/ai-brain/cli/commands.js'],
        acceptanceCriteria: ['ac1'],
        verification: { command: 'node -e 1' },
      },
    ]),
    'utf8'
  );

  const captured = [];
  const runOrchestration = async (_goal, opts) => {
    captured.push(opts);
    return { status: 'COMPLETED', outcomes: [], plan: { items: [], errors: [] } };
  };

  await orchestrateCommand(
    { goal: 'test', specs: specsPath, 'decision-dir': dir },
    { runOrchestration, log: () => {}, error: () => {}, exit: () => {} }
  );
  assert.equal(captured.length, 1);
  assert.equal(
    Object.prototype.hasOwnProperty.call(captured[0], 'now'),
    false,
    'live CLI call without deps.now must not freeze now on runOrchestration opts'
  );

  const fixedNow = 1700000000000;
  await orchestrateCommand(
    { goal: 'test', specs: specsPath, 'decision-dir': dir },
    { runOrchestration, now: fixedNow, log: () => {}, error: () => {}, exit: () => {} }
  );
  assert.equal(captured.length, 2);
  assert.equal(captured[1].now, fixedNow);
});
