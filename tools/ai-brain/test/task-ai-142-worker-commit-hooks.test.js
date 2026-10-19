'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const launcher = require('../isolation-launcher');

const EMPTY_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
const IDENTITY = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid'];

function git(cwd, ...args) {
  const result = cp.spawnSync('git', [...IDENTITY, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: EMPTY_GLOBAL,
      GIT_CONFIG_SYSTEM: EMPTY_GLOBAL,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-hook-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  const workItem = 'docs/product-spec/work-items/GOAL-FIXTURE.md';
  fs.mkdirSync(path.dirname(path.join(root, workItem)), { recursive: true });
  fs.writeFileSync(path.join(root, workItem), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  const head = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, workItem), 'updated\n');
  return { root, workItem, head, hook: path.join(root, '.git', 'hooks', 'pre-commit') };
}

function writeHook(target, body, mode = 0o755) {
  fs.writeFileSync(target, '#!/bin/sh\n' + body + '\n', { mode });
}

function commitMetadata(f, options = {}) {
  return launcher.commitWorkerMetadata({
    hostRoot: options.hostRoot || f.root,
    workerRoot: f.root,
    workItemId: 'GOAL-FIXTURE',
    ...options,
  });
}

test('published metadata commit executes the installed hook and rejects its failure', (t) => {
  for (const exitCode of [0, 1]) {
    const f = fixture(t);
    writeHook(f.hook, `printf ran > hook-ran\nexit ${exitCode}`);
    if (exitCode === 0) {
      assert.match(commitMetadata(f), /^[a-f0-9]{40}$/);
      assert.notEqual(git(f.root, 'rev-parse', 'HEAD'), f.head);
    } else {
      assert.throws(() => commitMetadata(f), /WORKER_COMMIT_FAILED: commit/);
      assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.head);
    }
    assert.equal(fs.readFileSync(path.join(f.root, 'hook-ran'), 'utf8'), 'ran');
  }
});

test('git directory and gitfile redirects outside the worker repository fail closed', (t) => {
  const host = fixture(t);
  writeHook(host.hook, 'exit 0');
  const victim = fixture(t);

  for (const kind of ['gitfile', 'directory-link']) {
    const worker = fixture(t);
    fs.rmSync(path.join(worker.root, '.git'), { recursive: true, force: true });
    if (kind === 'gitfile') {
      fs.writeFileSync(
        path.join(worker.root, '.git'),
        `gitdir: ${path.join(victim.root, '.git')}\n`
      );
    } else {
      fs.symlinkSync(
        path.join(victim.root, '.git'),
        path.join(worker.root, '.git'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    }
    assert.throws(
      () => commitMetadata(worker, { hostRoot: host.root }),
      /WORKER_COMMIT_FAILED: git directory resolves outside worker repository/
    );
    assert.equal(git(victim.root, 'rev-parse', 'HEAD'), victim.head);
  }
});

test('worker config cannot redirect worktree, hooks, includes, filters, or merge drivers', (t) => {
  const cases = [
    '[core]\nworktree = ../outside\n',
    '[core]\nhooksPath = hooks-controlled-by-worker\n',
    '[include]\npath = controlled.inc\n',
    '[includeIf "gitdir:worker"]\npath = controlled.inc\n',
    '[filter "evil"]\nclean = echo executed\n',
    '[merge "evil"]\ndriver = echo executed\n',
  ];
  for (const config of cases) {
    const f = fixture(t);
    writeHook(f.hook, 'exit 0');
    fs.appendFileSync(path.join(f.root, '.git', 'config'), '\n' + config);
    assert.throws(
      () => commitMetadata(f),
      /WORKER_COMMIT_FAILED: forbidden worker git config/,
      config
    );
    assert.equal(
      git(
        os.tmpdir(),
        `--git-dir=${path.join(f.root, '.git')}`,
        `--work-tree=${f.root}`,
        'rev-parse',
        'HEAD'
      ),
      f.head
    );
  }
});

test('a present but non-executable pre-commit hook fails closed', (t) => {
  const f = fixture(t);
  writeHook(f.hook, 'exit 0', 0o644);
  if (process.platform === 'win32') {
    const access = fs.accessSync.bind(fs);
    t.mock.method(fs, 'accessSync', (target, mode) => {
      if (path.resolve(target) === path.resolve(f.hook) && mode & fs.constants.X_OK) {
        throw Object.assign(new Error('not executable'), { code: 'EACCES' });
      }
      return access(target, mode);
    });
  }
  assert.throws(
    () => commitMetadata(f),
    /WORKER_COMMIT_FAILED: installed pre-commit hook not executable/
  );
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.head);
});

test('a failed HEAD lookup is a commit failure, never a no-op', (t) => {
  const f = fixture(t);
  writeHook(f.hook, 'exit 0');
  fs.writeFileSync(path.join(f.root, '.git', 'HEAD'), 'ref: refs/heads/missing\n');
  assert.throws(() => commitMetadata(f, { headSha: f.head }), /WORKER_COMMIT_FAILED: rev-parse/);
});

test('no metadata change needs no hook, and only private carry-over save bypasses hooks', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, f.workItem), 'base\n');
  assert.equal(commitMetadata(f), null);

  const source = fs.readFileSync(require.resolve('../isolation-launcher'), 'utf8');
  const saveStart = source.indexOf('function carryOverSave');
  const restoreStart = source.indexOf('function carryOverRestore');
  assert.match(source.slice(saveStart, restoreStart), /--no-verify/);
  assert.doesNotMatch(source.slice(0, saveStart) + source.slice(restoreStart), /--no-verify/);
});

