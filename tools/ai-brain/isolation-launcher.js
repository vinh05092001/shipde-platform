'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { executableFor } = require('./harness');
const crypto = require('crypto');
const { parseCsvRecords } = require('./reconcile');

const {
  WORKER_USERNAME,
  WORKER_ROOT,
  DEFAULT_WORKER_TIMEOUT_MS,
  EXPECTED_FIREWALL_RULES,
  isWorkerConfigKeyAllowed,
  cleanGitEnv,
  isPathInside,
  workerGitPaths,
  gitConfigCheckTimeoutMs,
  validateConfigFile,
  validateWorkerGitConfig,
  resolveInstalledHook,
  controllerGit,
  hookedControllerGit,
  retargetSharedDepsWorkspaceLinks,
  retainedRootHasOwnWriterRecord,
  commitNativeWriterChanges,
  commitWorkerMetadata,
  isolationVerdictPath,
  stageContextPack,
  workerRootFor,
  isWorkerPath,
  readClosedIsolationVerdict,
  getFolderHash,
  isSecretFileName,
  queryWorkerSid,
} = require('./isolation/git-workspace');
const {
  buildBoundaryVerifyScript,
  defaultVerifyBoundary,
  buildWorkerLaunchScript,
} = require('./isolation/worker-scripts');
const {
  carryRef,
  carryGit,
  carryOverSave,
  carryOverRestore,
  appendGitInfoExclude,
  provisionedHeadMatchesBase,
  ensureGoalRegistrationInWorker,
  exerciseCasesPath,
  captureFailBefore,
  materialiseExercise,
  recordWorkerDepsUnavailable,
  resolvePnpmCommand,
  offlineStoreMiss,
  enforceTokenBudget,
} = require('./isolation/carryover-exercise');

