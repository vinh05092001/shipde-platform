'use strict';
// AC-AI-10-14 - every negative proof of TASK-AI-10 must fail closed, exiting 2
// with SOURCE_MISSING when its source is absent, so "exit 1 found a violation"
// and "exit 1 died for an unrelated reason" can never be confused.
//
// The failure is a property of each subject's own guard, read from its source:
// an `fs.existsSync` check that prints `SOURCE_MISSING:` and exits 2 before any
// finding can be produced. This row reads the REAL subject scripts and requires
// each guard to name the real path it protects.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');

const SUBJECTS = [
  {
    script: 'ac-10-02-status-divergence.js',
    missing: 'docs/product-spec/work-items/TASK-AI-10.md',
  },
  {
    script: 'ac-10-04-dependency-unproven.js',
    missing: 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',
  },
  {
    script: 'ac-10-06-allowlist-broken.js',
    missing: 'docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md',
    token: 'DECISIONS_SOURCE',
  },
];

for (const subject of SUBJECTS) {
  if (!fs.existsSync(path.join(__dirname, subject.script))) {
    console.error('SOURCE_MISSING: tools/ai-brain/acceptance/' + subject.script);
    process.exit(2);
  }
}

const violations = [];
for (const subject of SUBJECTS) {
  const text = fs.readFileSync(path.join(__dirname, subject.script), 'utf8');
  if (text.indexOf('existsSync(') < 0) violations.push(subject.script + ': no existsSync guard');
  if (text.indexOf('SOURCE_MISSING: ') < 0) {
    violations.push(subject.script + ': no SOURCE_MISSING report');
  }
  if (text.indexOf('process.exit(2)') < 0) violations.push(subject.script + ': no exit 2');
  if (text.indexOf(subject.missing) < 0 && text.indexOf(subject.token || '\u0000') < 0) {
    violations.push(subject.script + ': guard does not name ' + subject.missing);
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error('FAIL_CLOSED_GUARD_MISSING: ' + violation);
  process.exit(1);
}

console.log('CONTROL: each guard is read from the real subject, not restated here');
console.log(
  'FAIL_CLOSED_GUARDS: ' + SUBJECTS.length + ' negative proofs carry the SOURCE_MISSING guard'
);
process.exit(0);
