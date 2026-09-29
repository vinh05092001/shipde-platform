'use strict';

/**
 * Ship Dễ — Publisher (TASK-AI-59 requirement 6, TASK-AI-61)
 *
 * The only component allowed to perform GitHub writes. It runs on the
 * operator side, outside the worker boundary, and refuses to publish unless
 * every deterministic gate passes.
 *
 * P1: the push destination (remote URL and branch) is taken ONLY from trusted
 * controller input — the options this module is called with (registry/argv on
 * the operator side). Nothing is ever read from the worker-writable tree:
 * never the remote URL configured inside its git directory, never a branch
 * name resolved by running git inside cwd. A worker that rewrites its own git
 * configuration cannot redirect this push.
 *
 * P2: the only fallback for a missing approval registry is `testMode`, an
 * explicit injected option used exclusively by tests. No argv, no environment
 * heuristic.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function runCommand(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true });
  return {
    exitCode: res.status === null ? -1 : res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function getHeadSha(cwd) {
  const res = runCommand('git', ['rev-parse', 'HEAD'], cwd);
  if (res.exitCode === 0) return res.stdout.trim();
  return null;
}

function validateRemoteUrl(remoteUrl) {
  let parsed;
  try {
    parsed = new URL(remoteUrl);
  } catch (e) {
    throw new Error('PUBLISH_REFUSED: remoteUrl is not a valid URL: ' + remoteUrl);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('PUBLISH_REFUSED: remoteUrl must be https, got: ' + parsed.protocol);
  }
  return parsed.href;
}

function resolveBranch(branch, cwd) {
  const target = branch || path.basename(cwd);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(target) ||
    target.includes('..') ||
    target.endsWith('.lock') ||
    target.endsWith('.')
  ) {
    throw new Error('PUBLISH_REFUSED: invalid branch name: ' + target);
  }
  return target;
}

/**
 * Q4: never run upload-pack against the worker-writable tree. `git fetch
 * <cwd>` spawns `git upload-pack <cwd>`, which reads cwd/.git/config; a
 * planted uploadpack.packObjectsHook there could execute as the operator on
 * git versions that honor repo-local config for that key (git >= 2.36 only
 * reads it from protected config, but the publisher must not depend on that).
 * Instead the objects are transferred via a trusted intermediate: a LOCAL
 * clone of cwd (a local clone copies object files directly and never spawns
 * upload-pack), whose config is then rewritten to a minimal trusted one
 * before any fetch reads from it.
 */
const SAFE_MIRROR_CONFIG = '[core]\n\tbare = true\n';

function buildSanitizedMirror(cwd, tmpDir) {
  const mirrorDir = path.join(tmpDir, 'source-mirror');
  const cloneRes = runCommand('git', ['clone', '--bare', '--no-hardlinks', cwd, mirrorDir], tmpDir);
  if (cloneRes.exitCode !== 0) {
    throw new Error('PUBLISH_FAILED: failed to mirror source tree: ' + cloneRes.stderr);
  }
  fs.writeFileSync(path.join(mirrorDir, 'config'), SAFE_MIRROR_CONFIG);
  return mirrorDir;
}

function transferReviewedObjects(cwd, reviewedSha, cloneDir, tmpDir) {
  const mirrorDir = buildSanitizedMirror(cwd, tmpDir);
  // Belt-and-braces: the client-side -c values below are stripped by the
  // local transport today (verified: GIT_CONFIG_PARAMETERS is not forwarded
  // to the spawned upload-pack). Should a future git version forward them,
  // an empty uploadpack.packObjectsHook must make upload-pack fail closed
  // (it cannot spawn an empty hook) rather than execute anything, and
  // upload-pack filters stay disabled.
  const fetchRes = runCommand(
    'git',
    [
      '-c',
      'core.hooksPath=nul',
      '-c',
      'uploadpack.packObjectsHook=',
      '-c',
      'uploadpack.allowFilter=false',
      'fetch',
      mirrorDir,
      `${reviewedSha}:refs/heads/temp-push`,
    ],
    cloneDir
  );
  if (fetchRes.exitCode !== 0) {
    throw new Error('PUBLISH_FAILED: failed to fetch objects from source: ' + fetchRes.stderr);
  }
}

