'use strict';
// TASK-AI-30 — the declared-dependency rule for this Work Item, held in exactly
// one place.
//
// `ac-30-03-dependency-declared.js` (the invariant: the register's declared
// dependency for TASK-AI-30 is exactly TASK-AI-29) and
// `ac-30-04-dependency-repointed.js` (the negative proof: a copy of the register
// that repoints the dependency is refused) both require this module, so the gate
// and the proof of the gate cannot drift apart.
//
// This pair deliberately asserts only the declared dependency NAME, never a merge
// claim. `lib/dependency-merged.js` and `lib/dependency-delivered.js` already
// exist to assert merge evidence via Git. This Work Item does not use them,
// because the gate it has to respect is the register: register row `162`
// (`TASK-AI-29`) still records `BLOCKED_DEPENDENCY` with empty `pr` and empty
// `merge_commit`, so the queue carries no recorded delivery to assert, and
// `AGENTS.md` § Source of truth makes the register — not the commit log — the
// authority for stage. Recorded, not resolved here: `git log origin/main
// --grep=TASK-AI-29` does return two commits, `af16a1f` (PR #68, the
// specification) and `cd3cfd8` (PR #99, the implementation), so
// `dependencyProven('TASK-AI-29')` in the module re-exported below would report
// `ok: true` today. Closing that gap belongs to the governed reconciler
// (`TASK-AI-19`) and to TASK-AI-29's own rows; this item writes no register cell.
// A later round may strengthen this pair to the merge claim once the register
// records the delivery.
//
// Exit codes used by the scripts that require this file:
//   0 the claim holds   1 the claim is violated   2 it cannot be measured
const { declaredDependency } = require('./dependency-merged');

/** The dependency this Work Item declares, exactly as written in the register. */
const DECLARED_DEPENDENCY = 'TASK-AI-29';

/**
 * Whether `registerText` declares `workItemId`'s dependency as exactly
 * `DECLARED_DEPENDENCY`. `measurable` is false when the register cannot be read
 * or has no such row, so a caller must exit 2 rather than 1.
 */
function dependencyDeclared(registerText, workItemId) {
  const declared = declaredDependency(registerText, workItemId);
  if (declared === null) {
    return { measurable: false, ok: false, why: 'no declared dependency for ' + workItemId };
  }
  return {
    measurable: true,
    ok: declared === DECLARED_DEPENDENCY,
    declared,
  };
}

module.exports = {
  DECLARED_DEPENDENCY,
  dependencyDeclared,
  // Re-exported by reference so callers share one CSV parser with the merge modules.
  declaredDependency,
};
