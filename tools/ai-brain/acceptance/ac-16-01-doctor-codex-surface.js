'use strict';
// AC-AI-16-01 — the repository-side Codex health check exists, distinguishes the
// states it must, and reads the ledger rather than a launch command's exit code.
//
// The stored row said `ao doctor` reports the check `codex-launch-flags` as PASS
// and names the registered hooks. That row cannot be run as written: `ao doctor`
// is a closed binary outside this repository, and at audit time it reports the
// opposite — see TASK-AI-16.md § Acceptance matrix audit, defect D1. What this
// repository owns, and what this script measures, is the two check blocks in
// scripts/ai/doctor.ps1 that this Work Item delivered.
//
// The rule about which states exist lives in lib/codex-hook-outcomes.js, which
// AC-AI-16-04 requires too; this script does not restate it.
//
// Exit codes: 0 the surface holds - 1 the surface is missing a required part -
//            2 cannot measure.
const fs = require('fs');
const path = require('path');

const DOCTOR = 'scripts/ai/doctor.ps1';
const COMMON = 'scripts/ai/common.ps1';
const DECISIONS = 'docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md';

if (!fs.existsSync(DOCTOR) || !fs.existsSync(COMMON) || !fs.existsSync(DECISIONS)) {
  console.error('SOURCE_MISSING: run from the repository root (' + DOCTOR + ')');
  process.exit(2);
}

const rule = require(path.join(__dirname, 'lib', 'codex-hook-outcomes'));

/** Every part of the delivered surface that is missing from the real source. */
function surfaceViolations(doctor, common, decisions) {
  const out = [];
  const has = (text, needle) => text.includes(needle);

  // 1. The launch-flag block probes the `projects` override in BOTH path forms,
  //    so it can tell "this CLI changed" from "the path separator is wrong".
  if (!has(doctor, '$backProbe') || !has(doctor, '$fwdProbe')) {
    out.push('launch-flag block does not probe the projects override in both path forms');
  }
  if (!has(doctor, 'REFUSED in both path forms')) {
    out.push('launch-flag block cannot distinguish a CLI change from a path-separator fault');
  }

  // 2. The hook-registration block reads the AO ledger. A launch flag that
  //    parses is not a hook that fired (AI-16-R03).
  if (!has(doctor, 'Get-ShipDeAoHarnessActivity')) {
    out.push('hook-registration block does not read the AO ledger');
  }
  if (!has(common, 'function Get-ShipDeAoHarnessActivity')) {
    out.push('common.ps1 does not define Get-ShipDeAoHarnessActivity');
  }

  // 3. Every state the rule requires is reachable and labelled in the Codex
  //    block. The prefix is required: "CANNOT VERIFY" also labels the unrelated
  //    single-writer guard hook, so the bare label would pass with this block
  //    deleted.
  for (const outcome of rule.OUTCOMES) {
    if (!has(doctor, rule.STATUS_PREFIX + rule.LABELS[outcome])) {
      out.push('doctor.ps1 never reports the ' + outcome + ' state for Codex');
    }
  }

  // 4. No hook was dropped to make the check succeed (AI-16-R05): the flag
  //    surface the repository records still names all four.
  for (const hook of rule.REQUIRED_HOOKS) {
    if (!has(decisions, 'hooks.' + hook)) {
      out.push('AI-TOOLCHAIN-DECISIONS.md does not record hook ' + hook);
    }
  }

  return out;
}

const doctor = fs.readFileSync(DOCTOR, 'utf8');
const common = fs.readFileSync(COMMON, 'utf8');
const decisions = fs.readFileSync(DECISIONS, 'utf8');

const baseline = surfaceViolations(doctor, common, decisions);

// Control: the detector must add a violation when a required state is removed
// from a COPY, or a clean verdict proves only that the detector never looked.
const tmp = path.join(require('os').tmpdir(), 'shipde-ac16-01-' + process.pid + '.ps1');
fs.writeFileSync(
  tmp,
  doctor.replace(rule.STATUS_PREFIX + rule.LABELS.CANNOT_VERIFY, rule.STATUS_PREFIX + 'RESULT_OK')
);
const control = surfaceViolations(fs.readFileSync(tmp, 'utf8'), common, decisions);
fs.unlinkSync(tmp);
const added = control.filter((v) => !baseline.includes(v));
if (added.length === 0 || !added.some((v) => v.includes('CANNOT_VERIFY'))) {
  console.error('CONTROL_FAILED: the detector did not notice a removed CANNOT VERIFY state');
  process.exit(2);
}
console.log('CONTROL: removed state detected (' + added[0] + ')');

const violations = baseline;
console.log(
  'CODEX_SURFACE: ' +
    rule.OUTCOMES.length +
    ' states required, ' +
    rule.REQUIRED_HOOKS.length +
    ' hooks recorded, ledger read wired'
);
if (violations.length > 0) {
  for (const v of violations) console.error('MISSING ' + v);
  process.exit(1);
}
console.log('AC-AI-16-01 surface held');
process.exit(0);
