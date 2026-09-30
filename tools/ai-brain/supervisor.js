'use strict';

/**
 * Ship Dễ — Session supervisor (TASK-AI-60, dry-run level).
 *
 * Classifies a session from real progress signals: diff, commits, tests, log
 * growth, tool activity, process tree, heartbeat and repeated errors. An empty
 * SUCCESS is COMPLETED_EMPTY, never a completion with an artifact; a dead
 * process with an empty log is FAILED; a live session that stopped making
 * progress is STALLED.
 */

const { progressVerdict, ProgressStatus } = require('./harness');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const Status = Object.freeze({
  RUNNING_WITH_PROGRESS: 'RUNNING_WITH_PROGRESS',
  STALLED: 'STALLED',
  FAILED: 'FAILED',
  COMPLETED_WITH_ARTIFACT: 'COMPLETED_WITH_ARTIFACT',
  COMPLETED_EMPTY: 'COMPLETED_EMPTY',
  UNKNOWN: 'UNKNOWN',
});

function withCleanGitEnv(cwd, fn) {
  const tmpDir = path.join(os.tmpdir(), 'shipde-git-safe-' + crypto.randomBytes(4).toString('hex'));
  spawnSync('git', ['init', tmpDir], { windowsHide: true });
  const gitDir = path.join(tmpDir, '.git');
  fs.mkdirSync(path.join(gitDir, 'objects', 'info'), { recursive: true });
  fs.writeFileSync(
    path.join(gitDir, 'config'),
    '[core]\n\trepositoryFormatVersion = 0\n\tbare = false\n'
  );

  const workerGitDir =
    spawnSync('git', ['-C', cwd, 'rev-parse', '--absolute-git-dir'], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout.trim() || path.join(cwd, '.git');
  const workerCommonDirRaw = spawnSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    windowsHide: true,
  }).stdout.trim();
  const workerCommonDir = workerCommonDirRaw ? path.resolve(cwd, workerCommonDirRaw) : workerGitDir;

  const workerObjects = path.join(workerGitDir, 'objects');
  if (fs.existsSync(workerObjects)) {
    fs.writeFileSync(
      path.join(gitDir, 'objects', 'info', 'alternates'),
      workerObjects.replace(/\\/g, '/')
    );
  }

  const copyIf = (srcDir, destDir, name) => {
    const src = path.join(srcDir, name);
    if (fs.existsSync(src)) {
      if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, path.join(destDir, name), { recursive: true, force: true });
      } else {
        fs.copyFileSync(src, path.join(destDir, name));
      }
    }
  };

  copyIf(workerGitDir, gitDir, 'HEAD');
  copyIf(workerGitDir, gitDir, 'index');

  // Refs might be in common dir for worktrees
  copyIf(workerCommonDir, gitDir, 'refs');
  copyIf(workerCommonDir, gitDir, 'packed-refs');

  try {
    return fn(gitDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function safeGit(tmpDir, cwd, args, timeoutMs) {
  const safeArgs = ['--git-dir=' + tmpDir, '--work-tree=' + cwd, ...args];
  return spawnSync('git', safeArgs, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs || 20000,
    maxBuffer: 16 * 1024 * 1024,
    env: Object.assign({}, process.env, {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    }),
  });
}

/**
 * The progress markers, measured HOST-SIDE from the worker's own repository.
 *
 * The audit found that nothing computed the seven markers `progressVerdict`
 * reads: a repository-wide grep for diffBytes/toolCalls/logBytes/toolActivity
 * hit only harness.js and two test files. So a live session had no progress
 * signal and the supervisor could only ever guess.
 *
 * This is the honest producer, and it is deliberately not the harness's word:
 * the worker is untrusted, so a session that reports its own progress is a
 * session that can report progress while doing nothing. It measures the
 * worktree the worker actually changed — the diff against the pinned base (which
 * counts both its commits and its uncommitted edits) and the commit count — so
 * the markers mean something even when the worker's own report is a lie.
 *
 * `lastProgressAt` is the newest commit date when there is one, and otherwise
 * the mtime of the worktree's index, which moves on any write. It is a
 * progress heuristic, not an identity claim, and a session that produces work
 * without any of it still reads as stalled — conservative in the safe direction.
 */
function progressFromWorkerRoot(cwd, options) {
  const o = options || {};
  const base = typeof o.baseSha === 'string' && o.baseSha ? o.baseSha : null;
  if (!cwd) return { diffBytes: 0, commits: 0, lastProgressAt: null };

  return withCleanGitEnv(cwd, (tmpDir) => {
    const git = (args) => safeGit(tmpDir, cwd, args, 20000);

    const patch = git(['diff', base || 'HEAD', '--no-ext-diff', '--no-textconv']);
    const diffBytes = patch.status === 0 ? Buffer.byteLength(patch.stdout || '', 'utf8') : 0;

    const counted = git(['rev-list', '--count', base ? base + '..HEAD' : 'HEAD']);
    const commits = counted.status === 0 ? Number(String(counted.stdout || '').trim()) || 0 : 0;

    let lastProgressAt = null;
    if (commits > 0) {
      const when = git(['log', '-1', '--format=%cI']);
      if (when.status === 0) lastProgressAt = String(when.stdout || '').trim() || null;
    }
    if (!lastProgressAt) {
      try {
        lastProgressAt = new Date(
          fs.statSync(path.join(cwd, '.git', 'index')).mtimeMs
        ).toISOString();
      } catch (e) {
        lastProgressAt = null;
      }
    }

    return { diffBytes, commits, lastProgressAt };
  });
}

function hasArtifact(session) {
  if (!session) return false;
  if (session.artifact) return true;
  return Array.isArray(session.artifacts) && session.artifacts.length > 0;
}

/**
 * @param session {
 *   exitCode?, dead?, processTreeGone?, output?, stdout?, artifact?, artifacts?,
 *   startedAt?, lastProgressAt?, progress?, heartbeats?, repeatedErrors?
 * }
 * @param opts  passed through to progressVerdict (stallMs, now)
 */
function classifySession(session, opts) {
  const s = session || {};
  const output = s.output !== undefined ? s.output : s.stdout !== undefined ? s.stdout : '';
  const text = String(output || '').trim();

  // A clean exit is success; the question is only whether it produced anything.
  if (s.exitCode === 0) {
    if (hasArtifact(s) || text.length > 0) return Status.COMPLETED_WITH_ARTIFACT;
    return Status.COMPLETED_EMPTY;
  }

  const dead =
    s.dead === true ||
    s.processTreeGone === true ||
    (s.exitCode !== undefined && s.exitCode !== null && Number(s.exitCode) !== 0);

  if (dead) return Status.FAILED;

  // Still alive: judge progress from real signals.
  const verdict = progressVerdict(s, opts);
  if (verdict.status === ProgressStatus.STALLED) return Status.STALLED;
  if (verdict.status === ProgressStatus.RUNNING_WITH_PROGRESS) {
    return Status.RUNNING_WITH_PROGRESS;
  }
  return Status.UNKNOWN;
}

module.exports = { Status, classifySession, progressFromWorkerRoot, withCleanGitEnv, safeGit };
