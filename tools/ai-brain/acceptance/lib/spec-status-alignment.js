'use strict';
// TASK-AI-08 — the Control-table/register comparison, held in exactly one place.
//
// `ac-08-01-status-alignment.js` (the invariant: the Work Item's Control table
// and its delivery-register row agree) and `ac-08-02-status-divergence.js` (the
// negative proof: a tampered copy diverges and is detected) both require this
// module. Neither restates the extraction, so editing the rule here changes
// both the gate and the proof of the gate. Before this module the pair carried
// independent copies of the same parsing, which is the defect TASK-AI-07 had to
// repair once already.
//
// The rule is a CLAIM ABOUT TWO DOCUMENTS, not a re-implementation of any
// validator. The authoritative register is
// `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`;
// these scripts read the real files, never a fixture.
//
// Exit codes used by the scripts that require this file:
//   0 the documents agree   1 they diverge   2 the claim cannot be measured

// The `Status` cell of a Work Item Control table. Whitespace-tolerant because
// the surrounding table is padded in some Work Items and not in others, and the
// value is written either bare or in backticks.
const STATUS_CELL = /\n\|\s*Status\s*\|\s*`?([A-Z_]+)`?\s*\|\r?\n/;

// Any lifecycle value the register may carry in its `status` column.
const REGISTER_STATUS =
  /"(BACKLOG|MERGED|BLOCKED_[A-Z_]+|READY_FOR_[A-Z]+|IN_PROGRESS|CHANGES_REQUIRED|CODEX_PASS|SUPERSEDED)"/;

/** The status the Control table declares, or null when there is no Status cell. */
function controlStatus(specText) {
  const match = STATUS_CELL.exec(specText);
  return match ? match[1] : null;
}

/** The register line for a Work Item, or null when the register has no such row. */
function registerRowLine(registerText, workItemId) {
  return registerText.split(/\r?\n/).find((line) => line.includes('"' + workItemId + '"')) || null;
}

/** The status the register records for a Work Item, or null when absent. */
function registerStatus(registerText, workItemId) {
  const line = registerRowLine(registerText, workItemId);
  if (!line) return null;
  const match = REGISTER_STATUS.exec(line);
  return match ? match[1] : null;
}

/** Every way the Control table and the register fail to agree. Empty means they agree. */
function statusAlignmentViolations(specText, registerText, workItemId) {
  const violations = [];
  const control = controlStatus(specText);
  const register = registerStatus(registerText, workItemId);

  if (!control) violations.push(workItemId + ': Control table has no Status cell');
  if (!register) violations.push(workItemId + ': register records no status');
  if (control && register && control !== register) {
    violations.push('STATUS_DIVERGENCE: Control table ' + control + ' vs register ' + register);
  }
  return violations;
}

module.exports = {
  STATUS_CELL,
  REGISTER_STATUS,
  controlStatus,
  registerRowLine,
  registerStatus,
  statusAlignmentViolations,
};
