#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Brain CLI
 *
 *   node tools/ai-brain/cli.js reconcile [--json] [--strict]
 *   node tools/ai-brain/cli.js prove --tests "<command>" [...]
 *   node tools/ai-brain/cli.js dispatch [--dry-run | --execute] [--plan <file>]
 *                                       [--profile <file.json>] [--report-outcome <file.json>]
 *   node tools/ai-brain/cli.js shadow --project|--compare [--register <p>] [--shadow <p>] [--json] [--dry-run]
 *   node tools/ai-brain/cli.js probe --account <id> [--model <m>] [--json]
 *                                   [--file <p>] [--timeout <ms>] [--cache-window <ms>]
 *   node tools/ai-brain/cli.js qualify --account <id> --model <m> [--role <roleId>]
 *                                      [--json] [--file <p>]
 *
 * `reconcile` asks whether the register can back up what it claims.
 * `prove` runs the checks an agent says it ran, and reports what happened.
 * `probe` runs the one bounded, recorded account-qualification probe
 * (TASK-AI-30): a cheapest-model real request through the account's own
 * launch path, whose outcome — pass, fail, timeout or refused — is recorded
 * in tools/ai-brain/qualification-results/results.json and reused inside the
 * cache window. It never grants qualification; that is TASK-AI-31.
 * `qualify` (TASK-AI-31) reads the probe result and grants qualifiedRoles
 * only when the outcome was 'pass' and the result is within the cache window.
 *
 * Exit codes: 0 when nothing is overstated, 1 when it is. --strict also fails
 * on warnings, for use in CI where an unrecorded merge should block.
 */

const path = require('path');
const { reconcileRegister, planReconciliation, applyStatusMutations } = require('./reconcile');
const { auditManifest } = require('./manifest-audit');
const { runCheck, currentBranch, headSha, commitExists } = require('./facts');
const { toPositiveInteger } = require('./source-discovery');
const { atomicRenameSync } = require('./atomic-rename');
const { maskEmailsInString } = require('./route-identity-utils');

const SEVERITY_LABEL = { error: 'LỖI ', warn: 'CẢNH', info: 'GHI ' };

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else out._.push(token);
  }
  return out;
}

/**
 * Options this command understands. Anything else is a typo, and a typo is
 * refused rather than ignored: silently dropping `--registr` would run the
 * reconciler against the real register while the operator believed they were
 * pointed at a fixture, which is the one mistake write-back must never make.
 */
const {
  loadRegister,
  pick,
  sha256,
  isProtectedCheckout,
  readJsonOrExit,
  revertCommand,
  reconcileCommand,
  allowFixtureWriteFor,
  writeAudit,
  printReport,
  manifestCommand,
  proveCommand,
  quotaCommand,
} = require('./cli/reconcile-manifest');
const {
  DRY_RUN_BLOCK_CODES,
  LIVE_BLOCK_CODES,
  mergeEvidenceAccounts,
  routeScopeOf,
  assembleForDispatch,
  readCheckpoint,
  writeJsonFile,
  usageReportFile,
  sevenFields,
  quotaSnapshot,
  candidateFromDecision,
  simulatedFailureFor,
  sameFailureDomain,
  applyFailureBlocks,
  applyDryRunBlocks,
  candidateContextWindow,
  applyHarnessVerification,
  buildDryRunLog,
  resolveFixturePaths,
  dispatchProfileCommand,
  coordinatorDispatchCommand,
  resolveExecuteBase,
} = require('./cli/dispatch-helpers');
const { dispatchCommand } = require('./cli/dispatch');
const {
  shadowCommand,
  reviewCommand,
  reviewPrCommand,
  orchestrateCommand,
  tokenReportCommand,
  mergeCommand,
  intakeCommand,
  planCommand,
} = require('./cli/commands');

