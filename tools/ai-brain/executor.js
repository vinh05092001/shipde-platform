'use strict';

/**
 * Ship Dễ — Dispatch executor (TASK-AI-24)
 *
 * The planner (scheduler.js, planDispatch) decides; this module launches.
 * It turns each `plan.assignments[]` entry into exactly one `ao spawn` call and
 * nothing else. The planner stays side-effect free, and the seam between the
 * two is the plain plan object, which this module reads and never mutates.
 *
 * The argument vector is the one `New-ShipDeAoSpawnArguments` builds in
 * scripts/ai/control.ps1, flag for flag, so a plan executed here and a launch
 * made by the controller cannot be told apart by AO.
 */

const { spawnSync } = require('child_process');
const { IMPLEMENTATION_ROLES, REVIEW_ROLES } = require('./scheduler');
const { offeringId: toOfferingId } = require('./offerings');

const Outcome = Object.freeze({
  LAUNCHED: 'LAUNCHED',
  REFUSED: 'REFUSED',
  FAILED: 'FAILED',
  DRY_RUN: 'DRY_RUN',
});

// Only harnesses the controller already launches. A provider absent here has
// no proven AO harness, and guessing one would launch an unobservable session.
const HARNESS_BY_PROVIDER = Object.freeze({
  antigravity: 'agy',
  gemini: 'agy',
  '9router': 'claude-code',
  anthropic: 'claude-code',
  claude: 'claude-code',
});

// The flag order of New-ShipDeAoSpawnArguments, read back by AC-AI-24-02.
const SPAWN_FLAGS = [
  '--project',
  '--kind',
  '--name',
  '--mode',
  '--branch',
  '--harness',
  '--prompt',
];

function workerName(workItemId) {
  const name = String(workItemId).toLowerCase() + '-worker';
  return name.length > 20 ? name.slice(0, 20) : name;
}

function resolveHarness(assignment, options) {
  if (assignment.harness) return assignment.harness;
  if (typeof options.harnessFor === 'function') {
    const chosen = options.harnessFor(assignment);
    if (chosen) return chosen;
  }
  return HARNESS_BY_PROVIDER[String(assignment.provider || '').toLowerCase()] || null;
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

function buildSpawnArgs({ project, name, harness, branch, prompt }) {
  const mode = harness === 'claude-code' ? 'chat' : 'tui';
  return [
    'spawn',
    '--project',
    project,
    '--kind',
    'worker',
    '--name',
    name,
    '--mode',
    mode,
    '--branch',
    branch,
    '--harness',
    harness,
    '--prompt',
    prompt,
  ];
}

function pickId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of ['id', 'sessionId', 'session_id']) {
    const v = obj[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return null;
}

/**
 * Same accepted shapes as Get-ShipDeAoSessionPayload / Get-ShipDeAoSessionId:
 * the response itself, its `session`, or its `result` / `data`, each of which
 * may nest a `session`. Returns the id, or null when there is none.
 */
function sessionIdFromResponse(response) {
  if (!response || typeof response !== 'object') return null;
  const candidates = [response, response.session, response.result || response.data];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    if (candidate.session && typeof candidate.session === 'object') {
      return pickId(candidate.session);
    }
    const id = pickId(candidate);
    if (id) return id;
  }
  return null;
}

function aoDetail(reason, res) {
  return (
    reason +
    ' (exit ' +
    (res && res.exitCode !== undefined ? res.exitCode : 'unknown') +
    ')' +
    (res && res.stderr ? ': ' + String(res.stderr).trim() : '')
  );
}