test('missing or unreadable worker git directory fails closed before running git', (t) => {
  const host = fixture(t);
  writeHook(host.hook, 'exit 0');

  // 1. Missing worker .git directory
  const emptyWorker = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-empty-'));
  t.after(() => fs.rmSync(emptyWorker, { recursive: true, force: true }));

  assert.throws(
    () =>
      launcher.commitNativeWriterChanges({
        hostRoot: host.root,
        workerRoot: emptyWorker,
        workItemId: 'GOAL-FIXTURE',
      }),
    /NATIVE_WRITER_COMMIT_FAILED: missing or unreadable worker git directory/
  );
  assert.throws(
    () =>
      launcher.commitWorkerMetadata({
        hostRoot: host.root,
        workerRoot: emptyWorker,
        workItemId: 'GOAL-FIXTURE',
      }),
    /WORKER_COMMIT_FAILED: missing or unreadable worker git directory/
  );
  assert.throws(
    () => launcher.validateWorkerGitConfig(emptyWorker),
    /WORKER_COMMIT_FAILED: missing or unreadable worker git directory/
  );

  // 2. Unreadable worker .git directory
  const worker = fixture(t);
  writeHook(worker.hook, 'exit 0');
  const dotGit = path.join(worker.root, '.git');
  const access = fs.accessSync.bind(fs);
  t.mock.method(fs, 'accessSync', (target, mode) => {
    if (path.resolve(target) === path.resolve(dotGit)) {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    }
    return access(target, mode);
  });

  assert.throws(
    () =>
      launcher.commitNativeWriterChanges({
        hostRoot: host.root,
        workerRoot: worker.root,
        workItemId: 'GOAL-FIXTURE',
      }),
    /NATIVE_WRITER_COMMIT_FAILED: missing or unreadable worker git directory/
  );
  assert.throws(
    () => launcher.validateWorkerGitConfig(worker.root),
    /WORKER_COMMIT_FAILED: missing or unreadable worker git directory/
  );
});

test('worker config allowlist rejects unknown keys and disallowed merge and diff keys', (t) => {
  const cases = [
    '[custom]\nkey = val\n',
    '[core]\nunknownKey = val\n',
    '[core]\npager = cat\n',
    '[merge]\nconflictstyle = diff3\n',
    '[merge "custom"]\nname = custom merge\n',
    '[diff]\nrenames = true\n',
    '[diff]\nexternal = echo\n',
    '[diff "custom"]\ncommand = echo\n',
    '[diff "custom"]\ntextconv = echo\n',
    '[branch "main"]\nunknownKey = val\n',
    '[remote "origin"]\nunknownKey = val\n',
    '[user]\nunknownKey = val\n',
  ];
  for (const config of cases) {
    const f = fixture(t);
    writeHook(f.hook, 'exit 0');
    fs.appendFileSync(path.join(f.root, '.git', 'config'), '\n' + config);
    assert.throws(
      () => commitMetadata(f),
      /WORKER_COMMIT_FAILED: forbidden worker git config:/,
      config
    );
    assert.throws(
      () => launcher.validateWorkerGitConfig(f.root),
      /WORKER_COMMIT_FAILED: forbidden worker git config:/,
      config
    );
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.head);
  }
});