function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const command = args._[0] || 'reconcile';

  if (command === 'agy-gateway') {
    require('./agy-gateway')
      .start({ port: args.port ? Number(args.port) : undefined })
      .then((srv) =>
        console.log(`agy-gateway listening on http://127.0.0.1:${srv.address().port}/v1`)
      )
      .catch((err) => {
        console.error(err.message);
        process.exitCode = 1;
      });
    return;
  }

  if (command === 'reconcile') return reconcileCommand(args);
  if (command === 'report' && args._[1] === 'tokens') return tokenReportCommand(args);
  if (command === 'manifest') return manifestCommand(args);
  if (command === 'prove') return proveCommand(args);
  if (command === 'dispatch') {
    const result = dispatchCommand(args, {
      ...deps,
      readDispatchComboConfig:
        args.offline !== undefined
          ? undefined
          : deps.readDispatchComboConfig || require('./writer-combo').readComboConfig,
    });
    // The profile path (TASK-AI-65) is async: the JEV advisory returns a
    // promise. An unhandled rejection would crash silently, so it is caught
    // here and turned into a non-zero exit instead.
    if (result && typeof result.then === 'function') {
      result.then(
        (value) => {
          if (value?.exitCode) process.exitCode = value.exitCode;
        },
        (err) => {
          console.error('Dispatch lỗi: ' + (err && err.message ? err.message : err));
          process.exitCode = 1;
        }
      );
    }
    if (result?.exitCode) process.exitCode = result.exitCode;
    return result;
  }
  if (command === 'shadow') return shadowCommand(args);
  // review manifest validate (TASK-AI-77): check a review manifest against git
  // before anything is published or promoted on the strength of it.
  if (command === 'review') return reviewCommand(args);
  // account add | account limits | account secret (TASK-AI-29). The account
  // surface parses its own argv strictly, so a mistyped flag is refused
  // rather than dropped, and never routes through reconcile allowlists.
  if (command === 'account') {
    const { runAccountCli } = require('./account-entry');
    process.exit(runAccountCli(process.argv.slice(3)));
  }
  // docs (GOAL-AUTOCLAW-REPOS-4): Context7 library docs lookup with source citations
  if (command === 'docs') {
    require('./context7')
      .runDocsCli(process.argv.slice(3))
      .then(
        (code) => process.exit(code),
        (err) => {
          console.error(err.message);
          process.exit(1);
        }
      );
    return;
  }
  // serena (TASK-AI-32): Serena read-only pilot for code retrieval
  // Symbol and reference lookup for authors, measured against TokenPerMergedItem
  if (command === 'serena') {
    const { runSerenaCli, runSerenaLive } = require('./serena');
    if (process.argv[3] === 'live') {
      runSerenaLive(process.argv.slice(4)).then(
        (code) => process.exit(code),
        (err) => {
          console.error(err.message);
          process.exit(1);
        }
      );
      return;
    }
    process.exit(runSerenaCli(process.argv.slice(3)));
  }

  // orchestrate (TASK-AI-64): the live autonomous loop —
  //   node tools/ai-brain/cli.js orchestrate --goal <text|file> --specs <file>
  //     [--isolated-worker --base-sha <40-hex>] [--checkpoint <file>] [--out <file>]
  //
  // The specs are the real work items the operator named and the candidates come
  // from the live registry: the old command synthesised one DRY-RUN-GOAL item and
  // two demo candidates, injected a launcher that failed once on a counter, and
  // injected three green gates, so the goal text never became work and no identity
  // came from the registry. Nothing is injected here any more — a live run either
  // launches for real or is refused.
  if (command === 'orchestrate') return orchestrateCommand(args);

  // merge (TASK-AI-133): governed exact-HEAD auto-merge without supervisor
  //   node tools/ai-brain/cli.js merge --work-item <ID> [--config <file>] [--repo <owner/repo>]
  if (command === 'merge') {
    const result = mergeCommand(args);
    if (result && typeof result.then === 'function') {
      result.then(
        () => {},
        (err) => {
          console.error('Merge lỗi: ' + (err && err.message ? err.message : err));
          process.exitCode = 1;
        }
      );
    }
    return;
  }

  // intake (TASK-AI-131): build every orchestrate input from repository sources.
  // Async (the catalogue merge awaits its live listings), so the exit code is
  // set via process.exitCode and any rejection is caught rather than crashing.
  if (command === 'intake') {
    const result = intakeCommand(args);
    if (result && typeof result.then === 'function') {
      result.then(
        () => {},
        (err) => {
          console.error('Intake lỗi: ' + (err && err.message ? err.message : err));
          process.exitCode = 1;
        }
      );
    }
    return;
  }

  // plan (TASK-AI-141 G): draft only from approved, cited repository sources.
  if (command === 'plan') {
    const rootDir = args.root || process.cwd();
    const planningDeps = require('./work-item-planner').defaultPlanningDeps(
      rootDir,
      deps.planningDeps || deps
    );
    planCommand(args, Object.assign({}, planningDeps, { __planningDepsReady: true }))
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
        if (result && (result.blocking || result.status === 'BLOCKED')) process.exitCode = 1;
      })
      .catch((err) => {
        console.error(
          (err && err.code ? err.code + ': ' : '') + (err && err.message ? err.message : err)
        );
        process.exitCode = 1;
      });
    return;
  }

  // next (TASK-AI-132): pick the next dependency-ready Work Item and run through intake.
  if (command === 'next') {
    const { nextCommand } = require('./next-runner');
    const result = nextCommand(args);
    if (result && typeof result.then === 'function') {
      result.then(
        (res) => {
          if (
            res &&
            (res.status === 'failed' ||
              res.failed ||
              (typeof res.exitCode === 'number' && res.exitCode !== 0))
          ) {
            process.exitCode =
              typeof res.exitCode === 'number' && res.exitCode !== 0 ? res.exitCode : 1;
          }
        },
        (err) => {
          console.error('Next lỗi: ' + (err && err.message ? err.message : err));
          process.exitCode = 1;
        }
      );
    }
    return;
  }

  // chat (TASK-AI-142 H2): interactive Hermes chat session bound to Controller-selected candidate
  if (command === 'chat') {
    const { chatCommand } = require('./hermes-session');
    const result = chatCommand(args, deps);
    if (result && typeof result.then === 'function') {
      result.then(
        (res) => {
          if (res && typeof res.exitCode === 'number' && res.exitCode !== 0) {
            process.exitCode = res.exitCode;
          }
        },
        (err) => {
          console.error('Chat error: ' + (err && err.message ? err.message : err));
          process.exitCode = 1;
        }
      );
    }
    return result;
  }

  // goal (TASK-AI-142 H1/H2): goal store and session management
  if (command === 'goal') {
    const sub = args._[1];
    if (sub === 'session') {
      const { goalSessionCommand } = require('./hermes-session');
      const result = goalSessionCommand(args, deps);
      if (result && typeof result.then === 'function') {
        result.then(
          (res) => {
            if (res && typeof res.exitCode === 'number' && res.exitCode !== 0) {
              process.exitCode = res.exitCode;
            }
          },
          (err) => {
            console.error(
              JSON.stringify({
                status: 'error',
                error: err && err.message ? err.message : String(err),
              })
            );
            process.exitCode = 1;
          }
        );
      }
      return result;
    }
    let goals;
    try {
      if (deps && deps.loadGoals) {
        goals = deps.loadGoals();
      } else if (deps && deps.goals !== undefined) {
        goals = deps.goals;
        if (goals instanceof Error) throw goals;
      } else {
        goals = require('./goals');
      }
    } catch (loadErr) {
      console.error(
        JSON.stringify({
          status: 'error',
          error:
            'GOAL_MODULE_UNAVAILABLE: ' +
            (loadErr && loadErr.message ? loadErr.message : String(loadErr)),
        })
      );
      process.exitCode = 1;
      return;
    }
    // H1 runGoalCli prints its own JSON document and returns the exit code; it
    // is terminal, so its number must become the process exit code untouched.
    if (
      goals &&
      typeof goals.goalCommand !== 'function' &&
      typeof goals.runGoalCli === 'function'
    ) {
      try {
        const code = goals.runGoalCli(args, deps);
        if (typeof code === 'number') process.exitCode = code;
        return code;
      } catch (cmdErr) {
        console.error(
          JSON.stringify({
            status: 'error',
            error: cmdErr && cmdErr.message ? cmdErr.message : String(cmdErr),
          })
        );
        process.exitCode = 1;
        return;
      }
    }
    if (goals && typeof goals.goalCommand === 'function') {
      try {
        const result = goals.goalCommand(args, deps);
        if (result && typeof result.then === 'function') {
          result.then(
            (res) => {
              if (res && typeof res.exitCode === 'number' && res.exitCode !== 0) {
                process.exitCode = res.exitCode;
              }
            },
            (err) => {
              console.error(
                JSON.stringify({
                  status: 'error',
                  error: err && err.message ? err.message : String(err),
                })
              );
              process.exitCode = 1;
            }
          );
        }
        return;
      } catch (cmdErr) {
        console.error(
          JSON.stringify({
            status: 'error',
            error: cmdErr && cmdErr.message ? cmdErr.message : String(cmdErr),
          })
        );
        process.exitCode = 1;
        return;
      }
    }
    console.error(
      JSON.stringify({
        status: 'error',
        error: 'UNKNOWN_GOAL_SUBCOMMAND: ' + (sub || 'missing subcommand'),
      })
    );
    process.exitCode = 1;
    return;
  }

  if (command === 'decisions' && args._[1] === 'compact') {
    console.log(JSON.stringify(require('./decisions').compactDecisions({ dir: args.dir })));
    return;
  }

  console.error('Lệnh không rõ: ' + command);
  console.error(
    'Dùng: reconcile | manifest | prove | dispatch | shadow | account | serena | docs | review | orchestrate | intake | plan | next | merge | goal | chat | goal session'
  );
  process.exit(2);
}

