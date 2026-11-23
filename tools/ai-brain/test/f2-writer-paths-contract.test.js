'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const intake = require('../intake');
const planner = require('../planner');
const { pinpointTarget } = require('../pinpoint');
const { compilePrompt } = require('../prompt-compiler');
const { createContextPack } = require('../context-pack');
const { repairSpec } = require('../orchestrate/review-lane');
const scopeGate = require('../scope-gate');
const writerScope = require('../writer-scope');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const REAL_187_PATH = path.join(REPO_ROOT, 'docs', 'product-spec', 'work-items', 'TASK-AI-187.md');

function git(cwd, args) {
  const res = cp.spawnSync('git', ['-c', 'safe.directory=*', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  }
  return (res.stdout || '').trim();
}

function makeGitFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-f2-git-'));
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 'test@shipde.local']);
  git(dir, ['config', 'user.name', 'ShipDe Test']);

  const write = (rel, body) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  };
  write('tools/ai-brain/cli/commands.js', '// controller\nmodule.exports = {};\n');
  write('tools/ai-brain/combo-reader.js', '// combo reader\nmodule.exports = {};\n');
  write(
    'tools/ai-brain/review-manifest.js',
    '// target\nfunction cli() { return path.join("a","b"); }\n'
  );
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'base']);
  const originMain = git(dir, ['rev-parse', 'HEAD']);

  // Prerequisite R1/R2 commit already on branch before writer turn
  write(
    'tools/ai-brain/combo-reader.js',
    '// combo reader with agent:false\nmodule.exports = { v: 2 };\n'
  );
  git(dir, ['add', 'tools/ai-brain/combo-reader.js']);
  git(dir, ['commit', '-m', 'prereq R1']);
  const turnBase = git(dir, ['rev-parse', 'HEAD']);

  return { dir, originMain, turnBase, write };
}

test('F2 end-to-end intake -> planner -> pinpoint/context-pack/prompt on real TASK-AI-187.md with Writer paths', () => {
  const raw187 = fs.readFileSync(REAL_187_PATH, 'utf8');
  const wiWithWriterPaths = raw187.replace(
    /(\|\s*Allowed paths\s*\|[^\r\n]+\r?\n)/i,
    '$1| Writer paths | `tools/ai-brain/review-manifest.js`, `tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js` |\n'
  );

  const derived = intake.deriveSpec({
    id: 'TASK-AI-187',
    workItemText: wiWithWriterPaths,
    registerItem: { id: 'TASK-AI-187', dependencies: '' },
    root: REPO_ROOT,
  });
  assert.deepEqual(derived.writerPaths, [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ]);
  assert.ok(derived.allowedPaths.includes('tools/ai-brain/cli/commands.js'));

  const planned = planner.plan('Fix review-manifest CLI', { specs: [derived.specItem] });
  const plannedItem = planned.workItems[0];
  assert.deepEqual(plannedItem.writerPaths, derived.writerPaths);
  assert.deepEqual(writerScope.effectiveWriterScope(plannedItem), derived.writerPaths);

  const repaired = repairSpec(plannedItem, [{ id: 'F1', detail: 'fix' }], 1);
  assert.deepEqual(repaired.writerPaths, derived.writerPaths);
  assert.deepEqual(writerScope.effectiveWriterScope(repaired), derived.writerPaths);

  const pp = pinpointTarget(plannedItem, { rootDir: REPO_ROOT });
  const pinFiles = [...new Set(pp.locations.map((l) => l.file))];
  assert.deepEqual(pinFiles, [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ]);

  const pack = createContextPack([plannedItem], { root: REPO_ROOT });
  assert.equal(pack.files[0], 'tools/ai-brain/review-manifest.js');
  assert.ok(!pack.files.includes('tools/ai-brain/cli/commands.js'));

  const prompt = compilePrompt(plannedItem, {
    goal: derived.goal,
    rootDir: REPO_ROOT,
    isolatedWorker: true,
    focusedTestsOnly: true,
  });
  assert.match(
    prompt,
    /Allowed files: tools\/ai-brain\/review-manifest\.js, tools\/ai-brain\/test\/task-ai-187-review-manifest-cli\.test\.js/
  );
  assert.match(prompt, /Worker shell: Windows PowerShell/);
  assert.match(prompt, /do NOT invoke any external skill tool/);
  assert.doesNotMatch(prompt, /\| grep -E/);
  assert.doesNotMatch(
    prompt,
    /Target files & lines:[\s\S]*cli\/commands\.js[\s\S]*=== END OF TARGET LOCATION ===/
  );
});

test('F2 legacy Work Item without Writer paths preserves allowedPaths without AC heuristic dropping review-manifest.js', () => {
  const raw187 = fs.readFileSync(REAL_187_PATH, 'utf8');
  const derived = intake.deriveSpec({
    id: 'TASK-AI-187',
    workItemText: raw187,
    registerItem: { id: 'TASK-AI-187', dependencies: '' },
    root: REPO_ROOT,
  });
  assert.equal(derived.writerPaths, undefined);
  assert.equal(derived.specItem.writerPaths, undefined);
  assert.deepEqual(writerScope.effectiveWriterScope(derived.specItem), derived.allowedPaths);

  const pp = pinpointTarget(derived.specItem, { rootDir: REPO_ROOT });
  const pinFiles = [...new Set(pp.locations.map((l) => l.file))];
  assert.ok(
    pinFiles.includes('tools/ai-brain/review-manifest.js'),
    'legacy pinpoint without Writer paths must keep review-manifest.js'
  );
});

