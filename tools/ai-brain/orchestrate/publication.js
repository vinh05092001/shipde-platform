'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runHardenedGit, assertGitOk } = require('./hardened-git');
const { Status: ReviewStatus } = require('../review-loop');
const { PublicationStatus, SHA_40, ACCEPTED_VERDICTS } = require('./shared');

const WORK_ITEM_ID = /\b(?:FEAT|TASK-FOUND|TASK-AI)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g;
const DRAFT_TITLE_LIMIT = 72;

function draftTitleFor(workItemId, outcome, fallback) {
  const id = String(workItemId || '').trim() || 'WORK-ITEM';
  const raw = outcome ? String(outcome).trim() : '';
  const withoutIds = raw.replace(WORK_ITEM_ID, '');
  // Only a removed ID can leave doubled whitespace behind, so an untouched
  // outcome keeps its own spacing exactly as the spec wrote it.
  const clean = withoutIds === raw ? raw : withoutIds.replace(/\s{2,}/g, ' ').trim();
  const body = clean || String(fallback || 'verified work item');
  const title = '[' + id + '] ' + body;
  return title.length > DRAFT_TITLE_LIMIT ? title.slice(0, DRAFT_TITLE_LIMIT).trimEnd() : title;
}

function draftTitleForItem(item, goal) {
  const goalText = goal ? String(goal).trim() : '';
  const firstLine = goalText.split(/\r?\n/)[0];
  const outcome =
    (item && (item.outcome || item.title || item.name)) ||
    (item && item.businessOutcome) ||
    firstLine ||
    null;
  return draftTitleFor(item && item.id, outcome, 'work item');
}

function publishCwdForReceipt(o, workerRoot) {
  const opts = o || {};
  if (opts.publisherCwd) return String(opts.publisherCwd);
  if (opts.isolatedWorker) return String(opts.cwd || process.cwd());
  return workerRoot ? String(workerRoot) : null;
}

/**
 * The single cwd expression shared by receipt validation and publication.
 *
 * Both stages used to resolve it separately, so they could disagree about the
 * directory being published from: validation saw the operator input while
 * publication fell back to the worker root. One expression, one answer.
 */
function resolvePublishCwd(o, rec) {
  const opts = o || {};
  return (
    (opts.publication && opts.publication.cwd) ||
    opts.publisherCwd ||
    opts.cwd ||
    (rec && rec.publishCwd) ||
    null
  );
}

