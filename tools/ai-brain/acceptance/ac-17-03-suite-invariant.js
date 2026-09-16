'use strict';
// AC-AI-17-03 — the ai-brain and ai-dashboard regression suites ran and
// reported zero failures.
//
// The stored row pinned "All 380 tests pass". The real figure at audit time is
// 499 and it drifts with every test added, so the pin is not the invariant the
// row meant: "fail 0" is. The pin was corrected rather than re-pinned.
//
// The count was not the only defect. `node --test <glob>` exits 0 and prints
// "fail 0" when the glob matches nothing, so the stored row also passed from an
// empty directory with no repository present. This script refuses to report
// success unless the suites really ran: the test directories must exist (exit 2
// outside the repository) and must hold test files.
//
// Exit codes: 0 the suite ran green - 1 the suite failed - 2 cannot measure.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const GLOBS = ['tools/ai-brain/test/*.test.js', 'tools/ai-dashboard/test/*.test.js'];

const missing = GLOBS.map((g) => path.dirname(g)).filter((d) => !fs.existsSync(d));
if (missing.length > 0) {
  console.error('SOURCE_MISSING: ' + missing.join(', '));
  process.exit(2);
}

// Control: each directory must really hold test files, or "fail 0" proves nothing.
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
  'AC-AI-17-03 suite invariant held: fail 0 with ' +
    pass +
    ' passing of ' +
    tests +
    ' tests across ' +
    suites +
    ' suites (count not pinned)'
);
process.exit(0);