test('worker config allowlist rejects diff.<driver>.textconv and executable diff settings before invoking hooks', (t) => {
  const f = fixture(t);
  const marker = path.join(f.root, 'pwned-textconv.txt');

  const scriptExt = process.platform === 'win32' ? '.bat' : '.sh';
  const scriptPath = path.join(f.root, `textconv-exploit${scriptExt}`);
  if (process.platform === 'win32') {
    fs.writeFileSync(scriptPath, `@echo off\r\necho pwned > "${marker}"\r\n`);
  } else {
    fs.writeFileSync(scriptPath, `#!/bin/sh\necho pwned > "${marker}"\n`, { mode: 0o755 });
  }

  const escapedScript = scriptPath.replace(/\\/g, '/');
  fs.appendFileSync(
    path.join(f.root, '.git', 'config'),
    `\n[diff "customdriver"]\n\ttextconv = "${escapedScript}"\n`
  );
  fs.writeFileSync(path.join(f.root, '.gitattributes'), '* diff=customdriver\n');

  // Install a hook that runs git diff
  writeHook(f.hook, 'git diff --cached\nexit 0');

  // Direct allowlist unit check
  assert.equal(launcher.isWorkerConfigKeyAllowed('diff.customdriver.textconv'), false);
  assert.equal(launcher.isWorkerConfigKeyAllowed('diff.customdriver.command'), false);
  assert.equal(launcher.isWorkerConfigKeyAllowed('diff.external'), false);

  // validateWorkerGitConfig must reject diff.<driver>.textconv
  assert.throws(
    () => launcher.validateWorkerGitConfig(f.root),
    /WORKER_COMMIT_FAILED: forbidden worker git config: diff\.customdriver\.textconv/
  );

  // commitWorkerMetadata must reject before invoking the hook or executing textconv
  assert.throws(
    () => commitMetadata(f),
    /WORKER_COMMIT_FAILED: forbidden worker git config: diff\.customdriver\.textconv/
  );

  // commitNativeWriterChanges must also reject before invoking the hook or executing textconv
  assert.throws(
    () =>
      launcher.commitNativeWriterChanges({
        hostRoot: f.root,
        workerRoot: f.root,
        workItemId: 'GOAL-FIXTURE',
      }),
    /NATIVE_WRITER_COMMIT_FAILED: forbidden worker git config: diff\.customdriver\.textconv/
  );

  // The textconv command must NEVER have executed and HEAD must remain unchanged
  assert.equal(fs.existsSync(marker), false, 'textconv command should not have executed');
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.head);
});

test('a non-regular worker config file fails closed before git parses it', (t) => {
  const f = fixture(t);
  writeHook(f.hook, 'exit 0');
  fs.mkdirSync(path.join(f.root, '.git', 'config.worktree'));
  assert.throws(
    () => commitMetadata(f),
    /WORKER_COMMIT_FAILED: worker git config is not a regular file/
  );
});

test('worker config parse is bounded by the dispatch-configured timeout and fails closed on expiry', (t) => {
  const f = fixture(t);
  writeHook(f.hook, 'exit 0');
  const configured = require('../sources.json').dispatch.gitConfigCheckTimeoutMs;
  const original = cp.spawnSync;
  const seen = [];
  t.mock.method(cp, 'spawnSync', (cmd, args, options) => {
    if (Array.isArray(args) && args.includes('--no-includes')) {
      seen.push(options && options.timeout);
      return { status: null, signal: 'SIGTERM', error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }) };
    }
    return original(cmd, args, options);
  });
  assert.throws(() => commitMetadata(f), /WORKER_COMMIT_FAILED: invalid worker git config/);
  assert.ok(seen.length > 0);
  assert.ok(seen.every((ms) => ms === configured));
});