test('F2 Writer paths fails closed on empty, invalid token, absolute, traversal, glob, or outside allowedPaths', () => {
  const allowed = [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];

  // Raw cell parsing rejects empty, trailing comma, non-path prose, unbalanced backticks, absolute, traversal, glob
  for (const badCell of [
    '',
    '   ',
    '`tools/ai-brain/review-manifest.js`, ',
    '`tools/ai-brain/review-manifest.js`, not a valid path',
    '`tools/ai-brain/review-manifest.js',
    '/etc/passwd',
    'C:\\Windows\\System32\\cmd.exe',
    '../outside.js',
    'tools/ai-brain/../secret.js',
    'tools/ai-brain/*.js',
    'tools/ai-brain/review-?.js',
    'tools/ai-brain/',
  ]) {
    assert.throws(
      () => writerScope.parseWriterPaths(badCell),
      (err) => err && err.code === 'WRITER_PATHS_INVALID',
      `expected WRITER_PATHS_INVALID for cell: ${JSON.stringify(badCell)}`
    );
  }

  // Subset validation rejects empty array and path outside allowedPaths
  assert.throws(
    () => writerScope.effectiveWriterScope({ allowedPaths: allowed, writerPaths: [] }),
    (err) => err && err.code === 'WRITER_PATHS_INVALID'
  );
  assert.throws(
    () => writerScope.validateWriterPaths(['tools/ai-brain/cli/commands.js'], allowed),
    (err) => err && err.code === 'WRITER_PATHS_OUTSIDE_ALLOWED_PATHS'
  );
  assert.throws(
    () =>
      planner.plan('invalid writerPaths', {
        specs: [
          {
            id: 'TASK-BAD',
            allowedPaths: allowed,
            writerPaths: ['tools/ai-brain/cli/commands.js'],
            acceptanceCriteria: ['ok'],
            verification: { command: 'echo ok' },
          },
        ],
      }),
    (err) => err && err.code === 'WRITER_PATHS_OUTSIDE_ALLOWED_PATHS'
  );

  // Glob in allowedPaths still covers concrete writerPaths via existing scope-gate matcher
  assert.deepEqual(
    writerScope.validateWriterPaths(['tools/ai-brain/review-manifest.js'], ['tools/ai-brain/*.js']),
    ['tools/ai-brain/review-manifest.js']
  );
});

test('F2 writer diff gate checks turnBase..head against writerPaths while PR gate checks originMain..head against allowedPaths', () => {
  const { dir, originMain, turnBase, write } = makeGitFixtureRepo();
  const prAllowedPaths = [
    'tools/ai-brain/combo-reader.js',
    'tools/ai-brain/cli/commands.js',
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];
  const writerPaths = [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];

  // Turn 1: writer edits ONLY writerPaths -> PASS (prereq combo-reader.js in turnBase is NOT blamed)
  write(
    'tools/ai-brain/review-manifest.js',
    'const path = require("path");\nfunction cli() { return path.join("a","b"); }\n'
  );
  git(dir, ['add', 'tools/ai-brain/review-manifest.js']);
  git(dir, ['commit', '-m', 'writer fix']);
  const goodHead = git(dir, ['rev-parse', 'HEAD']);

  const okWriterCheck = writerScope.checkWriterCommitDiff({
    workerRoot: dir,
    baseSha: turnBase,
    headSha: goodHead,
    writerPaths,
    allowedPaths: prAllowedPaths,
  });
  assert.equal(okWriterCheck.ok, true);
  assert.deepEqual(okWriterCheck.files, ['tools/ai-brain/review-manifest.js']);

  // Turn 2: writer touches PR-only allowedPaths file (cli/commands.js, outside writerPaths)
  write(
    'tools/ai-brain/cli/commands.js',
    '// writer illegally edited controller\nmodule.exports = { bad: true };\n'
  );
  git(dir, ['add', 'tools/ai-brain/cli/commands.js']);
  git(dir, ['commit', '-m', 'writer out of writerPaths']);
  const badHead = git(dir, ['rev-parse', 'HEAD']);

  const badWriterCheck = writerScope.checkWriterCommitDiff({
    workerRoot: dir,
    baseSha: turnBase,
    headSha: badHead,
    writerPaths,
    allowedPaths: prAllowedPaths,
  });
  assert.equal(badWriterCheck.ok, false);
  assert.equal(badWriterCheck.code, 'WRITER_DIFF_OUTSIDE_SCOPE');
  assert.deepEqual(badWriterCheck.offending, ['tools/ai-brain/cli/commands.js']);

  // Meanwhile, PR-level check over originMain..goodHead using full allowedPaths accepts both prereq + writer changes
  const prScope = scopeGate.parseScope({
    workItemId: 'TASK-AI-187',
    acceptanceIds: ['AC1'],
    ownedGlobs: prAllowedPaths,
    forbiddenGlobs: [],
    testCommands: ['node --test'],
    maxDiffLines: 500,
    repairBudget: 2,
    maxToolCalls: 50,
  });
  assert.equal(prScope.ok, true);
  const prDiff = scopeGate.checkDiff({
    repoCwd: dir,
    base: originMain,
    head: goodHead,
    scope: prScope.scope,
  });
  assert.equal(prDiff.ok, true);
});
