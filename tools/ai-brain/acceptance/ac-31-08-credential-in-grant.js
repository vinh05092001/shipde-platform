'use strict';
// AC-AI-31-08 — A grant result carrying a credential is refused (negative proof).
// Exit 1 + CREDENTIAL_IN_GRANT when grantCredentialFindings detects a credential key.
const fs = require('fs');

const REPO_MARKER = 'tools/ai-brain/qualification-gate.js';
if (!fs.existsSync(REPO_MARKER)) {
  console.error('SOURCE_MISSING: ' + REPO_MARKER);
  process.exit(2);
}

const { grantCredentialFindings, GRANT_SOURCE } = require('./lib/qualification-gate');

const CREDENTIAL_CASES = [
  { apiKey: 'sk-abc123' },
  { secret: 'mysecret' },
  { token: 'mytoken' },
  { password: 'hunter2' },
  { credential: 'cred' },
];

let allDetected = true;
for (const badEntry of CREDENTIAL_CASES) {
  const findings = grantCredentialFindings(Object.assign(
    { roleId: 'author.lowrisk', grantedAt: Date.now(), source: GRANT_SOURCE, probeOutcome: 'pass' },
    badEntry
  ));
  if (findings.length === 0) {
    console.error('CONTROL_FAILED: credential key "' + Object.keys(badEntry)[0] + '" was not detected');
    allDetected = false;
  }
}
if (!allDetected) process.exit(2);

process.stderr.write('CREDENTIAL_IN_GRANT: all credential key variants correctly detected (negative proof confirmed)\n');
process.exit(1);
