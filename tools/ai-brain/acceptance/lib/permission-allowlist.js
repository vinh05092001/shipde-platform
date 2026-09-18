'use strict';
// TASK-AI-10 - the permission-boundary rule, held in exactly one place.
//
// The supervisor operates with least-privilege permissions. That boundary is
// declared in one authority - the "Permission boundaries (TASK-AI-10+)" section
// of `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` -
// which lists six routine operations that are allowed and six that are
// explicitly denied. TASK-AI-10 turns that declaration into an enforced
// allowlist, and this module is the single definition of the boundary both the
// invariant and its negative proof read:
//
//   * AC-AI-10-05 (the invariant) requires the boundary heading plus every
//     allowed and every denied operation to be present in the real document.
//   * AC-AI-10-06 (the negative proof) removes one denied operation from a copy
//     and requires this rule to report it, so a rule that stops firing makes the
//     proof red rather than quietly passing.
//
// The denial half is the load-bearing one: an allowlist that only says what is
// allowed can be widened by accident. A missing deny entry is a violation.
//
// Exit codes used by the scripts that require this file:
//   0 the boundary holds   1 it is violated   2 it cannot be measured

const DECISIONS_SOURCE = 'docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md';

// The heading that owns the boundary. It names the Work Item so a later section
// on a different subject cannot satisfy the contract.
const BOUNDARY_HEADING = '### Permission boundaries (TASK-AI-10+)';

// The six routine operations the supervisor may perform, verbatim.
const ALLOWED_OPS = [
  'Read files and repository state',
  'Run lint, typecheck, test commands',
  'Create commits and push to feature branches',
  'Create and update Pull Requests',
  'Inspect CI status and review comments',
  'Send messages to AO sessions',
];

// The six operations the supervisor must never perform, verbatim.
const DENIED_OPS = [
  'Auto-merge any Pull Request',
  'Force-push or rewrite history',
  'Delete branches or worktrees destructively',
  'Bypass CI or review gates',
  'Broad unrestricted shell access',
  'Install, remove, or upgrade machine tools',
];

/** The allowed operations absent from `source`, in declaration order. */
function missingAllowedOps(source) {
  return ALLOWED_OPS.filter((op) => source.indexOf(op) < 0);
}

/** The denied operations absent from `source`, in declaration order. */
function missingDeniedOps(source) {
  return DENIED_OPS.filter((op) => source.indexOf(op) < 0);
}

/**
 * Every way the permission boundary fails to hold in `source`. Empty means the
 * boundary is complete: the section heading, all six allowed operations and all
 * six denied operations are present.
 */
function permissionBoundaryViolations(source) {
  const violations = [];
  if (source.indexOf(BOUNDARY_HEADING) < 0) {
    violations.push('BOUNDARY_HEADING_MISSING: ' + BOUNDARY_HEADING);
  }
  for (const op of missingAllowedOps(source)) violations.push('ALLOWED_OP_MISSING: ' + op);
  for (const op of missingDeniedOps(source)) violations.push('DENIED_OP_MISSING: ' + op);
  return violations;
}

module.exports = {
  DECISIONS_SOURCE,
  BOUNDARY_HEADING,
  ALLOWED_OPS,
  DENIED_OPS,
  missingAllowedOps,
  missingDeniedOps,
  permissionBoundaryViolations,
};
