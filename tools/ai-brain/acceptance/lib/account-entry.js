'use strict';
// TASK-AI-29 — the account-entry rule, held in exactly one place.
//
// AC-AI-29-05 (the invariant: the entry shape the registry already ships is the
// shape the entry path may write) and AC-AI-29-06 (its negative proof: a copy of
// a real declaration carrying a credential field, or a limit with no provenance,
// is refused) both require this module. AC-AI-29-07 and AC-AI-29-08 require it
// for the credential half of the same rule. Editing the rule here changes both
// the gate and the proof of the gate; a private copy in each script is the
// defect this repository has had to repair repeatedly.
//
// Nothing is restated. The registry rule is `accounts.validateAccount`, the
// limit rule is `limits.resolveLimits`, and the encrypted store is
// `accounts.setSecret` / `getSecret` — all re-exported here BY REFERENCE and
// consulted, never copied. The limit rule belongs to TASK-AI-26: a declared
// limit with no provenance is refused naming the account and the window, and a
// window with no ceiling stays unknown rather than being filled with a default.
// This module adds only the composition the entry path needs, plus the one new
// rule this Work Item is about: a registry document must never be a credential.
//
// Exit codes used by the scripts that require this file:
//   0 the rule holds   1 it is violated   2 it cannot be measured

const fs = require('fs');
const path = require('path');
const {
  validateAccount,
  addAccount,
  setSecret,
  getSecret,
  listAccounts,
} = require('../../accounts');
const { resolveLimits } = require('../../limits');

const DECLARATIONS_SOURCE = 'tools/ai-brain/seed-accounts.js';

// The real rules, by reference: a caller that uses these is exercising the
// shipped code rather than a second copy of it.
const realValidateAccount = validateAccount;
const realResolveLimits = resolveLimits;

/**
 * Every reason the entry path must refuse to write `account`.
 *
 * Two rules compose here and neither is restated: the registry validator, which
 * refuses a malformed account or one carrying a credential field, and the limit
 * resolution that refuses a declared ceiling with no recognised provenance,
 * naming the account and the window it came from.
 */
function entryFindings(account) {
  const findings = [];
  for (const detail of realValidateAccount(account)) {
    findings.push({ rule: 'REGISTRY_VALIDATOR', detail });
  }
  for (const rejected of realResolveLimits(account, { skipLedger: true }).rejected) {
    findings.push({
      rule: 'LIMIT_PROVENANCE',
      detail: rejected.accountId + ' ' + rejected.window + ': ' + rejected.reason,
    });
  }
  return findings;
}

/**
 * Whether a registry document exposes `credential` as readable text.
 *
 * The registry is a plain, diffable, dashboard-readable file by design, so a
 * credential inside it is readable by anything that can read the file. The
 * credential belongs in `accounts.secrets.enc`, written through `setSecret`.
 */
function registryExposesCredential(registryText, credential) {
  const needle = String(credential || '');
  if (needle === '') return false;
  return String(registryText).includes(needle);
}

/**
 * The account entries the committed seed file declares, read from the real
 * module rather than transcribed. A deep copy is returned so a caller cannot
 * mutate what every other consumer of this module sees.
 */
function declaredAccounts() {
  // eslint-disable-next-line global-require
  const seed = require('../../seed-accounts');
  return JSON.parse(JSON.stringify(seed.ACCOUNTS));
}

/**
 * Writes one account and its credential through the REAL modules into `dir`,
 * then reads back what a reader can see.
 *
 * Nothing here reimplements the entry path: `addAccount` and `setSecret` are the
 * shipped functions, and the injected paths are the only thing this adds.
 * `recovered` is returned so a caller can prove the credential really was stored
 * — without it, "the registry carries no credential" would also hold when the
 * write silently did nothing.
 */
function writeEntryThroughRealModules(dir, entry, credential) {
  const options = {
    registryFile: path.join(dir, 'accounts.registry.json'),
    secretsFile: path.join(dir, 'accounts.secrets.enc'),
    keyFile: path.join(dir, 'accounts.key'),
  };
  const saved = addAccount(entry, options);
  setSecret(saved.id, credential, options);
  return {
    options,
    registryText: fs.readFileSync(options.registryFile, 'utf8'),
    listed: listAccounts(options).find((candidate) => candidate.id === saved.id) || null,
    recovered: getSecret(saved.id, options),
  };
}

module.exports = {
  DECLARATIONS_SOURCE,
  realValidateAccount,
  realResolveLimits,
  entryFindings,
  registryExposesCredential,
  declaredAccounts,
  writeEntryThroughRealModules,
};
