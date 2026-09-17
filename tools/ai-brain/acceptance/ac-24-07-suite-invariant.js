'use strict';
// AC-AI-24-07 — the brain suite is non-vacuous and executor.test.js is among
// the files it runs. Control: the same parser rejects the run from an empty
// directory, where node --test exits 0 with no tests.
// Exit 0 proven, 1 violated, 2 cannot measure.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = 'tools/ai-brain/test';
if (!fs.existsSync(path.join(DIR, 'executor.test.js'))) {
  console.error('SOURCE_MISSING: ' + DIR + '/executor.test.js (run from the repository root)');
  process.exit(2);
}
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.test.js'));

function runSuite(cwd) {
  const r = spawnSync(process.execPath, ['--test', DIR + '/*.test.js'], {
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
const nonVacuous = (run, fileCount) =>
  run.tests !== null &&
  run.tests >= fileCount &&
  run.pass > 0 &&
  run.fail === 0 &&
  run.status === 0;

const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac24-07-'));
const control = runSuite(empty);
fs.rmSync(empty, { recursive: true, force: true });
if (nonVacuous(control, 1)) {
  console.error('CONTROL_FAILED: an empty directory was accepted as a real suite');
  process.exit(2);
}
console.log(
  'CONTROL: empty directory exits ' +
    control.status +
    ' with tests ' +
    control.tests +
    ' - rejected'
);

const run = runSuite(process.cwd());
console.log(
  'SUITE: ' +
    files.length +
    ' files - tests ' +
    run.tests +
    ', pass ' +
    run.pass +
    ', fail ' +
    run.fail
);
if (!nonVacuous(run, files.length)) {
  console.error('SUITE_VACUOUS_OR_FAILING');
  process.exit(1);
}
console.log('SUITE_NOT_VACUOUS: ' + files.join(', '));
process.exit(0);
