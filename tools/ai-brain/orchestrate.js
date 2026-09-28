'use strict';

/**
 * Ship Dễ — Autonomous loop orchestration (TASK-AI-60, dry-run level).
 *
 * goal -> plan -> prompts -> Controller candidate selection -> simulated
 * first-candidate failure -> fallback -> checkpoint/resume -> simulated tests ->
 * simulated independent review -> simulated repair -> final reconciliation.
 *
 * The Controller stays the only selector: candidate choice happens through
 * ranking.js `rankAndRecord`, and state is recorded through decisions.js. This
 * module owns neither a second state store nor a second ranking engine.
 */

const fs = require('fs');
const path = require('path');
const planner = require('./planner');
const { compilePrompt } = require('./prompt-compiler');
const { classifySession } = require('./supervisor');
const { runReviewLoop } = require('./review-loop');
const ranking = require('./ranking');
const decisions = require('./decisions');
const { candidateKey } = require('./candidates');

function buildDefaults() {
  return {
    goal: null,
    plan: { workItems: [], errors: [] },
    prompts: [],
    selections: [],
    sessions: [],
    review: null,
    reconciliation: null,
    checkpoint: null,
  };
}

/**
 * @param goal  user goal text
 * @param opts  {
 *   specs, specText, candidates, registry, run, tests, reviewer, repairer,
 *   sha, reviewBudget, decisionDir, out, now, resumeFrom
 * }
 */
function runOrchestration(goal, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const log = buildDefaults();
  log.goal = goal || null;

  // 1. plan (validated DAG)
  log.plan = planner.plan(goal, { specs: o.specs || [] });

  // 2. prompts (one per work item)
  for (const item of log.plan.workItems) {
    log.prompts.push({
      workItemId: item.id,
      prompt: compilePrompt(item, {
        goal,
        specText: o.specText,
        candidateKey: o.pinnedKey || null,
      }),
    });
  }

  const completedFromCheckpoint = new Set();
  if (o.resumeFrom && Array.isArray(o.resumeFrom.completed)) {
    for (const id of o.resumeFrom.completed) completedFromCheckpoint.add(id);
  }

  const statusOf = new Map();
  const candidates = Array.isArray(o.candidates) ? o.candidates : [];
  const registry = o.registry || { sources: [] };

  for (const item of log.plan.workItems) {
    if (log.plan.errors.length > 0) {
      statusOf.set(item.id, 'deferred');
      continue;
    }
    if (completedFromCheckpoint.has(item.id)) {
      statusOf.set(item.id, 'completed');
      continue;
    }

    // 3. Controller candidate selection (ranking.js is the only ranking engine).
    const decision = ranking.rankAndRecord(candidates, {
      workItemId: item.id,
      role: (item.roleRequirement && item.roleRequirement.role) || 'author.foundation',
      registry,
      dryRun: true,
      decisionOpts: { dir: o.decisionDir, now },
    });
    log.selections.push({ workItemId: item.id, decision });

    if (!decision.chosen) {
      statusOf.set(item.id, 'blocked');
      continue;
    }

    // Record the selection through decisions.js when a dir is provided (never
    // to the machine's default log during a dry run).
    if (o.decisionDir) {
      decisions.recordDecision(
        { stage: decisions.Stage.SELECTED, workItemId: item.id, chosen: decision.chosen },
        { dir: o.decisionDir, now }
      );
    }

    // 4. simulated launch; first failure falls back to a different domain.
    const run = typeof o.run === 'function' ? o.run : () => ({ exitCode: 0, stdout: '{}' });
    let chosen = decision.chosen;
    let res = run({ candidateKey: chosen, workItemId: item.id });
    const launch = {
      workItemId: item.id,
      firstChoice: chosen,
      selected: chosen,
      fallbackReason: null,
      outcome: null,
    };

    if (res && res.exitCode !== 0) {
      const failed = candidates.find((c) => candidateKey(c) === chosen);
      const failedDomain = (failed && (failed.gateway || failed.upstream)) || 'unknown';
      const alternate = candidates.find(
        (c) =>
          candidateKey(c) !== chosen &&
          c.accountId !== '*' &&
          c.modelId !== '*' &&
          ((c.gateway && c.gateway !== failed.gateway) ||
            (c.upstream && c.upstream !== failed.upstream))
      );
      if (alternate) {
        const altKey = candidateKey(alternate);
        const res2 = run({ candidateKey: altKey, workItemId: item.id });
        launch.selected = altKey;
        launch.fallbackReason = 'FIRST_CANDIDATE_FAILED: ' + failedDomain;
        res = res2;
        chosen = altKey;
      }
    }

    launch.outcome = res && res.exitCode === 0 ? 'launched' : 'failed';
    log.sessions.push(launch);

    if (launch.outcome === 'launched') {
      // 5. simulated tests -> independent review -> repair.
      const review = runReviewLoop(
        { sha: o.sha || 'head', budget: o.reviewBudget !== undefined ? o.reviewBudget : 3 },
        { runTests: o.tests, review: o.reviewer, repair: o.repairer }
      );
      log.review = { workItemId: item.id, review };
      statusOf.set(item.id, review.status === 'COMPLETED' ? 'completed' : 'blocked');
    } else {
      statusOf.set(item.id, 'blocked');
    }
  }

  // 6. reconciliation: nothing disappears.
  const completed = [];
  const blocked = [];
  const deferred = [];
  for (const item of log.plan.workItems) {
    const st = statusOf.get(item.id) || 'deferred';
    if (st === 'completed') completed.push(item.id);
    else if (st === 'blocked') blocked.push(item.id);
    else deferred.push(item.id);
  }
  log.reconciliation = {
    total: log.plan.workItems.length,
    completed,
    blocked,
    deferred,
  };

  // 7. checkpoint (reuses the existing decisions-store convention, no new store).
  log.checkpoint = {
    completed,
    blocked,
    deferred,
    at: new Date(now).toISOString(),
  };

  // 8. write the dry-run log to --out (never inside the repository).
  if (o.out) {
    const dir = path.dirname(o.out);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(o.out, JSON.stringify(log, null, 2), 'utf8');
  }

  return log;
}

module.exports = { runOrchestration };
