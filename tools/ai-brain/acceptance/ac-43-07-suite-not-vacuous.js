'use strict';
// AC-AI-43-07 — the regression suite actually ran, and it ran the real test
// files.
//
// The row this replaces asserted `node --test <globs>` exits 0 and prints
// "fail 0". Measured from an empty temporary directory with no repository
// present, that command still exits 0 and still prints "fail 0", because
// node --test reports a clean run when its globs match nothing. The assertion
// therefore could not distinguish a green suite from no suite at all.
//
// This script asserts the suite is non-vacuous: the glob patterns resolve to
// real files on disk, the run reports at least as many tests as files, pass is
// greater than zero, and fail is zero. The control step runs the same parser
// against a deliberately empty glob and requires it to be rejected.
//
// Exit codes: 0 suite green and non-vacuous - 1 suite vacuous or failing -
// 2 cannot measure (no repository / suite files missing).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PATTERNS = [
  'tools/ai-brain/test/*.test.js',
  'tools/ai-dashboard/test/*.test.js',
  'tools/ai-guard/test/*.test.js',
];

function expand(pattern) {
  const dir = path.dirname(pattern);
  if (!fs.existsSync(dir)) return null;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => path.join(dir, f));
}

const files = [];
for (const p of PATTERNS) {
  const hits = expand(p);
  if (hits === null) {
    console.error('SOURCE_MISSING: ' + path.dirname(p) + ' (run from the repository root)');
    process.exit(2);
  }
  files.push(...hits);
}
if (files.length === 0) {
  console.error('SOURCE_MISSING: the declared globs resolve to no test file');
  process.exit(2);
}

// Parses the node --test summary. Returns null when the run reported no tests,
// which is exactly the vacuous case the old row could not see.
function runSuite(patterns, cwd) {
  const r = spawnSync(process.execPath, ['--test', ...patterns], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const num = (key) => {
    const m = out.match(new RegExp('^[^\\n]*\\b' + key + '\\s+(\\d+)\\s*$', 'm'));
    return m ? Number(m[1]) : null;
  };
  return { status: r.status, tests: num('tests'), pass: num('pass'), fail: num('fail') };
}

// Control: the same command, the same parser, a directory with no repository
// in it. node --test exits 0 there; the parser must still refuse it.
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac43-07-'));
const control = runSuite(PATTERNS, empty);
fs.rmSync(empty, { recursive: true, force: true });
if (control.status !== 0) {
  console.error(
    'CONTROL_FAILED: node --test did not exit 0 on an empty directory; the trap has changed'
  );
  process.exit(2);
}
if (control.tests !== 0 || control.pass !== 0) {
  console.error(
    'CONTROL_FAILED: expected a vacuous run on an empty directory, got tests ' + control.tests
  );
  process.exit(2);
}
console.log(
  'CONTROL: node --test exits ' +
    control.status +
    ' with fail ' +
    control.fail +
    ' on an empty directory - exit code alone proves nothing'
);

const run = runSuite(PATTERNS, process.cwd());
console.log(
  'SUITE: ' +
    files.length +
    ' test files - tests ' +
    run.tests +
    ', pass ' +
    run.pass +
    ', fail ' +
    run.fail
);
if (run.tests === null || run.tests < files.length) {
  console.error(
    'SUITE_VACUOUS: reported ' + run.tests + ' tests for ' + files.length + ' test files'
  );
  process.exit(1);
}
if (run.pass === null || run.pass <= 0) {
  console.error('SUITE_VACUOUS: no test passed');
  process.exit(1);
}
if (run.fail !== 0 || run.status !== 0) {
  console.error('SUITE_FAILING: fail ' + run.fail + ', exit ' + run.status);
  process.exit(1);
}
console.log('SUITE_NOT_VACUOUS: ' + files.length + ' files, ' + run.pass + ' passed, fail 0');
process.exit(0);
