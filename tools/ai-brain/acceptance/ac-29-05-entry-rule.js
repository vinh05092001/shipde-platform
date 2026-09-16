'use strict';
// AC-AI-29-05 — the invariant: every account the committed registry ships
// passes the entry rule the form must apply.
//
// The rule lives in `./lib/account-entry.js`, the same module the negative proof
// `ac-29-06-entry-rule-refused.js` requires, so editing the rule changes both
// outcomes. The declarations are read from the REAL
// `tools/ai-brain/seed-accounts.js` through that module, and the two rules the
// entry rule composes are the shipped `accounts.validateAccount` and
// `limits.resolveLimits`, so this row is a claim about the real registry shape
// rather than about a fixture.
//
// The count of declared accounts is printed as evidence and is deliberately NOT
// asserted: adding a provider is a change this rule must keep admitting.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const { DECLARATIONS_SOURCE, declaredAccounts, entryFindings } = require('./lib/account-entry');

if (!fs.existsSync(DECLARATIONS_SOURCE)) {
  console.error('SOURCE_MISSING: ' + DECLARATIONS_SOURCE);
  process.exit(2);
}

// CONTROL — the rule must discriminate in both directions, or a clean result
// means nothing. It must refuse a registry entry missing a required field, and
// it must refuse a declared limit that carries no provenance, because those are
// the two halves of the entry rule.
const malformed = { id: 'control-malformed', model: 'control', capabilities: {} };
if (entryFindings(malformed).length === 0) {
  console.error('CONTROL_FAILED: the entry rule admitted an account with no provider');
  process.exit(2);
}
const bareLimit = {
  id: 'control-bare-limit',
  provider: 'antigravity',
  model: 'control',
  capabilities: { contextWindow: 1000 },
  limits: { tokensPerDay: { value: 1000 } },
};
if (entryFindings(bareLimit).length === 0) {
  console.error('CONTROL_FAILED: the entry rule admitted a declared limit with no provenance');
  process.exit(2);
}

const accounts = declaredAccounts();
const findings = [];
for (const account of accounts) {
  for (const finding of entryFindings(account)) {
    findings.push({ accountId: account.id, rule: finding.rule, detail: finding.detail });
  }
}

for (const finding of findings) {
  console.error(
    'ENTRY_RULE_VIOLATED: ' + finding.accountId + ' ' + finding.rule + ' ' + finding.detail
  );
}

console.log(
  'ENTRY_RULE_EVIDENCE: ' +
    accounts.length +
    ' declared accounts, ' +
    findings.length +
    ' findings; the rule refused a provider-less entry and a limit with no provenance'
);
console.log('CONTROL: the entry rule was exercised in both directions');
if (findings.length > 0) process.exit(1);
console.log(
  'ENTRY_RULE_HOLDS: every account the registry declares passes the entry rule the form must apply'
);
