'use strict';
// Host-only Git boundaries for the coordinator runtime. Tests inject git; no git write here.
const fs = require('fs');
const path = require('path');
const policy = require('./coordinator');
const { safeText } = require('./coordinator-text');

const REGISTER = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const EXCLUSIONS = ['.', ':(exclude).oc', ':(exclude).serena', ':(exclude).oc-codex-task.md'];

function createGitBoundary({ root, run, options = {} }) {
  const git =
    options.git ||
    (async (cwd, args, allowFailure = false) => {
      const result = await run('git', args, { cwd, timeoutMs: 60000 });
      if (result.exitCode !== 0 && !allowFailure)
        throw new Error('GIT_FAILED: ' + args[0] + ': ' + safeText(result.stderr));
      return result;
    });
  const checked = async (cwd, args) => String((await git(cwd, args)).stdout || '').trim();
  const statusFiles = async (cwd) =>
    String((await git(cwd, ['status', '--porcelain', '--', ...EXCLUSIONS])).stdout || '')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3));
  const hooked =
    options.hookedGit ||
    (async (cwd, args) =>
      require('./isolation-launcher').hookedControllerGit({ workerRoot: cwd, hostRoot: root })(
        args
      ));
  const ownFiles = async (cwd, base = 'origin/main') =>
    (await checked(cwd, ['diff', '--name-only', base + '...HEAD'])).split('\n').filter(Boolean);
  const assertHead = async (cwd, sha) => {
    if ((await checked(cwd, ['rev-parse', 'HEAD'])) !== sha) throw new Error('HEAD_CHANGED');
  };
  const commit = async (item, writer) => {
    const changes = String(
      (await git(item.cwd, ['status', '--porcelain', '--', ...EXCLUSIONS])).stdout || ''
    ).trimEnd();
    if (!changes) return;
    const files = changes.split('\n').map((line) => line.slice(3).replace(/^"|"$/g, ''));
    if (files.some(policy.protectedFile)) throw new Error('PROTECTED_PATH');
    const staged = await checked(item.cwd, ['diff', '--cached', '--name-only']);
    if (
      staged
        .split('\n')
        .some((file) => /^(?:\.oc(?:\/|$)|\.serena(?:\/|$)|\.oc-codex-task\.md$)/.test(file))
    )
      throw new Error('PRIVATE_FILES_STAGED');
    const diff = await git(item.cwd, ['diff', '--check'], true);
    if (diff.exitCode !== 0)
      throw new Error('DIFF_CHECK_FAILED: ' + safeText(diff.stderr || diff.stdout));
    await git(item.cwd, ['add', '-A', '--', ...EXCLUSIONS]);
    await hooked(item.cwd, [
      'commit',
      '-m',
      `[${item.id}] Address review: writer output (${writer.model})`,
    ]);
  };
  const prepare = async (item) => {
    if (await checked(item.cwd, ['status', '--porcelain', '--', ...EXCLUSIONS]))
      return { ok: false, reason: 'DIRTY_WORKTREE' };
    await git(item.cwd, ['fetch', 'origin', 'main']);
    const behind = Number(await checked(item.cwd, ['rev-list', '--count', 'HEAD..origin/main']));
    if (behind) {
      const merged = await git(item.cwd, ['merge', '--no-commit', '--no-ff', 'origin/main'], true);
      if (merged.exitCode !== 0) {
        const conflicts = (await checked(item.cwd, ['diff', '--name-only', '--diff-filter=U']))
          .split('\n')
          .filter(Boolean);
        if (conflicts.length !== 1 || conflicts[0] !== REGISTER) {
          await git(item.cwd, ['merge', '--abort'], true);
          return { ok: false, reason: 'MAIN_MERGE_CONFLICT: ' + conflicts.join(', ') };
        }
        try {
          const ours = await checked(item.cwd, ['show', ':2:' + REGISTER]);
          const theirs = await checked(item.cwd, ['show', ':3:' + REGISTER]);
          fs.writeFileSync(path.join(item.cwd, REGISTER), policy.unionRegister(ours, theirs));
          await git(item.cwd, ['add', '--', REGISTER]);
          const remainingUnmerged = (
            await checked(item.cwd, ['diff', '--name-only', '--diff-filter=U'])
          )
            .split('\n')
            .filter(Boolean);
          const regContent = fs.readFileSync(path.join(item.cwd, REGISTER), 'utf8');
          if (remainingUnmerged.length > 0 || regContent.includes('<<<<<<<')) {
            await git(item.cwd, ['merge', '--abort'], true);
            return {
              ok: false,
              reason:
                'MAIN_MERGE_CONFLICT: ' +
                (remainingUnmerged.length
                  ? remainingUnmerged.join(', ')
                  : 'conflict markers in ' + REGISTER),
            };
          }
        } catch {
          await git(item.cwd, ['merge', '--abort'], true);
          return { ok: false, reason: 'REGISTER_CONFLICT' };
        }
      }
      await hooked(item.cwd, ['commit', '--no-edit']);
    }
    const subjects = (
      await checked(item.cwd, ['log', 'origin/main..HEAD', '--no-merges', '--format=%s'])
    )
      .split('\n')
      .filter(Boolean);
    const files = await ownFiles(item.cwd);
    const whitespace = await git(item.cwd, ['diff', '--check', 'origin/main...HEAD'], true);
    return {
      ...policy.preflight(
        item.id,
        subjects,
        files,
        whitespace.exitCode
          ? 'DIFF_CHECK_FAILED: ' + safeText(whitespace.stderr || whitespace.stdout)
          : ''
      ),
      sha: await checked(item.cwd, ['rev-parse', 'HEAD']),
    };
  };
  return { git, checked, statusFiles, hooked, ownFiles, assertHead, commit, prepare };
}

module.exports = {
  REGISTER,
  EXCLUSIONS,
  createGitBoundary,
};