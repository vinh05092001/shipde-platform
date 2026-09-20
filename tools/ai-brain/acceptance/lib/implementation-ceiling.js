'use strict';
// TASK-AI-42 — the concurrent implementation ceiling rule, held in exactly one place.
//
// AC-AI-42-05 (the invariant: scheduler enforces concurrent implementation
// ceiling of 1 and requires a governed decision to raise it) and AC-AI-42-06
// (the negative proof: a copy of the scheduler that allows unvetted settings
// without a governed decision is refused) both require this module.
//
// AC-AI-42-07 and AC-AI-42-08 test the behavioral enforcement of the rule:
// with a valid governed decision (DEC-017) the ceiling can be raised, while an
// invalid or unvetted identifier is refused and clamped to 1.
//
// Exit codes used by the scripts that require this file:
//   0 the rule holds   1 it is violated   2 it cannot be measured

const {
  planDispatch,
  DEFAULTS,
  isGovernedDecision,
  GOVERNED_DECISION_PATTERN,
} = require('../../scheduler');

const SCHEDULER_SOURCE = 'tools/ai-brain/scheduler.js';

// Each part is one required property of the ceiling governance contract,
// read from the scheduler source:
// 1. maxImplementationAgents defaults to 1 in DEFAULTS (AI-TOOL-03)
// 2. governed decision identifier validation is present
// 3. unvetted setting without a valid governed decision is clamped to 1
// 4. utilisation records the governed decision status
const REQUIRED_PARTS = [
  {
    id: 'DEFAULT_CEILING_IS_ONE',
    label: 'maxImplementationAgents defaults to 1 in DEFAULTS (AI-TOOL-03 stability measure)',
    pattern: /maxImplementationAgents\s*:\s*1\s*,/,
  },
  {
    id: 'GOVERNED_DECISION_VALIDATION',
    label:
      'governed decision identifier validation (isGovernedDecision / GOVERNED_DECISION_PATTERN)',
    pattern: /function\s+isGovernedDecision\s*\(/,
  },
  {
    id: 'UNVETTED_SETTING_CLAMPED',
    label: 'unvetted setting without a valid governed decision clamped to 1',
    pattern: /effectiveMaxImpl\s*=\s*1\s*;/,
  },
  {
    id: 'GOVERNED_DECISION_RECORDED_IN_UTILISATION',
    label: 'utilisation records governedDecision and ceilingGoverned status',
    pattern: /governedDecision\s*:\s*decisionId\s*,/,
  },
];

/** Every part of the ceiling governance contract missing from `source`. */
function missingCeilingParts(source) {
  return REQUIRED_PARTS.filter((part) => !part.pattern.test(source));
}

module.exports = {
  SCHEDULER_SOURCE,
  REQUIRED_PARTS,
  missingCeilingParts,
  planDispatch,
  DEFAULTS,
  isGovernedDecision,
  GOVERNED_DECISION_PATTERN,
};
