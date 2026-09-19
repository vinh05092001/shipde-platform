'use strict';
// AC-AI-20-03: Negative proof - SPEC_MISSING severity escalates
//
// Expected: exit 1, print "SPEC_MISSING_ESCALATED:" after proving the real
// blocked row is reported as info, then rewriting copies of the register in a
// private temporary directory to place that one row at every rung of the ladder.
//
// AI-20-R06 states a ladder, not a single rung, so this script walks the whole of
// it over one real row: every early status stays `info` and every ready or
// terminal status becomes `error`. Proving only READY_FOR_AUTHOR would let the rule
// break for READY_FOR_CODEX or MERGED and this row would still pass.
//
// Uses the real reconciler's SPEC_MISSING rule, not a private copy of it, and reads
// the register through the same canonical reader the coverage rule uses.

const fs = require('fs');
const path = require('path');
const os = require('os');
// The register path and its reader come from the module that already owns the
// coverage rule: a second REGISTER_PATH or a direct call to the CSV parser here
// would be a second answer to what the register says.
const { REGISTER_PATH, registerRows, specExists } = require('./lib/spec-coverage');
const { reconcileRegister } = require('../reconcile');

const root = process.cwd();
const registerPath = path.resolve(root, REGISTER_PATH);

// Exit 2 when no register exists - AC-AI-20-04 exercises this.
if (!fs.existsSync(registerPath)) {
  console.error('SOURCE_MISSING: no register at', registerPath);
  process.exit(2);
}

const registerText = fs.readFileSync(registerPath, 'utf8');
const rows = registerRows(registerText);

// Find a real row whose named specification is absent. A BLOCKED_* row is preferred;
// a BACKLOG row is the fallback — both are early states, which AI-20-R06 reports as
// `info` while a specification is absent. The row is not chosen at random: the
// ladder is walked by rewriting this one row's status inside copies of the register,
// so a row already past readiness would make the first step of the ladder a lie.
//
// A row with a path of its own is required rather than any unspecified row, because
// the tamper below edits the status cell of the line that names it; a row that
// specifies nothing has no path to leave absent once its status is rewritten.
const absent = (r) => r.work_item_path && !specExists(r, root);
const blockedRow =
  rows.find((r) => absent(r) && /^BLOCKED/.test(r.status || '')) ||
  rows.find((r) => absent(r) && r.status === 'BACKLOG');

if (!blockedRow) {
  console.error('SOURCE_MISSING: no blocked row with absent spec found for CONTROL');
  process.exit(2);
}

// The severity ladder AI-20-R06 states, rung by rung: `info` while a row is
// BACKLOG or BLOCKED_*, `error` once it is READY_* or MERGED. Only the statuses the
// rule names appear here — IN_PROGRESS, CHANGES_REQUIRED and CODEX_PASS are not
// covered by AI-20-R06, and asserting a severity for them would be this script
// inventing a rule rather than testing one. Proving a single rung would let the rule
// break for every other status and this script would still print its escalation.
const STATUS_LADDER = [
  { status: 'BACKLOG', severity: 'info' },
  { status: 'BLOCKED_DEPENDENCY', severity: 'info' },
  { status: 'BLOCKED_BY_FOUNDATION', severity: 'info' },
  { status: 'READY_FOR_AUTHOR', severity: 'error' },
  { status: 'READY_FOR_CODEX', severity: 'error' },
  { status: 'READY_FOR_HUMAN_MERGE', severity: 'error' },
  { status: 'MERGED', severity: 'error' },
];

/**
 * The severity the reconciler reports for SPEC_MISSING when the register records the
 * probe row at `status`.
 *
 * The status change is applied to a COPY of the register under a private temporary
 * directory which is re-read through the same canonical reader, so the escalation is
 * attributed to a row the register says is ready rather than to a value this script
 * wrote into memory, and the real register is never touched.
 *
 * A control failure throws instead of exiting, so the temporary directory is removed
 * before the caller reports it.
 */