function executeDispatchLaunch(context) {
  const {
    args,
    deps,
    item,
    now,
    adapter,
    finalChosenCandidate,
    finalChosenKey,
    harnessName,
    rootDir,
    decisionDir,
    checkpointFile,
    checkpoint,
    lastDecision,
    limitsEnforcement,
    launcher,
    baseResolution,
    resolvedBaseSha,
    launchTimeoutMs,
    workerTimeoutMs,
    tokenBudget,
    outputCeiling,
    selectedMode,
    log,
    exit,
    route,
    promptText,
    usageFile,
  } = context;
  const decisionsStore = require('./decisions');
  const sourcesApi = require('./sources');
  const { readSessionId, workerName } = require('./executor');
  const { parseLastJson } = require('./harness');
  let launchRes = null;
  let thrownError = null;
  let isFailure = true;
  let sessionHandle = null;
  let handedOff = false;
  let launchPending = false;
  let launchAttempted = false;
  let launchArgs = null;
  try {
    const validation = adapter.validateLaunch?.({ accountId: finalChosenCandidate.accountId });
    if (validation) launchArgs = validation;
    else if (adapter.requiresUsageReport && !usageFile) {
      throw new Error('HARNESS_USAGE_REPORT_REQUIRED');
    }
    if (!launchArgs)
      launchArgs = adapter.launch({
        candidateKey: finalChosenKey,
        provider:
          (route && route.provider) || finalChosenCandidate.source || finalChosenCandidate.upstream,
        model: sourcesApi.qualifyModel(finalChosenCandidate.modelId, route),
        accountId: finalChosenCandidate.accountId,
        gateway: finalChosenCandidate.gateway || '',
        upstream: finalChosenCandidate.upstream,
        quotaScope: finalChosenCandidate.quotaScope,
        prompt: promptText,
        branch: item.branch,
        base: resolvedBaseSha,
        cwd: baseResolution.cwd || args.cwd || (deps && deps.cwd) || rootDir,
        usageFile: usageFile,
        checkpoint: checkpointFile,
        maxAttempts: 1,
        title: workerName(item.workItemId),
        labels: {
          workItem: item.workItemId,
          role: item.role,
          project: args.project || 'shipde-platform',
        },
        printTimeoutSec:
          Number(args['timeout-sec'] || args.timeoutSec || deps?.timeoutSec) ||
          (args.timeout ? Number(args.timeout) : 3600),
        timeoutMs: launchTimeoutMs,
        workerTimeoutMs,
        tokenBudget,
        outputCeiling,
        mode: selectedMode,
        effort: finalChosenCandidate.effort || args.effort || deps?.effort,
      });
  } catch (err) {
    log('Harness launch preparation failed: ' + (err.message || String(err)));
    thrownError = err;
    launchRes = {
      exitCode: err.exitCode !== undefined ? err.exitCode : 1,
      stdout: '',
      stderr: err.stderr || err.message || String(err),
      error: err,
    };
  }

  if (launchArgs && !Array.isArray(launchArgs)) {
    const reason = launchArgs.reason || launchArgs.refusal || launchArgs.error || 'LAUNCH_REFUSED';
    log('Harness launch refused: ' + reason);
    thrownError = new Error(reason);
    launchRes = {
      exitCode: launchArgs.exitCode !== undefined ? launchArgs.exitCode : 1,
      stdout: '',
      stderr: reason,
      error: thrownError,
    };
    launchArgs = null;
  }

  if (launchArgs) {
    try {
      decisionsStore.recordDecision(
        {
          stage:
            checkpoint && checkpoint.chosen
              ? decisionsStore.Stage.RESUMED
              : decisionsStore.Stage.LAUNCHED,
          workItemId: item.workItemId,
          role: item.role,
          chosen: finalChosenKey,
          harness: harnessName,
          branch: item.branch,
          // The claim on the branch, written before the launch. It is a claim,
          // not a handle: the durable session id is only knowable once the
          // harness has written its report, and it is recorded on the line
          // below. It was `process.pid` here, which is a Node process id and
          // not a session — decisions.js then treated that value as the
          // session to resume (audit section 4, Gap C).
          sessionId: null,
          worktree: args.cwd || rootDir,
          area: item.area,
          firstChoice: lastDecision ? lastDecision.chosen || finalChosenKey : finalChosenKey,
          selected: finalChosenKey,
          excluded: lastDecision
            ? (lastDecision.rejected || []).map((r) => ({
                candidateKey: r.offeringId,
                reasonCode: String(r.reason || 'UNKNOWN').split(':')[0],
                reason: r.reason,
              }))
            : [],
          quota:
            lastDecision && lastDecision.candidates
              ? lastDecision.candidates.map((c) => ({
                  candidateKey: c.offeringId,
                  score: c.score,
                  headroom: c.headroom,
                }))
              : [],
          resourceCeiling: deps && deps.resourceCeiling ? deps.resourceCeiling() : undefined,
          checkpoint: checkpointFile,
          limitsEnforcement,
        },
        { dir: decisionDir, now }
      );
    } catch (err) {
      log('Failed to append LAUNCHED to decision log');
      exit(1);
      return {
        fatal: { exitCode: 1, error: err },
        launchRes,
        thrownError,
        isFailure,
        sessionHandle,
        handedOff,
        launchPending,
      };
    }

    try {
      launchAttempted = true;
      launchRes = launcher(adapter, launchArgs, {
        cwd: baseResolution.cwd || args.cwd || (deps && deps.cwd) || rootDir,
        // The pinned base the worker root is provisioned at (AI-64-R15).
        baseSha: resolvedBaseSha,
        branch: item.branch,
        workItemId: item.workItemId,
        // TASK-AI-127 WD-R03: WORKER_DEPS_UNAVAILABLE warnings land in the
        // same decision log this dispatch records its launch in.
        decisionDir,
        checkpoint: checkpointFile,
        timeoutMs: launchTimeoutMs,
        workerTimeoutMs,
        tokenBudget,
        outputCeiling,
        mode: selectedMode,
        candidateKey: finalChosenKey,
        candidate: finalChosenCandidate,
        model: finalChosenCandidate.modelId || finalChosenCandidate.model,
        modelId: finalChosenCandidate.modelId || finalChosenCandidate.model,
        account: finalChosenCandidate.accountId || finalChosenCandidate.account,
        accountId: finalChosenCandidate.accountId || finalChosenCandidate.account,
        harness: harnessName,
        effort: finalChosenCandidate.effort || args.effort || deps?.effort,
      });
    } catch (err) {
      thrownError = err;
      launchRes = {
        exitCode: err.exitCode !== undefined ? err.exitCode : -1,
        stdout: '',
        stderr: err.stderr || err.message || String(err),
        error: err,
      };
    }
  }

  if (deps && deps.rethrow && thrownError) {
    throw thrownError;
  }

  isFailure =
    thrownError !== null ||
    !launchRes ||
    launchRes.exitCode !== 0 ||
    (typeof launchRes.httpStatus === 'number' && launchRes.httpStatus >= 400);

  // The durable handle, read from the report the launch was given. Never a
  // pid, a timestamp or a stdout guess.
  const sessionReceipt = readSessionId(
    adapter,
    {
      usageFile,
      accountId: finalChosenCandidate.accountId || finalChosenCandidate.account,
    },
    launchRes || {}
  );
  sessionHandle = sessionReceipt.id;
  if ((usageFile || adapter.backgroundLaunch) && !sessionHandle) {
    // The caller asked for a durable report and the report carries no
    // session id, so this launch cannot be resumed or stopped. A launch the
    // loop cannot find again is a failed launch (AI-64-R04), not a success
    // with a null handle.
    isFailure = true;
  }
  if (sessionHandle) {
    // The claim now carries the session it is a claim about, so a restart
    // resumes that session instead of starting a second writer.
    decisionsStore.recordDecision(
      {
        stage: decisionsStore.Stage.LAUNCHED,
        workItemId: item.workItemId,
        role: item.role,
        chosen: finalChosenKey,
        harness: harnessName,
        branch: item.branch,
        sessionId: sessionHandle,
        worktree: args.cwd || rootDir,
        area: item.area,
        detail: 'DURABLE_SESSION_ID',
      },
      { dir: decisionDir, now }
    );
  }

  const parsed = launchRes && launchRes.stdout ? parseLastJson(launchRes.stdout) : null;
  if (parsed && parsed.status && /fail|error|refus|stalled|timeout/i.test(String(parsed.status))) {
    isFailure = true;
  }

  handedOff = adapter.backgroundLaunch === true && !isFailure && Boolean(sessionHandle);
  if (adapter.backgroundLaunch === true && launchAttempted && isFailure) {
    launchPending = true;
    try {
      const reconciliation = adapter.onLaunchFailed?.(
        {
          usageFile,
          accountId: finalChosenCandidate.accountId || finalChosenCandidate.account,
          candidateKey: finalChosenKey,
        },
        launchRes
      );
      if (reconciliation?.pending === false) launchPending = false;
    } catch {
      /* Uncertainty preserves ownership. */
    }
  }

  try {
    if (!handedOff && !launchPending)
      decisionsStore.recordDecision(
        {
          stage: isFailure ? decisionsStore.Stage.FAILED : decisionsStore.Stage.COMPLETED,
          workItemId: item.workItemId,
          role: item.role,
          chosen: finalChosenKey,
          harness: harnessName,
          branch: item.branch,
          sessionId: sessionHandle,
          worktree: args.cwd || rootDir,
          area: item.area,
          outcome: isFailure ? 'failed' : 'passed',
          detail:
            (usageFile || adapter.backgroundLaunch) && !sessionHandle
              ? launchRes?.exitCode !== 0
                ? 'LAUNCH_FAILED'
                : sessionReceipt.cause || 'HARNESS_NO_SESSION_ID'
              : null,
          firstChoice: lastDecision ? lastDecision.chosen || finalChosenKey : finalChosenKey,
          selected: finalChosenKey,
          excluded: lastDecision
            ? (lastDecision.rejected || []).map((r) => ({
                candidateKey: r.offeringId,
                reasonCode: String(r.reason || 'UNKNOWN').split(':')[0],
                reason: r.reason,
              }))
            : [],
          quota:
            lastDecision && lastDecision.candidates
              ? lastDecision.candidates.map((c) => ({
                  candidateKey: c.offeringId,
                  score: c.score,
                  headroom: c.headroom,
                }))
              : [],
          resourceCeiling: deps && deps.resourceCeiling ? deps.resourceCeiling() : undefined,
          checkpoint: checkpointFile,
        },
        { dir: decisionDir, now }
      );
  } catch (err) {}
  return { launchRes, thrownError, isFailure, sessionHandle, handedOff, launchPending };
}

