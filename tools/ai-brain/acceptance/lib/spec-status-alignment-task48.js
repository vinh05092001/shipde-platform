'use strict';
// TASK-AI-48 — the Control-table/register comparison, held in exactly one place.
//
// `ac-48-01-status-alignment.js` (the invariant: the Work Item's Control table
// and its delivery-register row agree) and negative proofs (ac-48-02+, ac-48-03+)
// require this module. Editing the rule here changes both the gate and the proofs.
//
// The authoritative register is docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv.
// These scripts read the real files, never a fixture.
//
// Exit codes used by the scripts that require this file:
//   0 the documents agree   1 they diverge   2 the claim cannot be measured

const STATUS_CELL = /\n\|[\s]*Status[\s]*\|[\s]*`?([A-Z_]+)`?[\s]*\|[\r?\n]/;
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
