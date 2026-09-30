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
 *
 * P3: the publisher never runs inside the worker. The worker root is defined
 * once, by isolation-launcher.js, and a `cwd` under it is a refusal with the
 * boundary named — the loop runs this module operator-side, and a call that
 * arrives from the worker is a bug in the call path, not a publish.
 *
 * P4: the publish is authorised by an approval **bound to the commit**. The
 * approval registry is written by approval-registry.js, which only a named
 * human authority can fill in; here the binding is checked, so an approval for
 * one commit can never authorise a push of another.
 *
 * P5: the only Pull Request this module creates is a **draft**. It never marks
 * one ready, never merges, never approves and never comments (AI-64-R13,
 * AI-64-P07).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const approvals = require('./approval-registry');
const { isWorkerPath } = require('./isolation-launcher');

// A reviewed commit is a commit: 40 hex characters. Anything else is a label,
// not evidence (reconcile.js SHA_40, control.ps1 headRefOid).
const SHA_40 = /^[0-9a-f]{40}$/i;

// The terminal verdicts this repository records for a reviewed slice
// (FEATURE-DELIVERY-REGISTER rows 189..192). FALLBACK_PASS is accepted on the
// same terms reconcile.js already states: a named reviewer and an exact
// 40-character reviewed commit, both checked below.
const ACCEPTED_VERDICTS = Object.freeze(['PASS', 'FALLBACK_PASS']);

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
 * clone of cwd. The local clone spawns upload-pack and parses the source config
 * (which is worker-writable), so its config is rewritten to a minimal trusted one
 * before any fetch reads from it. A worker-written include.path can abort the
 * mirror clone (residual risk, surfaced as PUBLISH_FAILED).
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
 * The draft Pull Request shape the register's evidence standard expects: a
 * `[<WORK_ITEM_ID>]` title (reconcile.js) and a head that is the reviewed SHA
 * (control.ps1). It is created as a draft and then verified, because a
 * successful push is not evidence that the Pull Request points at the reviewed
 * commit.
 *
 * Idempotent on the head commit, which is what makes a repeated run for the same
 * `(workItemId, baseSha)` return the Pull Request that already exists instead of
 * opening a second one. GitHub is the record here; no local store is added.
 */
function createDraftPullRequest(options) {
  const o = options || {};
  const { remoteUrl, branch, reviewedSha, workItemId, outcome } = o;
  const title = '[' + String(workItemId || '').trim() + '] ' + String(outcome || 'work item');
  if (!/^\[[A-Za-z0-9-]+\]/.test(title)) {
    throw new Error('PUBLISH_REFUSED: draft title must begin with [<WORK_ITEM_ID>]');
  }
  const body =
    o.body ||
    'Draft opened by the Ship Dễ live loop at the reviewed commit ' +
      reviewedSha +
      '. Reviewer: ' +
      (o.reviewer || 'unrecorded') +
      '. This Pull Request is a proof artifact: the loop never merges it.';

  const existing = ghRun([
    'pr',
    'list',
    '--repo',
    repoOf(remoteUrl),
    '--head',
    branch,
    '--state',
    'all',
    '--json',
    'number,headRefOid,isDraft',
  ]);
  if (existing.exitCode === 0) {
    const list = JSON.parse(existing.stdout || '[]');
    const atSha = (Array.isArray(list) ? list : []).find((p) => p && p.headRefOid === reviewedSha);
    if (atSha) {
      return { status: 'existing_draft', number: atSha.number, headRefOid: reviewedSha, title };
    }
  }

  const created = ghRun([
    'pr',
    'create',
    '--repo',
    repoOf(remoteUrl),
    '--draft',
    '--head',
    branch,
    '--title',
    title,
    '--body',
    body,
  ]);
  if (created.exitCode !== 0) {
    throw new Error('PUBLISH_FAILED: gh pr create failed: ' + created.stderr);
  }

  const number = String(created.stdout || '')
    .trim()
    .split('#')
    .pop()
    .trim();
  const view = ghRun([
    'pr',
    'view',
    number,
    '--repo',
    repoOf(remoteUrl),
    '--json',
    'isDraft,headRefOid,title',
  ]);
  if (view.exitCode !== 0) {
    throw new Error('PUBLISH_FAILED: could not verify the draft Pull Request: ' + view.stderr);
  }
  const evidence = JSON.parse(view.stdout || '{}');
  if (evidence.isDraft !== true) {
    throw new Error('PUBLISH_FAILED: the Pull Request is not a draft');
  }
  if (evidence.headRefOid !== reviewedSha) {
    throw new Error(
      'PUBLISH_FAILED: draft head ' + evidence.headRefOid + ' is not the reviewed commit'
    );
  }
  return { status: 'draft_created', number, headRefOid: evidence.headRefOid, title };
}

