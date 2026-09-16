'use strict';
// AC-AI-43-08 — measures, rather than asserts, whether the manifest truth
// audit is wired into the two PowerShell health-check scripts.
//
// The row this replaces claimed that
//   scripts/ai/doctor.ps1 -ManifestPath <fixture>
// exits 1 and prints "QUALITY_GATE_MISSING: trivy". Measured at HEAD, that is
// false twice over: doctor.ps1 declares no -ManifestPath parameter, and no file
// under scripts/ invokes `tools/ai-brain/cli.js manifest`, requires
// `manifest-audit`, or contains the string QUALITY_GATE_MISSING at all. The
// audit is a Brain CLI surface; it is not a blocking surface in doctor.ps1 or
// ecosystem.ps1. Wiring it would require editing scripts/ai/*, which this Work
// Item's Author boundary prohibits.
//
// This script records the measured state and fails the moment it changes, so
// that whichever Work Item does the wiring must widen the Business outcome in
// the same change rather than leaving a stale claim behind.
//
// Exit codes: 0 measured state matches the documented claim (unwired) -
// 1 the wiring now exists and the Work Item prose must be updated - 2 cannot
// measure.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SURFACES = ['scripts/ai/doctor.ps1', 'scripts/ai/ecosystem.ps1'];
// Any one of these appearing in a health-check script means the audit is wired.
const WIRING = [/cli\.js["'\s]+manifest\b/i, /manifest-audit/i, /QUALITY_GATE_MISSING/];

function wiring(text) {
  return WIRING.filter((re) => re.test(text)).map((re) => String(re));
}

for (const f of SURFACES) {
  if (!fs.existsSync(f)) {
    console.error('SOURCE_MISSING: ' + f + ' (run from the repository root)');
    process.exit(2);
  }
}

// Control: the detector must find wiring when wiring is there. A COPY of the
// real doctor.ps1 is given the exact line the Work Item claims it already has;
// the file on disk is never written.
const real = fs.readFileSync(SURFACES[0], 'utf8');
const tmp = path.join(os.tmpdir(), 'shipde-ac43-08-' + process.pid + '.ps1');
fs.writeFileSync(tmp, real + '\nnode tools/ai-brain/cli.js manifest --manifest "$ManifestPath"\n');
const controlHits = wiring(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);
if (controlHits.length === 0) {
  console.error('CONTROL_FAILED: the detector missed wiring injected into a copy of doctor.ps1');
  process.exit(2);
}
console.log(
  'CONTROL: wiring injected into a copy of doctor.ps1 was detected (' + controlHits[0] + ')'
);

const wired = [];
for (const f of SURFACES) {
  const hits = wiring(fs.readFileSync(f, 'utf8'));
  if (hits.length > 0) wired.push(f + ' [' + hits.join(', ') + ']');
}

console.log('MANIFEST_AUDIT_WIRED_SURFACES: ' + wired.length + ' ' + JSON.stringify(wired));
if (wired.length !== 0) {
  console.error(
    'CLAIM_STALE: the manifest audit is now wired into a health-check script. ' +
      'Update the Business outcome, AI-43-R01, AI-43-R07 and AI-43-R09 of TASK-AI-43 to match.'
  );
  process.exit(1);
}
console.log('BLOCKING_SURFACE_UNWIRED: doctor.ps1 and ecosystem.ps1 do not run the manifest audit');
process.exit(0);
