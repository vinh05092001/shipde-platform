'use strict';
// AC-AI-42-11 — specification and documentation validation passes with 0 errors.
const path = require('path');
const cp = require('child_process');

const VALIDATOR_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'product-spec',
  'scripts',
  'validate_docs.py'
);

const res = cp.spawnSync('python3', [VALIDATOR_PATH], {
  encoding: 'utf8',
});

const out = (res.stdout || '') + (res.stderr || '');
if (res.status !== 0 || !out.includes('Documentation validation passed:')) {
  console.error('DOCS_VALIDATION_FAILED:\n' + out);
  process.exit(1);
}

console.log('DOCS_VALIDATION_PASSED: validate_docs.py passed with 0 errors');
process.exit(0);
