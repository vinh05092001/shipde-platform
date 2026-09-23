'use strict';

/**
 * Ship Dễ — Dispatch executor (TASK-AI-24, re-targeted by TASK-AI-49)
 *
 * The planner (scheduler.js, planDispatch) decides; this module launches. It
 * turns each `plan.assignments[]` entry into exactly one session and nothing
 * else. The planner stays side-effect free, and the seam between the two is
 * the plain plan object, which this module reads and never mutates.
 *
 * Until TASK-AI-49 the only launch it knew was `ao spawn`. AO was retired on
 * 2026-09-22 — its controller held idle processes, and the RAM they cost was
 * the reason for removing it — so the argument vector now comes from a harness
 * adapter (harness.js) and the provider-to-harness lookup from the registry
 * (sources.json). Neither this file nor anything below it branches on a
 * provider name, which is what makes a new source a row in a table rather than
 * another arm of an `if`.
 *
 * Two rules survive unchanged from AI-24 because they are what keep concurrent
 * work safe rather than merely fast:
 *
 *   R04  one writer per work item and per branch, always
 *   R05  the implementation ceiling the plan carries is a limit, not a hint
 *
 * And one is new. Before claiming a work item, the executor asks the decision
 * log whether a writer is already open on it. A session whose daemon restarted
 * is still the rightful writer of its branch, so "nothing is running" is not
 * evidence that the branch is free; only the log is. When a writer is found,
 * the work continues through the adapter's `resume`, keeping one agent and its
 * history instead of starting a second one on commits it has never seen.
 */

const { REVIEW_ROLES, IMPLEMENTATION_ROLES } = require('./scheduler');
const { offeringId: toOfferingId } = require('./offerings');
const { getHarness, runHarness, parseLastJson } = require('./harness');
const { loadSources, dispatchRoute, qualifyModel } = require('./sources');
const decisions = require('./decisions');

const Outcome = Object.freeze({
  LAUNCHED: 'LAUNCHED',
  REFUSED: 'REFUSED',
  FAILED: 'FAILED',
  RESUMED: 'RESUMED',
  DRY_RUN: 'DRY_RUN',
});

function workerName(workItemId) {
  const name = String(workItemId).toLowerCase() + '-worker';
  return name.length > 20 ? name.slice(0, 20) : name;
}

function defaultPrompt(assignment) {
  return (
    'Work Item ' +
    assignment.workItemId +
    ' in shipde-platform. Read AGENTS.md and the Work Item. Implement exactly its in-scope ' +
    'items within Allowed paths on branch ' +
    assignment.branch +
    ', run its verification, and open or update the Pull Request. Do not merge.'
  );
}

function resumePrompt(assignment) {
  return (
    'Continue Work Item ' +
    assignment.workItemId +
    ' on branch ' +
    assignment.branch +
    '. Read the branch as it stands now — it already carries your earlier commits — then finish ' +
    'the remaining in-scope items, run the verification, and update the Pull Request. ' +
    'Do not redo work that is already committed and do not repeat any action with an external effect ' +
    'before checking whether it already happened.'
  );
}

/**
 * Where an assignment should run: which harness, which provider name that
 * harness understands, and the model spelled the way it expects.
 *
 * `assignment.harness` wins when the plan states one, then an injected
 * `harnessFor`, then the registry. A provider with no row resolves to null and
 * the assignment is refused — guessing a harness launches a session nothing can
 * observe, which is worse than not launching one.
 */
function resolveRoute(assignment, options, registry) {
  const opts = options || {};
  const route = dispatchRoute(assignment.provider, registry);
  const harnessName =
    assignment.harness ||
    (typeof opts.harnessFor === 'function' ? opts.harnessFor(assignment) : null) ||
    (route && route.harness) ||
    null;
  if (!harnessName) return null;
  return {
    harnessName,
    provider: (route && route.provider) || assignment.provider,
    model: qualifyModel(assignment.model, route),
  };
}

function detailOf(reason, res) {
  return (
    reason +
    ' (exit ' +
    (res && res.exitCode !== undefined ? res.exitCode : 'unknown') +
    ')' +
    (res && res.stderr ? ': ' + String(res.stderr).trim().slice(0, 300) : '')
  );
}