// AI-24-R09: the vector goes to the child as an array with no shell.
function defaultRunAo(args) {
  const r = spawnSync('ao', args, { encoding: 'utf8', shell: false, windowsHide: true });
  if (r.error) return { exitCode: -1, stdout: '', stderr: String(r.error.message) };
  return { exitCode: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/**
 * @param plan    the object planDispatch returned; read only
 * @param options { runAo, project, dryRun (default true), now, harnessFor, promptFor }
 */
function executePlan(plan, options) {
  const opts = options || {};
  const dryRun = opts.dryRun !== false; // AI-24-R03
  const project = opts.project || 'shipde-platform';
  const runAo = typeof opts.runAo === 'function' ? opts.runAo : defaultRunAo;
  const promptFor = typeof opts.promptFor === 'function' ? opts.promptFor : defaultPrompt;
  const now = opts.now || Date.now();

  const assignments = (plan && Array.isArray(plan.assignments) && plan.assignments) || [];
  const utilisation = (plan && plan.utilisation) || {};
  const maxImplementation = Number.isFinite(utilisation.maxImplementation)
    ? utilisation.maxImplementation
    : 1;

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
      args: null,
      outcome: null,
      sessionId: null,
      detail: null,
    };
    records.push(record);

    const harness = resolveHarness(a, opts);
    if (!a.workItemId || !a.branch || !harness) {
      record.outcome = Outcome.REFUSED;
      record.detail = 'INCOMPLETE_ASSIGNMENT'; // AI-24-R07
      continue;
    }

    const isReview = REVIEW_ROLES.has(a.role);
    if (!isReview) {
      // AI-24-R04
      if (writerItems.has(a.workItemId) || writerBranches.has(a.branch)) {
        record.outcome = Outcome.REFUSED;
        record.detail = 'DUPLICATE_WRITER';
        continue;
      }
    }
    if (IMPLEMENTATION_ROLES.has(a.role) && implementationCount >= maxImplementation) {
      record.outcome = Outcome.REFUSED;
      record.detail = 'IMPLEMENTATION_CEILING'; // AI-24-R05
      continue;
    }
    if (!isReview) {
      writerItems.add(a.workItemId);
      writerBranches.add(a.branch);
    }
    if (IMPLEMENTATION_ROLES.has(a.role)) implementationCount += 1;

    record.args = buildSpawnArgs({
      project,
      name: workerName(a.workItemId),
      harness,
      branch: a.branch,
      prompt: promptFor(a),
    });

    if (dryRun) {
      record.outcome = Outcome.DRY_RUN;
      continue;
    }

    // AI-24-R02 / R06: one call, fail closed, no retry.
    let res;
    try {
      res = runAo(record.args.slice());
    } catch (err) {
      res = { exitCode: -1, stdout: '', stderr: String(err && err.message) };
    }
    if (!res || res.exitCode !== 0) {
      record.outcome = Outcome.FAILED;
      record.detail = aoDetail('AO_NONZERO_EXIT', res);
      continue;
    }
    if (!res.stdout || String(res.stdout).trim() === '') {
      record.outcome = Outcome.FAILED;
      record.detail = aoDetail('AO_EMPTY_STDOUT', res);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(res.stdout);
    } catch (_) {
      record.outcome = Outcome.FAILED;
      record.detail = aoDetail('AO_INVALID_JSON', res);
      continue;
    }
    const id = sessionIdFromResponse(parsed);
    if (!id) {
      record.outcome = Outcome.FAILED;
      record.detail = aoDetail('AO_NO_SESSION_ID', res);
      continue;
    }
    record.outcome = Outcome.LAUNCHED;
    record.sessionId = id;
  }

  const count = (o) => records.filter((r) => r.outcome === o).length;
  return {
    dryRun,
    executedAt: new Date(now).toISOString(),
    records,
    summary: {
      launched: count(Outcome.LAUNCHED),
      refused: count(Outcome.REFUSED),
      failed: count(Outcome.FAILED),
    },
  };
}

module.exports = {
  executePlan,
  buildSpawnArgs,
  sessionIdFromResponse,
  workerName,
  Outcome,
  SPAWN_FLAGS,
  HARNESS_BY_PROVIDER,
};
