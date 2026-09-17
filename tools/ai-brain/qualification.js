'use strict';
// TASK-AI-30 — qualification result record declaration.
// Mirrors how ceiling.js declares LEDGER_FILE: a stable, injectable path
// for the record this Work Item writes, so a later item (TASK-AI-31) can
// read it without this item touching capabilities.js, accounts.js or
// offerings.js — none of which is in Allowed paths.
const path = require('path');

const RESULT_DIR =
  process.env.QUALIFICATION_RESULT_DIR ||
  path.join(__dirname, 'qualification-results');
const RESULT_PATH = path.join(RESULT_DIR, 'results.json');

const OUTCOMES = new Set(['pass', 'fail', 'timeout', 'refused']);

/** Required fields for a qualification result record. */
const REQUIRED_FIELDS = [
  'accountId',
  'model',
  'instant',
  'outcome',
  'latencyMs',
  'reason',
];

/**
 * Every way `result` fails the qualification-record shape contract.
 * Empty means the record is well-formed enough to be stored and read.
 */
function validateResultShape(result) {
  const findings = [];
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    findings.push('RESULT_SHAPE: result is not a plain object');
    return findings;
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in result)) {
      findings.push(`RESULT_SHAPE: missing field ${field}`);
    }
  }
  if ('outcome' in result && !OUTCOMES.has(result.outcome)) {
    findings.push(`RESULT_SHAPE: unknown outcome ${result.outcome}`);
  }
  return findings;
}

module.exports = {
  RESULT_PATH,
  RESULT_DIR,
  OUTCOMES,
  REQUIRED_FIELDS,
  validateResultShape,
};
