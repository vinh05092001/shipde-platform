'use strict';
// AC-AI-37-21 — a Work Item that the delivery register still holds at a BLOCKED
// stage must disclose that hold, name the governed path that owns the
// transition, and name the remedies that path offers. The CHANGES_REQUIRED
// review of PR #103 recorded the opposite condition as a blocking finding: the
// item was routed for review while register row 170 read BLOCKED_DEPENDENCY,
// and FEATURE-DELIVERY-REGISTER.csv sits outside this Work Item's Allowed
// paths, so no edit inside this Work Item can advance the register. Prose alone
// cannot hold that boundary — a later edit can delete the paragraph — so this
// row makes the disclosure mechanical instead.
//
// The Control-versus-register comparison is deliberately NOT re-implemented
// here. AC-AI-37-15 owns it, so this script runs that script as a child and
// mirrors its verdict. Duplicating a rule in the probe that claims to test it
// is defect D-01 in docs/product-spec/work-items/TASK-AI-37.md, which the
// acceptance probes were rewritten to remove.
//
// Exits 2 when a source is missing or when its own control cannot fire, 1 when
// the hold is undisclosed, and 0 when the disclosure holds.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const SPEC = path.join('docs', 'product-spec', 'work-items', 'TASK-AI-37.md');
const ALIGNMENT = path.join(__dirname, 'ac-37-15-status-alignment.js');

const HEADING = '### Review routing disposition';
const REQUIRED_DISCLOSURES = [
  'REVIEW HOLD',
  'FEATURE-DELIVERY-REGISTER.csv',
  'TASK-AI-19',
  'ADVANCE',
  'CLOSE',
];

const STATUS_CELL = /^\|\s*Status\s*\|\s*`?([A-Z_]+)`?\s*\|\s*$/m;
const BLOCKED_STAGE = /^BLOCKED/;

for (const source of [SPEC, ALIGNMENT]) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source.split(path.sep).join('/'));
    process.exit(2);
  }
}

function controlStatus(markdown) {
  const match = markdown.match(STATUS_CELL);
  return match ? match[1] : null;
}

// The body of the disposition section, up to the next heading of any level.
function dispositionBody(markdown) {
  const start = markdown.indexOf(HEADING);
  if (start < 0) return null;
  const rest = markdown.slice(start + HEADING.length);
  const end = rest.search(/^#{2,3} /m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function violations(markdown, status) {
  if (!BLOCKED_STAGE.test(status)) return [];
  const body = dispositionBody(markdown);
  if (body === null) return ['DISPOSITION_SECTION_MISSING: ' + HEADING];
  const found = [];
  for (const token of REQUIRED_DISCLOSURES) {
    if (!body.includes(token)) found.push('DISCLOSURE_MISSING: ' + token);
  }
  return found;
}

const markdown = fs.readFileSync(SPEC, 'utf8');
const status = controlStatus(markdown);

// CONTROL 1: "held at a BLOCKED stage" is read from the Control table, so the
// parser must really see that cell and must notice a different one.
if (status === null) {
  console.error('CONTROL_FAILED: no Control table Status cell parsed from ' + SPEC);
  process.exit(2);
}
const raisedStatus = controlStatus(markdown.replace(STATUS_CELL, '| Status | `READY_FOR_CODEX` |'));
if (raisedStatus === status) {
  console.error('CONTROL_FAILED: the parser cannot tell two different Control statuses apart');
  process.exit(2);
}

const reported = violations(markdown, status);

// CONTROL 2: on a subject that passes, the test must still be able to fail. A
// deleted section or a stripped hold statement has to be reported; if neither
// is detected, the exit 0 below would prove nothing. A subject that already
// fails is reported further down, so these mutations never mask a real
// violation, and the row still refuses outside the repository through the
// SOURCE_MISSING guard above.
if (BLOCKED_STAGE.test(status) && reported.length === 0) {
  const body = dispositionBody(markdown);
  if (violations(markdown.replace(HEADING, '### Review routing note'), status).length === 0) {
    console.error('CONTROL_FAILED: deleting the disposition section is not detected');
    process.exit(2);
  }
  if (violations(markdown.replace(body, body.replace('REVIEW HOLD', '')), status).length === 0) {
    console.error('CONTROL_FAILED: removing the REVIEW HOLD statement is not detected');
    process.exit(2);
  }
  if (violations(markdown, raisedStatus).length !== 0) {
    console.error('CONTROL_FAILED: the test fires on a stage that is not blocked');
    process.exit(2);
  }
  console.log(
    'CONTROL: the probe fires when the section or its hold statement is removed,' +
      ' and stays silent on a stage that is not blocked'
  );
}

// AC-AI-37-15 owns the Control-versus-register comparison. Its verdict is this
// row's premise, so it is inherited by running it rather than by restating it.
const child = cp.spawnSync(process.execPath, [ALIGNMENT], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 8,
});
if (child.error) {
  console.error('CONTROL_FAILED: could not run AC-AI-37-15: ' + child.error.message);
  process.exit(2);
}
const childOut = ((child.stdout || '') + (child.stderr || '')).trim().split('\n')[0] || '';
if (child.status !== 0) {
  console.error(
    'ALIGNMENT_CHILD_REFUSED: ac-37-15-status-alignment.js exited ' +
      child.status +
      ' with ' +
      childOut
  );
  process.exit(child.status === 2 ? 2 : 1);
}
console.log('ALIGNMENT_CHILD_EXIT_0: ' + path.basename(ALIGNMENT) + ' — ' + childOut);

if (reported.length > 0) {
  console.error(reported.join('; '));
  process.exit(1);
}
console.log('REVIEW_ROUTING_HOLD: ' + status + ' disclosed with a governed transition path');
