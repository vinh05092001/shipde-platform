'use strict';
// AC-AI-42-11 — specification and documentation validation passes with 0 errors.
//
// The real validate_docs.py script runs from the repository root; no fixture
// stands in. Run outside the repository it exits 2, not 0. The interpreter is
// resolved for the Windows baseline (AGENTS.md, WINDOWS-SETUP-RUNBOOK.md):
// $PYTHON wins, then `python` on win32, then `python3` elsewhere — invoking the
// Windows App Execution Alias stub ("Python was not found") is never a result.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

// Running outside the repository must be detected operationally (exit 2), not as
// a finding (exit 1). The marker is relative to cwd, so this row refuses where no
// repository exists even though the validator itself resolves its own root.
const REPO_MARKER = 'docs/product-spec/scripts/validate_docs.py';
if (!fs.existsSync(REPO_MARKER)) {
  console.error('SOURCE_MISSING: ' + REPO_MARKER);
  process.exit(2);
}

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

// Windows resolves `python3` to the Store alias stub even when Python is
// installed as python.exe; the documented baseline interpreter is `python`.
const interpreter = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

const run = cp.spawnSync(interpreter, [SCRIPT], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 128,
});
const out = (run.stdout || '') + (run.stderr || '');

if (run.error) {
  console.error(
    'SOURCE_MISSING: could not run validate_docs.py via ' + interpreter + ': ' + run.error.message
  );
  process.exit(2);
}
if (run.status !== 0) {
  console.error('DOCS_VALIDATION_FAILED: validate_docs.py exited ' + run.status + '\n' + out);
  process.exit(1);
}
if (!out.includes('Documentation validation passed:')) {
  console.error('DOCS_VALIDATION_UNEXPECTED: validate_docs.py did not report success\n' + out);
  process.exit(1);
}

console.log('DOCS_VALIDATION_PASSED: validate_docs.py passed with 0 errors');
process.exit(0);
