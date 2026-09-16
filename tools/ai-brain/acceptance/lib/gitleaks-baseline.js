'use strict';
// The one definition of the TASK-AI-35 baseline rule (`AI-35-R01`): Gitleaks is
// the adopted, blocking, CI-provisioned secret-scanning gate, pinned to the
// exact version the security-baseline workflow installs.
//
// AC-AI-35-01 asserts the rule holds for the real repository; AC-AI-35-07
// proves a tampered copy of the real manifest is rejected. Both rows require
// this module, so the rule exists once. Before it did, the rule was written
// twice - the positive row pinned the literal `8.24.0` inline while the
// negative row compared against whatever version the workflow installs - and
// the two copies had already drifted: bumping `GITLEAKS_VERSION` in CI changed
// one row and left the other green.
//
// This module performs no file I/O. Callers pass the parsed manifest and the
// workflow text, so neither row can quietly read a different file and call it
// the same check.

const GATE_ID = 'gitleaks';

/**
 * The Gitleaks version the security-baseline workflow installs, or null when the
 * workflow carries no explicit pin. A workflow with no pin cannot be agreed
 * with, so callers must treat null as an operational failure, not as a pass.
 */
function provisionedGitleaksVersion(workflowText) {
  const match = String(workflowText).match(/GITLEAKS_VERSION\s*=\s*"([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Null when the manifest satisfies the rule, otherwise a string naming the
 * first condition it fails.
 */
function checkGitleaksBaseline(manifest, provisionedVersion) {
  const entry = ((manifest && manifest.adopted) || []).find((x) => x.id === GATE_ID);
  if (!entry) return GATE_ID + ' absent from the adopted set';
  if (entry.lifecycle_state !== 'ADOPTED') return 'lifecycle_state is ' + entry.lifecycle_state;
  if (entry.blocking_policy !== 'BLOCKING_GATE') {
    return 'blocking_policy is ' + entry.blocking_policy;
  }
  if (entry.install_method !== 'ci-provisioned') {
    return 'install_method is ' + entry.install_method;
  }
  if (entry.pinned_version_or_commit !== provisionedVersion) {
    return 'pinned ' + entry.pinned_version_or_commit + ' but CI installs ' + provisionedVersion;
  }
  return null;
}

module.exports = { GATE_ID, provisionedGitleaksVersion, checkGitleaksBaseline };
