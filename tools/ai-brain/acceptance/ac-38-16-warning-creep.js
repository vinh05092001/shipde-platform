'use strict';
// AC-AI-38-16 — negative proof that the AC-AI-38-11 baseline rejects warning creep.
//
// The row this replaces generated its own findings in one `node -e` and asserted
// on them in a second. Measured: from an empty directory with no repository it
// printed the exact expected string and exited 1, so it would have stayed green
// with the whole project deleted.
//
// This reads the REAL audit through the same command AC-AI-38-11 uses, proves
// the real baseline is accepted as a control, then adds one synthetic warning to
// a COPY and asserts the same assertion refuses it. Nothing on disk is written.
const path = require('path');
const { spawnSync } = require('child_process');

/** The assertion AC-AI-38-11 makes, in one place so both callers share it. */
function assertBaseline(findings) {
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warn');
  if (errors.length !== 0) {
    return 'MANIFEST_BASELINE_DRIFT: expected 0 errors, got ' + errors.length;
  }
  if (warnings.length !== 1) {
    return 'MANIFEST_BASELINE_DRIFT: expected exactly 1 warning, got ' + warnings.length;
  }
  return null;
}

const cli = path.join(process.cwd(), 'tools', 'ai-brain', 'cli.js');
const run = spawnSync(process.execPath, [cli, 'manifest', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (run.error || typeof run.stdout !== 'string' || run.stdout.trim() === '') {
  console.error('SOURCE_MISSING: could not run the manifest audit from ' + process.cwd());
  process.exit(2);
}

let findings;
try {
  const parsed = JSON.parse(run.stdout);
  findings = parsed.findings;
} catch (err) {
  console.error('SOURCE_MISSING: audit output was not JSON');
  process.exit(2);
}

if (!Array.isArray(findings)) {
  console.error('SOURCE_MISSING: the audit returned no findings array');
  process.exit(2);
}

// Control: the real baseline must be accepted, or refusing a drifted copy says
// nothing about the assertion.
const controlFailure = assertBaseline(findings);
if (controlFailure) {
  console.error('CONTROL_FAILED: the real baseline is already drifted — ' + controlFailure);
  process.exit(2);
}

const drifted = findings.concat([
  { severity: 'warn', code: 'SYNTHETIC_WARNING_FOR_AC_38_16', id: 'not-a-real-tool' },
]);

const failure = assertBaseline(drifted);
if (!failure) {
  console.error('WARNING_CREEP_NOT_DETECTED');
  process.exit(0);
}
console.error(failure);
process.exit(1);
