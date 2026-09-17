'use strict';
// AC-AI-22-04 — negative proof for the lifecycle half of the promotion rules.
//
// The rule is `./lib/lesson-promotion.js`, the same module
// `ac-22-03-lifecycle-states.js` requires. The REAL schema must be accepted as a
// CONTROL; a COPY written to `os.tmpdir()` then loses `proposed` from its
// status enum — the edit that leaves an agent nothing to write but a finished
// lesson — and the same rule must reject it. Nothing on disk is modified.
//
// Exit 1 when the tamper is detected. Exit 2 when the proof cannot be made,
// including when a regression stops the rule detecting it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SCHEMA_PATH, lifecycleViolations } = require('./lib/lesson-promotion');

if (!fs.existsSync(SCHEMA_PATH)) {
  console.error('SOURCE_MISSING: ' + SCHEMA_PATH);
  process.exit(2);
}

const real = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
if (lifecycleViolations(real).length !== 0) {
  console.error('CONTROL_FAILED: the real schema already violates the lifecycle rule');
  process.exit(2);
}

const tampered = JSON.parse(JSON.stringify(real));
tampered.properties.status.enum = tampered.properties.status.enum.filter((s) => s !== 'proposed');
const tmp = path.join(os.tmpdir(), 'shipde-ac22-04-' + process.pid + '.json');
fs.writeFileSync(tmp, JSON.stringify(tampered, null, 2));
const violations = lifecycleViolations(JSON.parse(fs.readFileSync(tmp, 'utf8')));
fs.unlinkSync(tmp);

if (violations.length === 0) {
  console.error('PROPOSED_STATE_REMOVAL_NOT_DETECTED');
  process.exit(2);
}
console.error('LIFECYCLE_CONTRACT_VIOLATED: ' + violations.join('; '));
process.exit(1);
