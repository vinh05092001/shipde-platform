'use strict';
// AC-AI-31-07 — Grant result record carries no credential.
// Exit 0 + GRANT_CREDENTIAL_FREE when grantCredentialFindings returns empty for a clean entry.
const fs = require('fs');

const REPO_MARKER = 'tools/ai-brain/qualification-gate.js';
if (!fs.existsSync(REPO_MARKER)) {
  console.error('SOURCE_MISSING: ' + REPO_MARKER);
  process.exit(2);
}

const { grantCredentialFindings, GRANT_SOURCE } = require('./lib/qualification-gate');

// Control: the check must be able to find credentials at all.
const control = grantCredentialFindings({ apiKey: 'sk-abc123' });
if (control.length === 0) {
  console.error('CONTROL_FAILED: credential check cannot detect apiKey');
  process.exit(2);
}

// A clean grant entry carries no credential.
const cleanEntry = {
  roleId: 'author.lowrisk',
  grantedAt: Date.now(),
  source: GRANT_SOURCE,
  probeOutcome: 'pass',
};
const findings = grantCredentialFindings(cleanEntry);
if (findings.length > 0) {
  for (const f of findings) console.error('UNEXPECTED_CREDENTIAL: ' + f);
  process.exit(1);
}

console.log('GRANT_CREDENTIAL_FREE: clean grant entry carries no credential fields');
process.exit(0);