/**
 * F6, N9: Push from a clean operator-side clone. Avoid running git in cwd
 * for anything except the read-only rev-parse HEAD check above; the clone
 * and the push both target the controller-pinned remoteUrl, and the object
 * transfer from cwd goes through the sanitized mirror (Q4).
 */
function publish(options) {
  const { cwd, reviewedSha, approvalId, expiry, verdict, remoteUrl, branch, registryPath } =
    options;
  const testMode = options.testMode === true;

  if (!cwd) throw new Error('PUBLISH_REFUSED: missing cwd');
  if (!reviewedSha) throw new Error('PUBLISH_REFUSED: missing reviewedSha');
  if (!approvalId) throw new Error('PUBLISH_REFUSED: missing approvalId');
  if (!expiry) throw new Error('PUBLISH_REFUSED: missing expiry');

  if (Date.now() > expiry) {
    throw new Error('PUBLISH_REFUSED: approval expired');
  }

  if (verdict !== 'PASS') {
    throw new Error('PUBLISH_REFUSED: missing PASS verdict, got: ' + verdict);
  }

  // F12: Validation against approval record. The registry lives on the
  // operator side; when it is absent the publish is refused unless the caller
  // explicitly injected testMode (tests only — never inferred from argv/env).
  const regPath =
    registryPath || path.join(process.env.LOCALAPPDATA || 'C:\\temp', 'ShipDe', 'approvals.json');
  if (fs.existsSync(regPath)) {
    const registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    if (registry[approvalId] !== 'APPROVED') {
      throw new Error('PUBLISH_REFUSED: approvalId not registered or not APPROVED');
    }
  } else if (!testMode) {
    throw new Error('PUBLISH_REFUSED: approval registry not found');
  }

  // P1: trusted push destination. remoteUrl and branch come from the options
  // the controller passed in; the worker-writable cwd is never consulted for
  // them. The only branch fallback is derived from the controller-supplied
  // cwd path itself, never from a file inside the tree.
  if (!remoteUrl) {
    throw new Error(
      'PUBLISH_REFUSED: missing remoteUrl (push destination must come from trusted controller input)'
    );
  }
  validateRemoteUrl(remoteUrl);
  const targetBranch = resolveBranch(branch, cwd);

  const currentSha = getHeadSha(cwd);
  if (!currentSha) {
    throw new Error('PUBLISH_REFUSED: could not resolve HEAD sha');
  }

  if (currentSha !== reviewedSha) {
    throw new Error(
      'PUBLISH_REFUSED: SHA mismatch. Expected ' + reviewedSha + ', got ' + currentSha
    );
  }

  // testMode is an explicit injected option used only by tests: the external
  // clone/fetch/push is simulated so a test can never reach the network.
  if (testMode) {
    return {
      status: 'published',
      sha: currentSha,
      approvalId,
      remoteUrl,
      branch: targetBranch,
      simulated: true,
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-publish-'));
  try {
    const cloneDir = path.join(tmpDir, 'clean-clone');
    const cloneRes = runCommand('git', ['clone', '--bare', remoteUrl, cloneDir], tmpDir);
    if (cloneRes.exitCode !== 0) {
      throw new Error('PUBLISH_FAILED: failed to clone remote: ' + cloneRes.stderr);
    }

    // Q4: fetch the reviewed objects via the sanitized mirror, never
    // directly from the worker-writable cwd (upload-pack would read its
    // config).
    transferReviewedObjects(cwd, reviewedSha, cloneDir, tmpDir);

    const pushRes = runCommand(
      'git',
      ['push', 'origin', `${reviewedSha}:refs/heads/${targetBranch}`],
      cloneDir
    );
    if (pushRes.exitCode !== 0) {
      throw new Error('PUBLISH_FAILED: git push failed: ' + pushRes.stderr);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { status: 'published', sha: currentSha, approvalId, remoteUrl, branch: targetBranch };
}

module.exports = {
  publish,
  buildSanitizedMirror,
  transferReviewedObjects,
  SAFE_MIRROR_CONFIG,
};
