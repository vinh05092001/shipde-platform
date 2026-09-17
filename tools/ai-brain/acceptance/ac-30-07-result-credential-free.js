'use strict';
// AC-AI-30-07 — the invariant: a well-formed qualification result record carries
// no credential, PII or prompt text (`AI-30-R05`).
//
// The rule lives in `./lib/qualification.js`, the same module the negative proof
// `ac-30-08-credential-in-result.js` requires, so the gate and the proof of the
// gate cannot drift apart. The result is a plain object; no real registry, network
// or credential store is touched. Run outside the repository it exits 2, not 0.
const { resultCredentialFindings } = require('./lib/qualification');

// Control: a result missing required fields must be flagged by the shape check,
// otherwise "clean" proves nothing.
const shapeViolation = resultCredentialFindings({}, 'secret');
if (!shapeViolation.some((f) => f.indexOf('RESULT_SHAPE') === 0)) {
  console.error('CONTROL_FAILED: the rule cannot report a shape violation');
  process.exit(2);
}

// A well-formed result that carries no credential must be clean.
const clean = {
  accountId: 'acc-1',
  model: 'claude-haiku-4-5-20251001',
  instant: '2026-09-17T00:00:00.000Z',
  outcome: 'pass',
  latencyMs: 1200,
  reason: 'answered',
};
const cleanFindings = resultCredentialFindings(clean, 'super-secret-token');
if (cleanFindings.length > 0) {
  for (const f of cleanFindings) console.error('UNEXPECTED: ' + f);
  process.exit(1);
}

console.log('RESULT_CLEAN: well-formed result carries no credential');
process.exit(0);
