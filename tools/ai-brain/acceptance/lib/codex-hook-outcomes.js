'use strict';
// TASK-AI-16 — the Codex hook-registration rule, held in exactly one place.
//
// AC-AI-16-01 (the health check distinguishes the states) and AC-AI-16-04
// (a state that cannot be measured is never a pass) both need the same four
// outcomes and the same pass rule. Neither row restates them: both `require`
// this module, so weakening the rule here weakens what both rows test and the
// negative row goes red. A private copy in each script would let one drift from
// the other while both stayed green.
//
// The rule is a CLAIM ABOUT THE CHECK, not a re-implementation of it. The check
// itself is `Get-ShipDeAoHarnessActivity` in scripts/ai/common.ps1 and the two
// blocks it feeds in scripts/ai/doctor.ps1; the scripts below read that real
// source from disk rather than trusting this file.
//
// Exit codes used by the scripts that require this file:
//   0 the claim holds   1 the claim is violated   2 the claim cannot be measured

// The four states AI-16-R03 / R04 require the check to distinguish, and the
// label doctor.ps1 prints for each.
const OUTCOMES = ['VERIFIED', 'STALE', 'NOT_OBSERVED', 'CANNOT_VERIFY'];

const LABELS = {
  VERIFIED: 'VERIFIED',
  STALE: 'STALE',
  NOT_OBSERVED: 'NOT OBSERVED',
  CANNOT_VERIFY: 'CANNOT VERIFY',
};

// Every state is reported under this prefix in doctor.ps1. The prefix matters:
// "CANNOT VERIFY" also labels the unrelated single-writer guard hook, so a check
// that only looked for the bare label would still pass with the Codex branch
// deleted.
const STATUS_PREFIX = 'Codex hook registration: ';

// Only a session that recorded activity inside the window is a pass. A stale
// reading is not (the check must go on failing once the thing it checks stops),
// and "cannot verify" never is (AI-16-R04).
const PASSES = {
  VERIFIED: true,
  STALE: false,
  NOT_OBSERVED: false,
  CANNOT_VERIFY: false,
};

// The four hooks the launch surface must register; none may be dropped to make
// a check succeed (AI-16-R05).
const REQUIRED_HOOKS = ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop'];

/**
 * Classify one ledger reading, as doctor.ps1 does:
 * { verifiable, sessions, withActivity, recentWithActivity }
 */
function outcomeFor(reading) {
  if (!reading || reading.verifiable !== true) return 'CANNOT_VERIFY';
  if (reading.recentWithActivity > 0) return 'VERIFIED';
  if (reading.withActivity > 0) return 'STALE';
  return 'NOT_OBSERVED';
}

function isPass(outcome) {
  return PASSES[outcome] === true;
}

module.exports = { OUTCOMES, LABELS, STATUS_PREFIX, PASSES, REQUIRED_HOOKS, outcomeFor, isPass };
