'use strict';
// AC-AI-22-06 — negative proof for the approval half of the promotion rules.
//
// The rule is `./lib/lesson-promotion.js`, the same module
// `ac-22-05-no-self-approval.js` requires. The REAL seed must be accepted as a
// CONTROL; a COPY written to `os.tmpdir()` then sets the first approved lesson's
// `approved_by` to its own `proposed_by` — an agent approving its own lesson,
// which TASK-AI-21's schema still accepts — and the same rule must reject it.
// Nothing on disk is modified.
//
// Exit 1 when the tamper is detected. Exit 2 when the proof cannot be made,
// including when a regression stops the rule detecting it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SEED_PATH, approvalViolations } = require('./lib/lesson-promotion');

if (!fs.existsSync(SEED_PATH)) {
  console.error('SOURCE_MISSING: ' + SEED_PATH);
  process.exit(2);
}

const real = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
if (approvalViolations(real).length !== 0) {
  console.error('CONTROL_FAILED: the real seed already contains a self-approved lesson');
  process.exit(2);
}

const tampered = JSON.parse(JSON.stringify(real));
const target = (tampered.lessons || []).find((lesson) => lesson.status === 'approved');
if (!target) {
  console.error('CONTROL_FAILED: the real seed has no approved lesson to tamper');
  process.exit(2);
}
target.approved_by = target.proposed_by;

const tmp = path.join(os.tmpdir(), 'shipde-ac22-06-' + process.pid + '.json');
fs.writeFileSync(tmp, JSON.stringify(tampered, null, 2));
const violations = approvalViolations(JSON.parse(fs.readFileSync(tmp, 'utf8')));
fs.unlinkSync(tmp);

if (violations.length === 0) {
  console.error('SELF_APPROVAL_NOT_DETECTED');
  process.exit(2);
}
console.error('PROMOTION_CONTRACT_VIOLATED: ' + violations[0]);
process.exit(1);
