'use strict';
// AC-AI-30-12 — the new unit tests for the qualification rule pass.
//
// `node --test <glob>` exits 0 and prints "fail 0" when the glob matches nothing,
// so this script refuses to report success unless the test file really exists and
// the suite really ran with tests > 0. The count is not pinned.
//
// Run outside the repository it exits 2, not 0.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const TEST_FILE = path.join(__dirname, '..', 'test', 'qualification.test.js');
if (!fs.existsSync(TEST_FILE)) {
  console.error('SOURCE_MISSING: ' + TEST_FILE.split(path.sep).join('/'));
  process.exit(2);
}

const GLOBS = ['tools/ai-brain/test/qualification.test.js'];

const missing = GLOBS.map((g) => path.dirname(g)).filter((d) => !fs.existsSync(d));
if (missing.length > 0) {
  console.error('SOURCE_MISSING: ' + missing.join(', '));
  process.exit(2);
}

const empty = GLOBS.map((g) => path.dirname(g)).filter(
  (d) => fs.readdirSync(d).filter((f) => f.endsWith('.test.js')).length === 0
);
if (empty.length > 0) {
  console.error('CONTROL_FAILED: no test files under ' + empty.join(', '));
  process.exit(2);
}

const run = cp.spawnSync(process.execPath, ['--test'].concat(GLOBS), {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 128,
});
const out = (run.stdout || '') + (run.stderr || '');

function metric(name) {
  const m = out.match(new RegExp('^\\D*' + name + ' (\\d+)$', 'm'));
  return m ? Number(m[1]) : -1;
}

const tests = metric('tests');
const suites = metric('suites');
const fail = metric('fail');
const pass = metric('pass');

if (tests <= 0 || suites <= 0) {
  console.error('SUITE_DID_NOT_RUN: tests ' + tests + ', suites ' + suites);
  process.exit(1);
}
if (fail !== 0) {
  console.error('SUITE_REGRESSION: fail ' + fail + ' of ' + tests + ' tests');
  process.exit(1);
}
console.log(
  'AC-AI-30-12 unit tests passed: fail 0 with ' +
    pass +
    ' passing of ' +
    tests +
    ' tests'
);
process.exit(0);
