'use strict';
// AC-AI-29-08 — negative proof that the registry rule rejects a registry
// document carrying the credential, having first proved the real entry path's
// registry does not.
//
// The rule lives in `./lib/account-entry.js`, the same module
// `ac-29-07-registry-credential-free.js` requires. The account and its
// credential are written by the REAL `accounts.addAccount` and
// `accounts.setSecret` against injected paths under `os.tmpdir()`, so the
// CONTROL is a registry the shipped code actually produced. The tampering is
// then done on a COPY of that document, written back to `os.tmpdir()` with the
// credential pasted into the entry — which is exactly the hand edit this Work
// Item exists to replace — and the same rule must report it. Nothing inside the
// repository is modified.
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-29-08-'));
let observed;
try {
  observed = writeEntryThroughRealModules(dir, accounts[0], CREDENTIAL);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Control: the registry the real entry path produced must be clean, or refusing
// a tampered copy of it says nothing about the rule. The credential must also
// really have been stored, so a clean document is not an empty one.
if (observed.recovered !== CREDENTIAL) {
  console.error('CONTROL_FAILED: getSecret did not return the credential that was set');
  process.exit(2);
}
if (registryExposesCredential(observed.registryText, CREDENTIAL)) {
  console.error('CONTROL_FAILED: the registry written by the real entry path already leaks');
  process.exit(2);
}

// Tamper a COPY: paste the credential into the entry by hand, as an operator
// editing the file would.
const tamperedObject = JSON.parse(observed.registryText);
tamperedObject.accounts[0].apiKey = CREDENTIAL;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-29-08-copy-'));
const tmpFile = path.join(tmpDir, 'accounts.registry.json');
fs.writeFileSync(tmpFile, JSON.stringify(tamperedObject, null, 2));
const reread = fs.readFileSync(tmpFile, 'utf8');
fs.rmSync(tmpDir, { recursive: true, force: true });

if (!registryExposesCredential(reread, CREDENTIAL)) {
  console.error('CREDENTIAL_IN_REGISTRY_NOT_DETECTED');
  process.exit(0);
}
console.error('CREDENTIAL_IN_REGISTRY: ' + path.basename(tmpFile));
process.exit(1);