module.exports = {
  resolveExecuteBase,
  // Called lazily by cli/dispatch.js. It stays in cli.js so the baselined
  // `maxAttempts: 1` keeps its file (TASK-AI-182).
  executeDispatchLaunch,
  dispatchCommand,
  parseArgs,
  main,
  // The Controller seams the live loop consumes rather than reimplements: the
  // ranking decision, the failure-domain rule, the atomic checkpoint store.
  readCheckpoint,
  writeJsonFile,
  buildDryRunLog,
  sameFailureDomain,
  applyFailureBlocks,
  applyDryRunBlocks,
  DRY_RUN_BLOCK_CODES,
  LIVE_BLOCK_CODES,
  // TASK-AI-70: one candidate assembly for both dispatch paths and for the
  // read-only `discovery candidates` listing, so what is listed is what dispatch
  // would rank.
  assembleForDispatch,
  reviewCommand,
  orchestrateCommand,
  mergeCommand,
  intakeCommand,
  dispatchProfileCommand,
  tokenReportCommand,
  planCommand,
  nextCommand: (args, deps) => {
    const nextDeps = Object.assign({}, deps || {});
    const rootDir = args.root || process.cwd();
    nextDeps.planningDeps = require('./work-item-planner').defaultPlanningDeps(
      rootDir,
      nextDeps.planningDeps || nextDeps
    );
    return require('./next-runner').nextCommand(args, nextDeps);
  },
  goalCommand: (args, deps) => require('./goals').runGoalCli(args, deps),
  chatCommand: (args, deps) => require('./hermes-session').chatCommand(args, deps),
  goalSessionCommand: (args, deps) => require('./hermes-session').goalSessionCommand(args, deps),
};

if (require.main === module) {
  // Dry-run stays inference-free whatever is configured; only an explicit --jev-live asks JEV.
  // Linux pipes are asynchronous: a large --json decision must survive process.exit.
  process.stdout._handle?.setBlocking?.(true);
  const argv = process.argv.slice(2);
  main(argv, { dryRunOffline: !argv.includes('--jev-live') });
}
