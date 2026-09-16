'use strict';
// TASK-AI-17 — the reconciliation claim, held in exactly one place.
//
// AC-AI-17-01 (the audit run is clean) and AC-AI-17-04 (the manifest entries
// were reconciled as claimed) both need the same rule. Neither row restates it:
// both `require` this module, so weakening the rule here weakens what both rows
// test and the negative row fails. A private copy in each script would let one
// drift from the other while both stayed green — the defect TASK-AI-07's pair
// already shipped once.
//
// The rule is a CLAIM ABOUT THE MANIFEST, not a re-implementation of the audit.
// The audit that decides whether the manifest is trustworthy is
// tools/ai-brain/manifest-audit.js, and the scripts below run that real module
// against the real manifest; this file only states which entries the Work Item
// promised to reconcile.
//
// Exit codes used by the scripts that require this file:
//   0 the claim holds   1 the claim is violated   2 the claim cannot be measured

// The tools the first audit run reported absent, and which this Work Item
// downgrades to PENDING.
//
// `gitleaks` is deliberately NOT in this list. The first run reported it
// missing because `where gitleaks` asked this workstation, but it is installed
// by CI at the pinned version and enforced as a blocking gate on every Pull
// Request. Downgrading it would have been understatement of exactly the kind
// this Work Item exists to prevent, so the check was corrected instead and the
// entry stayed ADOPTED.
const PENDING_EXPECTED = [
  'lighthouse-ci',
  'agent-scan',
  'token-tracker',
  'lefthook',
  'axe-core',
  'trivy',
  'storybook',
];

// The one entry that must stay a blocking gate, and the install method that
// says where it is verified: the workflow that installs it, not this host.
const CI_PROVISIONED_EXPECTED = {
  id: 'gitleaks',
  lifecycle_state: 'ADOPTED',
  default_enabled: true,
  blocking_policy: 'BLOCKING_GATE',
  install_method: 'ci-provisioned',
};

// Codes the real audit raises when the manifest claims more than is true. A
// clean run must raise none of them, whatever else it warns about.
const OVERSTATEMENT_CODES = [
  'DECLARED_INSTALLED_BUT_ABSENT',
  'QUALITY_GATE_MISSING',
  'DECLARED_ADOPTED_BUT_ABSENT',
];

function toolById(manifest, id) {
  return (manifest.adopted || []).find((entry) => entry.id === id) || null;
}

/**
 * Every way `manifest` fails the reconciliation claim this Work Item made.
 * Empty array means the claim holds.
 */
function reconciliationViolations(manifest) {
  const violations = [];

  for (const id of PENDING_EXPECTED) {
    const entry = toolById(manifest, id);
    if (!entry) {
      violations.push(id + ': absent from the manifest');
      continue;
    }
    if (entry.lifecycle_state !== 'PENDING') {
      violations.push(id + ': lifecycle_state is ' + entry.lifecycle_state + ', expected PENDING');
    }
    if (entry.default_enabled !== false) {
      violations.push(id + ': default_enabled is ' + entry.default_enabled + ', expected false');
    }
    if (entry.blocking_policy !== 'NON_BLOCKING') {
      violations.push(
        id + ': blocking_policy is ' + entry.blocking_policy + ', expected NON_BLOCKING'
      );
    }
  }

  const gate = toolById(manifest, CI_PROVISIONED_EXPECTED.id);
  if (!gate) {
    violations.push(CI_PROVISIONED_EXPECTED.id + ': absent from the manifest');
  } else {
    for (const key of Object.keys(CI_PROVISIONED_EXPECTED)) {
      if (key === 'id') continue;
      if (gate[key] !== CI_PROVISIONED_EXPECTED[key]) {
        violations.push(
          CI_PROVISIONED_EXPECTED.id +
            ': ' +
            key +
            ' is ' +
            gate[key] +
            ', expected ' +
            CI_PROVISIONED_EXPECTED[key]
        );
      }
    }
  }

  return violations;
}

module.exports = {
  PENDING_EXPECTED,
  CI_PROVISIONED_EXPECTED,
  OVERSTATEMENT_CODES,
  toolById,
  reconciliationViolations,
};
