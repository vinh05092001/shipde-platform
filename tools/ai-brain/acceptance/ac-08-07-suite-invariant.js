'use strict';
// AC-AI-08-07 — the regression suite across ai-brain, ai-dashboard and ai-guard
// must report zero failures.
//
// `node --test <glob>` exits 0 and prints "fail 0" when the glob matches nothing,
// so the stored form of this row would pass from an empty directory with no
// repository present. This script therefore refuses to report success unless the
// suites really ran: the test directories must exist and hold test files (exit 2
// outside the repository) and the summary must report tests > 0 and suites > 0.
// The invariant asserted is `fail 0`, never a pinned pass count.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const GLOBS = [
  'tools/ai-brain/test/*.test.js',
  'tools/ai-dashboard/test/*.test.js',
  'tools/ai-guard/test/*.test.js',
];

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
  'AC-AI-08-07 suite invariant held: fail 0 with ' +
    pass +
    ' passing of ' +
    tests +
    ' tests across ' +
    suites +
    ' suites'
);
process.exit(0);
