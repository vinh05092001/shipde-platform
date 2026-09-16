'use strict';
// AC-AI-17-04 — the manifest entries were reconciled as this Work Item claims:
// the seven genuinely absent tools are PENDING / default_enabled false /
// NON_BLOCKING, and the CI-provisioned gate stays ADOPTED / BLOCKING_GATE.
//
// The claim lives in exactly one place, lib/reconcile-expectations.js, which
// AC-AI-17-01 requires too. This script does not restate it. It asserts the
// claim against the REAL manifest, and it first proves the claim's own detector
// is live by pointing it at a tampered COPY: if the rule stops firing (the
// module weakened, or the manifest drifted), this row goes red rather than
// passing on an empty rule.
//
// Exit codes: 0 the claim holds - 1 the claim is violated - 2 cannot measure.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MANIFEST = 'tools/ecosystem-manifest.json';

if (!fs.existsSync(MANIFEST) || !fs.existsSync('tools/ai-brain/manifest-audit.js')) {
  console.error('SOURCE_MISSING: run from the repository root (' + MANIFEST + ')');
  process.exit(2);
}

const rule = require('./lib/reconcile-expectations');
const { auditManifest } = require(path.resolve('./tools/ai-brain/manifest-audit'));
const real = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// Non-vacuity: an empty expectation set would make every assertion below pass
// for no reason.
if (rule.PENDING_EXPECTED.length === 0) {
  console.error('RULE_VACUOUS: no entries are expected to be PENDING; the rule has stopped firing');
  process.exit(1);
}

// Control A: the claim's detector must reject an absent entry flipped back to
// ADOPTED. Control B: it must reject the live CI gate demoted to PENDING.
const tmp = path.join(os.tmpdir(), 'shipde-ac17-04-' + process.pid + '.json');
function tamper(mutate) {
  const copy = JSON.parse(JSON.stringify(real));
  mutate(copy);
  fs.writeFileSync(tmp, JSON.stringify(copy));
  const onDisk = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  // The host probe is injected so the control is deterministic: a machine that
  // happens to have the tool installed must not turn the control into a pass.
  const audit = auditManifest(onDisk, { onPath: () => false, dependencies: new Set() });
  return { violations: rule.reconciliationViolations(onDisk), audit };
}

const backToAdopted = tamper((m) => {
  const trivy = rule.toolById(m, 'trivy');
  trivy.lifecycle_state = 'ADOPTED';
  trivy.default_enabled = true;
  trivy.blocking_policy = 'BLOCKING_GATE';
});
if (backToAdopted.violations.length === 0) {
  console.error('CONTROL_FAILED: the rule accepted an absent gate declared ADOPTED');
  process.exit(2);
}
if (!backToAdopted.audit.findings.some((f) => rule.OVERSTATEMENT_CODES.includes(f.code))) {
  console.error('CONTROL_FAILED: the real audit accepted an absent gate declared ADOPTED');
  process.exit(2);
}
console.log(
  'CONTROL: ADOPTED-while-absent rejected by the audit (' +
    backToAdopted.audit.findings.filter((f) => rule.OVERSTATEMENT_CODES.includes(f.code)).length +
    ' overstatement finding(s))'
);

const gateDemoted = tamper((m) => {
  rule.toolById(m, rule.CI_PROVISIONED_EXPECTED.id).lifecycle_state = 'PENDING';
});
if (gateDemoted.violations.length === 0) {
  console.error(
    'CONTROL_FAILED: the rule accepted the CI-provisioned gate demoted out of ' +
      rule.CI_PROVISIONED_EXPECTED.id +
      "'s promised state"
  );
  process.exit(2);
}
console.log('CONTROL: CI-provisioned gate demoted was rejected by the rule');

// Measurement: the real manifest, untouched on disk.
const violations = rule.reconciliationViolations(real);
console.log(
  'RECONCILED_PENDING: ' + rule.PENDING_EXPECTED.length + ' entries expected PENDING/NON_BLOCKING'
);
console.log(
  'CI_PROVISIONED_GATE: ' +
    rule.CI_PROVISIONED_EXPECTED.id +
    ' expected ' +
    rule.CI_PROVISIONED_EXPECTED.lifecycle_state +
    '/' +
    rule.CI_PROVISIONED_EXPECTED.blocking_policy +
    '/' +
    rule.CI_PROVISIONED_EXPECTED.install_method
);
if (violations.length > 0) {
  for (const v of violations) console.error('VIOLATION ' + v);
  process.exit(1);
}
console.log('AC-AI-17-04 reconciliation held: 0 violation(s)');
process.exit(0);
