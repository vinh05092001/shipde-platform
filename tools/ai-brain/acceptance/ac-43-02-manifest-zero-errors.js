'use strict';
// AC-AI-43-02 — the manifest truth audit reports zero blocking errors against
// the REAL root manifest, and the check that says so is demonstrably live.
//
// This replaces a row that pinned the whole console tally
// ("Tong: 0 loi, 1 canh bao, 2 ghi chu"). Two of those three numbers are
// host-dependent observations, not invariants: the warning and note counts
// drift with what happens to be installed on the workstation. Only
// "summary.error === 0" is the invariant this Work Item actually claims, so
// only that is asserted here. Warning and note counts are printed as evidence
// and never compared.
//
// Exit codes: 0 invariant holds - 1 invariant violated - 2 cannot measure.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MANIFEST = 'tools/ecosystem-manifest.json';
const AUDIT = './tools/ai-brain/manifest-audit';

if (!fs.existsSync(MANIFEST) || !fs.existsSync('tools/ai-brain/manifest-audit.js')) {
  console.error('SOURCE_MISSING: run from the repository root (' + MANIFEST + ')');
  process.exit(2);
}

const { auditManifest } = require(path.resolve(AUDIT));
const real = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// Control: the detector must reject a tampered COPY, or a clean verdict on the
// real manifest proves only that the audit is asleep. The copy flips the
// existing PENDING entry `trivy` to an ADOPTED BLOCKING_GATE while it is absent
// from the host; the entry count stays at 37 so schema validation still passes.
const tmp = path.join(os.tmpdir(), 'shipde-ac43-02-' + process.pid + '.json');
const tampered = JSON.parse(JSON.stringify(real));
const trivy = tampered.adopted.find((x) => x.id === 'trivy');
if (!trivy) {
  console.error('CONTROL_FAILED: entry `trivy` is no longer present in ' + MANIFEST);
  process.exit(2);
}
trivy.lifecycle_state = 'ADOPTED';
trivy.blocking_policy = 'BLOCKING_GATE';
fs.writeFileSync(tmp, JSON.stringify(tampered));
const controlResult = auditManifest(JSON.parse(fs.readFileSync(tmp, 'utf8')));
fs.unlinkSync(tmp);
const controlFinding = controlResult.findings.find(
  (f) => f.id === 'trivy' && f.severity === 'error'
);
if (!controlFinding || controlResult.summary.error === 0) {
  console.error(
    'CONTROL_FAILED: the audit accepted a tampered manifest with an absent adopted gate'
  );
  process.exit(2);
}
console.log(
  'CONTROL: tampered copy rejected with ' + controlFinding.code + ': ' + controlFinding.id
);

// Measurement: the real manifest, untouched on disk.
const result = auditManifest(real);
const s = result.summary;
console.log(
  'MANIFEST_AUDIT: error ' + s.error + ' (warn ' + s.warn + ', info ' + s.info + ' - not asserted)'
);
if (s.error !== 0) {
  for (const f of result.findings.filter((f) => f.severity === 'error')) {
    console.error('ERROR ' + f.code + ': ' + f.id);
  }
  process.exit(1);
}
console.log('MANIFEST_AUDIT_ERRORS: 0');
process.exit(0);
