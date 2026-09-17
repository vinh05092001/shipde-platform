'use strict';
// AC-AI-30-11 — the specification documentation validates.
//
// The real validate_docs.py script runs from the repository root; no fixture
// stands in. Run outside the repository it exits 2, not 0.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'docs', 'product-spec', 'scripts', 'validate_docs.py');
if (!fs.existsSync(SCRIPT)) {
  console.error('SOURCE_MISSING: ' + SCRIPT.split(path.sep).join('/'));
  process.exit(2);
}
if (!fs.existsSync(path.join(ROOT, 'docs', 'product-spec'))) {
  console.error('SOURCE_MISSING: repository documentation tree missing');
  process.exit(2);
}

const run = cp.spawnSync('python', [SCRIPT], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 128,
});
const out = (run.stdout || '') + (run.stderr || '');

if (run.error) {
  console.error('SOURCE_MISSING: could not run validate_docs.py: ' + run.error.message);
  process.exit(2);
}
if (run.status !== 0) {
  console.error('DOCS_VALIDATION_FAILED: validate_docs.py exited ' + run.status);
  process.exit(1);
}
if (!out.includes('Documentation validation passed:')) {
  console.error('DOCS_VALIDATION_UNEXPECTED: validate_docs.py did not report success');
  process.exit(1);
}

console.log('Documentation validation passed (validate_docs.py ran green)');
process.exit(0);
