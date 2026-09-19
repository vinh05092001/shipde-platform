'use strict';
// AC-AI-30-08 — negative proof that the result credential rule refuses a result
// record that carries the credential (`AI-30-R05`).
//
// The rule is `./lib/qualification.js`, the same module
// `ac-30-07-result-credential-free.js` requires: editing the rule changes both the
// invariant and this proof. The result is a plain object; no real registry, network
// or credential store is touched. Run outside the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');
const { resultCredentialFindings } = require('./lib/qualification');

// Running outside the repository must be detected operationally (exit 2), not as
// a finding (exit 1). AC-AI-30-09 measures this property. The check is relative to
// cwd so a spawned child with a different cwd refuses instead of running against
// the real modules by accident.
const REPO_MARKER = 'tools/ai-brain/qualification.js';
if (!fs.existsSync(REPO_MARKER)) {
  console.error('SOURCE_MISSING: ' + REPO_MARKER);
  process.exit(2);
}

// Control: a clean, well-formed result must be accepted, or refusing a tainted one
// says nothing about the rule.
const clean = {
  accountId: 'acc-1',
  model: 'claude-haiku-4-5-20251001',
  instant: '2026-09-17T00:00:00.000Z',
  outcome: 'pass',
  latencyMs: 1200,
  reason: 'answered',
};
if (resultCredentialFindings(clean, 'super-secret-token').length > 0) {
  console.error('CONTROL_FAILED: the rule refuses a clean result');
  process.exit(2);
}

const tainted = {
  accountId: 'acc-1',
  model: 'claude-haiku-4-5-20251001',
  instant: '2026-09-17T00:00:00.000Z',
  outcome: 'pass',
  latencyMs: 1200,
  reason: 'super-secret-token', // the credential leaked into the readable reason
};
const taintedFindings = resultCredentialFindings(tainted, 'super-secret-token')
  .map((f) => f.replace(/^CREDENTIAL_IN_RESULT:\s*/, ''))
  .filter((f) => f);

if (taintedFindings.length === 0) {
  console.error('CREDENTIAL_IN_RESULT_NOT_DETECTED');
  process.exit(0);
}
console.error('CREDENTIAL_IN_RESULT: ' + taintedFindings.join('; '));
process.exit(1);