function getIsolatedLauncher() {
  return function isolatedLauncher(adapter, args, options) {
    if (args && !Array.isArray(args)) {
      if (args.killTree) {
        return require('./harness').runHarness(adapter, args, options);
      }
      args = [];
    }
    const opts = options || {};

    // The verdict path is injectable so tests can write the verdict where the
    // code reads it on every OS. The production default is unchanged on Windows
    // (LOCALAPPDATA\ShipDe\isolation-verdict.json); LOCALAPPDATA is unset on
    // non-Windows, so production there resolves to a relative path, exactly as
    // before this opt was added.
    const verdictPath = isolationVerdictPath(opts);
    const hostCwd = opts.cwd || process.cwd();
    const jobName = path.basename(hostCwd) || 'default';
    const workerRoot = opts.workerRoot || workerRootFor(hostCwd);
    let carriedOver = 'none';
    let currentSid;
    const verdictData = require('./isolation-refresh').refreshIsolationVerdict({
      cwd: hostCwd,
      runner: opts.refreshRunner,
      timeoutMs: opts.refreshTimeoutMs,
      decisionDir: opts.decisionDir,
      validate: () => {
        if (!fs.existsSync(verdictPath)) {
          throw new Error('ISOLATION_VERDICT_MISSING: Cannot find ' + verdictPath);
        }
        const stat = fs.statSync(verdictPath);
        if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) {
          throw new Error('ISOLATION_VERDICT_STALE: ' + verdictPath + ' is older than 24h');
        }
        const verdictText = fs.readFileSync(verdictPath, 'utf8');
        const verdictData = JSON.parse(
          verdictText.charCodeAt(0) === 0xfeff ? verdictText.slice(1) : verdictText
        );
        if (verdictData.verdict !== 'CLOSED') {
          throw new Error('ISOLATION_VERDICT_NOT_CLOSED: Last verdict was ' + verdictData.verdict);
        }

        // P5: bind the FULL host worktree path, not just the worker-root leaf, so
        // two jobs sharing a directory leaf cannot share one attestation.
        if (
          !verdictData.worktree ||
          String(verdictData.worktree).toLowerCase() !== String(hostCwd).toLowerCase()
        ) {
          throw new Error(
            'ISOLATION_VERDICT_INVALID: worktree mismatch or missing: ' +
              verdictData.worktree +
              ' vs ' +
              hostCwd
          );
        }
        if (!verdictData.timestamp || new Date(verdictData.timestamp).getTime() > Date.now()) {
          throw new Error('ISOLATION_VERDICT_INVALID: timestamp in future or missing');
        }
        const policyHash = getFolderHash(path.join(hostCwd, 'scripts/ai/isolation'));
        if (!verdictData.policyHash || verdictData.policyHash !== policyHash) {
          throw new Error('ISOLATION_VERDICT_INVALID: policyHash mismatch or missing');
        }
        const getWorkerSid =
          typeof opts.getWorkerSid === 'function' ? opts.getWorkerSid : queryWorkerSid;
        currentSid = getWorkerSid();
        if (!verdictData.sid || verdictData.sid !== currentSid) {
          throw new Error('ISOLATION_VERDICT_INVALID: SID mismatch or missing');
        }
        // P5: per-check granularity — the verdict must carry every isolation
        // check's outcome and each one must be PASS, not just the summary verdict.
        if (!verdictData.details || typeof verdictData.details !== 'object') {
          throw new Error('ISOLATION_VERDICT_INVALID: details missing');
        }
        for (const [key, value] of Object.entries(verdictData.details)) {
          if (!/^PASS/.test(String(value))) {
            throw new Error('ISOLATION_VERDICT_INVALID: check ' + key + ' = ' + value);
          }
        }
        // P5: re-verify the boundary is still physically present right now.
        const verifyBoundary =
          typeof opts.verifyBoundary === 'function' ? opts.verifyBoundary : defaultVerifyBoundary;
        if (!verifyBoundary(currentSid, WORKER_USERNAME, opts)) {
          throw new Error(
            'ISOLATION_BOUNDARY_MISSING: firewall rules or operator-profile Deny ACL absent; rerun Set-WorkerFirewall.ps1/Set-WorkerAcl.ps1'
          );
        }

        return verdictData;
      },
    });

    // Provision worktree using a clean clone checked out at the caller's
    // pinned base SHA (AI-64-R15). The operator worktree's current HEAD is not
    // a base: it moves under the operator's feet, and a worker provisioned at
    // "whatever HEAD was" is not a reproducible run. An absent or malformed pin
    // stops the run before the worker root is created.
    const baseSha = opts.baseSha || null;
    if (!baseSha) {
      throw new Error('ISOLATION_BASE_SHA_MISSING: the caller must pin the base SHA to provision');
    }
    if (!/^[0-9a-f]{40}$/i.test(String(baseSha))) {
      throw new Error('ISOLATION_BASE_SHA_INVALID: not a 40-character commit: ' + baseSha);
    }
    const headSha = String(baseSha);

    // Distinguish initial launch of a work item vs repair round explicitly:
    // (1) Initial launch (no repair context, retainWorkerHead is not provided):
    //     always re-provision a fresh worker root at the pinned base SHA
    //     (delete + git clone --no-checkout --no-hardlinks + checkout inside the fresh clone),
    //     regardless of what an earlier run left in workerRoot.
    // (2) Repair round (retainWorkerHead is provided, e.g. <40-char sha>):
    //     keep the existing root only if a hardened read (clean GIT_CONFIG_GLOBAL/SYSTEM=NUL,
    //     -c core.hooksPath=NUL -c core.fsmonitor=false -c core.attributesFile=NUL) shows
    //     HEAD == that sha; never run checkout or any tree-mutating git in a retained root;
    //     mismatch -> structured WORKER_HEAD_MISMATCH failure for that repair attempt.
    const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    let retainWorkerHead =
      typeof opts.retainWorkerHead === 'string'
        ? opts.retainWorkerHead.trim()
        : opts.retainWorkerHead
          ? headSha
          : null;

    if (retainWorkerHead) {
      let retainedHeadSha = null;
      let missingRoot = false;
      if (fs.existsSync(workerRoot) && fs.existsSync(path.join(workerRoot, '.git'))) {
        try {
          const { withCleanGitEnv, safeGit } = require('./supervisor');
          retainedHeadSha = withCleanGitEnv(
            workerRoot,
            (safeGitDir) => {
              const curHeadRes = safeGit(
                safeGitDir,
                workerRoot,
                ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
                20000
              );
              if (curHeadRes && curHeadRes.status === 0 && curHeadRes.stdout) {
                return curHeadRes.stdout.trim();
              }
              return null;
            },
            { workerWritable: true }
          );
        } catch {
          retainedHeadSha = null;
        }
      } else {
        missingRoot = true;
      }

      if (missingRoot) {
        const err = new Error('WORKER_ROOT_MISSING: retained worker root is missing');
        err.code = 'WORKER_ROOT_MISSING';
        throw err;
      }

      const { isTreeDirty } = require('./orchestrate');
      // A repair turn that edited the retained root but left it uncommitted is
      // this item's own output: keep it as a commit (the same restore commit the
      // carry-over uses) so the next repair or gate runs on a clean HEAD. A dirty
      // tree with no writer/repair record for this item stays dirty and fails
      // closed below.
      appendGitInfoExclude(workerRoot, [
        '.shipde/',
        'run-target.ps1',
        'run-target.complete.json',
        'temp/',
        '.config/',
        '.local/',
        'Microsoft/',
        'AppData/',
        '.cache/',
        '.upstream-tmp/',
        '.env',
        '.env.*',
        '*.env',
        '*credential*',
        '*credentials*',
        '*.secret*',
        '*secrets*',
        '*.pem',
        '*.key',
        'id_rsa*',
        'id_ed25519*',
      ]);
      let commitRefusalReason = null;
      if (
        retainedHeadSha &&
        retainedHeadSha.toLowerCase() === retainWorkerHead.toLowerCase() &&
        opts.workItemId &&
        isTreeDirty(workerRoot) &&
        retainedRootHasOwnWriterRecord(opts, {
          workerRoot,
          retainedHeadSha,
          retainWorkerHead,
          runId: opts.runId,
        })
      ) {
        try {
          const { getTreeStatus } = require('./orchestrate');
          const status = getTreeStatus(workerRoot, { untracked: 'all' });
          const dirtyPaths = status.dirtyPaths || [];
          const isSecretPath = (p) => {
            const norm = String(p).replace(/\\/g, '/');
            const base = path.basename(norm).toLowerCase();
            return (
              base.startsWith('.env') ||
              base.endsWith('.env') ||
              base.includes('credential') ||
              base.includes('secret') ||
              /\.(pem|key|pfx|p12|enc)$/i.test(base) ||
              /^id_(rsa|ed25519|dsa)/i.test(base)
            );
          };
          if (dirtyPaths.some(isSecretPath)) {
            throw new Error('WORKER_COMMIT_REFUSED: dirty tree contains sensitive files');
          }
          const writerScope = require('./writer-scope');
          let allowedPaths = opts.allowedPaths
            ? opts.allowedPaths
            : opts.item
              ? writerScope.effectiveWriterScope(opts.item)
              : null;
          if (!allowedPaths && opts.workItemId) {
            const baseId = String(opts.workItemId).replace(/-(repair-\d+|review)$/, '');
            const itemPath = path.join(
              workerRoot,
              'docs',
              'product-spec',
              'work-items',
              baseId + '.md'
            );
            if (fs.existsSync(itemPath)) {
              try {
                const text = fs.readFileSync(itemPath, 'utf8');
                const intake = require('./intake');
                const parsedAllowed = intake.deriveAllowedPaths(text);
                const parsedWriter = intake.deriveWriterPaths(text);
                allowedPaths = writerScope.effectiveWriterScope({
                  allowedPaths: parsedAllowed,
                  writerPaths: parsedWriter,
                });
              } catch (err) {
                throw new Error(
                  'WORKER_COMMIT_REFUSED: failed to read allowed paths from ' +
                    itemPath +
                    ': ' +
                    err.message
                );
              }
            }
          }
          if (opts.isDocsOnly || opts.isPlanReview) {
            const baseId = String(opts.workItemId).replace(/-(repair-\d+|review)$/, '');
            allowedPaths = [
              `docs/product-spec/work-items/${baseId}.md`,
              'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',
            ];
          }
          if (dirtyPaths.length > 0) {
            if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
              throw new Error('WORKER_COMMIT_REFUSED: allowed paths contract missing or empty');
            }
            const { matchGlobs } = require('./scope-gate');
            const normAllowed = allowedPaths.map((p) =>
              String(p).replace(/\\/g, '/').replace(/^\.\//, '')
            );
            for (const p of dirtyPaths) {
              const normP = String(p).replace(/\\/g, '/').replace(/^\.\//, '');
              const isAllowed = normAllowed.includes(normP) || matchGlobs(normAllowed, normP);
              if (!isAllowed) {
                throw new Error(`WORKER_COMMIT_REFUSED: dirty file ${normP} outside allowed paths`);
              }
            }
          }
          const checked = hookedControllerGit({
            hostRoot: hostCwd,
            workerRoot,
            failure: 'WORKER_COMMIT_FAILED',
          });
          if (dirtyPaths.length > 0) {
            checked(['add', '--', ...dirtyPaths]);
            checked(['commit', '-m', 'Restore interrupted writer work']);
          }
          const committed = checked(['rev-parse', '--verify', 'HEAD^{commit}']);
          if (/^[a-f0-9]{40}$/i.test(committed) && !isTreeDirty(workerRoot)) {
            const requestedSha = retainWorkerHead;
            retainedHeadSha = committed;
            retainWorkerHead = committed;
            const baseId = String(opts.workItemId).replace(/-(repair-\d+|review)$/, '');
            if (opts.checkpoint) {
              const cli = require('./cli');
              const onDisk = cli.readCheckpoint(opts.checkpoint);
              const step = onDisk && onDisk.liveSteps && onDisk.liveSteps[baseId];
              if (step) {
                if (step.launch) step.launch.workerSha = committed;
                if (step.repair) step.repair.sha = committed;
                cli.writeJsonFile(opts.checkpoint, onDisk);
              }
            }
            require('./decisions').recordDecision(
              {
                stage: 'adopted_repair_head',
                workItemId: opts.workItemId,
                branch: opts.branch || null,
                worktree: workerRoot,
                detail: 'committed uncommitted repair output',
                requestedSha,
                adoptedSha: committed,
              },
              { dir: opts.decisionDir || undefined }
            );
          }
        } catch (err) {
          commitRefusalReason = (err && err.message) || String(err);
          // Fail closed: the dirty tree is reported as WORKER_HEAD_MISMATCH below.
        }
      }

      if (
        !retainedHeadSha ||
        retainedHeadSha.toLowerCase() !== retainWorkerHead.toLowerCase() ||
        isTreeDirty(workerRoot)
      ) {
        const workItemId = (opts && opts.workItemId) || null;
        let adopted = false;

        if (retainedHeadSha && retainWorkerHead && workItemId) {
          try {
            const { safeGit, withCleanGitEnv } = require('./supervisor');
            const { isTreeDirty } = require('./orchestrate');
            if (!isTreeDirty(workerRoot)) {
              withCleanGitEnv(
                workerRoot,
                (safeGitDir) => {
                  const mergeBaseRes = safeGit(
                    safeGitDir,
                    workerRoot,
                    ['merge-base', '--is-ancestor', retainWorkerHead, retainedHeadSha],
                    20000
                  );
                  if (mergeBaseRes && mergeBaseRes.status === 0) {
                    const logRes = safeGit(
                      safeGitDir,
                      workerRoot,
                      ['log', '--format=%H', retainWorkerHead + '..' + retainedHeadSha],
                      20000
                    );
                    if (logRes && logRes.status === 0 && logRes.stdout) {
                      const extraCommits = logRes.stdout
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      if (extraCommits.length > 0) {
                        const decisions = require('./decisions');
                        const logRecords = decisions.readDecisionsSafe({
                          dir: (opts && opts.decisionDir) || undefined,
                        });
                        const baseId = workItemId
                          ? workItemId.replace(/-(repair-\d+|review)$/, '')
                          : null;
                        const repairCommits = new Set();
                        for (const rec of logRecords) {
                          if (
                            rec.workItemId &&
                            baseId &&
                            rec.workItemId.replace(/-(repair-\d+|review)$/, '') === baseId &&
                            rec.stage === decisions.Stage.LAUNCHED &&
                            rec.detail &&
                            rec.detail.startsWith('REPAIR_ROUND:') &&
                            rec.sha &&
                            rec.worktree
                          ) {
                            const recWorktree = path.resolve(rec.worktree);
                            const currentWorktree = path.resolve(workerRoot);
                            const pathsMatch =
                              process.platform === 'win32'
                                ? recWorktree.toLowerCase() === currentWorktree.toLowerCase()
                                : recWorktree === currentWorktree;

                            if (pathsMatch) {
                              repairCommits.add(rec.sha.toLowerCase());
                            }
                          }
                        }

                        const allExtraAreRepair = extraCommits.every((c) =>
                          repairCommits.has(c.toLowerCase())
                        );
                        if (allExtraAreRepair) {
                          adopted = true;

                          if (opts.checkpoint) {
                            const cli = require('./cli');
                            const checkpointOnDisk = cli.readCheckpoint(opts.checkpoint);
                            if (
                              checkpointOnDisk &&
                              checkpointOnDisk.liveSteps &&
                              checkpointOnDisk.liveSteps[baseId]
                            ) {
                              const step = checkpointOnDisk.liveSteps[baseId];
                              let updated = false;
                              if (step.launch) {
                                step.launch.workerSha = retainedHeadSha;
                                updated = true;
                              }
                              if (step.repair) {
                                step.repair.sha = retainedHeadSha;
                                updated = true;
                              }
                              if (updated) {
                                cli.writeJsonFile(opts.checkpoint, checkpointOnDisk);
                              }
                            }
                          }

                          decisions.recordDecision(
                            {
                              stage: 'adopted_repair_head',
                              workItemId,
                              branch: (opts && opts.branch) || null,
                              worktree: workerRoot,
                              detail: 'adopted descendant repair HEAD',
                              requestedSha: retainWorkerHead,
                              adoptedSha: retainedHeadSha,
                            },
                            { dir: (opts && opts.decisionDir) || undefined }
                          );
                          retainWorkerHead = retainedHeadSha;
                        }
                      }
                    }
                  }
                },
                { workerWritable: true }
              );
            }
          } catch (e) {
            // Ignore Git errors during adoption check and fallback to WORKER_HEAD_MISMATCH failure
            // but bubble up decision log unreadable errors.
            if (e && e.code === 'DECISION_LOG_UNREADABLE') {
              throw e;
            }
          }
        }

        if (!adopted) {
          let errMsg =
            'WORKER_HEAD_MISMATCH: retained worker root HEAD (' +
            (retainedHeadSha || 'unknown') +
            ') does not match requested SHA ' +
            retainWorkerHead;

          if (
            retainedHeadSha &&
            retainedHeadSha.toLowerCase() === retainWorkerHead.toLowerCase() &&
            isTreeDirty(workerRoot)
          ) {
            errMsg =
              'WORKER_HEAD_MISMATCH: retained worker root HEAD (' +
              retainedHeadSha +
              ') is dirty' +
              (commitRefusalReason ? ': ' + commitRefusalReason : '');
          }

          const err = new Error(errMsg);
          err.code = 'WORKER_HEAD_MISMATCH';
          if (commitRefusalReason) {
            err.refusalReason = commitRefusalReason;
          }
          throw err;
        }
      }
      // Matching HEAD: retain worker root and its commits as-is. NEVER run checkout.
    } else {
      const carryBranch =
        opts.branch || (opts.workItemId ? 'feat/' + String(opts.workItemId).toLowerCase() : null);
      if (fs.existsSync(workerRoot)) {
        carryOverSave(hostCwd, workerRoot, carryBranch, headSha);
        fs.rmSync(workerRoot, { recursive: true, force: true });
      }

      // Q5: --no-hardlinks — a local clone hardlinks .git/objects files to
      // the operator repo; the worker root is outside the operator profile and
      // the worker is granted Modify, so a hardlinked object could be
      // rewritten in place to corrupt the OPERATOR repo's objects.
      const cloneRes = cp.spawnSync(
        'git',
        ['clone', '--no-checkout', '--no-hardlinks', hostCwd, workerRoot],
        {
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        }
      );
      if (cloneRes.status !== 0) throw new Error('Failed to clone repository');

      const { getEffectiveEolConfig } = require('./supervisor');
      const eolConfig = getEffectiveEolConfig(hostCwd, opts);

      const normWorkerRoot = path.resolve(workerRoot).replace(/\\/g, '/');
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
        'safe.directory=' + normWorkerRoot,
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
      const targetBranch =
        opts.branch || (opts.workItemId ? 'feat/' + String(opts.workItemId).toLowerCase() : null);

      if (targetBranch) {
        checkoutArgs.push('checkout', '-B', targetBranch, headSha);
      } else {
        checkoutArgs.push('checkout', headSha);
      }

      const checkoutRes = cp.spawnSync('git', checkoutArgs, {
        cwd: workerRoot,
        windowsHide: true,
        env: Object.assign({}, process.env, {
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: nulDevice,
          GIT_CONFIG_SYSTEM: nulDevice,
        }),
      });
      if (checkoutRes.status !== 0) {
        throw new Error(
          'ISOLATION_CHECKOUT_FAILED: Failed to checkout HEAD SHA in worker root: ' + headSha
        );
      }

      if (targetBranch) {
        cp.spawnSync('git', ['update-ref', 'refs/remotes/origin/' + targetBranch, headSha], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }

      if (targetBranch) {
        try {
          carriedOver = carryOverRestore(hostCwd, workerRoot, targetBranch, eolConfig);
        } catch (error) {
          if (String(error.message).startsWith('WORKER_COMMIT_FAILED:')) {
            return {
              exitCode: 1,
              localFailure: 'WORKER_COMMIT_FAILED',
              failureReason: String(error.message),
              stderr: String(error.message),
            };
          }
          throw error;
        }
      }

      ensureGoalRegistrationInWorker(hostCwd, workerRoot, opts.workItemId);

      if (eolConfig.autocrlf !== null) {
        cp.spawnSync('git', ['config', 'core.autocrlf', eolConfig.autocrlf], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }
      if (eolConfig.eol !== null) {
        cp.spawnSync('git', ['config', 'core.eol', eolConfig.eol], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }
      if (process.platform === 'win32') {
        cp.spawnSync('git', ['config', 'core.filemode', 'false'], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }

      // Provisioning must end with HEAD == requested base SHA exactly, verified with a hardened rev-parse;
      // any mismatch is a hard structured failure (PROVISION_BASE_MISMATCH) before the agent starts.
      const { withCleanGitEnv, safeGit } = require('./supervisor');
      let provisionedHeadSha = null;
      try {
        provisionedHeadSha = withCleanGitEnv(
          workerRoot,
          (safeGitDir) => {
            const curHeadRes = safeGit(
              safeGitDir,
              workerRoot,
              ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
              20000
            );
            if (curHeadRes && curHeadRes.status === 0 && curHeadRes.stdout) {
              return curHeadRes.stdout.trim();
            }
            return null;
          },
          { workerWritable: true }
        );
      } catch {
        provisionedHeadSha = null;
      }

      if (!provisionedHeadSha) {
        const revRes = (opts.spawnSync || cp.spawnSync)(
          'git',
          [
            '-c',
            'safe.directory=' + normWorkerRoot,
            '-c',
            'core.hooksPath=' + nulDevice,
            '-c',
            'core.fsmonitor=false',
            '-c',
            'core.attributesFile=' + nulDevice,
            'rev-parse',
            '--verify',
            '--quiet',
            'HEAD^{commit}',
          ],
          {
            cwd: workerRoot,
            encoding: 'utf8',
            windowsHide: true,
            env: Object.assign({}, process.env, {
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL: nulDevice,
              GIT_CONFIG_SYSTEM: nulDevice,
            }),
          }
        );
        if (revRes && revRes.status === 0 && revRes.stdout) {
          provisionedHeadSha = revRes.stdout.trim();
        }
      }

      if (!provisionedHeadMatchesBase(workerRoot, provisionedHeadSha, headSha, carriedOver)) {
        const err = new Error(
          'PROVISION_BASE_MISMATCH: provisioned worker root HEAD (' +
            (provisionedHeadSha || 'unknown') +
            ') does not match requested base SHA ' +
            headSha
        );
        err.code = 'PROVISION_BASE_MISMATCH';
        throw err;
      }
    }

    // WD-R01, WD-R02, WD-R03: Shared dependency directory for pnpm
    const pnpmLockPath = path.join(workerRoot, 'pnpm-lock.yaml');
    if (fs.existsSync(pnpmLockPath)) {
      try {
        const findPackageJsons = (dir, results = []) => {
          if (!fs.existsSync(dir)) return results;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
              findPackageJsons(path.join(dir, entry.name), results);
            } else if (entry.isFile() && entry.name === 'package.json') {
              results.push(path.join(dir, entry.name));
            }
          }
          return results;
        };
        const pkgJsons = findPackageJsons(workerRoot);
        // The hash mixes each file's repo-relative name with its content and a
        // delimiter, so distinct file sets cannot collide on a bare content
        // concatenation and the value does not depend on where the clone sits.
        const hashEntries = [
          { rel: 'pnpm-lock.yaml', file: pnpmLockPath },
          ...pkgJsons.map((f) => ({
            rel: path.relative(workerRoot, f).split(path.sep).join('/'),
            file: f,
          })),
        ].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
        const hash = crypto.createHash('sha256');
        for (const entry of hashEntries) {
          hash.update(entry.rel, 'utf8');
          hash.update('\0', 'utf8');
          hash.update(fs.readFileSync(entry.file));
          hash.update('\0', 'utf8');
        }
        const depsHash = hash.digest('hex').substring(0, 16);
        const depsDir = path.join(path.dirname(workerRoot), 'deps', depsHash);
        const depsNodeModules = path.join(depsDir, 'node_modules');
        const markerFile = path.join(depsDir, '.shipde-deps-ready');
        const cacheReady = () => fs.existsSync(markerFile) && fs.existsSync(depsNodeModules);
        // Populate ONCE (WD-R01): stage only the lockfile/workspace manifests,
        // install from the host pnpm store, mark the completed tree, then
        // rename it into place. pnpm creates Windows junctions/hard links
        // without requiring the symlink privilege needed by recursive copies.
        if (!cacheReady()) {
          const targetDir =
            depsDir + '.staging-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
          fs.mkdirSync(targetDir, { recursive: true });
          let failedPath = 'pnpm-lock.yaml';
          try {
            for (const entry of hashEntries) {
              failedPath = entry.rel;
              const hostManifest = path.join(hostCwd, entry.rel);
              const stagedManifest = path.join(targetDir, entry.rel);
              if (!fs.existsSync(hostManifest)) {
                const missing = new Error('host workspace manifest is missing');
                missing.code = 'WORKER_DEPS_SOURCE_MISSING';
                throw missing;
              }
              fs.mkdirSync(path.dirname(stagedManifest), { recursive: true });
              fs.copyFileSync(hostManifest, stagedManifest);
            }
            const hostWorkspaceFile = path.join(hostCwd, 'pnpm-workspace.yaml');
            if (fs.existsSync(hostWorkspaceFile)) {
              failedPath = 'pnpm-workspace.yaml';
              fs.copyFileSync(hostWorkspaceFile, path.join(targetDir, 'pnpm-workspace.yaml'));
            }

            failedPath = 'node_modules';
            const runPnpmInstall = (offline) => {
              const args = ['install', '--frozen-lockfile'];
              if (offline) args.push('--offline');
              const pnpmExecutable = resolvePnpmCommand();
              const result = cp.spawnSync(pnpmExecutable, args, {
                cwd: targetDir,
                encoding: 'utf8',
                windowsHide: true,
                timeout: 600000,
                maxBuffer: 10 * 1024 * 1024,
              });
              if (result.error) throw result.error;
              if (result.status !== 0) {
                const detail = (result.stderr || result.stdout || 'pnpm install failed').trim();
                const error = new Error(detail.slice(-4000));
                error.code = 'PNPM_INSTALL_FAILED';
                error.offline = offline;
                error.relativePath = failedPath;
                throw error;
              }
            };

            try {
              runPnpmInstall(true);
            } catch (offlineError) {
              if (!offlineError.offline || !offlineStoreMiss(offlineError)) throw offlineError;
              // An incomplete local store is the only reason to retry online.
              runPnpmInstall(false);
            }

            if (!fs.existsSync(path.join(targetDir, 'node_modules'))) {
              const error = new Error('pnpm install completed without node_modules');
              error.code = 'WORKER_DEPS_SOURCE_MISSING';
              throw error;
            }
            fs.writeFileSync(path.join(targetDir, '.shipde-deps-ready'), 'ready', 'utf8');
            try {
              if (fs.existsSync(depsDir)) {
                fs.rmSync(depsDir, { recursive: true, force: true });
              }
              fs.renameSync(targetDir, depsDir);
            } catch (renameErr) {
              // A concurrent launch finished first: its complete tree wins.
              fs.rmSync(targetDir, { recursive: true, force: true });
              if (!cacheReady()) throw renameErr;
            }
          } catch (provisionError) {
            provisionError.relativePath = failedPath.split(path.sep).join('/');
            fs.rmSync(targetDir, { recursive: true, force: true });
            throw provisionError;
          }
        }

        // Provision the entire graph into this checkout. No worker path may
        // resolve through shared pnpm workspace links or mutable cache files.
        const excluded = retargetSharedDepsWorkspaceLinks(depsDir, workerRoot);
        if (excluded.length > 0) appendGitInfoExclude(workerRoot, excluded);

        try {
          fs.rmSync(path.join(workerRoot, '.local'), { recursive: true, force: true });
        } catch {}
      } catch (err) {
        recordWorkerDepsUnavailable(opts, workerRoot, err);
      }
    }

    // DS-R04: store the credential env for the worker allowlist
    let selectedCredentialEnv = null;
    let directModelRewrite = null;

    if (adapter.id === 'opencode-direct') {
      const sourcesModule = require('./sources');
      const staticSources = require('./sources.json');
      const loadedSources =
        opts && opts.sources
          ? Array.isArray(opts.sources)
            ? opts.sources
            : (opts.sources && opts.sources.sources) || []
          : sourcesModule.loadSources(opts).sources;
      // Discovered (probed) direct sources are only in the merged registry.
      const sources = {
        ...staticSources,
        sources: (staticSources.sources || []).concat(
          loadedSources.filter(
            (entry) => !(staticSources.sources || []).some((s) => s.id === entry.id)
          )
        ),
      };
      const { parseCandidateKey } = require('./discovery/identity');

      // Extract pinned model id from args or options (the exact --model string opencode receives)
      const modelIdx = Array.isArray(args) ? args.indexOf('--model') : -1;
      const pinnedModel =
        modelIdx !== -1 && modelIdx + 1 < args.length
          ? args[modelIdx + 1]
          : (opts && opts.pinnedModel) || (opts && opts.model) || null;

      // SUPERVISOR FIX: resolve source from options, candidate gateway, or model prefix
      let selectedSource =
        opts && (opts.selectedSource || (typeof opts.source === 'object' ? opts.source : null));
      const candidateKey = (opts && opts.candidateKey) || null;
      let sourceId =
        (opts &&
          (opts.sourceId ||
            (typeof opts.source === 'string' ? opts.source : null) ||
            opts.gateway)) ||
        null;
      if (!sourceId && candidateKey) {
        const parsed = parseCandidateKey(candidateKey);
        sourceId = parsed && parsed.gateway ? parsed.gateway : null;
      }
      if (!sourceId && pinnedModel) {
        const prefix = sourcesModule.providerFromPrefix(pinnedModel);
        if (prefix) {
          const match = sources.sources.find(
            (s) =>
              s.id === prefix ||
              s.opencodeProvider === prefix ||
              s.modelPrefix === prefix + '/' ||
              s.modelPrefix === prefix
          );
          if (match) {
            sourceId = match.id;
          } else {
            const machineDataOff =
              process.env.AI_BRAIN_DISCOVERED_SOURCES === 'none' ||
              process.env.AI_BRAIN_MACHINE_DATA === 'none';
            if (!machineDataOff) {
              try {
                const { discoverSources } = require('./source-discovery');
                const discovered = discoverSources();
                const dMatch = discovered.find(
                  (s) => s.id === prefix || s.opencodeProvider === prefix
                );
                if (dMatch) {
                  sourceId = dMatch.id;
                  selectedSource = dMatch;
                }
              } catch (_) {}
            }
          }
        }
      }

      // No gateway (legacy callers/tests) -> use 9router unchanged
      sourceId = sourceId || '9router';

      if (!selectedSource) {
        selectedSource =
          opts && (opts.selectedSource || (typeof opts.source === 'object' ? opts.source : null));
      }
      if (!selectedSource) {
        selectedSource = sources.sources.find(
          (s) => s.id === sourceId || s.opencodeProvider === sourceId
        );
      }
      if (!selectedSource) {
        const machineDataOff =
          process.env.AI_BRAIN_DISCOVERED_SOURCES === 'none' ||
          process.env.AI_BRAIN_MACHINE_DATA === 'none';
        if (!machineDataOff) {
          try {
            const { discoverSources } = require('./source-discovery');
            const discovered = discoverSources();
            selectedSource = discovered.find(
              (s) => s.id === sourceId || s.opencodeProvider === sourceId
            );
          } catch (_) {}
        }
      }
      if (!selectedSource) {
        const err = new Error(
          `OPENCODE_DIRECT_SOURCE_UNKNOWN: gateway '${sourceId}' not found in sources.json`
        );
        err.code = 'OPENCODE_DIRECT_SOURCE_UNKNOWN';
        throw err;
      }

      // DS-R02: validate that the source has an https endpoint (or http://127.0.0.1 / localhost) and credential.env
      const isKeyless = Boolean(
        selectedSource.opencodeBuiltin &&
        selectedSource.credential &&
        selectedSource.credential.type === 'none'
      );
      const endpoint = selectedSource.endpoint;
      const credentialEnv =
        (selectedSource.credential &&
          (selectedSource.credential.env || selectedSource.credential.name)) ||
        selectedSource.apiKeyEnv;

      const isHttpsOrLocalhost =
        endpoint &&
        (endpoint.startsWith('https://') ||
          endpoint.startsWith('http://127.0.0.1') ||
          endpoint.startsWith('http://localhost'));

      // OpenCode's built-in provider (Zen free tier) needs neither a key nor a
      // provider block: opencode resolves `opencode/<model>` itself.
      const builtin = isKeyless;
      if (builtin) {
        const builtinProvider = selectedSource.opencodeProvider;
        if (pinnedModel && !pinnedModel.startsWith(builtinProvider + '/')) {
          directModelRewrite = builtinProvider + '/' + pinnedModel;
        }
      }

      if (!builtin && (!isHttpsOrLocalhost || !credentialEnv)) {
        const err = new Error(
          `OPENCODE_DIRECT_SOURCE_UNSUPPORTED: source '${sourceId}' does not have a valid https endpoint (or http://127.0.0.1 / localhost) and credential.env`
        );
        err.code = 'OPENCODE_DIRECT_SOURCE_UNSUPPORTED';
        throw err;
      }

      const isRouter = selectedSource.kind === 'router' || Boolean(selectedSource.modelPrefix);

      // DS-R04: verify that the credential is available in the host environment before spawning (direct sources only; router never checked)
      if (!builtin && !isRouter && !process.env[credentialEnv]) {
        const err = new Error(
          `OPENCODE_DIRECT_CREDENTIAL_MISSING: environment variable ${credentialEnv} is not set`
        );
        err.code = 'OPENCODE_DIRECT_CREDENTIAL_MISSING';
        throw err;
      }

      // Store for later use in buildWorkerLaunchScript
      selectedCredentialEnv = builtin ? null : credentialEnv;

      // DS-R03: for direct sources, provider id must be the source id, not the model name
      const providerId =
        isRouter && pinnedModel
          ? sourcesModule.providerFromPrefix(pinnedModel) || selectedSource.id
          : selectedSource.opencodeProvider || selectedSource.id;

      // The worker config below registers only providerId, keyed by the source's own model id
      // (which may contain '/'). opencode splits --model at the first '/', so any id not already
      // qualified with providerId must be, even if it contains a slash.
      if (!isRouter && pinnedModel && !pinnedModel.startsWith(providerId + '/')) {
        directModelRewrite = providerId + '/' + pinnedModel;
      }

      if (pinnedModel && isRouter) {
        const derivedFromModel = sourcesModule.providerFromPrefix(pinnedModel);
        if (derivedFromModel && derivedFromModel !== providerId) {
          throw new Error(
            `OPENCODE_DIRECT_LAUNCH_FAILED: provider mismatch between model prefix '${derivedFromModel}' and provider '${providerId}'`
          );
        }
      }

      const modelsMap = {};
      if (pinnedModel) {
        const prefixWithSlash = providerId + '/';
        const relativeId = pinnedModel.startsWith(prefixWithSlash)
          ? pinnedModel.slice(prefixWithSlash.length)
          : pinnedModel;

        const routerProvider = selectedSource.modelPrefix
          ? sourcesModule.providerFromPrefix(selectedSource.modelPrefix)
          : null;
        const useFullWireId = isRouter && routerProvider && providerId !== routerProvider;
        const wireId = useFullWireId ? pinnedModel : relativeId;

        const outputLimit =
          (selectedSource.modelMeta && selectedSource.modelMeta[pinnedModel]?.limit?.output) ||
          (selectedSource.options && selectedSource.options.max_tokens) ||
          4096;
        const contextLimit =
          (selectedSource.modelMeta && selectedSource.modelMeta[pinnedModel]?.limit?.context) ||
          32000;

        const modelEntry = {
          id: wireId,
          name: relativeId,
          limit: {
            context: contextLimit,
            output: outputLimit,
          },
        };
        modelsMap[pinnedModel] = modelEntry;
        if (relativeId && relativeId !== pinnedModel) {
          modelsMap[relativeId] = modelEntry;
        }
      }

      const providerOptions = {
        baseURL: selectedSource.endpoint,
        ...(credentialEnv ? { apiKey: `{env:${credentialEnv}}` } : {}),
        ...(selectedSource.headers && typeof selectedSource.headers === 'object'
          ? { headers: selectedSource.headers }
          : {}),
      };
      if (selectedSource.options && typeof selectedSource.options === 'object') {
        Object.assign(providerOptions, selectedSource.options);
      }
      // Ensure apiKey is strictly {env:credentialEnv} and never leaked/overwritten.
      // On the keyless branch, delete any apiKey copied from options so no literal key is written.
      if (credentialEnv) {
        providerOptions.apiKey = `{env:${credentialEnv}}`;
      } else {
        delete providerOptions.apiKey;
      }

      // Permission scoping: strictly worker root, shared deps and report dir; no whole-machine wildcard
      const normWorker = path.resolve(workerRoot).replace(/\\/g, '/');
      const workerPattern = normWorker.endsWith('/') ? normWorker + '**' : normWorker + '/**';
      const extDirPerms = {
        [workerPattern]: 'allow',
      };
      const depsBase = path.join(path.dirname(workerRoot), 'deps');
      if (fs.existsSync(depsBase)) {
        const normDeps = path.resolve(depsBase).replace(/\\/g, '/');
        const depsPattern = normDeps.endsWith('/') ? normDeps + '**' : normDeps + '/**';
        extDirPerms[depsPattern] = 'allow';
      }
      if (opts && opts.usageDir) {
        const normUsage = path.resolve(opts.usageDir).replace(/\\/g, '/');
        const usagePattern = normUsage.endsWith('/') ? normUsage + '**' : normUsage + '/**';
        extDirPerms[usagePattern] = 'allow';
      }
      if (opts && opts.usageFile) {
        const reportDir = path.dirname(path.resolve(opts.usageFile)).replace(/\\/g, '/');
        const reportPattern = reportDir.endsWith('/') ? reportDir + '**' : reportDir + '/**';
        extDirPerms[reportPattern] = 'allow';
      }

      // DS-R03: generate opencode.json with the direct source's endpoint and credential
      const configPath = path.join(workerRoot, 'opencode.json');
      const configData = JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        permission: {
          external_directory: extDirPerms,
        },
        provider: {
          [providerId]: {
            npm: '@ai-sdk/openai-compatible',
            name: selectedSource.label || providerId,
            options: providerOptions,
            models: modelsMap,
          },
        },
      });
      fs.writeFileSync(configPath, configData, 'utf8');
      appendGitInfoExclude(workerRoot, ['opencode.json']);
      const hostRg = path.join(os.homedir(), '.cache', 'opencode', 'bin', 'rg.exe');
      if (fs.existsSync(hostRg)) {
        try {
          const workerRgDir = path.join(workerRoot, '.cache', 'opencode', 'bin');
          fs.mkdirSync(workerRgDir, { recursive: true });
          const workerRg = path.join(workerRgDir, 'rg.exe');
          if (!fs.existsSync(workerRg)) fs.copyFileSync(hostRg, workerRg);
          appendGitInfoExclude(workerRoot, ['.cache/']);
        } catch {}
      }
      if (builtin) {
        // opencode resolves its built-in provider from the public models.dev catalogue
        // cached at ~/.cache/opencode/models.json; without it (the worker's USERPROFILE is
        // the worker root and cannot fetch it) every Zen call is "Unexpected server error".
        const hostCatalogue = path.join(os.homedir(), '.cache', 'opencode', 'models.json');
        const workerCache = path.join(workerRoot, '.cache', 'opencode');
        if (fs.existsSync(hostCatalogue)) {
          fs.mkdirSync(workerCache, { recursive: true });
          fs.copyFileSync(hostCatalogue, path.join(workerCache, 'models.json'));
          appendGitInfoExclude(workerRoot, ['.cache/']);
        }
      }
    }

    let exerciseResult = null;
    if (opts.exercise) {
      exerciseResult = materialiseExercise(workerRoot, {
        exercise: opts.exercise,
        baseSha: headSha,
        spawnSync: opts.spawnSync,
        isWorkerPath: opts.isWorkerPath,
      });
      appendGitInfoExclude(workerRoot, ['tools/ai-brain/test/e1-branch-name.test.js']);
    }

    if (typeof opts.onProvisioned === 'function') {
      const hookRes = opts.onProvisioned(workerRoot, {
        baseSha: headSha,
        exercise: opts.exercise,
        exerciseResult,
        adapter,
        args,
      });
      if (hookRes && !exerciseResult) {
        exerciseResult = hookRes;
      }
    }

    // Final pre-launch check: verify HEAD has not moved from base SHA (or retained head) before agent starts
    const expectedActiveSha = retainWorkerHead || headSha;
    const { withCleanGitEnv, safeGit } = require('./supervisor');
    let preLaunchHead = null;
    try {
      preLaunchHead = withCleanGitEnv(
        workerRoot,
        (safeGitDir) => {
          const curHeadRes = safeGit(
            safeGitDir,
            workerRoot,
            ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
            20000
          );
          if (curHeadRes && curHeadRes.status === 0 && curHeadRes.stdout) {
            return curHeadRes.stdout.trim();
          }
          return null;
        },
        { workerWritable: true }
      );
    } catch {
      preLaunchHead = null;
    }
    if (!preLaunchHead) {
      const normWorker = path.resolve(workerRoot).replace(/\\/g, '/');
      const revRes = (opts.spawnSync || cp.spawnSync)(
        'git',
        [
          '-c',
          'safe.directory=' + normWorker,
          '-c',
          'core.hooksPath=' + nulDevice,
          '-c',
          'core.fsmonitor=false',
          '-c',
          'core.attributesFile=' + nulDevice,
          'rev-parse',
          '--verify',
          '--quiet',
          'HEAD^{commit}',
        ],
        {
          cwd: workerRoot,
          encoding: 'utf8',
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        }
      );
      if (revRes && revRes.status === 0 && revRes.stdout) {
        preLaunchHead = revRes.stdout.trim();
      }
    }
    // Same rule as provisioning: a carried-over merge on the base is the base.
    const preLaunchOk = retainWorkerHead
      ? Boolean(preLaunchHead) && preLaunchHead.toLowerCase() === expectedActiveSha.toLowerCase()
      : provisionedHeadMatchesBase(workerRoot, preLaunchHead, headSha, carriedOver);
    if (!preLaunchOk) {
      const code = retainWorkerHead ? 'WORKER_HEAD_MISMATCH' : 'PROVISION_BASE_MISMATCH';
      const err = new Error(
        code +
          ': worker root HEAD before agent start (' +
          (preLaunchHead || 'unknown') +
          ') does not match requested SHA ' +
          expectedActiveSha
      );
      err.code = code;
      throw err;
    }

    const rtkConfig = opts.rtk || null;
    let rtkEnabled = false;
    let rtkDecision = 'not_requested';
    let rtkPathPrepend = null;
    const RISK_DOMAINS = ['auth', 'tenancy', 'money', 'carrier', 'security'];

    if (rtkConfig && rtkConfig.enabled) {
      const isRepairRound = Boolean(retainWorkerHead);
      const hasRiskDomains =
        Array.isArray(opts.riskDomains) &&
        opts.riskDomains.some((d) => RISK_DOMAINS.includes(String(d).toLowerCase()));
      const isLowRisk = opts.lowRisk === true || !hasRiskDomains;

      if (isRepairRound) {
        rtkDecision = 'repair_round_blocks_rtk';
      } else if (hasRiskDomains) {
        rtkDecision = 'risk_domains_block_rtk';
      } else if (!isLowRisk) {
        rtkDecision = 'not_low_risk';
      } else {
        // RTK is optional for isolated execution: never write rtk.exe into
        // workerRoot/.shipde-bin or stage under a worker-writable ancestor.
        // Only use a pre-provisioned trusted directory outside workerRoot/parent.
        const rtkSource =
          rtkConfig.sourcePath ||
          process.env.SHIPDE_RTK_PATH ||
          path.join(
            process.env.LOCALAPPDATA || '',
            'Microsoft',
            'WinGet',
            'Packages',
            'rtk-ai.rtk_Microsoft.Winget.Source_8wekyb3d8bbwe',
            'rtk.exe'
          );
        const rtkResolved = resolveIsolatedRtkDecision(workerRoot, rtkConfig, process.env);
        rtkEnabled = rtkResolved.enabled;
        rtkPathPrepend = rtkResolved.pathPrepend;
        rtkDecision = rtkResolved.reason;
        if (!rtkEnabled) {
          console.error(
            '[ISOLATION_LAUNCHER] RTK_UNAVAILABLE: ' + rtkDecision + ' (source=' + rtkSource + ')'
          );
        }
      }
    } else {
      rtkDecision = 'rtk_not_enabled';
    }

    const credPath = path.join(process.env.LOCALAPPDATA || '', 'ShipDe', 'WorkerUser.cred');

    const exe = executableFor(adapter.command, opts);
    let fullArgs = exe.prefixArgs.concat(args);

    if (rtkEnabled && fullArgs.length > 0 && typeof fullArgs[fullArgs.length - 1] === 'string') {
      const hint =
        '\n\n# RTK is optional for reading long output (use: rtk test, rtk err, rtk git diff).\n# Final check and all evidence are produced by the host, raw.';
      fullArgs = [...fullArgs.slice(0, -1), fullArgs[fullArgs.length - 1] + hint];
    }

    // Q6: the launch result is written to a HOST-OWNED directory outside
    // workerRoot. Inside workerRoot a worker child that survives the main
    // process could overwrite launch-result.json and forge the telemetry the
    // node parent reads. LOCALAPPDATA\ShipDe\launch-results is operator-only.
    const launchResultDir = path.join(
      process.env.LOCALAPPDATA || 'C:\\temp',
      'ShipDe',
      'launch-results'
    );
    fs.mkdirSync(launchResultDir, { recursive: true });
    const launchResultPath = path.join(launchResultDir, jobName + '-' + Date.now() + '.json');

    // P6: the worker wait is bounded. A hung worker is killed after the
    // timeout instead of blocking the controller forever.
    const workerTimeoutMs =
      Number.isFinite(Number(opts.workerTimeoutMs)) && Number(opts.workerTimeoutMs) > 0
        ? Number(opts.workerTimeoutMs)
        : DEFAULT_WORKER_TIMEOUT_MS;
    const tokenBudget =
      opts.tokenBudget && typeof opts.tokenBudget === 'object' ? opts.tokenBudget : null;
    const budgetJson = tokenBudget ? JSON.stringify(tokenBudget) : '';

    // Bound to THIS launch: run-target.ps1 can only write a marker carrying
    // this nonce, so a leftover marker from an earlier job can never satisfy
    // the completion gate below.
    const completionNonce = crypto.randomBytes(16).toString('hex');
    const payloadDir = path.join(workerRoot, '.shipde');
    fs.mkdirSync(payloadDir, { recursive: true });
    appendGitInfoExclude(workerRoot, [
      '.shipde/',
      'run-target.ps1',
      'run-target.complete.json',
      'temp/',
      '.config/',
      '.local/',
      'Microsoft/',
      'AppData/',
      '.cache/',
      '.upstream-tmp/',
    ]);
    const payloadArgsPath = path.join(payloadDir, 'launch-args-' + completionNonce + '.json');

    // TASK-AI-113: Windows caps a command line at ~32,767 characters. The
    // opencode-direct author prompt (TASK-AI-109 skill pack) blew past that and
    // every isolated launch failed with "The filename or extension is too
    // long". The prompt is the LAST positional arg from
    // harness.js opencodeDirect.launch; write it to a file inside workerRoot
    // and hand the model a short instruction that points at the file. The
    // file is UTF-8 with no BOM and is covered by the `.shipde/` git exclude
    // added above.
    // The isolated worker cannot read host paths, so the focused context pack
    // the Controller wrote on the host travels into .shipde/ with the prompt.
    let launchArgs = fullArgs.map((arg) =>
      typeof arg === 'string' ? stageContextPack(arg, payloadDir, completionNonce) : arg
    );
    if (adapter.id === 'opencode-direct') {
      if (directModelRewrite) {
        const modelIdx = launchArgs.indexOf('--model');
        if (modelIdx !== -1 && modelIdx + 1 < launchArgs.length) {
          launchArgs[modelIdx + 1] = directModelRewrite;
        }
      }
      if (launchArgs.length > 0) {
        const prompt = launchArgs[launchArgs.length - 1];
        if (typeof prompt === 'string' && prompt.length > 0) {
          const promptFileName = 'prompt-' + completionNonce + '.md';
          fs.writeFileSync(path.join(payloadDir, promptFileName), Buffer.from(prompt, 'utf8'));
          launchArgs = launchArgs
            .slice(0, -1)
            .concat(
              'Read the file .shipde/' +
                promptFileName +
                ' in the current directory. It is your complete task; follow it exactly.'
            );
        }
      }
    }

    fs.writeFileSync(payloadArgsPath, JSON.stringify(launchArgs), 'utf8');

    const scriptContent = buildWorkerLaunchScript({
      credPath,
      workerRoot,
      workerUsername: WORKER_USERNAME,
      exeFile: exe.file,
      exePrefixArgs: exe.prefixArgs || [],
      payloadArgsPath,
      launchResultPath,
      workerTimeoutMs,
      completionNonce,
      adapterId: adapter.id,
      model: opts.model || null,
      upstream: opts.upstream || null,
      isolationVerdict: verdictData,
      isolationVerdictPath: verdictPath,
      rtkPathPrepend,
      credentialEnv: selectedCredentialEnv,
      tokenBudget,
      progressTimeoutMs: opts.progressTimeoutMs || null,
      usageFile: opts.usageFile || null,
    });

    const tempScript = path.join(os.tmpdir(), 'isolated-launch-' + Date.now() + '.ps1');
    fs.writeFileSync(tempScript, scriptContent, 'utf8');

    const hostRes = cp.spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tempScript],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: workerTimeoutMs + 120000,
        maxBuffer: 16 * 1024 * 1024,
      }
    );

    try {
      fs.unlinkSync(tempScript);
    } catch (e) {}

    const launchResult = readLaunchResult(launchResultPath, completionNonce, hostRes);
    if (opts.usageFile && !fs.existsSync(opts.usageFile)) {
      const { writeUsageReportFromHarnessResult } = require('./orchestrate');
      const job = Object.assign({}, opts, opts.job, {
        harness: (adapter && adapter.id) || (opts.job && opts.job.harness),
        usageFile: opts.usageFile || (opts.job && opts.job.usageFile),
      });
      delete job.run;
      writeUsageReportFromHarnessResult(job, launchResult);
    }
    enforceTokenBudget(launchResult, opts.tokenBudget, opts.usageFile);
    if (exerciseResult) {
      launchResult.exercise = exerciseResult;
      launchResult.failBefore = exerciseResult.failBefore;
    }
    launchResult.carriedOver = carriedOver;
    launchResult.rtk = { provided: rtkEnabled, reason: rtkDecision };
    launchResult.tokenBudget = opts.tokenBudget || null;
    launchResult.workerRoot = launchResult.workerRoot || workerRoot;
    launchResult.worktree = launchResult.worktree || workerRoot;

    if (
      adapter?.id === 'codex' &&
      opts.commitFileOnlyWriter === true &&
      launchResult.exitCode === 0 &&
      !launchResult.timedOut
    ) {
      try {
        launchResult.workerSha = commitNativeWriterChanges({
          workerRoot,
          hostRoot: hostCwd,
          workItemId: opts.workItemId,
        });
        launchResult.retainedHeadSha = launchResult.workerSha;
      } catch {
        launchResult.exitCode = 1;
        launchResult.localFailure = 'NATIVE_WRITER_COMMIT_FAILED';
        launchResult.failureReason = 'NATIVE_WRITER_COMMIT_FAILED';
        delete launchResult.workerSha;
        delete launchResult.retainedHeadSha;
      }
    }

    // Ensure any modified register row or staged work item spec for a GOAL item
    // is committed into the workerSha so the PR contract passes
    if (
      adapter?.id !== 'codex' &&
      opts.workItemId &&
      typeof opts.workItemId === 'string' &&
      opts.workItemId.toUpperCase().startsWith('GOAL-') &&
      fs.existsSync(workerRoot) &&
      fs.existsSync(path.join(workerRoot, '.git'))
    ) {
      try {
        const amended = commitWorkerMetadata({
          hostRoot: hostCwd,
          workerRoot,
          workItemId: opts.workItemId,
          headSha: opts.headSha,
        });
        if (amended) {
          launchResult.workerSha = amended;
          launchResult.retainedHeadSha = amended;
        }
      } catch (error) {
        launchResult.exitCode = 1;
        launchResult.localFailure = 'WORKER_COMMIT_FAILED';
        launchResult.failureReason = String(error.message);
        launchResult.stderr = [launchResult.stderr, launchResult.failureReason]
          .filter(Boolean)
          .join('\n');
        delete launchResult.workerSha;
        delete launchResult.retainedHeadSha;
      }
    }

    if (
      !launchResult.localFailure &&
      !launchResult.workerSha &&
      fs.existsSync(workerRoot) &&
      fs.existsSync(path.join(workerRoot, '.git'))
    ) {
      try {
        const { withCleanGitEnv, safeGit } = require('./supervisor');
        const headSha = withCleanGitEnv(
          workerRoot,
          (safeGitDir) => {
            const curHeadRes = safeGit(
              safeGitDir,
              workerRoot,
              ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
              20000
            );
            return curHeadRes && curHeadRes.status === 0 && curHeadRes.stdout
              ? curHeadRes.stdout.trim()
              : null;
          },
          { workerWritable: true }
        );
        if (headSha) {
          launchResult.workerSha = headSha;
          launchResult.retainedHeadSha = headSha;
        }
      } catch {}
    }
    if (
      opts.commitFileOnlyWriter === true &&
      !launchResult.localFailure &&
      launchResult.exitCode === 0 &&
      launchResult.workerSha &&
      opts.baseSha &&
      launchResult.workerSha !== opts.baseSha &&
      Array.isArray(opts.allowedPaths) &&
      opts.allowedPaths.length > 0 &&
      fs.existsSync(workerRoot) &&
      fs.existsSync(path.join(workerRoot, '.git'))
    ) {
      const diffCheck = require('./writer-scope').checkWriterCommitDiff({
        workerRoot,
        baseSha: opts.baseSha,
        headSha: launchResult.workerSha,
        allowedPaths: opts.allowedPaths,
      });
      if (!diffCheck.ok) {
        launchResult.exitCode = 1;
        launchResult.localFailure = diffCheck.code;
        launchResult.failureReason =
          diffCheck.code +
          (diffCheck.offending && diffCheck.offending.length
            ? ': ' + diffCheck.offending.join(', ')
            : '');
        launchResult.stderr = [launchResult.stderr, launchResult.failureReason]
          .filter(Boolean)
          .join('\n');
        delete launchResult.workerSha;
        delete launchResult.retainedHeadSha;
      }
    }
    return launchResult;
  };
}