function severityAt(status) {
  const line = registerText
    .split(/\r?\n/)
    .find((candidate) => candidate.includes('"' + blockedRow.work_item_id + '"'));
  if (!line || !line.includes('"' + blockedRow.status + '"')) {
    throw new Error(
      `CONTROL_FAILURE: the register line for ${blockedRow.work_item_id} was not found`
    );
  }
  const tamperedLine = line.replace('"' + blockedRow.status + '"', '"' + status + '"');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-20-03-'));
  try {
    const tmpRegister = path.join(tmpDir, 'register.csv');
    fs.writeFileSync(
      tmpRegister,
      registerText.replace(line, () => tamperedLine),
      'utf8'
    );
    const tamperedRow = registerRows(fs.readFileSync(tmpRegister, 'utf8')).find(
      (row) => row.work_item_id === blockedRow.work_item_id
    );
    if (!tamperedRow || tamperedRow.status !== status) {
      throw new Error(
        `CONTROL_FAILURE: the tampered copy did not re-read ${blockedRow.work_item_id} as ${status}`
      );
    }
    const reported = reconcileRegister([tamperedRow], { cwd: root }).findings.filter(
      (f) => f.code === 'SPEC_MISSING'
    );
    if (reported.length !== 1) {
      throw new Error(
        `CONTROL_FAILURE: SPEC_MISSING reported ${reported.length} times for ${blockedRow.work_item_id} at ${status}`
      );
    }
    return reported[0].severity;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// CONTROL: the real row, read from the real register with nothing altered, is
// reported as info. The escalation below would mean nothing if the rule already
// errored on every row with an absent specification - every rung of the ladder would
// look like a pass.
const realFindings = reconcileRegister([blockedRow], { cwd: root }).findings.filter(
  (f) => f.code === 'SPEC_MISSING'
);

if (realFindings.length !== 1) {
  console.error(
    `CONTROL_FAILURE: SPEC_MISSING reported ${realFindings.length} times for blocked row ${blockedRow.work_item_id}`
  );
  process.exit(2);
}

if (realFindings[0].severity !== 'info') {
  console.error(
    `CONTROL_FAILURE: blocked row ${blockedRow.work_item_id} reported as ${realFindings[0].severity}, expected info`
  );
  process.exit(2);
}

console.log(
  `CONTROL: ${blockedRow.work_item_id} status=${blockedRow.status} -> SPEC_MISSING severity=info OK`
);

// Walk every rung of the ladder over the one real row. Each rung is a COPY of the
// register in os.tmpdir(), re-read through the same canonical reader, so the
// severity comes from what the register says rather than from a value this script
// wrote into memory, and the real register is never touched.
const measured = new Map();
for (const rung of STATUS_LADDER) {
  let severity;
  try {
    severity = severityAt(rung.status);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (severity !== rung.severity) {
    console.error(
      `SPEC_MISSING_NOT_ESCALATED: ${blockedRow.work_item_id} status=${rung.status} -> SPEC_MISSING severity=${severity}, expected ${rung.severity}`
    );
    process.exit(2);
  }
  measured.set(rung.status, severity);
}

// Both ends of the ladder, read back out of the measurement rather than restated.
// The walk above already fails on any rung that does not match its declared
// severity, so a rule answering one constant for every status never reaches this
// line; what this guard protects is the harness's own premise - if the ladder table
// ever loses its `info` rung or its `error` rung, the escalation above would prove
// nothing, and this script must not print it.
const held = STATUS_LADDER.find((rung) => measured.get(rung.status) === 'info');
const escalated = STATUS_LADDER.find((rung) => measured.get(rung.status) === 'error');
if (!held || !escalated) {
  console.error(
    `SPEC_MISSING_NOT_ESCALATED: the ladder measured no info rung and no error rung for ${blockedRow.work_item_id}`
  );
  process.exit(2);
}

console.log(
  `CONTROL: ${blockedRow.work_item_id} -> SPEC_MISSING severity per status: ` +
    STATUS_LADDER.map((rung) => `${rung.status}=${measured.get(rung.status)}`).join(', ')
);

console.error(
  `SPEC_MISSING_ESCALATED: ${blockedRow.work_item_id} status=${escalated.status} -> SPEC_MISSING severity=${measured.get(escalated.status)}`
);

process.exit(1);
