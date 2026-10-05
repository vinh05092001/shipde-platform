'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const { measureFailBefore } = require('../orchestrate');

function createRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-98-'));
  const runGit = (args) => {
    const result = cp.spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || 'git ' + args.join(' ') + ' failed');
    return String(result.stdout || '').trim();
  };

  runGit(['init', '-q']);
  runGit(['config', 'user.name', 'TASK-AI-98 Test']);
  runGit(['config', 'user.email', 'task-ai-98@example.invalid']);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'feature.js'), "module.exports = { value: 'base' };\n");
  runGit(['add', '.']);
  runGit(['commit', '-qm', 'base']);
  const baseSha = runGit(['rev-parse', 'HEAD']);

  return {
    root,
    baseSha,
    commitHead() {
      runGit(['add', '.']);
      runGit(['commit', '-qm', 'head']);
      return runGit(['rev-parse', 'HEAD']);
    },
    runGit,
  };
}

function runHeadCommand(root, command) {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  return cp.spawnSync(command, [], {
    cwd: root,
    env,
    shell: true,
    encoding: 'utf8',
  });
}

describe('TASK-AI-98: supervisor measures fail-before in the base tree', () => {
  test('a test for a changed module fails on base, and only the test file is overlaid', (t) => {
    const repo = createRepo();
    t.after(() => fs.rmSync(repo.root, { recursive: true, force: true }));

    fs.writeFileSync(
      path.join(repo.root, 'src', 'new-feature.js'),
      "module.exports = { value: 'head' };\n"
    );
    fs.mkdirSync(path.join(repo.root, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(repo.root, 'tests', 'new-feature.test.js'),
      "const assert = require('node:assert/strict');\n" +
        "const feature = require('../src/new-feature');\n" +
        "const { test } = require('node:test');\n" +
        "test('new feature behavior', () => assert.equal(feature.value, 'head'));\n"
    );
    const headSha = repo.commitHead();
    const command = 'node --test tests/new-feature.test.js';

    const measured = measureFailBefore(repo.root, repo.baseSha, headSha, command);
    assert.ok(measured);
    assert.notEqual(measured.exitCode, 0);
    assert.deepEqual(measured.testFiles, ['tests/new-feature.test.js']);
    assert.equal(measured.baseSha, repo.baseSha);
    assert.equal(measured.headSha, headSha);
    assert.equal(measured.measuredBy, 'supervisor-base-tree');

    const headResult = runHeadCommand(repo.root, command);
    assert.equal(headResult.status, 0, headResult.stderr || headResult.stdout);
  });

  test('a test already passing on base reports success without fabricating a failure', (t) => {
    const repo = createRepo();
    t.after(() => fs.rmSync(repo.root, { recursive: true, force: true }));

    fs.mkdirSync(path.join(repo.root, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(repo.root, 'tests', 'existing.test.js'),
      "const assert = require('node:assert/strict');\n" +
        "const feature = require('../src/feature');\n" +
        "const { test } = require('node:test');\n" +
        "test('existing behavior', () => assert.equal(feature.value, 'base'));\n"
    );
    const headSha = repo.commitHead();

    const measured = measureFailBefore(
      repo.root,
      repo.baseSha,
      headSha,
      'node --test tests/existing.test.js'
    );
    assert.ok(measured);
    assert.equal(measured.exitCode, 0);
    assert.deepEqual(measured.testFiles, ['tests/existing.test.js']);
  });

  test('measurement leaves worker HEAD and status unchanged', (t) => {
    const repo = createRepo();
    t.after(() => fs.rmSync(repo.root, { recursive: true, force: true }));

    fs.mkdirSync(path.join(repo.root, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(repo.root, 'tests', 'unchanged.test.js'),
      "const { test } = require('node:test');\ntest('ok', () => {});\n"
    );
    const headSha = repo.commitHead();
    const headBefore = repo.runGit(['rev-parse', 'HEAD']);
    const statusBefore = repo.runGit(['status', '--porcelain']);

    assert.ok(
      measureFailBefore(repo.root, repo.baseSha, headSha, 'node --test tests/unchanged.test.js')
    );
    assert.equal(repo.runGit(['rev-parse', 'HEAD']), headBefore);
    assert.equal(repo.runGit(['status', '--porcelain']), statusBefore);
  });

  test('missing inputs return null', () => {
    assert.equal(measureFailBefore(null, 'base', 'head', 'node --test'), null);
    assert.equal(measureFailBefore('worker', null, 'head', 'node --test'), null);
    assert.equal(measureFailBefore('worker', 'base', 'head', ''), null);
  });
});
