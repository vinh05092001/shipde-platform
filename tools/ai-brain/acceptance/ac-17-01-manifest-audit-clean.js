'use strict';
// AC-AI-17-01 — the manifest truth audit reports zero blocking errors against
// the REAL manifest, and the check that says so is demonstrably live.
//
// The stored row was prose, not a command, so it could not be executed as
// written. This script carries the claim it made, unchanged in substance:
//   * 0 errors and trustworthy === true;
//   * no overstatement finding (nothing declared in use that is absent);
//   * the codex-cli PINNED_VERSION_DRIFT warning is present, because a run with
//     that warning hidden would mean the drift had been settled silently rather
//     than recorded.
// The total warning count is deliberately NOT pinned: it moves with what happens
// to be installed on the host, and pinning it is how a matrix rots.
//
// Exit codes: 0 the claim holds - 1 the claim is violated - 2 cannot measure.
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
const { OVERSTATEMENT_CODES } = require('./lib/reconcile-expectations');
const real = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// Control: a clean verdict on the real manifest proves something only if the
// audit rejects a tampered COPY. The copy flips a genuinely absent PENDING tool
// back to ADOPTED while it is still absent; if the audit cannot see that, it
// cannot see anything.
const tmp = path.join(os.tmpdir(), 'shipde-ac17-01-' + process.pid + '.json');
const tampered = JSON.parse(JSON.stringify(real));
const probe = tampered.adopted.find((e) => e.id === 'trivy');
if (!probe) {
  console.error('CONTROL_FAILED: entry `trivy` is no longer present in ' + MANIFEST);
  process.exit(2);
}
probe.lifecycle_state = 'ADOPTED';
probe.default_enabled = true;
probe.blocking_policy = 'BLOCKING_GATE';
fs.writeFileSync(tmp, JSON.stringify(tampered));
const control = auditManifest(JSON.parse(fs.readFileSync(tmp, 'utf8')));
fs.unlinkSync(tmp);
const controlFinding = control.findings.find(
  (f) => f.id === 'trivy' && OVERSTATEMENT_CODES.includes(f.code)
);
if (!controlFinding) {
  console.error('CONTROL_FAILED: the audit accepted an absent adopted gate');
  process.exit(2);
}
console.log(
  'CONTROL: tampered copy rejected with ' + controlFinding.code + ': ' + controlFinding.id
);

// Measurement: the real manifest, untouched on disk.
const result = auditManifest(real);
const summary = result.summary;
console.log(
  'MANIFEST_AUDIT: error ' +
    summary.error +
    ', warn ' +
    summary.warn +
    ', info ' +
    summary.info +
    ' (only error and the warning identity are asserted)'
);

const overstatement = result.findings.filter((f) => OVERSTATEMENT_CODES.includes(f.code));
for (const f of overstatement) {
  console.error('OVERSTATEMENT ' + f.code + ': ' + f.id);
}

const warnings = result.findings.filter((f) => f.severity === 'warn');
const unexpected = warnings.filter(
  (f) => f.code !== 'PINNED_VERSION_DRIFT' || f.id !== 'codex-cli'
);
const drift = warnings.find((f) => f.code === 'PINNED_VERSION_DRIFT' && f.id === 'codex-cli');

if (summary.error !== 0 || !result.trustworthy || overstatement.length > 0) {
  console.error('MANIFEST_AUDIT_NOT_CLEAN');
  process.exit(1);
}
if (unexpected.length > 0) {
  for (const f of unexpected) console.error('UNEXPECTED_WARNING ' + f.code + ': ' + f.id);
  console.error('MANIFEST_AUDIT_UNEXPECTED_WARNING');
  process.exit(1);
}
if (!drift) {
  console.error('DRIFT_WARNING_MISSING: the codex-cli pin drift was not reported');
  process.exit(1);
}
console.log('MANIFEST_AUDIT_ERRORS: 0');
process.exit(0);