/**
 * Reads the host-owned launch result for one launch.
 *
 * Q6: the file comes from LOCALAPPDATA\ShipDe\launch-results, never from
 * worker-writable workerRoot. PowerShell 5.1 writes it with a UTF-8 BOM, which
 * JSON.parse rejects, so the BOM is stripped exactly as it is for the verdict
 * and the approvals registry. Nothing here may fall back to the host process
 * status, which can be 0 for a job that never ran: an absent, unparsable,
 * timed-out or unproven result is a failed launch (exitCode -1), and only a
 * completed job carrying THIS launch's nonce returns the job's own exit code.
 */
function opencodeErrorFromStdout(stdout) {
  const found = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith('{')) continue;
    let ev;
    try {
      ev = JSON.parse(text);
    } catch {
      continue;
    }
    if (!ev || ev.type !== 'error' || !ev.error) continue;
    const data = ev.error.data || {};
    const msg = data.message || ev.error.message || ev.error.name || 'error';
    const status = data.statusCode ? ' (HTTP ' + data.statusCode + ')' : '';
    found.push('OPENCODE_ERROR: ' + String(msg).slice(0, 500) + status);
  }
  return found.slice(-3).join('\n');
}

function readLaunchResult(launchResultPath, completionNonce, hostRes) {
  const hostFailure = (reason) => ({
    exitCode: -1,
    stdout: (hostRes && hostRes.stdout) || '',
    stderr: [reason, String((hostRes && hostRes.stderr) || '').trim()].filter(Boolean).join('\n'),
    timedOut: Boolean(hostRes && hostRes.signal === 'SIGTERM'),
  });

  let resJson = null;
  try {
    if (!fs.existsSync(launchResultPath)) {
      throw new Error('the host script never wrote it');
    }
    const resultText = fs.readFileSync(launchResultPath, 'utf8');
    resJson = JSON.parse(resultText.charCodeAt(0) === 0xfeff ? resultText.slice(1) : resultText);
  } catch (e) {
    return hostFailure('[ISOLATION_LAUNCHER] launch result unreadable: ' + e.message);
  }

  const jobExit = Number(resJson.exitCode);
  let failureReason = undefined;
  if (typeof resJson.failureReason === 'string') {
    if (resJson.failureReason.startsWith('STALLED_NO_PROGRESS')) {
      failureReason = 'STALLED_NO_PROGRESS';
    } else if (resJson.failureReason.startsWith('TOKEN_BUDGET_EXCEEDED')) {
      failureReason = 'TOKEN_BUDGET_EXCEEDED';
    } else if (resJson.failureReason.startsWith('REQUEST_TOO_LARGE')) {
      failureReason = 'REQUEST_TOO_LARGE';
    } else if (resJson.failureReason.length > 0) {
      failureReason = resJson.failureReason;
    }
  } else if (resJson.budgetExceeded) {
    failureReason = 'TOKEN_BUDGET_EXCEEDED';
  } else if (resJson.requestTooLarge) {
    failureReason = 'REQUEST_TOO_LARGE';
  }

  if (
    resJson.timedOut === true ||
    resJson.completed !== true ||
    resJson.completionNonce !== completionNonce ||
    !Number.isFinite(jobExit)
  ) {
    return {
      exitCode: -1,
      stdout: String(resJson.stdout || ''),
      stderr: String(resJson.stderr || ''),
      timedOut: resJson.timedOut === true,
      ...(resJson.progressDetail ? { progressDetail: String(resJson.progressDetail) } : {}),
      ...(failureReason ? { failureReason } : {}),
    };
  }

  return {
    exitCode: resJson.localFailure ? 1 : jobExit,
    stdout: String(resJson.stdout || ''),
    stderr: [
      String(resJson.localFailure || ''),
      String(resJson.stderr || ''),
      // opencode reports API errors as JSON events on stdout and leaves stderr
      // empty; keep the real message so a failed launch is never only a budget note.
      (resJson.localFailure ? 1 : jobExit) !== 0 && !String(resJson.stderr || '').trim()
        ? opencodeErrorFromStdout(resJson.stdout)
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    localFailure: resJson.localFailure ? String(resJson.localFailure) : null,
    timedOut: false,
    verifiedToolCalls: Number(resJson.verifiedToolCalls) || 0,
    completionNonce: resJson.completionNonce,
    ...(resJson.sessionId ? { sessionId: resJson.sessionId } : {}),
    ...(resJson.launchHandle ? { launchHandle: resJson.launchHandle } : {}),
    ...(resJson.workerSha ? { workerSha: resJson.workerSha } : {}),
    ...(resJson.workerRoot ? { workerRoot: resJson.workerRoot } : {}),
    ...(resJson.usage ? { usage: resJson.usage } : {}),
    ...(resJson.progressDetail ? { progressDetail: String(resJson.progressDetail) } : {}),
    ...(failureReason ? { failureReason } : {}),
  };
}

function isWithinPath(parentDir, childPath) {
  const rel = path.relative(path.resolve(parentDir), path.resolve(childPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isSymlinkOrJunction(targetPath) {
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink()) return true;
    const real = fs.realpathSync(targetPath);
    return path.resolve(real).toLowerCase() !== path.resolve(targetPath).toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Minimal fail-closed RTK decision for isolated execution:
 * Never copies rtk.exe into workerRoot or under a worker-writable ancestor.
 * Only uses a pre-provisioned trustedBinDir outside workerRoot and its parent
 * directory whose executable exists and is not a symlink/junction.
 */
function resolveIsolatedRtkDecision(workerRoot, rtkConfig, env) {
  const cfg = rtkConfig && typeof rtkConfig === 'object' ? rtkConfig : {};
  const e = env || process.env;
  const rawDir = cfg.trustedBinDir || e.SHIPDE_RTK_TRUSTED_BIN_DIR || '';
  if (!rawDir || typeof rawDir !== 'string' || !rawDir.trim()) {
    return {
      enabled: false,
      pathPrepend: null,
      reason: 'rtk_omitted_isolated_no_trusted_bin',
    };
  }
  const trustedDir = path.resolve(rawDir.trim());
  const resolvedWorker = path.resolve(workerRoot);
  const workerParent = path.dirname(resolvedWorker);
  if (
    isWithinPath(resolvedWorker, trustedDir) ||
    (workerParent && workerParent !== resolvedWorker && isWithinPath(workerParent, trustedDir))
  ) {
    return {
      enabled: false,
      pathPrepend: null,
      reason: 'rtk_omitted_isolated_untrusted_ancestor',
    };
  }
  if (!fs.existsSync(trustedDir) || isSymlinkOrJunction(trustedDir)) {
    return {
      enabled: false,
      pathPrepend: null,
      reason: 'rtk_omitted_isolated_untrusted_dir',
    };
  }
  const exePath = path.join(trustedDir, 'rtk.exe');
  if (!fs.existsSync(exePath) || isSymlinkOrJunction(exePath)) {
    return {
      enabled: false,
      pathPrepend: null,
      reason: 'rtk_omitted_isolated_exe_missing',
    };
  }
  return {
    enabled: true,
    pathPrepend: trustedDir,
    reason: 'provided',
  };
}

module.exports = {
  resolveIsolatedRtkDecision,
  retainedRootHasOwnWriterRecord,
  retargetSharedDepsWorkspaceLinks,
  provisionedHeadMatchesBase,
  commitNativeWriterChanges,
  commitWorkerMetadata,
  validateWorkerGitConfig,
  isWorkerConfigKeyAllowed,
  getIsolatedLauncher,
  getFolderHash,
  defaultVerifyBoundary,
  buildBoundaryVerifyScript,
  buildWorkerLaunchScript,
  workerRootFor,
  isWorkerPath,
  readClosedIsolationVerdict,
  appendGitInfoExclude,
  carryOverSave,
  carryOverRestore,
  materialiseExercise,
  captureFailBefore,
  WORKER_USERNAME,
  WORKER_ROOT,
  readLaunchResult,
  EXPECTED_FIREWALL_RULES,
  DEFAULT_WORKER_TIMEOUT_MS,
  enforceTokenBudget,
  ensureGoalRegistrationInWorker,
  controllerGit,
  hookedControllerGit,
};
