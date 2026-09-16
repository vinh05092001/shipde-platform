'use strict';
// AC-AI-29-06 — negative proof that the entry rule refuses a tampered account,
// having first proved the accounts the registry really ships are accepted.
//
// The rule lives in `./lib/account-entry.js`, the same module
// `ac-29-05-entry-rule.js` requires. The real declarations are read from the
// REAL `tools/ai-brain/seed-accounts.js`, proved clean as a CONTROL, then two
// tampered copies are written to `os.tmpdir()`, re-read, and handed to the same
// rule: one carrying a credential field, which the registry validator must
// refuse, and one declaring a ceiling with no provenance, which the limit rule
// TASK-AI-26 owns must refuse naming the account and the window. Nothing on disk
// is modified.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DECLARATIONS_SOURCE, declaredAccounts, entryFindings } = require('./lib/account-entry');

if (!fs.existsSync(DECLARATIONS_SOURCE)) {
  console.error('SOURCE_MISSING: ' + DECLARATIONS_SOURCE);
  process.exit(2);
}

const real = declaredAccounts();

// Control: the real declarations must be accepted, or refusing tampered copies
// of them says nothing about the rule.
if (real.length === 0) {
  console.error('CONTROL_FAILED: the registry declares no account to tamper with');
  process.exit(2);
}
if (real.some((account) => entryFindings(account).length > 0)) {
  console.error('CONTROL_FAILED: a real declared account already violates the entry rule');
  process.exit(2);
}

// Tamper two copies, through os.tmpdir(): a credential smuggled into the
// registry, and a ceiling declared without provenance.
const withCredential = JSON.parse(JSON.stringify(real[0]));
withCredential.apiKey = 'sk-not-a-credential';
const withBareLimit = JSON.parse(JSON.stringify(real[0]));
withBareLimit.limits = { tokensPerDay: { value: 1000 } };

function throughTmp(account, tag) {
  const tmp = path.join(os.tmpdir(), 'shipde-ac29-06-' + process.pid + '-' + tag + '.json');
  fs.writeFileSync(tmp, JSON.stringify(account));
  const reread = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  return reread;
}

const credentialFindings = entryFindings(throughTmp(withCredential, 'credential'));
const limitFindings = entryFindings(throughTmp(withBareLimit, 'limit'));

if (credentialFindings.length === 0 || limitFindings.length === 0) {
  console.error(
    'ENTRY_RULE_NOT_ENFORCED: ' +
      (credentialFindings.length === 0 ? 'a credential field was admitted' : '') +
      (credentialFindings.length === 0 && limitFindings.length === 0 ? ' and ' : '') +
      (limitFindings.length === 0 ? 'a limit with no provenance was admitted' : '')
  );
  process.exit(0);
}
console.error(
  'ENTRY_RULE_VIOLATED: ' +
    credentialFindings[0].rule +
    ',' +
    limitFindings[0].rule +
    ' (' +
    limitFindings[0].detail +
    ')'
);
process.exit(1);
