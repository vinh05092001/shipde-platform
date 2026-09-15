'use strict';

/**
 * Ship Dễ — Verifiable Facts
 *
 * Everything here answers a question about the repository with something a
 * machine can re-derive: a commit exists, a file exists, a branch exists, a
 * test run exited zero. Nothing in this module asks a model, and nothing here
 * accepts a claim as input.
 *
 * This is the half of the brain that cannot be talked into agreeing. A model
 * may assert that a Work Item is merged; only `isAncestorOf` can say whether
 * the commit it named is actually reachable from main.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const GIT_TIMEOUT_MS = 10000;
const MAX_BUFFER = 8 * 1024 * 1024;

function git(args, cwd) {
  try {
    const stdout = execFileSync('git', args, {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: stdout.trim() };
  } catch (e) {
    return { ok: false, out: '', err: e && e.message ? e.message : String(e) };
  }
}

/** True when `sha` names an object that exists in this repository. */
function commitExists(sha, cwd) {
  if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) return false;
  return git(['cat-file', '-e', sha + '^{commit}'], cwd).ok;
}

/**
 * True when `sha` is reachable from `ref`. This is the check that separates a
 * merged Work Item from one that merely has a commit somewhere: a commit can
 * exist on an abandoned branch and still be quoted as evidence of delivery.
 */
function isAncestorOf(sha, ref, cwd) {
  if (!commitExists(sha, cwd)) return false;
  const result = git(['merge-base', '--is-ancestor', sha, ref], cwd);
  return result.ok;
}

function branchExists(branch, cwd) {
  if (!branch) return false;
  const local = git(['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch], cwd);
  if (local.ok && local.out) return true;
  const remote = git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + branch], cwd);
  return Boolean(remote.ok && remote.out);
}

function fileExists(relPath, rootDir) {
  if (!relPath) return false;
  const root = rootDir || process.cwd();
  const resolved = path.resolve(root, relPath);
  // Refuse to answer about anything outside the repository: a Work Item path
  // that escapes the tree is itself the finding.
  if (!resolved.startsWith(path.resolve(root))) return false;
  try {
    return fs.statSync(resolved).isFile();
  } catch (e) {
    return false;
  }
}

/** Commits touching a path, newest first. Used to check that work left traces. */
function commitsTouching(relPath, limit, cwd) {
  const n = Number(limit) > 0 ? Number(limit) : 20;
  const result = git(['log', '--format=%H%x1f%s', '-n', String(n), '--', relPath], cwd);
  if (!result.ok || !result.out) return [];
  return result.out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split('');
      return { sha, subject: subject || '' };
    });
}

function currentBranch(cwd) {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return r.ok ? r.out : null;
}

function headSha(ref, cwd) {
  const r = git(['rev-parse', ref || 'HEAD'], cwd);
  return r.ok ? r.out : null;
}

/**
 * Runs a command and reports only whether it succeeded, plus its tail.
 *
 * A brain that trusts "tests pass" because a model said so has learned
 * nothing. This runs them.
 */
function runCheck(command, args, options) {
  const opts = options || {};
  const started = Date.now();
  try {
    const stdout = execFileSync(command, args || [], {
      cwd: opts.cwd || process.cwd(),
      encoding: 'utf8',
      timeout: opts.timeoutMs || 120000,
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      passed: true,
      exitCode: 0,
      durationMs: Date.now() - started,
      tail: lastLines(stdout, 12),
    };
  } catch (e) {
    return {
      passed: false,
      exitCode: typeof e.status === 'number' ? e.status : 1,
      durationMs: Date.now() - started,
      tail: lastLines(String((e.stdout || '') + (e.stderr || '') || e.message || ''), 12),
    };
  }
}

function lastLines(text, count) {
  const lines = String(text || '')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  return lines.slice(-count).join('\n');
}

module.exports = {
  git,
  commitExists,
  isAncestorOf,
  branchExists,
  fileExists,
  commitsTouching,
  currentBranch,
  headSha,
  runCheck,
  lastLines,
};
