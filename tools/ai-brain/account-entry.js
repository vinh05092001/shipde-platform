'use strict';

/**
 * Ship Dễ — Account entry validation rules
 *
 * The entry path refuses what validateAccount and resolveLimits refuse, and
 * nothing here restates either. The functions are re-exported by reference so
 * editing accounts.js or limits.js changes both the gate and the proof of it.
 */

const { validateAccount, setSecret, getSecret, hasSecret } = require('./accounts');
const { resolveLimits, PROVENANCE } = require('./limits');

/**
 * Entry rule findings for one account declaration.
 *
 * Returns an array of finding objects, each with a code and a message. Empty
 * array means the entry passes and may be written.
 */
function entryFindings(account, options) {
  const findings = [];

  // Registry validator: every field validateAccount checks.
  const errors = validateAccount(account);
  if (errors.length > 0) {
    findings.push({
      code: 'REGISTRY_VALIDATOR',
      message: errors.join('; '),
      fields: errors,
    });
  }

  // Limit provenance: every declared ceiling must carry recognized provenance.
  const limits = (account && account.limits) || {};
  for (const window of Object.keys(limits)) {
    const entry = limits[window];
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const provenance = String(entry.provenance || '');
      if (PROVENANCE.indexOf(provenance) === -1) {
        findings.push({
          code: 'LIMIT_PROVENANCE',
          message: account.id + ' ' + window + ': provenance is missing or unrecognised',
          accountId: account.id,
          window,
        });
      }
    }
  }

  return findings;
}

/**
 * Whether the registry JSON carries a readable copy of the credential.
 *
 * A credential inside the registry would be written to the readable file. The
 * validator refuses the field before anything is written, so this check is the
 * proof that the written registry carries no readable copy of it.
 */
function registryExposesCredential(registryJson) {
  const forbidden = ['apiKey', 'token', 'accessToken', 'secret', 'password'];
  const accounts = Array.isArray(registryJson.accounts) ? registryJson.accounts : [];
  for (const account of accounts) {
    for (const field of forbidden) {
      if (account && account[field] !== undefined) {
        return { exposed: true, accountId: account.id, field };
      }
    }
  }
  return { exposed: false };
}

module.exports = {
  entryFindings,
  registryExposesCredential,
  // Re-export by reference, so editing accounts.js or limits.js changes the
  // gate and the proof together.
  validateAccount,
  resolveLimits,
  setSecret,
  getSecret,
  hasSecret,
  PROVENANCE,
};
