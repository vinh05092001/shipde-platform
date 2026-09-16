'use strict';
// AC-AI-29-07 — the invariant: the real entry path stores the credential through
// the encrypted store, and the registry it writes carries no readable copy of it.
//
// The rule lives in `./lib/account-entry.js`, the same module the negative proof
// `ac-29-08-credential-in-registry.js` requires, so editing the rule changes both
// outcomes. Nothing is reimplemented: the account is written by the shipped
// `accounts.addAccount` and the credential by the shipped `accounts.setSecret`,
// against injected paths under `os.tmpdir()`, so no real registry and no real
// home directory is touched.
//
// The CONTROL is that `getSecret` returns the credential. Without it, "the
// registry carries no credential" would also hold when the write silently did
// nothing, which is the way a leak test passes while proving nothing.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DECLARATIONS_SOURCE,
  declaredAccounts,
  writeEntryThroughRealModules,
  registryExposesCredential,
} = require('./lib/account-entry');

const CREDENTIAL = 'sk-ac29-synthetic-value-not-a-credential';

if (!fs.existsSync(DECLARATIONS_SOURCE)) {
  console.error('SOURCE_MISSING: ' + DECLARATIONS_SOURCE);
  process.exit(2);
}

const accounts = declaredAccounts();
if (accounts.length === 0) {
  console.error('CONTROL_FAILED: the registry declares no account to enter');
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-29-07-'));
let observed;
try {
  observed = writeEntryThroughRealModules(dir, accounts[0], CREDENTIAL);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// CONTROL: the credential must really have been stored and be recoverable, or a
// clean registry says nothing.
if (observed.recovered !== CREDENTIAL) {
  console.error('CONTROL_FAILED: getSecret did not return the credential that was set');
  process.exit(2);
}
if (!observed.listed || observed.listed.hasSecret !== true) {
  console.error('CONTROL_FAILED: listAccounts did not report the credential as present');
  process.exit(2);
}

const exposedFields = Object.keys(observed.listed).filter(
  (key) => String(observed.listed[key]) === CREDENTIAL
);
if (exposedFields.length > 0) {
  console.error('REGISTRY_CREDENTIAL_EXPOSED: ' + exposedFields.join(','));
  process.exit(1);
}
if (registryExposesCredential(observed.registryText, CREDENTIAL)) {
  console.error('REGISTRY_CREDENTIAL_EXPOSED: accounts.registry.json');
  process.exit(1);
}

console.log(
  'REGISTRY_EVIDENCE: addAccount wrote ' +
    observed.registryText.length +
    ' bytes of registry; setSecret stored the credential and getSecret returned it; listAccounts reported hasSecret=true'
);
console.log('CONTROL: the credential really was stored, so a clean registry is not an empty one');
console.log(
  'REGISTRY_CREDENTIAL_FREE: the entry path wrote the credential through accounts.setSecret and the registry carries no readable copy of it'
);
