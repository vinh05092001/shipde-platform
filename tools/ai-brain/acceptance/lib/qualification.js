'use strict';
// TASK-AI-30 — the qualification rule, held in exactly one place.
//
// AC-AI-30-05 (positive: the probe rule holds over a compliant configuration)
// and AC-AI-30-06 (negative: a non-compliant configuration is refused) both
// require this module, so the gate and the proof of the gate cannot drift.
// AC-AI-30-07/08 (result credential rule) and AC-AI-30-12 (unit tests) require
// it too. Editing this module changes every row that depends on it.
//
// The probe rule is compositional and deliberately never calls a real network
// client here. Operational checks (entry admission, provider support, outcome
// recording) are injected by the caller so the same rule can be exercised by
// injected doubles in the acceptance harness and by real modules in the unit
// tests. Nothing here reaches the network, the real registry, or Git.
//
// Exit codes used by the scripts that require this file:
//   0 the rule holds   1 it is violated   2 it cannot be measured
const { validateResultShape } = require('../../qualification');

const PROBE_REQUIRED_CONFIG = ['timeoutMs', 'treeKill', 'cheapestModel', 'cacheWindowMs'];

/**
 * Every way a probe configuration breaks the bounded, entry-gated, outcome-recording
 * probe rule (`AI-30-R01`..`AI-30-R04`, `AI-30-R06`). Empty means the configuration
 * is compliant.
 *
 * The configuration is injected so the same rule can be proven with compliant and
 * non-compliant doubles without a real probe.
 */
function probeRuleFindings(config) {
  const findings = [];
  if (config === null || typeof config !== 'object') {
    findings.push('PROBE_VIOLATED: probe config is not a plain object');
    return findings;
  }

  for (const key of PROBE_REQUIRED_CONFIG) {
    if (!(key in config)) {
      findings.push(`PROBE_VIOLATED: missing probe config ${key}`);
    }
  }
  if (findings.length > 0) return findings;

  if (typeof config.timeoutMs !== 'number' || config.timeoutMs <= 0) {
    findings.push('PROBE_VIOLATED: timeoutMs is not a positive number');
  }
  if (config.treeKill !== true) {
    findings.push('PROBE_VIOLATED: treeKill is not enabled');
  }
  if (config.cheapestModel !== true) {
    findings.push('PROBE_VIOLATED: cheapestModel is not selected');
  }
  if (typeof config.cacheWindowMs !== 'number' || config.cacheWindowMs <= 0) {
    findings.push('PROBE_VIOLATED: cacheWindowMs is not a positive number');
  }

  // Operational guards are injected so the rule stays deterministic and network-free.
  if (typeof config.isEntryAdmitted === 'function') {
    if (!config.isEntryAdmitted(config.account)) {
      findings.push('PROBE_VIOLATED: account is not entry-admitted');
    }
  }
  if (typeof config.isProviderSupported === 'function') {
    if (!config.isProviderSupported(config.provider)) {
      findings.push('PROBE_VIOLATED: provider is not supported');
    }
  }
  if (typeof config.recordOutcome === 'function') {
    if (!config.recordOutcome(config.outcome)) {
      findings.push('PROBE_VIOLATED: outcome is not recorded');
    }
  }

  return findings;
}

/**
 * Every way a qualification result record breaks the no-credential rule
 * (`AI-30-R05`). Empty means the record is clean.
 */
function resultCredentialFindings(result, credential) {
  const findings = [];
  for (const f of validateResultShape(result)) {
    findings.push(`RESULT_SHAPE: ${f}`);
  }
  if (findings.length > 0) return findings;

  const haystack = JSON.stringify(result);
  const needle = credential == null ? '' : String(credential);
  if (needle.length > 0 && haystack.includes(needle)) {
    findings.push('CREDENTIAL_IN_RESULT: result carries the credential');
  }
  return findings;
}

module.exports = {
  PROBE_REQUIRED_CONFIG,
  probeRuleFindings,
  resultCredentialFindings,
};
