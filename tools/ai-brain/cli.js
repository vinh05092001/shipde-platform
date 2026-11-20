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
  executeDispatchLaunch,
} = require('./cli/dispatch-helpers');
const {
  dispatchCommand,
} = require('./cli/dispatch');
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

module.exports = {
  resolveExecuteBase,
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
