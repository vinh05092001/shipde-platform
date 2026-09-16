'use strict';
// AC-AI-16-04 — a state that cannot be measured is reported as "cannot verify",
// never as a pass.
//
// The stored row ("Stop the daemon, run `ao doctor` — reports 'cannot verify',
// not PASS") cannot be run from a repository checkout without stopping a live
// daemon, and stopping it would disrupt the workstation this audit runs on. What
// is checkable is the rule the delivered code implements, and that is what this
// script measures: the real scripts/ai/doctor.ps1 and scripts/ai/common.ps1 must
// fail closed on an unreadable ledger, and the pass rule must be the one
// lib/codex-hook-outcomes.js states — which AC-AI-16-01 requires too.
//
// Exit codes: 0 the rule holds - 1 the rule is violated - 2 cannot measure.
const fs = require('fs');
const path = require('path');

const DOCTOR = 'scripts/ai/doctor.ps1';
const COMMON = 'scripts/ai/common.ps1';

if (!fs.existsSync(DOCTOR) || !fs.existsSync(COMMON)) {
  console.error('SOURCE_MISSING: run from the repository root (' + DOCTOR + ')');
  process.exit(2);
}

const rule = require(path.join(__dirname, 'lib', 'codex-hook-outcomes'));

/** Every way the never-a-pass rule is broken. */
function neverAPassViolations(doctor, common) {
  const out = [];

  // 1. The rule itself, from the one module that states it.
  const unverifiable = rule.outcomeFor({ verifiable: false, sessions: 0 });
  if (unverifiable !== 'CANNOT_VERIFY') {
    out.push('an unverifiable reading classifies as ' + unverifiable + ', not CANNOT_VERIFY');
  }
  if (rule.isPass('CANNOT_VERIFY')) out.push('CANNOT_VERIFY counts as a pass');
  if (rule.isPass('STALE')) out.push('STALE counts as a pass');
  if (rule.isPass('NOT_OBSERVED')) out.push('NOT_OBSERVED counts as a pass');
  if (!rule.isPass('VERIFIED')) out.push('VERIFIED does not count as a pass');

  // 2. The real health check must fail closed, not merely print.
  if (!doctor.includes('$failures.Add("Codex hook registration could not be verified')) {
    out.push('doctor.ps1 does not record a failure when the ledger cannot be read');
  }
  if (!doctor.includes('$failures.Add("Codex hook registration is stale')) {
    out.push('doctor.ps1 does not record a failure for a stale reading');
  }

  // 3. The ledger reader must return Verifiable $false on every unreadable path.
  if (!common.includes('Verifiable     = $false')) {
    out.push('common.ps1 does not return Verifiable $false from the unverifiable path');
  }
  if (!common.includes('AO ledger not found')) {
    out.push('common.ps1 does not treat a missing ledger as unverifiable');
  }

  return out;
}

const doctor = fs.readFileSync(DOCTOR, 'utf8');
const common = fs.readFileSync(COMMON, 'utf8');

const baseline = neverAPassViolations(doctor, common);

// Control: the detector must add a violation when the fail-closed branch is
// removed from a COPY.
const tmp = path.join(require('os').tmpdir(), 'shipde-ac16-04-' + process.pid + '.ps1');
fs.writeFileSync(
  tmp,
  doctor.replace('$failures.Add("Codex hook registration could not be verified', '$null = "x')
);
const control = neverAPassViolations(fs.readFileSync(tmp, 'utf8'), common);
fs.unlinkSync(tmp);
const added = control.filter((v) => !baseline.includes(v));
if (added.length === 0) {
  console.error('CONTROL_FAILED: the detector did not notice a removed fail-closed branch');
  process.exit(2);
}
console.log('CONTROL: removed fail-closed branch detected (' + added[0] + ')');

const violations = baseline;
if (violations.length > 0) {
  for (const v of violations) console.error('VIOLATION ' + v);
  process.exit(1);
}
console.log('AC-AI-16-04 held: unverifiable and stale are never a pass');
process.exit(0);
