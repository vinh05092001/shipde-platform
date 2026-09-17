'use strict';
// AC-AI-24-06 — negative proof for the planner half of the contract.
//
// The rule is `./lib/dispatch-executor-contract.js`, the same module
// `ac-24-05-planner-launches-nothing.js` requires. The REAL planner is read and
// must be accepted as a CONTROL; a COPY written to `os.tmpdir()` then gains one
// `require('child_process')` — the smallest edit that turns a planner into a
// launcher — and the same rule must reject it. Nothing on disk is modified.
//
// Exit 1 when the tamper is detected. Exit 2 when the proof cannot be made,
// including when a regression stops the rule detecting it, so a broken proof
// never reports success.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PLANNER_PATH, plannerViolations } = require('./lib/dispatch-executor-contract');

if (!fs.existsSync(PLANNER_PATH)) {
  console.error('SOURCE_MISSING: ' + PLANNER_PATH);
  process.exit(2);
}

const real = fs.readFileSync(PLANNER_PATH, 'utf8');
if (plannerViolations(real).length !== 0) {
  console.error('CONTROL_FAILED: the real planner already violates the contract');
  process.exit(2);
}

const tampered = "const cp = require('child_process');\n" + real;
const tmp = path.join(os.tmpdir(), 'shipde-ac24-06-' + process.pid + '.js');
fs.writeFileSync(tmp, tampered);
const violations = plannerViolations(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

if (violations.length === 0) {
  console.error('PLANNER_LAUNCH_NOT_DETECTED');
  process.exit(2);
}
console.error('PLANNER_CONTRACT_VIOLATED: ' + violations.join('; '));
process.exit(1);
