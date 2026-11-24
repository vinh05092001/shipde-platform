'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { compileReviewPrompt } = require('../prompt-compiler');
const { candidateKey } = require('../candidates');
const { parseCandidateKey } = require('../discovery/identity');
const decisions = require('../decisions');
const evidence = require('../evidence');
const sourcesApi = require('../sources');
const { SHA_40, roleOf } = require('./shared');
const { resolveLaunchRoute, routeProbeCandidate } = require('./route-probe');
const {
  resolveIsolatedWorkerRoot,
  harnessFor,
  prepareUsageReport,
  writeUsageReportFromHarnessResult,
} = require('./writer-loop');
const { normalizeAccount } = require('./checkpoint');

function provisionReviewRoot(workerRoot, reviewRoot, targetSha, options) {
  const o = options || {};
  if (!workerRoot || !fs.existsSync(workerRoot)) {
    fs.mkdirSync(reviewRoot, { recursive: true });
    return;
  }
  const workerGit = path.join(workerRoot, '.git');
  if (!fs.existsSync(workerGit)) {
    fs.mkdirSync(reviewRoot, { recursive: true });
    return;
  }

  if (fs.existsSync(reviewRoot)) {
    // Windows reports transient EPERM/EBUSY while a large tree is being released.
    try {
      fs.rmSync(reviewRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (err) {
      // A process whose working directory is inside the old root blocks deletion
      // but not a rename; move it aside so the fresh clone can proceed.
      fs.renameSync(reviewRoot, reviewRoot + '-stale-' + Date.now());
    }
  }

  const { withCleanGitEnv, safeGit, getEffectiveEolConfig } = require('../supervisor');
  withCleanGitEnv(
    workerRoot,
    (safeGitDir) => {
      const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
      const safeRepoDir = path.dirname(safeGitDir);

      // Verify targetSha is present in the sanitized object store
      const revCheck = safeGit(safeGitDir, safeRepoDir, ['cat-file', '-e', targetSha], 20000);
      if (revCheck.status !== 0) {
        throw new Error(
          'PROVISION_REVIEW_FAILED: commit ' + targetSha + ' not found in worker object store'
        );
      }

      // Point a temporary branch ref at targetSha in the clean safe repo
      safeGit(
        safeGitDir,
        safeRepoDir,
        ['update-ref', 'refs/heads/review-target', targetSha],
        20000
      );

      // Clone from safe operator-controlled repository to reviewRoot with --no-hardlinks
      const cloneRes = (o.spawnSync || spawnSync)(
        'git',
        ['clone', '--no-checkout', '--no-hardlinks', safeRepoDir, reviewRoot],
        {
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        }
      );
      if (cloneRes.status !== 0) {
        throw new Error(
          'PROVISION_REVIEW_FAILED: failed to clone safe repository: ' + (cloneRes.stderr || '')
        );
      }

      const eolConfig = getEffectiveEolConfig(workerRoot, o);
      const normReviewRoot = path.resolve(reviewRoot).replace(/\\/g, '/');
      const checkoutArgs = [
        '-c',
        'core.hooksPath=' + nulDevice,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.attributesFile=' + nulDevice,
        '-c',
        'diff.external=',
        '-c',
        'safe.directory=' + normReviewRoot,
      ];
      if (process.platform === 'win32') {
        checkoutArgs.push('-c', 'core.filemode=false');
      }
      if (eolConfig.autocrlf !== null) {
        checkoutArgs.push('-c', 'core.autocrlf=' + eolConfig.autocrlf);
      }
      if (eolConfig.eol !== null) {
        checkoutArgs.push('-c', 'core.eol=' + eolConfig.eol);
      }
      checkoutArgs.push('checkout', targetSha);

      const checkoutRes = (o.spawnSync || spawnSync)('git', checkoutArgs, {
        cwd: reviewRoot,
        windowsHide: true,
        env: Object.assign({}, process.env, {
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: nulDevice,
          GIT_CONFIG_SYSTEM: nulDevice,
        }),
      });
      if (checkoutRes.status !== 0) {
        throw new Error(
          'PROVISION_REVIEW_FAILED: failed to checkout targetSha: ' + (checkoutRes.stderr || '')
        );
      }

      if (eolConfig.autocrlf !== null) {
        spawnSync('git', ['config', 'core.autocrlf', eolConfig.autocrlf], {
          cwd: reviewRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }
      if (eolConfig.eol !== null) {
        spawnSync('git', ['config', 'core.eol', eolConfig.eol], {
          cwd: reviewRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }
      if (process.platform === 'win32') {
        spawnSync('git', ['config', 'core.filemode', 'false'], {
          cwd: reviewRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }

      // Hardened rev-parse HEAD^{commit} verification (PR #189)
      let verifiedHead = null;
      try {
        verifiedHead = withCleanGitEnv(
          reviewRoot,
          (safeRevGitDir) => {
            const curRes = safeGit(
              safeRevGitDir,
              reviewRoot,
              ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
              20000
            );
            return curRes && curRes.status === 0 && curRes.stdout ? curRes.stdout.trim() : null;
          },
          { workerWritable: true }
        );
      } catch {
        verifiedHead = null;
      }
      if (!verifiedHead || verifiedHead.toLowerCase() !== targetSha.toLowerCase()) {
        throw new Error(
          'PROVISION_REVIEW_MISMATCH: review root HEAD (' +
            (verifiedHead || 'unknown') +
            ') does not match ' +
            targetSha
        );
      }
    },
    { workerWritable: true }
  );
}

/**
 * The review lane for the live isolated loop.
 *
 * Runs the reviewer candidate selected by the Controller outside the writer failure domain.
 * Operates in a SEPARATE read-only review root provisioned from the worker repository at the exact worker head SHA.
 * Gives the reviewer a compiled review prompt requiring a machine-readable verdict file (verdict.json).
 * Parses the verdict file fail-closed (missing/malformed/sha mismatch -> not PASS) and feeds findings into the repair path.
 */
/**
 * Is this reviewer key the configured combo? A key does not carry every source
 * field, so when the run holds the full candidate for the key, that candidate
 * decides; the key alone decides only when no candidate exists (#605, F1).
 */
function isComboReviewerKey(key, candidates, registry, launched) {
  const comboApi = require('../combo');
  const full =
    launched || (Array.isArray(candidates) ? candidates : []).find((c) => candidateKey(c) === key);
  return full ? comboApi.isComboCandidate(full, registry) : comboApi.isComboIdentity(key, registry);
}

function reviewLane(
  o,
  itemOrWriterKey,
  session,
  log,
  logOpts,
  launcher,
  usageDir,
  now,
  candidates,
  evidenceData,
  registry,
  opts
) {
  const writerKey =
    typeof itemOrWriterKey === 'string'
      ? itemOrWriterKey
      : (session && session.candidateKey) || null;
  const item = typeof itemOrWriterKey === 'object' ? itemOrWriterKey : null;
  const reviewerIdentity = (o && o.reviewerIdentity) || null;

  // Operator decision 2026-11-19 ("1 combo cho tất cả"): under combo-only routing
  // the single 9router combo is the only candidate, so the reviewer necessarily
  // resolves to the same combo as the writer. The operator accepted reviewer ==
  // writer for that case — 9router still dispatches the review call across the
  // combo's members, and the review stays an independent exact-SHA task with a
  // fail-closed verdict. The REVIEWER_EQUALS_WRITER refusal therefore applies only
  // to a NON-combo candidate, where a distinct reviewer is expected and self-review
  // would violate the AGENTS.md prohibition on an author approving its own work.
  // Only the configured combo itself qualifies; an individual model reached
  // through 9router still needs a distinct reviewer (review of #605, F1).
  const reviewerIsCombo = isComboReviewerKey(
    reviewerIdentity,
    candidates,
    registry || (o && o.registry)
  );

  if (reviewerIdentity && writerKey && reviewerIdentity === writerKey && !reviewerIsCombo) {
    return () => ({
      pass: false,
      sha: null,
      cause: 'REVIEWER_EQUALS_WRITER',
      verdict: 'REFUSED',
      findings: [
        {
          id: 'REVIEWER_EQUALS_WRITER',
          open: true,
          detail: 'the review lane resolved to the writer candidate ' + String(writerKey),
        },
      ],
    });
  }

  if (!launcher && !item) {
    return () => {
      throw new Error(
        'REVIEW_ROUTE_UNAVAILABLE: no exact-SHA review lane is wired for the live loop'
      );
    };
  }

  return async (currentSha) => {
    if (!currentSha || typeof currentSha !== 'string' || !SHA_40.test(currentSha.trim())) {
      return {
        pass: false,
        sha: null,
        cause: 'REVIEW_SHA_UNBOUND',
        verdict: 'REFUSED',
        findings: [
          {
            id: 'REVIEW_SHA_UNBOUND',
            open: true,
            detail: 'review target commit must be a valid 40-character SHA',
          },
        ],
      };
    }
    const targetSha = currentSha.trim();

    if (!reviewerIdentity) {
      return {
        pass: false,
        sha: targetSha,
        cause: 'NO_REVIEWER_CANDIDATE',
        verdict: 'REFUSED',
        findings: [
          {
            id: 'NO_REVIEWER_CANDIDATE',
            open: true,
            detail: 'no eligible reviewer candidate available outside writer failure domain',
          },
        ],
      };
    }

    const strictComboReview = Boolean(o && o.strictIndependentComboReview === true);
    if (writerKey && reviewerIdentity === writerKey && (!reviewerIsCombo || strictComboReview)) {
      return {
        pass: false,
        sha: null,
        cause: 'REVIEWER_EQUALS_WRITER',
        verdict: 'REFUSED',
        findings: [
          {
            id: 'REVIEWER_EQUALS_WRITER',
            open: true,
            detail: 'the review lane resolved to the writer candidate ' + String(writerKey),
          },
        ],
      };
    }
    if (writerKey && reviewerIdentity === writerKey && reviewerIsCombo && !strictComboReview) {
      // Record the operator-accepted residual risk (reviewer == writer combo) so
      // the audit trail shows the self-review was a deliberate combo-only decision.
      decisions.recordDecision(
        {
          stage: decisions.Stage.SELECTED,
          workItemId: item && item.id,
          role: 'reviewer',
          chosen: reviewerIdentity,
          reason:
            'REVIEWER_EQUALS_WRITER_COMBO_ACCEPTED: combo-only routing, operator decision 2026-11-19 ("1 combo cho tất cả")',
          detail:
            'the single 9router combo reviews its own work; 9router dispatches the review across combo members and the review remains an independent exact-SHA task with a fail-closed verdict',
        },
        logOpts
      );
    }

    const candidateList = Array.isArray(candidates) ? candidates : [];
    const candidate =
      candidateList.find((c) => candidateKey(c) === reviewerIdentity) ||
      parseCandidateKey(reviewerIdentity);
    if (!candidate) {
      return {
        pass: false,
        sha: targetSha,
        cause: 'REVIEWER_CANDIDATE_MISSING',
        verdict: 'REFUSED',
        findings: [
          {
            id: 'REVIEWER_CANDIDATE_MISSING',
            open: true,
            detail: 'reviewer candidate could not be resolved from ' + reviewerIdentity,
          },
        ],
      };
    }

    const route = resolveLaunchRoute(candidate, o, registry);
    if (!route || !route.harnessName) {
      return {
        pass: false,
        sha: targetSha,
        cause: 'REVIEW_ROUTE_UNRESOLVABLE',
        verdict: 'REFUSED',
        findings: [
          {
            id: 'REVIEW_ROUTE_UNRESOLVABLE',
            open: true,
            detail: 'cannot resolve launch route for reviewer candidate ' + reviewerIdentity,
          },
        ],
      };
    }

    const hostWorktree = o.cwd || process.cwd();
    const isolatedWorkerRoot = resolveIsolatedWorkerRoot(o, hostWorktree);
    const workerRoot =
      (o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot) ||
      (session && session.worktree) ||
      o.cwd;
    const reviewWorkerRoot =
      o.reviewRoot ||
      (o.isolatedWorker && isolatedWorkerRoot
        ? path.join(path.dirname(isolatedWorkerRoot), path.basename(isolatedWorkerRoot) + '-review')
        : workerRoot
          ? workerRoot + '-review'
          : path.join(os.tmpdir(), 'shipde-review-' + Date.now()));

    provisionReviewRoot(workerRoot, reviewWorkerRoot, targetSha, o);

    // Compute diff baseSha..targetSha host-side
    let diffText = '';
    const baseSha = (session && session.baseSha) || o.baseSha || null;
    if (baseSha && fs.existsSync(path.join(reviewWorkerRoot, '.git'))) {
      const { withCleanGitEnv, safeGit } = require('../supervisor');
      try {
        diffText =
          withCleanGitEnv(
            reviewWorkerRoot,
            (safeGitDir) => {
              const dRes = safeGit(
                safeGitDir,
                reviewWorkerRoot,
                ['diff', '--no-ext-diff', '--no-textconv', baseSha + '..' + targetSha],
                20000
              );
              if (!dRes || dRes.status !== 0) {
                throw new Error(
                  'DIFF_FAILED: git diff returned status ' +
                    (dRes ? dRes.status : 'null') +
                    (dRes && dRes.stderr ? ': ' + dRes.stderr.trim() : '')
                );
              }
              const fullDiff = dRes.stdout;
              const reg = registry || (o && o.registry);
              const dispatchCfg =
                sourcesApi && sourcesApi.getDispatchConfig
                  ? sourcesApi.getDispatchConfig(reg, o)
                  : {};
              const rawMaxDiff =
                o.maxReviewDiffChars ??
                dispatchCfg.maxReviewDiffChars ??
                reg?.dispatch?.maxReviewDiffChars ??
                o.dispatch?.maxReviewDiffChars;
              const maxDiffChars = Number(rawMaxDiff);
              if (!Number.isSafeInteger(maxDiffChars) || maxDiffChars <= 0) {
                throw new Error(
                  'DIFF_CONFIG_INVALID: maxReviewDiffChars must be a positive integer'
                );
              }
              if (fullDiff.length > maxDiffChars) {
                const patchDir = path.join(reviewWorkerRoot, '.shipde');
                const patchFile = path.join(patchDir, 'review-diff.patch');
                try {
                  fs.mkdirSync(patchDir, { recursive: true });
                  fs.writeFileSync(patchFile, fullDiff, 'utf8');
                } catch (writeErr) {
                  throw new Error(
                    'PATCH_WRITE_FAILED: could not write full patch for review: ' + writeErr.message
                  );
                }
                if (!fs.existsSync(patchFile)) {
                  throw new Error('PATCH_MISSING: reviewer cannot access patch file');
                }
                const statRes = safeGit(
                  safeGitDir,
                  reviewWorkerRoot,
                  ['diff', '--no-ext-diff', '--no-textconv', '--stat', baseSha + '..' + targetSha],
                  20000
                );
                const statText = statRes && statRes.status === 0 ? statRes.stdout : '';
                return (
                  '# Large diff (' +
                  fullDiff.length +
                  ' chars). Summary:\n' +
                  statText +
                  '\n# Full patch saved to .shipde/review-diff.patch in review root'
                );
              }
              return fullDiff;
            },
            { workerWritable: true }
          ) || '';
      } catch (err) {
        return {
          pass: false,
          sha: targetSha,
          verdict: 'BLOCKED',
          reviewer: reviewerIdentity,
          findings: [
            {
              id: 'DIFF_UNAVAILABLE',
              open: true,
              detail: 'Reviewer failed to receive diff: ' + ((err && err.message) || err),
            },
          ],
        };
      }
    }

    const verdictFile = path.join(reviewWorkerRoot, 'verdict.json');
    if (fs.existsSync(verdictFile)) {
      try {
        fs.unlinkSync(verdictFile);
      } catch {
        // ignore
      }
    }

    const usageFile = prepareUsageReport(
      usageDir,
      (item ? item.id : 'review') + '-' + (now || Date.now()) + '-review-' + targetSha.slice(0, 7)
    );

    const reviewPrompt = compileReviewPrompt(item, {
      goal: log ? log.goal : null,
      headSha: targetSha,
      baseSha,
      diffText,
      verdictFile,
      usageFile,
      candidateKey: reviewerIdentity,
      exercise: o.exercise || null,
      logOpts,
    });

    const reviewJob = {
      workItemId: (item ? item.id : 'item') + '-review',
      candidateKey: reviewerIdentity,
      harness: route.harnessName,
      provider: route.provider,
      model: route.model,
      accountId: normalizeAccount(candidate.accountId),
      gateway: candidate.gateway || '',
      upstream: candidate.upstream,
      quotaScope: candidate.quotaScope,
      prompt: reviewPrompt,
      branch:
        (session && session.branch) ||
        o.branch ||
        (item ? 'feat/' + String(item.id).toLowerCase() : 'review'),
      base: o.base || 'main',
      baseSha: targetSha,
      retainWorkerHead: targetSha,
      hostWorktree: o.isolatedWorker ? hostWorktree : null,
      workerRoot: o.isolatedWorker ? reviewWorkerRoot : o.workerRoot || null,
      cwd: reviewWorkerRoot,
      isolatedWorker: Boolean(o.isolatedWorker),
      usageFile,
      verdictFile,
      isReview: true,
      decisionDir: o.decisionDir || null,
      checkpoint: o.checkpointFile || null,
      title: (item ? item.id : 'item') + '-review',
      labels: {
        workItem: (item ? item.id : 'item') + '-review',
        role: 'reviewer',
        reviewOf: item ? item.id : undefined,
      },
      exercise: o.exercise || null,
      workerTimeoutMs: o.workerTimeoutMs || null,
    };

    let res = null;
    try {
      if (opts && typeof opts.onReviewerLaunch === 'function') {
        const eligible = opts.onReviewerLaunch(candidate);
        if (eligible === false) {
          return {
            pass: false,
            sha: targetSha,
            cause: 'NO_ALTERNATE_FAILURE_DOMAIN',
            verdict: 'REFUSED',
            reviewer: reviewerIdentity,
            findings: [
              {
                id: 'NO_ALTERNATE_FAILURE_DOMAIN',
                open: true,
                detail: 'reviewer failure domain is excluded or its attempt cap is exhausted',
              },
            ],
          };
        }
      }
      res = await launcher(reviewJob);
    } catch (err) {
      res = { exitCode: -1, stdout: '', stderr: String((err && err.message) || err) };
    }

    writeUsageReportFromHarnessResult(reviewJob, res);

    if (!res || res.exitCode !== 0) {
      if (opts && typeof opts.onReviewerLaunchFailure === 'function') {
        opts.onReviewerLaunchFailure(res, candidate, opts && opts.attempt);
      }
      // TASK-AI-114 R01: a launch failure is a failed reviewer attempt, never a
      // verdict. It carries no verdict value, so nothing downstream can record
      // it as a review round or read it as CHANGES_REQUIRED.
      return {
        pass: false,
        sha: targetSha,
        verdict: 'LAUNCH_FAILED',
        reviewer: reviewerIdentity,
        res,
        launchFailed: true,
        findings: [
          {
            id: 'REVIEWER_LAUNCH_FAILED',
            open: true,
            detail:
              'reviewer launch failed: ' +
              ((res && res.stderr) ||
                (res && res.failureReason) ||
                'exit code ' + (res && res.exitCode)),
          },
        ],
      };
    }

    if (logOpts) {
      const adapter = harnessFor({ harness: reviewJob.harness });
      const handle = adapter
        ? require('../executor').readSessionId(adapter, reviewJob, res).id
        : null;
      if (handle) {
        const { getOrCreateSigningKey, signReviewLaunchPayload } = require('../governed-merge');
        const signingOpts = {
          signingKeyPath:
            (opts && (opts.signingKeyPath || opts.keyPath)) ||
            (logOpts && (logOpts.signingKeyPath || logOpts.keyPath)) ||
            (o && (o.signingKeyPath || o.keyPath)),
          decisionDir: (logOpts && logOpts.dir) || (o && o.decisionDir),
        };
        const signingKey = getOrCreateSigningKey(signingOpts);
        const baseWorkItemId = String(
          (item && item.id) || (session && session.workItemId) || (o && o.workItemId) || 'item'
        ).trim();
        const recordAt =
          logOpts && logOpts.now ? new Date(logOpts.now).toISOString() : new Date().toISOString();
        let signature = '';
        if (signingKey) {
          const payload = {
            workItemId: baseWorkItemId,
            sha: targetSha,
            reviewerKey: reviewerIdentity,
            sessionId: handle,
            stage: decisions.Stage.REVIEW_LAUNCH || 'review-launch',
            at: recordAt,
          };
          signature = signReviewLaunchPayload(payload, signingKey);
        }
        decisions.recordDecision(
          {
            stage: decisions.Stage.REVIEW_LAUNCH || 'review-launch',
            workItemId: (item ? item.id : 'item') + '-review',
            reviewOf: baseWorkItemId,
            role: 'reviewer',
            attempt: opts && opts.attempt,
            attemptNumber: opts && opts.attempt,
            chosen: reviewerIdentity,
            reviewerKey: reviewerIdentity,
            reviewerCandidateKey: reviewerIdentity,
            harness: reviewJob.harness,
            branch: reviewJob.branch,
            sessionId: handle,
            detail: 'REVIEW_LANE: reviews ' + (item ? item.id : 'item') + ' at ' + targetSha,
            worktree: reviewWorkerRoot,
            reviewedSha: targetSha,
            sha: targetSha,
            at: recordAt,
            signature,
          },
          logOpts
        );
      }
    }

    // Fail-closed verdict parsing
    let effectiveVerdictFile = verdictFile;
    if (!fs.existsSync(effectiveVerdictFile)) {
      const altFile = path.join(reviewWorkerRoot, 'review-verdict.json');
      if (fs.existsSync(altFile)) {
        effectiveVerdictFile = altFile;
      } else if (res && typeof res.stdout === 'string' && res.stdout.trim()) {
        try {
          const text = require('../writer-schema').poolResultText(res.stdout);
          // Strict parse of the whole payload only; no embedded JSON extraction from prose.
          const candidateJson = JSON.parse(String(text || '').trim());
          if (
            candidateJson &&
            typeof candidateJson === 'object' &&
            typeof candidateJson.verdict === 'string' &&
            typeof candidateJson.sha === 'string'
          ) {
            fs.writeFileSync(verdictFile, JSON.stringify(candidateJson, null, 2), 'utf8');
            effectiveVerdictFile = verdictFile;
          }
        } catch {}
      }
    }

    if (!fs.existsSync(effectiveVerdictFile)) {
      return {
        pass: false,
        sha: targetSha,
        verdict: 'CHANGES_REQUIRED',
        reviewer: reviewerIdentity,
        findings: [
          {
            id: 'VERDICT_FILE_MISSING',
            open: true,
            detail: 'review verdict file was not produced at ' + verdictFile,
          },
        ],
      };
    }

    let parsed = null;
    try {
      const raw = fs.readFileSync(effectiveVerdictFile, 'utf8');
      parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    } catch (err) {
      return {
        pass: false,
        sha: targetSha,
        verdict: 'CHANGES_REQUIRED',
        reviewer: reviewerIdentity,
        findings: [
          {
            id: 'VERDICT_FILE_MALFORMED',
            open: true,
            detail: 'verdict file is not valid JSON: ' + ((err && err.message) || err),
          },
        ],
      };
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        pass: false,
        sha: targetSha,
        verdict: 'CHANGES_REQUIRED',
        reviewer: reviewerIdentity,
        findings: [
          {
            id: 'VERDICT_FILE_INVALID',
            open: true,
            detail: 'verdict file root must be an object',
          },
        ],
      };
    }

    const verdictSha = typeof parsed.sha === 'string' ? parsed.sha.trim() : null;
    if (
      !verdictSha ||
      !SHA_40.test(verdictSha) ||
      verdictSha.toLowerCase() !== targetSha.toLowerCase()
    ) {
      return {
        pass: false,
        sha: verdictSha || null,
        verdict: 'CHANGES_REQUIRED',
        cause: 'STALE_REVIEW_SHA',
        reviewer: reviewerIdentity,
        findings: [
          {
            id: 'STALE_REVIEW_SHA',
            open: true,
            detail:
              'verdict sha (' +
              (verdictSha || 'missing') +
              ') does not match reviewed sha (' +
              targetSha +
              ')',
          },
        ],
      };
    }

    const verdictStr = String(parsed.verdict || '')
      .trim()
      .toUpperCase();
    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const findings = rawFindings.map((f, idx) => {
      if (typeof f === 'string') {
        return { id: 'FINDING_' + (idx + 1), open: true, detail: f };
      }
      return {
        id: (f && f.id) || 'FINDING_' + (idx + 1),
        open: f && f.closed === true ? false : true,
        detail: (f && f.detail) || 'open finding',
      };
    });

    if (verdictStr !== 'PASS' && verdictStr !== 'CHANGES_REQUIRED') {
      return {
        pass: false,
        sha: targetSha,
        verdict: 'CHANGES_REQUIRED',
        reviewer: reviewerIdentity,
        findings: [
          {
            id: 'VERDICT_INVALID',
            open: true,
            detail: 'verdict must be PASS or CHANGES_REQUIRED, got: ' + verdictStr,
          },
        ],
      };
    }

    if (verdictStr === 'PASS') {
      return {
        pass: true,
        sha: targetSha,
        verdict: 'PASS',
        reviewer: reviewerIdentity,
        findings,
      };
    }

    return {
      pass: false,
      sha: targetSha,
      verdict: 'CHANGES_REQUIRED',
      reviewer: reviewerIdentity,
      findings:
        findings.length > 0
          ? findings
          : [
              {
                id: 'CHANGES_REQUIRED',
                open: true,
                detail: 'reviewer requested changes',
              },
            ],
    };
  };
}

/**
 * A repair task: the open findings become a new work-item spec whose acceptance
 * criteria are those findings, and the spec goes back through planner.plan, so the
 * fail-closed checks still run (AI-64-R09).
 *
 * A repair round claims no new file ownership: those files are already owned by
 * the item it repairs, and a repair that claimed them again is refused at the
 * planner's FILE_OWNED_TWICE check — which is the point. The refusal has to
 * happen at the planner, not downstream.
 */
function formatFindingDetail(f) {
  if (!f) return 'open finding';
  let detail = String(f.detail || 'open finding');
  const dirty = Array.isArray(f.dirtyPaths) ? f.dirtyPaths : [];
  if (dirty.length > 0 && !dirty.some((p) => detail.includes(p))) {
    detail += '; offending paths: ' + dirty.join(', ');
  }
  if (f.headSha && !detail.includes(f.headSha)) {
    detail += '; HEAD SHA: ' + f.headSha;
  }
  if (f.baseSha && !detail.includes(f.baseSha)) {
    detail += '; base SHA: ' + f.baseSha;
  }
  return detail;
}

function repairSpec(item, findings, round) {
  const repairFindings = Array.isArray(findings) ? findings : [];
  const dirtyPaths = [
    ...new Set(
      repairFindings.flatMap((f) => (Array.isArray(f && f.dirtyPaths) ? f.dirtyPaths : []))
    ),
  ];
  const headSha =
    repairFindings.find((f) => f && f.headSha && typeof f.headSha === 'string')?.headSha || null;
  const baseSha =
    repairFindings.find((f) => f && f.baseSha && typeof f.baseSha === 'string')?.baseSha || null;

  return {
    id: item.id + '-repair-' + round,
    role: roleOf(item),
    files: [],
    allowedPaths: (item.allowedPaths || []).slice(),
    ...(item.writerPaths !== undefined ? { writerPaths: item.writerPaths.slice() } : {}),
    dependencies: [item.id],
    acceptanceCriteria: repairFindings.map(
      (f) => (f && f.id ? f.id : 'finding') + ': ' + formatFindingDetail(f)
    ),
    verification: (item && item.verification) || null,
    dirtyPaths,
    headSha,
    baseSha,
  };
}

module.exports = {
  provisionReviewRoot,
  reviewLane,
  isComboReviewerKey,
  formatFindingDetail,
  repairSpec,
};
