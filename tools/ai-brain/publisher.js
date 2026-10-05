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
const { resolveWorkerGitDir, safeCopyObjects } = require('./supervisor');

// Load lazily because routing has a runtime dependency on this publisher module.
// Routing owns the canonical implementation; this module only forwards to it.
const routingFailureDomain = (candidate) => require('./routing').canonicalFailureDomain(candidate);

// Compatibility adapter for existing publisher consumers. Pass the parsed
// route dimensions to routing so its candidate-key adapter cannot recurse here.
function candidateFailureDomain(key) {
  const parts = String(key || '').split('::');
  if (parts.length !== 7) return null;
  return routingFailureDomain({ gateway: parts[2], upstream: parts[3] });
}

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

function getHeadSha(cwd, options) {
  const { withCleanGitEnv, safeGit } = require('./supervisor');
  const o = options || {};
  return withCleanGitEnv(
    cwd,
    (tmpDir) => {
      const res = safeGit(tmpDir, cwd, ['rev-parse', 'HEAD'], 20000);
      if (res.status === 0) return res.stdout.trim();
      return null;
    },
    { workerWritable: o.workerWritable === true || isWorkerPath(cwd) }
  );
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

/** Build the reviewable draft body from the already-validated manifest. */
function buildDraftBody(manifest, evidence) {
  const m = manifest || {};
  const e = evidence || {};
  const workItemId = String(e.workItemId || m.workItemId || '').trim();
  const outcome = String(e.outcome || 'Reviewed work item').trim();
  const writer = String(m.writerCandidateKey || '').trim();
  const reviewer = String(m.reviewerCandidateKey || '').trim();
  const manifestPath = String(e.reviewManifest || '').trim();
  const artifactPath = String(e.reviewArtifact || '').trim();
  const decisionEvidence = String(e.decisionEvidence || '').trim();
  const failBefore = e.failBefore || {};
  const failCommand = String(failBefore.command || '').trim();
  const failExitCode = Number(failBefore.exitCode);
  const tests = Array.isArray(m.tests) ? m.tests : [];
  const findings = Array.isArray(m.findings) ? m.findings : [];
  const openFindings = findings.filter((finding) => finding && finding.status === 'open');
  if (m.verdict === 'PASS' && openFindings.length > 0) {
    throw new Error(
      'PUBLISH_REFUSED: PASS_WITH_OPEN_FINDINGS: ' +
        openFindings.map((finding) => finding.id).join(', ')
    );
  }
  if (!reviewer) throw new Error('PUBLISH_REFUSED: review manifest missing reviewerCandidateKey');
  if (!decisionEvidence) throw new Error('PUBLISH_REFUSED: decision evidence path is required');
  if (
    !workItemId ||
    !writer ||
    !manifestPath ||
    !artifactPath ||
    !failCommand ||
    !Number.isFinite(failExitCode)
  ) {
    throw new Error('PUBLISH_REFUSED: draft Pull Request evidence is incomplete');
  }
  const passingTests = tests.filter((item) => item && item.result === 'pass');
  if (passingTests.length === 0) {
    throw new Error('PUBLISH_REFUSED: draft Pull Request is missing pass-after tests');
  }
  const testLines = tests.map((item) => {
    const line = '- ' + item.command + ' -> ' + item.result;
    return item.summary ? line + ' (' + item.summary + ')' : line;
  });
  const findingLines =
    findings.length === 0
      ? ['- No findings recorded.']
      : findings.map(
          (finding) => '- ' + finding.id + ' [' + finding.status + '] ' + finding.summary
        );
  return [
    '## Work Item',
    '',
    '- Work Item ID: ' + workItemId,
    '- Business outcome: ' + outcome,
    '- Writer candidate: ' + writer,
    '- Reviewer candidate: ' + reviewer,
    '',
    '## Source requirements',
    '',
    '- Requirements: ' + workItemId + ' acceptance matrix',
    '- Work Item: docs/product-spec/work-items/' + workItemId + '.md',
    '',
    '## Scope integrity',
    '',
    '- Exactly one Work Item: ' + workItemId,
    '- Reviewed commit: ' + m.reviewedCommit,
    '',
    '## Implementation',
    '',
    '- Review verdict: ' + m.verdict,
    '- Review artifact: ' + artifactPath,
    '- Findings:',
    ...findingLines,
    '',
    '## Acceptance evidence',
    '',
    '- Review manifest: ' + manifestPath,
    '- Decision evidence: ' + decisionEvidence,
    '',
    '## Verification',
    '',
    '- Fail-before: ' + failCommand + ' exited ' + failExitCode,
    '- Pass-after tests:',
    ...testLines,
    '',
    '## Safety and recovery',
    '',
    '- Draft only; publication does not mark ready, approve, or merge.',
    '- Publication refusals preserve the reviewed evidence and name the failed gate.',
    '',
    '## Documentation and traceability',
    '',
    '- Review manifest: ' + manifestPath,
    '- Review artifact: ' + artifactPath,
    '- Decision evidence: ' + decisionEvidence,
    '',
    '## Risks and limitations',
    '',
    '- This draft is bound to reviewed commit ' + m.reviewedCommit + '.',
    '',
    '## Codex review',
    '',
    '- Review status: READY_FOR_CODEX',
    '- Reviewed commit: ' + m.reviewedCommit,
    '',
  ].join('\n');
}

/**
 * M-R06 (TASK-AI-77): a push is authorised by a structured review manifest, not
 * by the option values themselves. The manifest is validated against the very
 * commit and work item being pushed BEFORE anything leaves this machine, and a
 * refusal names the manifest's own code, so the operator reads WHY the reviewed
 * evidence does not cover this push.
 *
 * The single exception is `testMode`, the explicit injected test-only option P2
 * already defines for the approval registry: a simulated publish pushes nothing,
 * so it cannot launder evidence. A manifest that IS supplied is always
 * validated, in testMode too — the seam is "no push, no manifest", never "any
 * manifest is fine".
 *
 * The manifest is only honoured together with the markdown review it binds, so
 * a publish that names no reviewArtifact is refused (ARTIFACT_REQUIRED) instead
 * of carrying an unchecked artifactSha256.
 */
function requireReviewManifest(options, refuse) {
  const o = options || {};
  const testMode = o.testMode === true;
  if (testMode && !o.reviewManifest) return null;
  if (!o.reviewManifest) {
    refuse('PUBLISH_REFUSED: MANIFEST_REQUIRED: a review manifest must authorise the publish');
  }
  if (!o.reviewArtifact) {
    refuse('PUBLISH_REFUSED: ARTIFACT_REQUIRED: the review manifest must name its markdown review');
  }
  const { validateManifestFile } = require('./review-manifest');
  const result = validateManifestFile(o.reviewManifest, {
    repoCwd: o.cwd,
    expected: { workItemId: o.workItemId, commit: o.reviewedSha },
    artifactPath: o.reviewArtifact,
  });
  if (!result.ok) {
    // P2-3: one clean message, prefixed exactly once. The refusal carries its
    // own gate code (MANIFEST_SHA_MISMATCH) beside the legacy SHA_MISMATCH
    // token the untouched task-ai-77 assertions match; PUBLISH_REFUSED is never
    // repeated inside the message.
    const code =
      result.code === 'SHA_MISMATCH' ? 'SHA_MISMATCH (MANIFEST_SHA_MISMATCH)' : result.code;
    refuse('PUBLISH_REFUSED: ' + code + (result.reason ? ': ' + result.reason : ''));
  }
  // A review that did not pass cannot authorise a push, however well bound.
  if (!ACCEPTED_VERDICTS.includes(result.verdict)) {
    refuse('PUBLISH_REFUSED: VERDICT_NOT_PASS: the review manifest verdict is ' + result.verdict);
  }
  return result;
}

/** Parse the Work Item identifier from a CSV row, honoring quoted commas/quotes. */
function csvFields(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * The reviewed commit, not the working tree, is authoritative for registration:
 * the register is read with `git show <sha>:<path>` through the same hardened
 * git helper `getHeadSha` uses (Q4: clean environment, no hooks, no worker
 * config), so no checkout ever happens and the mutable tree cannot launder a
 * row. `registerPresent` is separate from `registered` so the caller can tell
 * "this repository carries no delivery register" (a legacy fixture) apart from
 * "the register names no row for this Work Item" (a refusal).
 */
function registerStateAtCommit(cwd, reviewedSha, workItemId) {
  const state = { registerPresent: false, registered: false };
  const { withCleanGitEnv, safeGit } = require('./supervisor');
  const result = withCleanGitEnv(
    cwd,
    (tmpDir) =>
      safeGit(
        tmpDir,
        cwd,
        [
          'show',
          reviewedSha + ':docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',
        ],
        20000
      ),
    { workerWritable: isWorkerPath(cwd) }
  );
  if (result.status !== 0 || typeof result.stdout !== 'string') return state;
  state.registerPresent = true;
  const [header, ...rows] = result.stdout.split(/\r?\n/);
  if (!header) return state;
  const workItemColumn = csvFields(header).findIndex(
    (field) => field.trim().toLowerCase() === 'work_item_id'
  );
  if (workItemColumn < 0) return state;
  if (typeof workItemId !== 'string' || !workItemId.trim()) return state;
  state.registered = rows.some((line) => csvFields(line)[workItemColumn] === workItemId.trim());
  return state;
}

/** The reviewed commit names the Work Item in its register row, or it does not. */
function workItemRegisteredAtCommit(cwd, reviewedSha, workItemId) {
  return registerStateAtCommit(cwd, reviewedSha, workItemId).registered;
}

/**
 * Q4: never run upload-pack or read configuration from the worker-writable tree. A worker that rewrites its own
 * git config could still try to trigger code execution via include.path, core.fsmonitor, or hooks if any host-side
 * git command is run with that configuration. To prevent this, the actual operator-side publish path *never* runs any
 * git command inside the worker repo. Instead, it copies allowed objects directly (with a size bound and file type check) from the resolved object store path to a sanitized mirror it creates. Inside the publish path, no -c config overrides or git flags are used to disable hooks/textconv/etc., because the worker's config is never parsed. No push is ever done from the worker's repo: only from an operator-controlled, sanitized bare mirror, after integrity check (which verifies the reviewed commit is fully reachable). This avoids all code/config execution vectors arising from a malicious or malformed worker repository.
 */
const SAFE_MIRROR_CONFIG = '[core]\n\tbare = true\n';

function buildSanitizedMirror(cwd, tmpDir) {
  const mirrorDir = path.join(tmpDir, 'source-mirror');
  const initRes = runCommand('git', ['init', '--bare', mirrorDir], tmpDir);
  if (initRes.exitCode !== 0) {
    throw new Error('PUBLISH_FAILED: failed to init mirror source tree: ' + initRes.stderr);
  }
  fs.writeFileSync(path.join(mirrorDir, 'config'), SAFE_MIRROR_CONFIG);
  return mirrorDir;
}

function transferReviewedObjects(cwd, reviewedSha, cloneDir, tmpDir, options) {
  const mirrorDir = buildSanitizedMirror(cwd, tmpDir);

  // Copy objects explicitly to the mirror to completely avoid running git in the worker repository
  // or spawning upload-pack. This ensures malformed include.path or hostile hooks in the worker's
  // .git/config can never abort the transfer or execute code.
  // The copy is bounded and strictly allow-lists loose objects and packfiles to prevent copying
  // objects/info/alternates or dereferencing worker-planted junctions.
  // A worker-writable source refuses a gitfile or link at .git. An operator-owned
  // linked worktree (workerWritable: false) still resolves its gitdir.
  const o = options || {};
  const { workerCommonDir } = resolveWorkerGitDir(cwd, {
    workerWritable: o.workerWritable === true,
  });
  const workerObjects = path.join(workerCommonDir, 'objects');
  const mirrorObjects = path.join(mirrorDir, 'objects');
  safeCopyObjects(workerObjects, mirrorObjects);

  // Set the temp-push ref in the mirror to the reviewed SHA
  const refRes = runCommand('git', ['update-ref', 'refs/heads/temp-push', reviewedSha], mirrorDir);
  if (refRes.exitCode !== 0) {
    throw new Error('PUBLISH_FAILED: failed to update mirror ref: ' + refRes.stderr);
  }

  // Verify the reviewed commit is fully reachable from the mirror's own objects.
  // Since alternates are not copied, this guarantees the worker didn't supply an empty commit
  // relying on operator-side objects.
  const verifyRes = runCommand('git', ['rev-list', '--objects', reviewedSha], mirrorDir);
  if (verifyRes.exitCode !== 0) {
    throw new Error('PUBLISH_FAILED: reviewed commit is not fully reachable: ' + verifyRes.stderr);
  }

  // Then fetch from the safe operator-controlled mirror.
  const fetchRes = runCommand(
    'git',
    [
      '-c',
      'core.hooksPath=NUL',
      '-c',
      'protocol.file.allow=always',
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
  const body = buildDraftBody(o.manifest, Object.assign({}, o, { workItemId, outcome }));
  const runGh = typeof o.ghRun === 'function' ? o.ghRun : ghRun;

  const existing = runGh([
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

  const created = runGh([
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
  const view = runGh([
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

  const hasReviewerField = Object.prototype.hasOwnProperty.call(options, 'reviewerCandidateKey');
  const hasArtifactField = Object.prototype.hasOwnProperty.call(options, 'reviewArtifact');
  if (hasReviewerField && !options.reviewerCandidateKey) {
    refuse('PUBLISH_REFUSED: missing reviewer candidate key');
  }
  if (hasArtifactField && (!options.reviewArtifact || !fs.existsSync(options.reviewArtifact))) {
    refuse('PUBLISH_REFUSED: missing review artifact');
  }
  if (options.writerCandidateKey && options.reviewerCandidateKey) {
    const writerDomain = candidateFailureDomain(options.writerCandidateKey);
    const reviewerDomain = candidateFailureDomain(options.reviewerCandidateKey);
    if (writerDomain && reviewerDomain && writerDomain === reviewerDomain) {
      refuse('PUBLISH_REFUSED: reviewer shares writer failure domain ' + reviewerDomain);
    }
  }

  // F12: Validation against approval record. The registry lives on the
  // operator side; when it is absent the publish is refused unless the caller
  // explicitly injected testMode (tests only — never inferred from argv/env).
  const regPath = approvals.registryPath(registryPath);
  let approvalRecord = null;
  let legacyFlatApproval = false;
  if (fs.existsSync(regPath)) {
    const registry = approvals.readRegistry(regPath);
    const entry = approvals.approvalEntry(registry, approvalId);
    if (approvals.approvalState(entry) !== approvals.State.APPROVED) {
      refuse('PUBLISH_REFUSED: approvalId not registered or not APPROVED');
    }
    approvalRecord = entry;
    legacyFlatApproval = typeof entry === 'string';
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

  // M-R06: the review manifest gate. It sits after the approval the named human
  // already issued and before the destination, the head check, the clone and the
  // push: an approval authorises a push, the manifest says whether the reviewed
  // evidence covers it.
  const manifestValidation = requireReviewManifest(options, refuse);
  if (manifestValidation && approvalRecord) {
    const approvedReviewer = approvals.approvalReviewer(approvalRecord);
    const manifestReviewer = manifestValidation.manifest.reviewerCandidateKey;
    // Historical flat APPROVED entries carry no reviewer. Keep this seam only
    // for the existing TASK-AI-77 simulated-publish fixtures; structured
    // approval records without reviewer identity always refuse.
    if (approvedReviewer !== manifestReviewer && !(testMode && legacyFlatApproval)) {
      refuse('PUBLISH_REFUSED: APPROVAL_REVIEWER_MISMATCH');
    }
  }
  if (options.draft) {
    if (!manifestValidation || !manifestValidation.manifest) {
      refuse(
        'PUBLISH_REFUSED: draft Pull Request requires a review manifest with reviewer evidence'
      );
    }
    const reviewer = manifestValidation.manifest.reviewerCandidateKey;
    if (typeof reviewer !== 'string' || !reviewer.trim()) {
      refuse('PUBLISH_REFUSED: review manifest missing reviewerCandidateKey');
    }
    const decisionEvidence = options.draft.decisionEvidence;
    if (
      typeof decisionEvidence !== 'string' ||
      !decisionEvidence.trim() ||
      !fs.existsSync(decisionEvidence)
    ) {
      refuse('PUBLISH_REFUSED: decision evidence path is missing or does not exist');
    }
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

  const currentSha = getHeadSha(cwd, { workerWritable: isWorkerPath(cwd) });
  if (!currentSha) {
    refuse('PUBLISH_REFUSED: could not resolve HEAD sha');
  }

  if (currentSha !== reviewedSha) {
    refuse('PUBLISH_REFUSED: SHA mismatch. Expected ' + reviewedSha + ', got ' + currentSha);
  }

  // PG-R03: registration at the exact reviewed commit. Live publication always
  // requires the row before cloning or pushing. The simulated mode keeps its
  // legacy seam only for repositories that carry no delivery register at all
  // (the pre-register fixtures in task-ai-64/77/isolation); a repository that
  // does carry one is held to its rows in every mode, so the gate is exercised
  // wherever a real register is seeded.
  const registration = registerStateAtCommit(cwd, reviewedSha, options.workItemId);
  if (!registration.registered && (!testMode || registration.registerPresent)) {
    refuse('PUBLISH_REFUSED: WORK_ITEM_NOT_REGISTERED');
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
    transferReviewedObjects(cwd, reviewedSha, cloneDir, tmpDir, {
      workerWritable: isWorkerPath(cwd),
    });

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
              manifest: manifestValidation && manifestValidation.manifest,
              reviewManifest: options.reviewManifest,
              reviewArtifact: options.reviewArtifact,
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
  buildDraftBody,
  buildSanitizedMirror,
  transferReviewedObjects,
  // M-R04: the reviewer-independence rule has exactly one definition; the review
  // manifest reuses it instead of restating it.
  failureDomainFromCandidateKey: candidateFailureDomain,
  workItemRegisteredAtCommit,
  SAFE_MIRROR_CONFIG,
  ACCEPTED_VERDICTS,
};
