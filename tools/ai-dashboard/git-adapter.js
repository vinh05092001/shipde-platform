/**
 * Ship Dễ — Git & Worktree Adapter
 * TASK-AI-15: AI15-R01, AI15-R05, AI15-R06, AI15-AC07
 * Reads git worktrees, active branches, HEAD commits, and recent log records
 * using fixed, bounded commands and path redaction.
 */

const { execFile } = require('child_process');
const { redactPath } = require('./redaction');

const CMD_TIMEOUT = 5000;
const MAX_BUFFER = 1024 * 1024; // 1 MB limit

function runGitCommand(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: cwd || process.cwd(), timeout: CMD_TIMEOUT, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          success: false,
          exitCode: error.code || 1,
          stdout: stdout ? stdout.trim() : '',
          stderr: stderr ? stderr.trim() : error.message
        });
      } else {
        resolve({
          success: true,
          exitCode: 0,
          stdout: stdout ? stdout.trim() : '',
          stderr: ''
        });
      }
    });
  });
}

function parseWorktreesPorcelain(output) {
  if (!output) return [];
  const lines = output.split('\n');
  const worktrees = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current && current.path) {
        worktrees.push(current);
        current = null;
      }
      continue;
    }

    if (line.startsWith('worktree ')) {
      if (current && current.path) {
        worktrees.push(current);
      }
      current = {
        path: redactPath(line.substring('worktree '.length).trim()),
        head: '',
        branch: '',
        isDetached: false
      };
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.substring('HEAD '.length).trim();
      current.headShort = current.head.substring(0, 7);
    } else if (current && line.startsWith('branch refs/heads/')) {
      current.branch = line.substring('branch refs/heads/'.length).trim();
    } else if (current && line === 'detached') {
      current.isDetached = true;
      current.branch = '(detached HEAD)';
    }
  }

  if (current && current.path) {
    worktrees.push(current);
  }

  return worktrees;
}

function parseCommits(logOutput) {
  if (!logOutput) return [];
  const lines = logOutput.split('\n');
  const commits = [];

  // Author email is intentionally never requested from git log (PII minimization).
  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length >= 4) {
      commits.push({
        hash: parts[0],
        hashShort: parts[0].substring(0, 7),
        authorName: parts[1],
        date: parts[2],
        message: parts.slice(3).join('|')
      });
    }
  }

  return commits;
}

async function collectGitState(cwd) {
  const startTime = Date.now();
  const workDir = cwd || process.cwd();

  try {
    const [branchRes, headRes, statusRes, worktreeRes, logRes] = await Promise.all([
      runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], workDir),
      runGitCommand(['rev-parse', 'HEAD'], workDir),
      runGitCommand(['status', '--porcelain'], workDir),
      runGitCommand(['worktree', 'list', '--porcelain'], workDir),
      runGitCommand(['log', '-n', '10', '--format=%H|%an|%aI|%s'], workDir)
    ]);

    if (!headRes.success && !branchRes.success) {
      return {
        health: {
          name: 'git',
          status: 'unavailable',
          observedAt: new Date().toISOString(),
          latencyMs: Date.now() - startTime,
          provenance: 'git CLI',
          impact: 'Cannot determine git branch or worktree state',
          error: headRes.stderr || 'Git repository unreachable'
        },
        data: {
          currentBranch: 'unknown',
          headOid: '',
          headOidShort: '',
          dirtyCount: 0,
          worktrees: [],
          recentCommits: []
        }
      };
    }

    const currentBranch = branchRes.stdout || 'unknown';
    const headOid = headRes.stdout || '';
    const headOidShort = headOid.substring(0, 7);

    // Count dirty files
    const dirtyLines = statusRes.stdout ? statusRes.stdout.split('\n').filter(l => l.trim().length > 0) : [];
    const dirtyCount = dirtyLines.length;

    const worktrees = parseWorktreesPorcelain(worktreeRes.stdout);
    const recentCommits = parseCommits(logRes.stdout);

    return {
      health: {
        name: 'git',
        status: 'live',
        observedAt: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
        provenance: `git status/worktree at ${redactPath(workDir)}`,
        impact: 'None — git observations verified',
        error: null
      },
      data: {
        currentBranch,
        headOid,
        headOidShort,
        dirtyCount,
        dirtyFiles: dirtyLines.slice(0, 10).map(l => redactPath(l)),
        worktrees,
        recentCommits
      }
    };
  } catch (err) {
    return {
      health: {
        name: 'git',
        status: 'unavailable',
        observedAt: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
        provenance: 'git CLI',
        impact: 'Git command invocation failed',
        error: err.message
      },
      data: {
        currentBranch: 'unknown',
        headOid: '',
        headOidShort: '',
        dirtyCount: 0,
        worktrees: [],
        recentCommits: []
      }
    };
  }
}

module.exports = {
  runGitCommand,
  parseWorktreesPorcelain,
  parseCommits,
  collectGitState
};