/** `owner/name` for a trusted https remote, for gh's --repo flag. */
function repoOf(remoteUrl) {
  const parsed = validateRemoteUrl(remoteUrl);
  const parts = parsed
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  const name = parts[parts.length - 1];
  const owner = parts[parts.length - 2];
  if (!owner || !name) throw new Error('PUBLISH_REFUSED: remoteUrl does not name owner/repo');
  return owner + '/' + name;
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
  const log = typeof options.log === 'function' ? options.log : null;
  const refuse = (message) => {
    // P3/P4: a refusal is logged, not swallowed. The caller sees the throw and
    // a human sees the line.
    if (log) log(message);
    throw new Error(message);
  };

  if (!cwd) refuse('PUBLISH_REFUSED: missing cwd');
  if (isWorkerPath(cwd)) {
    refuse(
      'PUBLISH_REFUSED: refusing to publish from inside the worker root (' +
        String(cwd) +
        '); the publisher runs operator-side only'
    );
  }
  if (!reviewedSha) refuse('PUBLISH_REFUSED: missing reviewedSha');
  if (!SHA_40.test(String(reviewedSha))) {
    refuse('PUBLISH_REFUSED: reviewedSha is not a 40-character commit: ' + reviewedSha);
  }
  if (!approvalId) refuse('PUBLISH_REFUSED: missing approvalId');
  if (!expiry) refuse('PUBLISH_REFUSED: missing expiry');

  if (Date.now() > expiry) {
    refuse('PUBLISH_REFUSED: approval expired');
  }

  if (!ACCEPTED_VERDICTS.includes(verdict)) {
    refuse(
      'PUBLISH_REFUSED: missing PASS verdict, got: ' +
        verdict +
        ' (accepted: ' +
        ACCEPTED_VERDICTS.join(', ') +
        ')'
    );
  }

  // F12: Validation against approval record. The registry lives on the
  // operator side; when it is absent the publish is refused unless the caller
  // explicitly injected testMode (tests only — never inferred from argv/env).
  const regPath = approvals.registryPath(registryPath);
  if (fs.existsSync(regPath)) {
    const registry = approvals.readRegistry(regPath);
    const entry = approvals.approvalEntry(registry, approvalId);
    if (approvals.approvalState(entry) !== approvals.State.APPROVED) {
      refuse('PUBLISH_REFUSED: approvalId not registered or not APPROVED');
    }
    // P4: the binding. A registered, APPROVED approval for a different commit
    // does not authorise pushing this one.
    const bound = approvals.approvalReviewedSha(entry);
    if (bound && bound !== reviewedSha) {
      refuse(
        'PUBLISH_REFUSED: approval ' +
          approvalId +
          ' is bound to reviewed commit ' +
          bound +
          ', not ' +
          reviewedSha
      );
    }
    const boundVerdict = approvals.approvalVerdict(entry);
    if (boundVerdict && boundVerdict !== verdict) {
      refuse(
        'PUBLISH_REFUSED: approval ' +
          approvalId +
          ' was issued for ' +
          boundVerdict +
          ', not ' +
          verdict
      );
    }
    if (verdict === approvals.Verdict.FALLBACK_PASS && !approvals.approvalReviewer(entry)) {
      refuse('PUBLISH_REFUSED: ' + approvals.Verdict.FALLBACK_PASS + ' must name its reviewer');
    }
    const entryExpiry = approvals.approvalExpiry(entry);
    if (entryExpiry !== null && Date.now() > entryExpiry) {
      refuse('PUBLISH_REFUSED: approval ' + approvalId + ' expired at ' + entry.expiry);
    }
  } else if (!testMode) {
    refuse('PUBLISH_REFUSED: approval registry not found');
  }

  // P1: trusted push destination. remoteUrl and branch come from the options
  // the controller passed in; the worker-writable cwd is never consulted for
  // them. The only branch fallback is derived from the controller-supplied
  // cwd path itself, never from a file inside the tree.
  if (!remoteUrl) {
    refuse(
      'PUBLISH_REFUSED: missing remoteUrl (push destination must come from trusted controller input)'
    );
  }
  validateRemoteUrl(remoteUrl);
  const targetBranch = resolveBranch(branch, cwd);

  const currentSha = getHeadSha(cwd);
  if (!currentSha) {
    refuse('PUBLISH_REFUSED: could not resolve HEAD sha');
  }

  if (currentSha !== reviewedSha) {
    refuse('PUBLISH_REFUSED: SHA mismatch. Expected ' + reviewedSha + ', got ' + currentSha);
  }

  // testMode is an explicit injected option used only by tests: the external
  // clone/fetch/push is simulated so a test can never reach the network.
  if (testMode) {
    return Object.assign(
      {
        status: 'published',
        sha: currentSha,
        approvalId,
        remoteUrl,
        branch: targetBranch,
        simulated: true,
      },
      options.draft ? { draft: { status: 'simulated_draft', headRefOid: currentSha } } : {}
    );
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

  return Object.assign(
    { status: 'published', sha: currentSha, approvalId, remoteUrl, branch: targetBranch },
    // P5: the draft is opened only when the caller asked for it, always at the
    // reviewed SHA, and the loop stops here: no ready-for-review, no merge.
    options.draft
      ? {
          draft: createDraftPullRequest(
            Object.assign({}, options.draft, {
              remoteUrl,
              branch: targetBranch,
              reviewedSha: currentSha,
            })
          ),
        }
      : {}
  );
}

/** `gh` through the same shim-aware spawner every harness uses. */
function ghRun(args, cwd) {
  const { executableFor } = require('./harness');
  const exe = executableFor('gh');
  return runCommand(exe.file, exe.prefixArgs.concat(args), cwd);
}

module.exports = {
  publish,
  createDraftPullRequest,
  buildSanitizedMirror,
  transferReviewedObjects,
  SAFE_MIRROR_CONFIG,
  ACCEPTED_VERDICTS,
};
