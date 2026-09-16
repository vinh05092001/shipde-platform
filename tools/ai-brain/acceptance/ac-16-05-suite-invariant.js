'use strict';
// AC-AI-16-05 — the repository's own checks were re-run and reported no
// regression.
//
// The stored row ("Run existing repository checks — No regression in scripts/ai
// behavior — command output") named no command and no runner, so it could not be
// executed as written. There is also no automated harness over scripts/ai
// itself, so "no regression in scripts/ai behavior" is not mechanically
// provable from this repository; what is provable is that the suites the
// repository does own stay green, which is what this script asserts.
//
// The count is not pinned. `node --test <glob>` exits 0 and prints "fail 0" when
// the glob matches nothing, so the directories must exist and hold test files or
// the row proves nothing.
//
// Exit codes: 0 the suite ran green - 1 the suite failed - 2 cannot measure.
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
  'AC-AI-16-05 suite invariant held: fail 0 with ' +
    pass +
    ' passing of ' +
    tests +
    ' tests across ' +
    suites +
    ' suites (count not pinned)'
);
process.exit(0);