/**
 * @param plan    the object planDispatch returned; read only
 * @param options {
 *   dryRun (default true), project, now, promptFor, harnessFor,
 *   run, registry, decisionDir, cwd, base
 * }
 */
function executePlan(plan, options) {
  const opts = options || {};
  const dryRun = opts.dryRun !== false; // AI-24-R03
  const project = opts.project || 'shipde-platform';
  const promptFor = typeof opts.promptFor === 'function' ? opts.promptFor : defaultPrompt;
  const run = typeof opts.run === 'function' ? opts.run : runHarness;
  const now = opts.now || Date.now();
  const registry = opts.registry || loadSources();
  const logOpts = { dir: opts.decisionDir, now };

  const assignments = (plan && Array.isArray(plan.assignments) && plan.assignments) || [];
  const utilisation = (plan && plan.utilisation) || {};
  const maxImplementation = Number.isFinite(utilisation.maxImplementation)
    ? utilisation.maxImplementation
    : 1;

  // Writers already open according to the log, so an interrupted run resumes
  // instead of racing itself.
  //
  // A log that cannot be read is not a log that says nothing. If the directory
  // is unreadable or a file is damaged, the claims may still exist and simply
  // be out of reach, and treating that as "no writers" is exactly how a second
  // agent lands on a branch that already has one. So an unreadable log stops
  // every writing assignment in this plan; reviews, which claim nothing, still
  // run.
  const writerState = decisions.openWritersDetailed(logOpts);
  const openByItem = new Map();
  for (const writer of writerState.writers) openByItem.set(writer.workItemId, writer);
  const logUnreadable = writerState.readable
    ? null
    : 'DECISION_LOG_UNREADABLE: ' + (writerState.damaged.join('; ') || 'unknown');

  const writerItems = new Set();
  const writerBranches = new Set();
  let implementationCount = 0;
  const records = [];

  // AI-24-R01: only assignments, in plan order; deferred and alternatives unread.
  for (const assignment of assignments) {
    const a = assignment || {};
    const record = {
      workItemId: a.workItemId || null,
      role: a.role || null,
      offeringId: a.accountId && a.model ? toOfferingId(a.accountId, a.model) : null,
      harness: null,
      args: null,
      outcome: null,
      sessionId: null,
      detail: null,
    };
    records.push(record);

    const refuse = (reason) => {
      record.outcome = Outcome.REFUSED;
      record.detail = reason;
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          workItemId: record.workItemId,
          role: record.role,
          chosen: record.offeringId,
          branch: a.branch || null,
          detail: reason,
          rejected: (a.alternatives || []).map((id) => ({
            offeringId: id,
            reason: 'not selected',
          })),
        },
        logOpts
      );
    };

    const route = resolveRoute(a, opts, registry);
    if (!a.workItemId || !a.branch || !route) {
      refuse('INCOMPLETE_ASSIGNMENT'); // AI-24-R07
      continue;
    }

    let adapter;
    try {
      adapter = getHarness(route.harnessName);
    } catch (err) {
      // A retired harness throws rather than resolving to null: AO's removal
      // is a decision, and reaching for it must fail loudly.
      refuse(String(err.message));
      continue;
    }
    if (!adapter) {
      refuse('UNKNOWN_HARNESS: ' + route.harnessName);
      continue;
    }
    record.harness = adapter.id;

    const isReview = REVIEW_ROLES.has(a.role);
    const existing = isReview ? null : openByItem.get(a.workItemId);

    if (!isReview && logUnreadable) {
      refuse(logUnreadable);
      continue;
    }

    if (!isReview) {
      // AI-24-R04, within this plan.
      if (writerItems.has(a.workItemId) || writerBranches.has(a.branch)) {
        refuse('DUPLICATE_WRITER');
        continue;
      }
      // AI-24-R04, across restarts. An open writer with no way to resume is a
      // refusal, not a fresh launch: Cline cannot be continued, and starting it
      // again would be the second writer this rule exists to prevent.
      if (existing && !adapter.resume) {
        refuse('WRITER_OPEN_ELSEWHERE: session ' + (existing.sessionId || 'unknown'));
        continue;
      }
    }
    if (IMPLEMENTATION_ROLES.has(a.role) && implementationCount >= maxImplementation) {
      refuse('IMPLEMENTATION_CEILING'); // AI-24-R05
      continue;
    }
    if (!isReview) {
      writerItems.add(a.workItemId);
      writerBranches.add(a.branch);
    }
    if (IMPLEMENTATION_ROLES.has(a.role)) implementationCount += 1;

    // One description of the job, given to whichever call runs it. A resume
    // needs it too: a harness whose durable handle is a workspace (Hermes)
    // cannot resume from an id alone.
    const job = {
      provider: route.provider,
      model: route.model,
      prompt: promptFor(a),
      branch: isReview ? null : a.branch,
      base: opts.base || 'main',
      cwd: opts.cwd,
      title: workerName(a.workItemId),
      labels: { workItem: a.workItemId, role: a.role || 'unknown', project },
    };

    const resuming = Boolean(existing && existing.sessionId && adapter.resume);
    record.args = resuming
      ? adapter.resume(existing.sessionId, resumePrompt(a), job)
      : adapter.launch(job);

    if (dryRun) {
      record.outcome = Outcome.DRY_RUN;
      continue;
    }

    decisions.recordDecision(
      {
        stage: decisions.Stage.SELECTED,
        workItemId: a.workItemId,
        role: a.role,
        chosen: record.offeringId,
        harness: adapter.id,
        branch: a.branch,
        candidates: (a.alternatives || []).concat(record.offeringId ? [record.offeringId] : []),
        rejected: (a.alternatives || []).map((id) => ({
          offeringId: id,
          reason: 'ranked below chosen',
        })),
        resuming,
      },
      logOpts
    );

    // AI-24-R02 / R06: one call, fail closed, no retry.
    let res;
    try {
      res = run(adapter, record.args.slice(), opts);
    } catch (err) {
      res = { exitCode: -1, stdout: '', stderr: String(err && err.message) };
    }

    const fail = (reason) => {
      record.outcome = Outcome.FAILED;
      record.detail = detailOf(reason, res);
      decisions.recordDecision(
        {
          stage: decisions.Stage.FAILED,
          workItemId: a.workItemId,
          role: a.role,
          chosen: record.offeringId,
          harness: adapter.id,
          branch: a.branch,
          detail: record.detail,
        },
        logOpts
      );
    };

    if (!res || res.exitCode !== 0) {
      fail('HARNESS_NONZERO_EXIT');
      continue;
    }
    if (!res.stdout || String(res.stdout).trim() === '') {
      fail('HARNESS_EMPTY_STDOUT');
      continue;
    }
    const parsed = parseLastJson(res.stdout);
    if (!parsed) {
      fail('HARNESS_INVALID_JSON');
      continue;
    }
    const id = resuming ? existing.sessionId : adapter.sessionIdFrom(parsed, job);
    if (!id) {
      // No id means no way to find this session again, which makes it
      // unstoppable and unresumable. Reported as failed so a human looks.
      fail('HARNESS_NO_SESSION_ID');
      continue;
    }

    record.outcome = resuming ? Outcome.RESUMED : Outcome.LAUNCHED;
    record.sessionId = id;
    decisions.recordDecision(
      {
        stage: resuming ? decisions.Stage.RESUMED : decisions.Stage.LAUNCHED,
        workItemId: a.workItemId,
        role: a.role,
        chosen: record.offeringId,
        harness: adapter.id,
        sessionId: id,
        branch: a.branch,
      },
      logOpts
    );
  }

  const count = (o) => records.filter((r) => r.outcome === o).length;
  return {
    dryRun,
    executedAt: new Date(now).toISOString(),
    records,
    summary: {
      launched: count(Outcome.LAUNCHED),
      resumed: count(Outcome.RESUMED),
      refused: count(Outcome.REFUSED),
      failed: count(Outcome.FAILED),
    },
  };
}

module.exports = {
  executePlan,
  resolveRoute,
  workerName,
  defaultPrompt,
  resumePrompt,
  Outcome,
};
