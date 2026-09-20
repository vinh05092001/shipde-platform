'use strict';
// TASK-AI-31 — the qualification gate rule, held in exactly one place.
//
// AC-AI-31-05 (gate rule holds, proved against a compliant grant config),
// AC-AI-31-06 (gate rule refused, proved against a non-compliant config),
// AC-AI-31-07 (grant credential-free) and AC-AI-31-08 (credential-in-grant
// refused) all require this module. Editing the rule here changes both the
// gate and the proof of the gate; a private copy in qualification-gate.js
// is the defect this repository has had to repair repeatedly.
//
// This module defines the GRANT decision for qualifiedRoles. It is the same
// rule the production qualification-gate.js will call; this file is the
// reference, re-exported by reference, never copied. Nothing here writes
// production state — it evaluates a proposed grant against the rules and
// returns the findings.
//
// Exit codes used by the scripts that require this file:
//   0 the rule holds   1 it is violated   2 it cannot be measured

const { listRoles } = require('../../capabilities');

// --- Constants -----------------------------------------------------------

/** Window within which a probe result is fresh enough to grant. */
const GRANT_CACHE_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Fields the gate is permitted to write into the account record.
 * Any field outside this set in a grant result is a violation (AI-31-R02).
 */
const GRANT_WRITTEN_FIELDS = new Set(['qualifiedRoles', 'qualificationHistory']);

/**
 * Required fields on every qualifiedRoles entry written by this gate (AI-31-R04).
 */
const GRANT_ENTRY_REQUIRED_FIELDS = ['roleId', 'grantedAt', 'source', 'probeOutcome'];

/**
 * The only permitted source value for entries written by this gate.
 */
const GRANT_SOURCE = 'qualification-gate';

/**
 * Credential-like keys that must never appear in a grant result (AI-31-R09).
 */
const CREDENTIAL_KEYS = new Set([
  'apiKey',
  'api_key',
  'secret',
  'password',
  'token',
  'credential',
  'key',
  'privateKey',
  'private_key',
  'accessToken',
  'access_token',
  'secretKey',
  'secret_key',
]);

// --- Grant rule ----------------------------------------------------------

/**
 * Every way `config` violates the qualification-gate grant rule.
 * An empty array means the configuration is compliant.
 *
 * `config` should have the shape:
 *   {
 *     outcome:        string   — probe outcome ('pass'|'fail'|'timeout'|'refused')
 *     resultInstant:  number   — epoch ms when the probe result was recorded
 *     now:            number   — epoch ms reference clock (injectable for tests)
 *     roleId:         string   — the role being granted
 *     entry:          object   — the qualifiedRoles entry to be written
 *     writtenFields:  string[] — the fields the gate intends to write
 *     removesRole:    boolean  — whether the gate removes an existing role
 *   }
 */
function gateRuleFindings(config) {
  const findings = [];
  const c = config || {};

  // AI-31-R08: role must be a known role.
  const targetRole = c.roleId || (c.entry && c.entry.roleId);
  const validRoles = c.knownRoles || listRoles();
  if (!targetRole || !validRoles.includes(targetRole)) {
    findings.push('GATE_VIOLATED: unknown role "' + targetRole + '"');
  }

  // AI-31-R01: only a 'pass' outcome grants.
  if (c.outcome !== 'pass') {
    findings.push('GATE_VIOLATED: outcome must be "pass" to grant; got ' + c.outcome);
  }

  // AI-31-R01: result must not be stale.
  if (typeof c.resultInstant === 'number' && typeof c.now === 'number') {
    const age = c.now - c.resultInstant;
    if (age > GRANT_CACHE_WINDOW_MS) {
      findings.push(
        'GATE_VIOLATED: result is stale (' + age + 'ms > ' + GRANT_CACHE_WINDOW_MS + 'ms window)'
      );
    }
  } else if (c.resultInstant == null) {
    findings.push('GATE_VIOLATED: resultInstant is required');
  }

  // AI-31-R02: only permitted fields may be written.
  if (Array.isArray(c.writtenFields)) {
    for (const field of c.writtenFields) {
      if (!GRANT_WRITTEN_FIELDS.has(field)) {
        findings.push('GATE_VIOLATED: gate must not write field ' + field);
      }
    }
  }

  // AI-31-R03: gate must not remove a role.
  if (c.removesRole === true) {
    findings.push('GATE_VIOLATED: gate must not remove a role (narrowing is TASK-AI-25)');
  }

  // AI-31-R04: entry must carry required fields with correct source.
  if (c.entry != null) {
    for (const field of GRANT_ENTRY_REQUIRED_FIELDS) {
      if (!(field in c.entry) || c.entry[field] == null) {
        findings.push('GATE_VIOLATED: entry missing required field ' + field);
      }
    }
    if (c.entry.source != null && c.entry.source !== GRANT_SOURCE) {
      findings.push(
        'GATE_VIOLATED: entry source must be "' + GRANT_SOURCE + '"; got "' + c.entry.source + '"'
      );
    }
    if (c.entry.probeOutcome != null && c.entry.probeOutcome !== 'pass') {
      findings.push(
        'GATE_VIOLATED: entry probeOutcome must be "pass"; got "' + c.entry.probeOutcome + '"'
      );
    }
    if (c.roleId && c.entry.roleId && c.roleId !== c.entry.roleId) {
      findings.push(
        'GATE_VIOLATED: roleId mismatch between config (' +
          c.roleId +
          ') and entry (' +
          c.entry.roleId +
          ')'
      );
    }
  } else {
    findings.push('GATE_VIOLATED: entry is required');
  }

  return findings;
}

/**
 * Every credential-like key found in `record` (AI-31-R09).
 * Scans top-level keys only; nested credentials are not expected in a grant record.
 */
function grantCredentialFindings(record) {
  const findings = [];
  if (record == null || typeof record !== 'object' || Array.isArray(record)) {
    findings.push('CREDENTIAL_CHECK: record is not a plain object');
    return findings;
  }
  for (const key of Object.keys(record)) {
    if (CREDENTIAL_KEYS.has(key)) {
      findings.push('CREDENTIAL_IN_GRANT: field "' + key + '" looks like a credential');
    }
  }
  return findings;
}

// --- Single-source marker -----------------------------------------------

// This export lets AC-AI-31-06 assert that the grant rule lives in exactly
// this module and nowhere else.
const GRANT_RULE_MODULE = module;

// --- Public surface ------------------------------------------------------

module.exports = {
  GRANT_CACHE_WINDOW_MS,
  GRANT_WRITTEN_FIELDS,
  GRANT_ENTRY_REQUIRED_FIELDS,
  GRANT_SOURCE,
  CREDENTIAL_KEYS,
  gateRuleFindings,
  grantCredentialFindings,
  GRANT_RULE_MODULE,
};
