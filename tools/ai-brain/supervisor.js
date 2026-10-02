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

const Status = Object.freeze({
  RUNNING_WITH_PROGRESS: 'RUNNING_WITH_PROGRESS',
  STALLED: 'STALLED',
  FAILED: 'FAILED',
  COMPLETED_WITH_ARTIFACT: 'COMPLETED_WITH_ARTIFACT',
  COMPLETED_EMPTY: 'COMPLETED_EMPTY',
  UNKNOWN: 'UNKNOWN',
});

function isSubPath(parent, child) {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (process.platform === 'win32') {
    return (
      c.toLowerCase() === p.toLowerCase() || c.toLowerCase().startsWith(p.toLowerCase() + path.sep)
    );
  }
  return c === p || c.startsWith(p + path.sep);
}

function resolveGitDirFromGitfile(cwd, gitPath) {
  const content = fs.readFileSync(gitPath, 'utf8').trim();
  if (!content.startsWith('gitdir:')) {
    return { workerGitDir: gitPath, workerCommonDir: gitPath };
  }
  const p = content.slice(7).trim();
  const workerGitDir = path.resolve(cwd, p);
  let workerCommonDir = workerGitDir;
  const commondirPath = path.join(workerGitDir, 'commondir');
  if (fs.existsSync(commondirPath)) {
    const cstat = fs.lstatSync(commondirPath);
    if (cstat.isFile()) {
      const cp = fs.readFileSync(commondirPath, 'utf8').trim();
      workerCommonDir = path.resolve(workerGitDir, cp);
    }
  }
  if (!isSubPath(cwd, workerGitDir) || !isSubPath(cwd, workerCommonDir)) {
    const backlinkPath = path.join(workerGitDir, 'gitdir');
    let validWorktree = false;
    if (fs.existsSync(backlinkPath)) {
      const backlinkStat = fs.lstatSync(backlinkPath);
      if (backlinkStat.isFile()) {
        const backlinkTarget = fs.readFileSync(backlinkPath, 'utf8').trim();
        if (path.resolve(backlinkTarget) === path.resolve(cwd, '.git')) {
          validWorktree = true;
        }
      }
    }
    if (!validWorktree) {
      return { workerGitDir: gitPath, workerCommonDir: gitPath };
    }
  }
  return { workerGitDir, workerCommonDir };
}

function unresolvedGitDir(cwd) {
  const refused = path.join(cwd, '.git-unresolved');
  return { workerGitDir: refused, workerCommonDir: refused };
}

function resolveWorkerGitDir(cwd, options) {
  const o = options || {};
  const gitPath = path.join(cwd, '.git');
  if (!fs.existsSync(gitPath)) return { workerGitDir: gitPath, workerCommonDir: gitPath };
  const stat = fs.lstatSync(gitPath);
  if (stat.isDirectory()) return { workerGitDir: gitPath, workerCommonDir: gitPath };
  if (o.workerWritable === true) return unresolvedGitDir(cwd);
  if (stat.isFile()) return resolveGitDirFromGitfile(cwd, gitPath);
  return { workerGitDir: gitPath, workerCommonDir: gitPath };
}

function safeCopyObjects(srcDir, destDir) {
  let totalBytes = 0;
  const MAX_BYTES = 500 * 1024 * 1024; // 500 MB bound

  function copyFileIfSafe(src, dest) {
    const stat = fs.lstatSync(src);
    if (!stat.isFile()) throw new Error('PUBLISH_REFUSED: Not a regular file: ' + src);
    totalBytes += stat.size;
    if (totalBytes > MAX_BYTES) throw new Error('PUBLISH_FAILED: Object store exceeds size bound');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  if (!fs.existsSync(srcDir)) return;
  const srcStat = fs.lstatSync(srcDir);
  if (!srcStat.isDirectory()) return;

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && /^[0-9a-f]{2}$/.test(entry.name)) {
      const hexDir = path.join(srcDir, entry.name);
      const destHex = path.join(destDir, entry.name);
      for (const obj of fs.readdirSync(hexDir, { withFileTypes: true })) {
        if (obj.isFile() && /^[0-9a-f]{38}$/.test(obj.name)) {
          copyFileIfSafe(path.join(hexDir, obj.name), path.join(destHex, obj.name));
        }
      }
    } else if (entry.isDirectory() && entry.name === 'pack') {
      const packDir = path.join(srcDir, 'pack');
      const destPack = path.join(destDir, 'pack');
      for (const pack of fs.readdirSync(packDir, { withFileTypes: true })) {
        if (pack.isFile() && /^pack-[0-9a-f]{40}\.(pack|idx|rev)$/.test(pack.name)) {
          copyFileIfSafe(path.join(packDir, pack.name), path.join(destPack, pack.name));
        }
      }
    }
  }
}