function reviewedPublishBranch(entry, request) {
  const branch = (entry && entry.branch) || (request && request.branch) || null;
  if (!branch) throw new Error('PUBLISH_REFUSED: missing publish branch');
  return String(branch).replace(/^refs\/heads\//, '');
}

function importReviewedCommitForPublish(o, entry, request) {
  const reviewedSha = entry && (entry.sha || entry.reviewedSha);
  const workerRoot = entry && entry.workerRoot;
  const baseSha = entry && entry.baseSha;
  const publishCwd = resolvePublishCwd(o, entry);
  const branch = reviewedPublishBranch(entry, request);

  if (!reviewedSha || !SHA_40.test(String(reviewedSha))) {
    throw new Error('PUBLISH_REFUSED: invalid reviewed commit for publish import');
  }
  if (!baseSha || !SHA_40.test(String(baseSha))) {
    throw new Error('PUBLISH_REFUSED: publish import missing valid baseSha');
  }
  if (!workerRoot || !fs.existsSync(path.join(workerRoot, '.git'))) {
    throw new Error('PUBLISH_REFUSED: publish import workerRoot is not a git repository');
  }
  if (!publishCwd || !fs.existsSync(path.join(publishCwd, '.git'))) {
    throw new Error('PUBLISH_REFUSED: publish import cwd is not a git repository');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-publish-import-'));
  const cloneDir = path.join(tmpDir, 'publish-worktree');
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  try {
    assertGitOk(
      runHardenedGit(
        tmpDir,
        [
          'clone',
          '--no-local',
          '--no-hardlinks',
          '--no-tags',
          '--no-checkout',
          publishCwd,
          cloneDir,
        ],
        [publishCwd]
      ),
      'PUBLISH_REFUSED: failed to create operator-side publish clone'
    );
    assertGitOk(
      runHardenedGit(
        cloneDir,
        ['fetch', '--no-tags', '--no-recurse-submodules', workerRoot, reviewedSha],
        [workerRoot]
      ),
      'PUBLISH_REFUSED: failed to import reviewed commit from worker repo'
    );
    assertGitOk(
      runHardenedGit(cloneDir, ['rev-parse', '--verify', reviewedSha + '^{commit}']),
      'PUBLISH_REFUSED: imported reviewed commit is missing'
    );
    assertGitOk(
      runHardenedGit(cloneDir, ['merge-base', '--is-ancestor', baseSha, reviewedSha]),
      'PUBLISH_REFUSED: reviewed commit ' + reviewedSha + ' does not descend from base ' + baseSha
    );
    assertGitOk(
      runHardenedGit(cloneDir, ['check-ref-format', '--branch', branch]),
      'PUBLISH_REFUSED: invalid publish branch'
    );
    // Only the reviewed commit is needed locally. The publisher pushes that
    // SHA to refs/heads/<branch>; it never needs to move or check out the
    // destination branch, which may already be checked out in a worktree.
    assertGitOk(
      runHardenedGit(cloneDir, ['checkout', '--detach', reviewedSha]),
      'PUBLISH_REFUSED: failed to checkout reviewed commit for publish'
    );
    const head = assertGitOk(
      runHardenedGit(cloneDir, ['rev-parse', 'HEAD']),
      'PUBLISH_REFUSED: could not verify publish import HEAD'
    );
    if (head !== reviewedSha) {
      throw new Error(
        'PUBLISH_REFUSED: publish import HEAD mismatch. Expected ' + reviewedSha + ', got ' + head
      );
    }
    return { cwd: cloneDir, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

function approvalIdsOf(request) {
  if (!request) return [];
  if (Array.isArray(request.approvalIds)) {
    return request.approvalIds.map((id) => String(id).trim()).filter(Boolean);
  }
  const single = request.approvalId;
  return typeof single === 'string' && single.trim() ? [single.trim()] : [];
}

/**
 * PI-R02: one approval per reviewed commit. The multi-approval request shape
 * (`--approval ID1,ID2`) is matched per item by the approval record's
 * reviewedSha; an item no supplied approval binds has no approval at all and is
 * reported NOT_REQUESTED (APPROVAL_NOT_SUPPLIED) — never an attempt, so the
 * replay guard stays clean for the items that do carry an approval. Ids that
 * resolve to no bound record keep the legacy seam: they are passed through and
 * the publisher's own binding gate decides.
 *
 * The legacy singular approvalId has no list to match across and is passed
 * through unchanged: a bound-but-wrong approval then refuses at the publisher
 * with the binding named, which is the diagnostic that shape has always had.
 */
function selectApprovalId(request, reviewedSha) {
  if (!Array.isArray(request.approvalIds)) {
    return { approvalId: request.approvalId || null };
  }
  const ids = approvalIdsOf(request);
  if (ids.length === 0) return { approvalId: null, missing: true };
  const approvals = require('../approval-registry');
  let registry = null;
  try {
    const regPath = approvals.registryPath(request.registryPath);
    registry = fs.existsSync(regPath) ? approvals.readRegistry(regPath) : null;
  } catch (err) {
    registry = null;
  }
  let sawBound = false;
  let unboundFallback = null;
  for (const id of ids) {
    const entry = registry ? approvals.approvalEntry(registry, id) : null;
    const bound = approvals.approvalReviewedSha(entry);
    if (bound) {
      sawBound = true;
      if (String(bound).toLowerCase() === String(reviewedSha).toLowerCase()) {
        return { approvalId: id };
      }
    } else if (unboundFallback === null) {
      unboundFallback = id;
    }
  }
  if (!sawBound && unboundFallback !== null) return { approvalId: unboundFallback };
  return { approvalId: null, missing: true };
}

/**
 * The publication stage for one reviewed work item.
 *
 * It runs operator-side, outside the worker, and only with an approval a named
 * human authority wrote and bound to the reviewed commit. The loop cannot mint
 * one, so a run with no approval records that fact and publishes nothing — which
 * is the correct outcome, not a fallback to an unapproved push.
 *
 * `publishGuard` is the run's replay state: once the publisher throws or its
 * promise rejects (a failed or timed-out attempt) the guard is marked here, and
 * the loop refuses the next attempt with PUBLISH_NOT_REPLAYABLE. It is marked
 * from this call rather than read from `entry.publication`, because the entry
 * carries every outcome — a refusal that never reached the publisher, a
 * not-requested run — while only an attempted publish can be unreplayable.
 *
 * `publishedByItem` is this run's publish outcome: workItemId -> published
 * branch. A dependent draft stacks its PR base on the dependency's published
 * branch (TASK-AI-122 PI-R03), and is not published at all without one.
 */
function publication(o, entry, publishGuard, publishedByItem) {
  const request = o.publication;
  const markAttemptFailed = (reason) => {
    if (publishGuard && !publishGuard.failed) {
      publishGuard.failed = { workItemId: entry.workItemId, reason };
    }
  };
  // Only a call that reached the publisher is an attempt. A manifest or import
  // refusal never touched the external effect, so it must not poison the guard.
  let attempted = false;
  if (entry && entry.checkpointReviewError) {
    return {
      status: PublicationStatus.REFUSED,
      workItemId: entry.workItemId,
      reason: entry.checkpointReviewError,
    };
  }
  if (!request) {
    const review = entry && entry.review;
    if (
      entry &&
      (!review ||
        review.status !== ReviewStatus.COMPLETED ||
        !ACCEPTED_VERDICTS.includes(review.verdict))
    ) {
      return {
        status: PublicationStatus.NOT_REQUESTED,
        workItemId: entry.workItemId,
        reason: 'NO_REVIEWED_COMMIT: the item did not reach a passing review',
      };
    }
    return {
      status: PublicationStatus.NOT_REQUESTED,
      reason: 'APPROVAL_NOT_SUPPLIED: the loop cannot mint the approval that authorises a publish',
    };
  }
  const review = entry && entry.review;
  // PI-R01: the review manifest and artifact are per Work Item. The per-item
  // files written at review time are this item's evidence; the legacy shared
  // review-manifest.json / review-artifact.md pair is read only when no
  // per-item file exists, because it is last-writer-wins across a multi-item
  // run. An explicit request pin stays authoritative for the caller that set it.
  const itemKey = (request && request.workItemId) || (entry && entry.workItemId);
  const itemDecisionDir =
    (entry && entry.decisionLog && entry.decisionLog.dir) || o.decisionDir || null;
  const itemManifestCandidate =
    itemDecisionDir && path.join(itemDecisionDir, 'review-manifest-' + itemKey + '.json');
  const itemArtifactCandidate =
    itemDecisionDir && path.join(itemDecisionDir, 'review-artifact-' + itemKey + '.md');
  const reviewManifest =
    (request && request.reviewManifest) ||
    (itemManifestCandidate && fs.existsSync(itemManifestCandidate)
      ? itemManifestCandidate
      : null) ||
    (entry && entry.reviewManifest) ||
    (entry &&
      entry.decisionLog &&
      entry.decisionLog.dir &&
      path.join(entry.decisionLog.dir, 'review-manifest.json')) ||
    (o.decisionDir && path.join(o.decisionDir, 'review-manifest.json')) ||
    null;
  const reviewArtifact =
    (request && request.reviewArtifact) ||
    (itemArtifactCandidate && fs.existsSync(itemArtifactCandidate)
      ? itemArtifactCandidate
      : null) ||
    (entry && entry.reviewArtifact) ||
    (entry &&
      entry.decisionLog &&
      entry.decisionLog.dir &&
      path.join(entry.decisionLog.dir, 'review-artifact.md')) ||
    (o.decisionDir && path.join(o.decisionDir, 'review-artifact.md')) ||
    null;

  if (
    !reviewManifest &&
    (!review ||
      review.status !== ReviewStatus.COMPLETED ||
      !ACCEPTED_VERDICTS.includes(review.verdict))
  ) {
    return {
      status: PublicationStatus.REFUSED,
      workItemId: entry && entry.workItemId,
      reason: 'NO_REVIEWED_COMMIT: the item did not reach a passing review',
    };
  }

  const reviewedSha = (entry && entry.sha) || (review && review.finalSha) || null;

  // PI-R02: an approval binds one reviewed commit. An item no supplied
  // approval binds is NOT_REQUESTED (APPROVAL_NOT_SUPPLIED) — not a refusal,
  // and never an attempt, so the replay guard stays clean for the items that
  // do carry an approval.
  const approval = selectApprovalId(request, reviewedSha);
  if (!approval.approvalId) {
    return {
      status: PublicationStatus.NOT_REQUESTED,
      workItemId: entry && entry.workItemId,
      reason:
        'APPROVAL_NOT_SUPPLIED: no supplied approval is bound to reviewed commit ' + reviewedSha,
    };
  }

  // PI-R03: one draft PR per Work Item. A dependent stacks its PR base on the
  // dependency's published branch, so its diff carries only its own commit(s);
  // without a published dependency there is no legal base and no publish.
  const specItem =
    (entry && entry.item) ||
    (o.specs || []).find((s) => s && s.id === (entry && entry.workItemId)) ||
    null;
  const dependencies = (
    specItem && Array.isArray(specItem.dependencies) ? specItem.dependencies : []
  ).filter(Boolean);
  let baseBranch = null;
  if (dependencies.length > 1) {
    return {
      status: PublicationStatus.REFUSED,
      workItemId: entry && entry.workItemId,
      reason:
        'MULTI_DEPENDENCY_BASE_UNSUPPORTED: a dependent draft PR stacks on exactly one dependency, got ' +
        dependencies.join(', '),
    };
  }
  if (dependencies.length === 1) {
    const dependencyBranch = publishedByItem && publishedByItem.get(dependencies[0]);
    if (!dependencyBranch) {
      return {
        status: PublicationStatus.REFUSED,
        workItemId: entry && entry.workItemId,
        reason: 'DEPENDENCY_NOT_PUBLISHED: ' + dependencies[0] + ' was not published in this run',
      };
    }
    baseBranch = dependencyBranch;
  }

  let imported = null;
  try {
    imported = importReviewedCommitForPublish(o, entry, request);

    let manifestValidation = null;
    if (reviewManifest) {
      const { validateManifestFile } = require('../review-manifest');
      manifestValidation = validateManifestFile(reviewManifest, {
        repoCwd: imported.cwd,
        expected: {
          workItemId: (request && request.workItemId) || (entry && entry.workItemId),
          commit: (entry && entry.sha) || (review && review.finalSha),
        },
        artifactPath: reviewArtifact,
      });
      if (!manifestValidation.ok) {
        throw new Error(
          'PUBLISH_REFUSED: ' +
            manifestValidation.code +
            (manifestValidation.reason ? ': ' + manifestValidation.reason : '')
        );
      }
      if (!ACCEPTED_VERDICTS.includes(manifestValidation.verdict)) {
        throw new Error(
          'PUBLISH_REFUSED: VERDICT_NOT_PASS: the review manifest verdict is ' +
            manifestValidation.verdict
        );
      }
    } else if (!request.testMode) {
      throw new Error(
        'PUBLISH_REFUSED: MANIFEST_REQUIRED: a review manifest must authorise the publish'
      );
    }

    const publishFn =
      typeof request.publish === 'function'
        ? request.publish
        : typeof o.publisher === 'function'
          ? o.publisher
          : require('../publisher').publish;
    attempted = true;
    // PI-R03: the publish branch is this item's own branch, and the approval is
    // the one bound to this item's reviewed commit (PI-R02).
    const publishBranch =
      (entry && entry.branch) || (request && request.branch) || (review && review.branch) || null;
    const result = publishFn(
      Object.assign({}, request, {
        // The publisher still owns the approval, destination and draft gates.
        // Its cwd is now an operator-side clone whose HEAD is the reviewed
        // worker commit, imported before this call without letting the worker
        // push or checking out inside the worker root.
        cwd: imported.cwd,
        reviewedSha: (entry && entry.sha) || (review && review.finalSha),
        verdict:
          (manifestValidation && manifestValidation.verdict) ||
          (review && review.verdict) ||
          'PASS',
        reviewer:
          entry.reviewerIdentity ||
          (review && review.reviewer) ||
          entry.reviewer ||
          request.reviewer ||
          null,
        branch: publishBranch,
        approvalId: approval.approvalId,
        reviewManifest,
        reviewArtifact,
        workItemId: (entry && entry.workItemId) || (request && request.workItemId),
        draft: (() => {
          if (!request.draft && !entry.draftTitle) return undefined;
          const manifest = manifestValidation && manifestValidation.manifest;
          const callerDraft = request.draft || {};
          // PI-R03: the title is "[<workItemId>] <outcome>" from that item's own
          // spec. A run-level draft title (the old specs[0] shape) names another
          // Work Item and must not label this one's Pull Request.
          const callerNamesThisItem =
            typeof callerDraft.workItemId === 'string' &&
            callerDraft.workItemId === String(entry.workItemId);
          const specOutcome = entry.draftTitle
            ? String(entry.draftTitle).replace(/^\[[^\]]+\]\s*/, '')
            : null;
          // DT-R01: whichever source names the outcome, the Pull Request title
          // and the body's outcome line are composed from this one normalized
          // string — exactly one Work Item ID, truncated to 72 characters.
          const outcome = draftTitleFor(
            entry.workItemId,
            (callerNamesThisItem && callerDraft.outcome) || specOutcome,
            'work item'
          ).replace(/^\[[^\]]+\]\s*/, '');
          return Object.assign(
            {
              workItemId: entry.workItemId,
              outcome,
              reviewer:
                entry.reviewerIdentity ||
                (review && review.reviewer) ||
                entry.reviewer ||
                request.reviewer ||
                null,
              writerCandidateKey: manifest && manifest.writerCandidateKey,
              reviewerCandidateKey: manifest && manifest.reviewerCandidateKey,
              verdict: manifest && manifest.verdict,
              findings: (manifest && manifest.findings) || [],
              tests: (manifest && manifest.tests) || [],
              reviewManifest,
              reviewArtifact,
              decisionEvidence:
                (entry.decisionLog && entry.decisionLog.dir) ||
                (typeof entry.decisionLog === 'string' ? entry.decisionLog : null) ||
                o.decisionDir ||
                callerDraft.decisionEvidence ||
                null,
              failBefore: entry.failBefore || {
                command: entry.tests && entry.tests.command,
                exitCode: entry.tests && entry.tests.baseExitCode,
              },
            },
            // PI-R03: a dependent draft PR stacks on the dependency's published
            // branch; an independent one has no base override.
            baseBranch ? { baseBranch } : {}
          );
        })(),
        log: typeof o.log === 'function' ? o.log : null,
      })
    );
    const record = {
      status: PublicationStatus.PUBLISHED_DRAFT,
      workItemId: entry.workItemId,
      branch: publishBranch,
      baseBranch,
      result,
      attempted,
    };
    if (result && typeof result.then === 'function') {
      // A rejected publish is a failed or timed-out attempt. The record stops
      // claiming a draft that never landed, and the run's guard is marked —
      // both before the loop can reach another entry.
      result.then(null, (err) => {
        const reason = String((err && err.message) || err);
        record.status = PublicationStatus.REFUSED;
        record.reason = reason;
        markAttemptFailed(reason);
      });
    }
    return record;
  } catch (err) {
    const reason = String((err && err.message) || err);
    if (attempted) markAttemptFailed(reason);
    return {
      status: PublicationStatus.REFUSED,
      workItemId: entry.workItemId,
      reason,
      attempted,
    };
  } finally {
    if (imported) imported.cleanup();
  }
}

module.exports = {
  WORK_ITEM_ID,
  DRAFT_TITLE_LIMIT,
  PublicationStatus,
  draftTitleFor,
  draftTitleForItem,
  publishCwdForReceipt,
  resolvePublishCwd,
  reviewedPublishBranch,
  importReviewedCommitForPublish,
  approvalIdsOf,
  selectApprovalId,
  publication,
};
