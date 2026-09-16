'use strict';
// TASK-AI-24 — the planner/executor separation, held in exactly one place.
//
// `ac-24-05-planner-launches-nothing.js` (the invariant) and
// `ac-24-06-planner-launch-detected.js` (its negative proof) require the
// planner half. `ac-24-07-spawn-contract.js` and
// `ac-24-08-spawn-branch-dropped.js` require the executor half. No script
// restates a rule, so editing a rule here changes the gate and the proof of the
// gate together.
//
// Planner half. `tools/ai-brain/scheduler.js` says of itself "It plans; it does
// not launch", and that is the property TASK-AI-24 must preserve while adding an
// executor beside it. A planner that can spawn a process cannot be tested by
// calling it, so the rule is: the planner module requires no process, network or
// thread capability, and it exports `planDispatch`.
//
// Executor half. The only launcher that exists today is the controller's
// `New-ShipDeAoSpawnArguments` in `scripts/ai/control.ps1`. Whatever consumes a
// plan must still pass the project, the worker kind, the worker name, the Work
// Item's branch, the harness and the prompt, because the branch and the harness
// are what keep one writer on one branch.
//
// Exit codes used by the scripts that require this file:
//   0 the rule holds   1 the rule is violated   2 the rule cannot be measured

const PLANNER_PATH = 'tools/ai-brain/scheduler.js';
const CONTROLLER_PATH = 'scripts/ai/control.ps1';

// Modules whose presence would let the planner act rather than plan.
const LAUNCH_CAPABILITIES = ['child_process', 'net', 'http', 'https', 'worker_threads', 'cluster'];

/** Every launch-capable module the planner source requires, in source order. */
function launchCapabilitiesRequired(source) {
  const found = [];
  const pattern = /require\(\s*['"](?:node:)?([a-z_]+)['"]\s*\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (LAUNCH_CAPABILITIES.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/** Violations of the planner half; empty when the planner only plans. */
function plannerViolations(source) {
  const violations = [];
  for (const capability of launchCapabilitiesRequired(source)) {
    violations.push('PLANNER_REQUIRES_LAUNCH_CAPABILITY: ' + capability);
  }
  if (!/module\.exports\s*=\s*\{[^}]*\bplanDispatch\b/.test(source)) {
    violations.push('PLANNER_EXPORT_MISSING: planDispatch');
  }
  return violations;
}

// The flags a launch must carry.
const REQUIRED_SPAWN_FLAGS = ['--project', '--kind', '--name', '--branch', '--harness', '--prompt'];

/** The source of `New-ShipDeAoSpawnArguments`, or null when the function is absent. */
function spawnFunctionBody(controllerSource) {
  const start = controllerSource.indexOf('function New-ShipDeAoSpawnArguments');
  if (start < 0) return null;
  const next = controllerSource.indexOf('\nfunction ', start + 1);
  return controllerSource.slice(start, next < 0 ? undefined : next);
}

/** Violations of the executor half, or null when the launcher cannot be found. */
function spawnViolations(controllerSource) {
  const body = spawnFunctionBody(controllerSource);
  if (body === null) return null;
  const violations = [];
  if (!body.includes('"spawn"')) violations.push('SPAWN_VERB_MISSING');
  for (const flag of REQUIRED_SPAWN_FLAGS) {
    if (!body.includes('"' + flag + '"')) violations.push('SPAWN_FLAG_MISSING: ' + flag);
  }
  return violations;
}

module.exports = {
  PLANNER_PATH,
  CONTROLLER_PATH,
  LAUNCH_CAPABILITIES,
  REQUIRED_SPAWN_FLAGS,
  launchCapabilitiesRequired,
  plannerViolations,
  spawnFunctionBody,
  spawnViolations,
};
