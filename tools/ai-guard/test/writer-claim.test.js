/**
 * Ship Dễ — Single-Writer Claim Guard Test Suite
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { execFileSync } = require('child_process');

const {
  readClaims,
  writeClaim,
  releaseClaim,
  checkWrite,
  claimPath,
  defaultOwner,
  getHookStatus,
  installHook,
  uninstallHook,
} = require('../writer-claim');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-claim-'));
}

const aoSession = (id, branch, harness) => ({
  source: 'ao',
  id,
  branch,
  harness: harness || 'agy',
  kind: 'worker',
  state: 'idle',
  lastActivityAt: '2026-09-13T14:37:31Z',
});

describe('Single-writer claim guard', () => {
  describe('Claim lifecycle', () => {
    test('a written claim is read back', () => {
      const dir = tempDir();
      writeClaim({ branch: 'feat/x', owner: 'alice', dir });
      const claims = readClaims(dir);
      assert.equal(claims.length, 1);
      assert.equal(claims[0].branch, 'feat/x');
      assert.equal(claims[0].owner, 'alice');
    });

    test('a branch name with slashes maps to one flat file', () => {
      const dir = tempDir();
      writeClaim({ branch: 'feat/deep/nested/name', owner: 'a', dir });
      const file = claimPath('feat/deep/nested/name', dir);
      assert.equal(path.dirname(file), dir, 'no nested directories created');
      assert.ok(fs.existsSync(file));
    });

    test('an expired claim is dropped on read, so a crashed session frees its branch', () => {
      const dir = tempDir();
      writeClaim({ branch: 'feat/stale', owner: 'ghost', dir, ttlMinutes: 60 });
      const file = claimPath('feat/stale', dir);
      const claim = JSON.parse(fs.readFileSync(file, 'utf8'));
      claim.expiresAt = new Date(Date.now() - 1000).toISOString();
      fs.writeFileSync(file, JSON.stringify(claim), 'utf8');

      assert.equal(readClaims(dir).length, 0, 'expired claim not reported');
      assert.equal(fs.existsSync(file), false, 'and removed from disk');
    });

    test('a corrupt claim file is skipped rather than throwing', () => {
      const dir = tempDir();
      fs.writeFileSync(path.join(dir, 'garbage.json'), '{not json', 'utf8');
      writeClaim({ branch: 'feat/ok', owner: 'a', dir });
      assert.equal(readClaims(dir).length, 1);
    });

    test('releasing removes the claim and is safe to repeat', () => {
      const dir = tempDir();
      writeClaim({ branch: 'feat/y', owner: 'a', dir });
      assert.equal(releaseClaim('feat/y', dir), true);
      assert.equal(releaseClaim('feat/y', dir), false, 'second release is a no-op, not an error');
      assert.equal(readClaims(dir).length, 0);
    });

    test('claiming requires a branch and an owner', () => {
      const dir = tempDir();
      assert.throws(() => writeClaim({ owner: 'a', dir }), /branch is required/);
      assert.throws(() => writeClaim({ branch: 'b', dir }), /owner is required/);
    });
  });

  describe('Write checks', () => {
    test('allows a branch nobody holds', async () => {
      const result = await checkWrite({
        branch: 'feat/free',
        owner: 'me',
        aoHolders: [],
        claims: [],
      });
      assert.equal(result.allowed, true);
      assert.equal(result.holders.length, 0);
    });

    test('blocks the exact collision that happened on TASK-AI-15', async () => {
      const result = await checkWrite({
        branch: 'feat/task-ai-15-realtime-ai-cockpit',
        owner: 'direct-terminal',
        aoHolders: [aoSession('shipde-platform-14', 'feat/task-ai-15-realtime-ai-cockpit')],
        claims: [],
      });
      assert.equal(result.allowed, false);
      assert.match(result.reason, /shipde-platform-14/);
      assert.equal(result.holders[0].harness, 'agy');
    });

    test('does not block the holder from its own branch', async () => {
      const result = await checkWrite({
        branch: 'feat/mine',
        owner: 'shipde-platform-14',
        aoHolders: [aoSession('shipde-platform-14', 'feat/mine')],
        claims: [],
      });
      assert.equal(result.allowed, true, 'a session is never blocked by itself');
    });

    test('a holder on a different branch is irrelevant', async () => {
      const result = await checkWrite({
        branch: 'feat/a',
        owner: 'me',
        aoHolders: [aoSession('other', 'feat/b')],
        claims: [],
      });
      assert.equal(result.allowed, true);
    });

    test('a direct claim blocks an AO session just as an AO session blocks a direct one', async () => {
      const result = await checkWrite({
        branch: 'feat/shared',
        owner: 'shipde-platform-14',
        aoHolders: [],
        claims: [
          { source: 'claim', branch: 'feat/shared', owner: 'direct-terminal', harness: 'direct' },
        ],
      });
      assert.equal(result.allowed, false, 'the guard is symmetric across both kinds of session');
      assert.match(result.reason, /direct-terminal/);
    });

    test('refuses main and master outright', async () => {
      for (const branch of ['main', 'master']) {
        const result = await checkWrite({ branch, owner: 'me', aoHolders: [], claims: [] });
        assert.equal(result.allowed, false, branch + ' is refused');
        assert.match(result.reason, /nhánh riêng/);
      }
    });

    test('reports every holder when more than one exists', async () => {
      const result = await checkWrite({
        branch: 'feat/crowded',
        owner: 'me',
        aoHolders: [
          aoSession('s1', 'feat/crowded'),
          aoSession('s2', 'feat/crowded', 'claude-code'),
        ],
        claims: [{ source: 'claim', branch: 'feat/crowded', owner: 'direct', harness: 'direct' }],
      });
      assert.equal(result.allowed, false);
      assert.equal(result.holders.length, 3);
    });

    test('an unknown branch degrades rather than blocking', async () => {
      const result = await checkWrite({
        branch: null,
        cwd: os.tmpdir(),
        owner: 'me',
        aoHolders: [],
        claims: [],
      });
      assert.equal(result.allowed, true, 'a guard that cannot tell must not stop work');
      assert.equal(result.degraded, true);
    });
  });

  describe('Owner identity resolution (defaultOwner)', () => {
    test('resolves AO_SESSION_ID in an AO worker session', () => {
      const owner = defaultOwner({ AO_SESSION_ID: 'shipde-platform-17' });
      assert.equal(owner, 'shipde-platform-17');
    });

    test('resolves AO_REVIEW_WORKER_SESSION_ID in an AO review session to match the branch holder', () => {
      const owner = defaultOwner({
        AO_REVIEW_SESSION_ID: 'shipde-platform-review-99',
        AO_REVIEW_WORKER_SESSION_ID: 'shipde-platform-16',
      });
      assert.equal(owner, 'shipde-platform-16');
    });

    test('resolves AO_REVIEW_SESSION_ID in an AO review session when worker ID is unset', () => {
      const owner = defaultOwner({ AO_REVIEW_SESSION_ID: 'shipde-platform-review-99' });
      assert.equal(owner, 'shipde-platform-review-99');
    });

    test('resolves CLAUDE_CODE_SESSION_ID in a direct Claude Code session', () => {
      const owner = defaultOwner({
        CLAUDE_CODE_SESSION_ID: '35ef22e6-5564-4b4c-8a01-e6f94103e817',
      });
      assert.equal(owner, '35ef22e6-5564-4b4c-8a01-e6f94103e817');
    });

    test('resolves legacy CLAUDE_SESSION_ID if present', () => {
      const owner = defaultOwner({ CLAUDE_SESSION_ID: 'legacy-claude-session' });
      assert.equal(owner, 'legacy-claude-session');
    });

    test('SHIPDE_WRITER override takes precedence over all other variables', () => {
      const owner = defaultOwner({
        SHIPDE_WRITER: 'manual-operator-override',
        AO_SESSION_ID: 'shipde-platform-17',
        AO_REVIEW_WORKER_SESSION_ID: 'shipde-platform-16',
        AO_REVIEW_SESSION_ID: 'shipde-platform-review-99',
        CLAUDE_CODE_SESSION_ID: '35ef22e6-5564-4b4c-8a01-e6f94103e817',
      });
      assert.equal(owner, 'manual-operator-override');
    });

    test('precedence hierarchy across session types is strictly maintained', () => {
      // AO_SESSION_ID beats AO_REVIEW_WORKER_SESSION_ID
      assert.equal(
        defaultOwner({ AO_SESSION_ID: 'worker-1', AO_REVIEW_WORKER_SESSION_ID: 'worker-2' }),
        'worker-1'
      );
      // AO_REVIEW_WORKER_SESSION_ID beats AO_REVIEW_SESSION_ID
      assert.equal(
        defaultOwner({ AO_REVIEW_WORKER_SESSION_ID: 'worker-2', AO_REVIEW_SESSION_ID: 'review-1' }),
        'worker-2'
      );
      // AO_REVIEW_SESSION_ID beats CLAUDE_CODE_SESSION_ID
      assert.equal(
        defaultOwner({ AO_REVIEW_SESSION_ID: 'review-1', CLAUDE_CODE_SESSION_ID: 'cc-1' }),
        'review-1'
      );
      // CLAUDE_CODE_SESSION_ID beats CLAUDE_SESSION_ID
      assert.equal(
        defaultOwner({ CLAUDE_CODE_SESSION_ID: 'cc-1', CLAUDE_SESSION_ID: 'legacy-1' }),
        'cc-1'
      );
    });

    test('falls back to host username@hostname when no variables are present', () => {
      const owner = defaultOwner({});
      assert.match(owner, /@.+/);
      assert.ok(!owner.includes('undefined'));
    });
  });

  describe('Git hook installation lifecycle', () => {
    test('reports not installed when no hook exists and no override is set', () => {
      const repoDir = tempDir();
      execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
      const status = getHookStatus({ cwd: repoDir });
      assert.equal(status.installed, false);
      assert.equal(status.hooksPath, null);
      assert.equal(status.hookManager, null);
      assert.deepEqual(status.remediation, ['pnpm lefthook install']);
    });

    test('a legacy .githooks override is detected but flagged for retirement', () => {
      const repoDir = tempDir();
      execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
      fs.mkdirSync(path.join(repoDir, '.githooks'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
      execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repoDir });

      const status = getHookStatus({ cwd: repoDir });
      assert.equal(status.installed, true, 'the hook behind the override does run');
      assert.equal(status.hookManager, 'legacy-githooks');
      assert.equal(status.legacyOverride, true);
      assert.equal(status.hooksPath, '.githooks');
      assert.equal(status.configuredOnly, false);
    });

    test('installHook retires the override and installs the Lefthook hook', () => {
      const repoDir = tempDir();
      execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
      fs.mkdirSync(path.join(repoDir, '.githooks'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
      execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repoDir });
      fs.writeFileSync(
        path.join(repoDir, 'lefthook.yml'),
        'pre-commit:\n  commands:\n    writer-claim:\n      run: node tools/ai-guard/cli.js check\n'
      );

      const installRes = installHook({ cwd: repoDir });
      assert.equal(installRes.success, true, installRes.error || '');
      assert.equal(installRes.installed, true);
      assert.equal(installRes.retired, '.githooks');

      // The override is gone, so Git reads the common hooks directory again,
      // and the hook living there delegates to Lefthook.
      const hookText = fs.readFileSync(path.join(repoDir, '.git', 'hooks', 'pre-commit'), 'utf8');
      assert.ok(hookText.includes('call_lefthook'), 'the written hook delegates');

      const status = getHookStatus({ cwd: repoDir });
      assert.equal(status.installed, true);
      assert.equal(status.hookManager, 'lefthook');
      assert.equal(status.legacyOverride, false);
      assert.equal(status.hooksPath, null, 'nothing shadows the common hooks dir');
      assert.deepEqual(status.remediation, []);
    });
  });
});

describe('Uninstalling what is already gone is not a failure', () => {
  // `git config --unset` exits 5 when the key is absent. Treating that as an
  // error made `cli.js uninstall` warn and exit non-zero for reaching exactly
  // the state it was asked to reach.
  test('uninstall succeeds when core.hooksPath was never set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-hook-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      const r = uninstallHook({ cwd: dir });
      assert.strictEqual(r.success, true);
      assert.strictEqual(r.alreadyAbsent, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('uninstall retires an existing override and the second pass is already absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-hook-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
      const first = uninstallHook({ cwd: dir });
      assert.strictEqual(first.success, true);
      assert.strictEqual(first.alreadyAbsent, false);
      assert.strictEqual(first.retired, '.githooks');
      assert.strictEqual(first.scope, 'local');
      const second = uninstallHook({ cwd: dir });
      assert.strictEqual(second.success, true);
      assert.strictEqual(second.alreadyAbsent, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('A configured path is not an installed hook', () => {
  test('core.hooksPath pointing at a directory with no pre-commit is not installed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-hook-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      fs.mkdirSync(path.join(dir, '.githooks'));
      execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
      const s = getHookStatus({ cwd: dir });
      assert.strictEqual(s.installed, false);
      assert.strictEqual(s.configuredOnly, true);
      assert.strictEqual(s.hooksPath, '.githooks');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a directory containing pre-commit is installed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-hook-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      fs.mkdirSync(path.join(dir, '.githooks'));
      fs.writeFileSync(path.join(dir, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
      execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
      const s = getHookStatus({ cwd: dir });
      assert.strictEqual(s.installed, true);
      assert.strictEqual(s.configuredOnly, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Where git looks for the hook is where we must look', () => {
  // git resolves a relative core.hooksPath against the working-tree top level.
  // Resolving it against the current directory reported NOT INSTALLED from any
  // subdirectory of a correctly installed repository.
  function repoWithHook() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-sub-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
    fs.mkdirSync(path.join(dir, 'tools', 'deep'), { recursive: true });
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
    return dir;
  }

  test('status from a subdirectory still reports installed', () => {
    const dir = repoWithHook();
    try {
      const s = getHookStatus({ cwd: path.join(dir, 'tools', 'deep') });
      assert.strictEqual(s.installed, true);
      assert.strictEqual(s.configuredOnly, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('status from the top level agrees', () => {
    const dir = repoWithHook();
    try {
      assert.strictEqual(getHookStatus({ cwd: dir }).installed, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('installHook refuses to claim an install it has not verified', () => {
  // Lefthook invents an empty configuration and installs no hook when it
  // finds none; running it blindly would create the file and announce success
  // with nothing guarding the commit (AI-TOOL-10).
  test('a repository without lefthook.yml is refused before any side effect', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-nohook-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      const r = installHook({ cwd: dir });
      assert.strictEqual(r.success, false);
      assert.strictEqual(r.installed, false);
      assert.match(r.error, /lefthook\.yml/);
      assert.ok(!fs.existsSync(path.join(dir, 'lefthook.yml')), 'no config was invented');
      assert.ok(!fs.existsSync(path.join(dir, '.git', 'hooks', 'pre-commit')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an installed hook is verified through the common hooks dir and the config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-hook-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      fs.writeFileSync(
        path.join(dir, 'lefthook.yml'),
        'pre-commit:\n  commands:\n    writer-claim:\n      run: node tools/ai-guard/cli.js check\n'
      );
      const r = installHook({ cwd: dir });
      assert.strictEqual(r.success, true, r.error || '');
      assert.strictEqual(r.installed, true);
      assert.strictEqual(r.hookManager, 'lefthook');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a delegation whose config lost the guard command is not installed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-drift-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      fs.writeFileSync(
        path.join(dir, 'lefthook.yml'),
        'pre-commit:\n  commands:\n    writer-claim:\n      run: node tools/ai-guard/cli.js check\n'
      );
      installHook({ cwd: dir });
      // The config drifts and no longer declares the guard command.
      fs.writeFileSync(path.join(dir, 'lefthook.yml'), 'pre-commit:\n  commands: {}\n');
      const s = getHookStatus({ cwd: dir });
      assert.strictEqual(s.installed, false);
      assert.strictEqual(s.configuredOnly, true);
      assert.strictEqual(s.hookManager, 'lefthook');
      assert.match(s.remediation[0], /Restore .*lefthook\.yml/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
