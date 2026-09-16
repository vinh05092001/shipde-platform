'use strict';
// AC-AI-36-13 — the toolchain suite across ai-brain, ai-dashboard and ai-guard
// must report zero failures, and the run must be real.
//
// The stored row carried backslash-escaped quotes (`\"…\"`). Those are not shell
// quoting: a shell hands node the literal quote characters, no glob expands,
// `node --test` matches nothing, and the row passed by printing `fail 0` over a
// zero-test run — so the row asserted an invariant that holds equally when no
// test exists. This Work Item adds `tools/ai-guard/test/` suites; a vacuous check
// cannot see them.
//
// This script refuses to report success unless the run was non-vacuous: the
// three test directories must exist (exit 2 outside the repository), must really
// hold `*.test.js` files, and the summary must report tests > 0, suites > 0 and
// fail === 0. No pass count is pinned: this Work Item's own evidence note records
// `pass 458` at its baseline and the real count keeps drifting.
const fs = require('fs');
const os = require('os');
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

// CONTROL: each directory must really hold test files, or "fail 0" proves nothing.
const empty = GLOBS.map((g) => path.dirname(g)).filter(
  (d) => fs.readdirSync(d).filter((f) => f.endsWith('.test.js')).length === 0
);
if (empty.length > 0) {
  console.error('CONTROL_FAILED: no test files under ' + empty.join(', '));
  process.exit(2);
}

function parseMetric(out, name) {
  const m = out.match(new RegExp('^\\D*' + name + ' (\\d+)$', 'm'));
  return m ? Number(m[1]) : -1;
}

// CONTROL: prove the stored row's assertion is insufficient by running the same
// command from an empty directory with no repository present. It exits 0 and
// prints `fail 0` over zero tests, so "fail 0" alone cannot be the check.
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-36-13-empty-'));
let vacuousOut = '';
try {
  const probe = cp.spawnSync(process.execPath, ['--test'].concat(GLOBS), {
    cwd: emptyDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 32,
  });
  vacuousOut = (probe.stdout || '') + (probe.stderr || '');
  if (probe.status !== 0 || parseMetric(vacuousOut, 'tests') !== 0) {
    console.error(
      'CONTROL_INCONCLUSIVE: node --test did not behave vacuously on an empty directory'
    );
    process.exit(2);
  }
} finally {
  fs.rmSync(emptyDir, { recursive: true, force: true });
}

const run = cp.spawnSync(process.execPath, ['--test'].concat(GLOBS), {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 128,
});
const out = (run.stdout || '') + (run.stderr || '');

const tests = parseMetric(out, 'tests');
const suites = parseMetric(out, 'suites');
const pass = parseMetric(out, 'pass');
const fail = parseMetric(out, 'fail');

if (tests <= 0 || suites <= 0 || pass <= 0) {
  console.error(
    'SUITE_VACUOUS: tests=' +
      tests +
      ' suites=' +
      suites +
      ' pass=' +
      pass +
      ' (no suite really ran)'
  );
  process.exit(2);
}
if (fail !== 0) {
  console.error('SUITE_FAILURES: fail=' + fail);
  process.exit(1);
}
console.log('CONTROL: empty-directory run printed `fail 0` over 0 tests and was refused');
console.log(
  'SUITE_NOT_VACUOUS: fail 0, pass ' + pass + ' of ' + tests + ' tests across ' + suites + ' suites'
);