function safeCopyRefs(srcDir, destDir) {
  let totalBytes = 0;
  const MAX_BYTES = 50 * 1024 * 1024; // 50MB bound for refs

  function walk(currentSrc, currentDest) {
    if (!fs.existsSync(currentSrc)) return;
    const stat = fs.lstatSync(currentSrc);
    if (!stat.isDirectory()) return;

    const entries = fs.readdirSync(currentSrc, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(currentSrc, entry.name), path.join(currentDest, entry.name));
      } else if (entry.isFile()) {
        const srcPath = path.join(currentSrc, entry.name);
        const stat = fs.lstatSync(srcPath);
        if (!stat.isFile()) continue;
        totalBytes += stat.size;
        if (totalBytes > MAX_BYTES)
          throw new Error('PUBLISH_FAILED: Refs store exceeds size bound');
        fs.mkdirSync(currentDest, { recursive: true });
        fs.copyFileSync(srcPath, path.join(currentDest, entry.name));
      }
    }
  }
  walk(srcDir, destDir);
}

function withCleanGitEnv(cwd, fn, options) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-git-safe-'));
  try {
    spawnSync('git', ['init', tmpDir], { windowsHide: true });
    const gitDir = path.join(tmpDir, '.git');
    fs.mkdirSync(path.join(gitDir, 'objects', 'info'), { recursive: true });
    fs.writeFileSync(
      path.join(gitDir, 'config'),
      '[core]\n\trepositoryFormatVersion = 0\n\tbare = false\n'
    );

    const { workerGitDir, workerCommonDir } = resolveWorkerGitDir(cwd, options);

    const workerObjects = path.join(workerCommonDir, 'objects');
    safeCopyObjects(workerObjects, path.join(gitDir, 'objects'));

    const copyIfSafe = (srcDir, destDir, name) => {
      const src = path.join(srcDir, name);
      if (fs.existsSync(src)) {
        const stat = fs.lstatSync(src);
        if (stat.isFile() && stat.size <= 50 * 1024 * 1024) {
          fs.copyFileSync(src, path.join(destDir, name));
        }
      }
    };

    copyIfSafe(workerGitDir, gitDir, 'HEAD');
    copyIfSafe(workerGitDir, gitDir, 'index');
    copyIfSafe(workerCommonDir, gitDir, 'packed-refs');

    fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
    copyIfSafe(path.join(workerGitDir, 'info'), path.join(gitDir, 'info'), 'exclude');
    copyIfSafe(path.join(workerCommonDir, 'info'), path.join(gitDir, 'info'), 'exclude');

    safeCopyRefs(path.join(workerCommonDir, 'refs'), path.join(gitDir, 'refs'));

    return fn(gitDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function safeGit(tmpDir, cwd, args, timeoutMs) {
  const normCwd = path.resolve(cwd).replace(/\\/g, '/');
  const normTmp = path.resolve(tmpDir).replace(/\\/g, '/');
  const safeArgs = [
    '-c',
    'safe.directory=' + normCwd,
    '-c',
    'safe.directory=' + normTmp,
    '--git-dir=' + tmpDir,
    '--work-tree=' + cwd,
    ...args,
  ];
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

  return withCleanGitEnv(
    cwd,
    (tmpDir) => {
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
    },
    { workerWritable: true }
  );
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

module.exports = {
  Status,
  classifySession,
  progressFromWorkerRoot,
  withCleanGitEnv,
  safeGit,
  resolveWorkerGitDir,
  safeCopyObjects,
};
