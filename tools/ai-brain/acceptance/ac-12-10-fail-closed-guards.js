'use strict';
// AC-AI-12-10 — fail-closed guards: install-task-scheduler.ps1 must verify controller
// existence before proceeding, restrict interval minutes between 1 and 1440, and
// enforce that mutations require the -Apply flag.
//
// Exit codes: 0 guards hold, 1 guard violated, 2 source missing.
const fs = require('fs');

const SOURCE = 'scripts/ai/install-task-scheduler.ps1';

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

const source = fs.readFileSync(SOURCE, 'utf8');
const violations = [];

// 1. Controller check must throw/fail-close if control.ps1 is missing
if (!/throw\s*["']Controller script missing/i.test(source)) {
  violations.push('MISSING CONTROLLER THROW: script does not throw when control.ps1 is missing');
}

// 2. Interval validation range
if (!/\[ValidateRange\(\s*1\s*,\s*1440\s*\)\]/i.test(source)) {
  violations.push('MISSING INTERVAL RANGE: [ValidateRange(1, 1440)] not found on IntervalMinutes');
}

// 3. Mutation guard requiring -Apply
if (!/\$Apply/i.test(source) || !/PREVIEW ONLY.*?-Apply/i.test(source)) {
  violations.push('MISSING APPLY GUARD: script does not guard mutations with -Apply requirement');
}

if (violations.length > 0) {
  for (const v of violations) console.error(v);
  process.exit(1);
}

console.log(
  'TASK_SCHEDULER_FAIL_CLOSED_GUARDS_HOLD: controller existence check, interval range check, and apply-guard present'
);
process.exit(0);
