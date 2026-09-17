'use strict';
// AC-AI-20-03: Negative proof - SPEC_MISSING severity escalates
//
// Expected: exit 1, print "SPEC_MISSING_ESCALATED:" after proving the real
// blocked row is reported as info, tampering a copy of the register in
// os.tmpdir() to make it ready, and showing the same rule escalating it to
// error.
//
// Uses the real reconciler's SPEC_MISSING rule, not a private copy.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseRegisterCsv } = require('../../ai-dashboard/register-adapter');
const { reconcileRegister } = require('../reconcile');

const REGISTER_PATH = path.join(
  'docs',
  'product-spec',
  'docs',
  '10-ai-collaboration',
  'FEATURE-DELIVERY-REGISTER.csv'
);

const root = process.cwd();
const registerPath = path.resolve(root, REGISTER_PATH);

// Exit 2 when no register exists - AC-AI-20-04 exercises this.
if (!fs.existsSync(registerPath)) {
  console.error('SOURCE_MISSING: no register at', registerPath);
  process.exit(2);
}

const registerText = fs.readFileSync(registerPath, 'utf8');
const rows = parseRegisterCsv(registerText, null);

// Find a real blocked row whose work_item_path is absent. A BLOCKED_* row is
// preferred; a BACKLOG row is the fallback. Both are reported as `info` while a
// specification is absent (AI-20-R06).
const absent = (r) => r.work_item_path && !fs.existsSync(path.resolve(root, r.work_item_path));
const blockedRow =
  rows.find((r) => absent(r) && /^BLOCKED/.test(r.status || '')) ||
  rows.find((r) => absent(r) && r.status === 'BACKLOG');

if (!blockedRow) {
  console.error('SOURCE_MISSING: no blocked row with absent spec found for CONTROL');
  process.exit(2);
}

// CONTROL: prove the real blocked row's absent spec is reported as info.
const realResult = reconcileRegister([blockedRow], { cwd: root });
const realSpecMissing = realResult.findings.find((f) => f.code === 'SPEC_MISSING');

if (!realSpecMissing) {
  console.error(
    `CONTROL_FAILURE: SPEC_MISSING not reported for blocked row ${blockedRow.work_item_id}`
  );
  process.exit(2);
}

if (realSpecMissing.severity !== 'info') {
  console.error(
    `CONTROL_FAILURE: blocked row ${blockedRow.work_item_id} reported as ${realSpecMissing.severity}, expected info`
  );
  process.exit(2);
}

console.log(
  `CONTROL: ${blockedRow.work_item_id} status=${blockedRow.status} -> SPEC_MISSING severity=info OK`
);

// Tamper a COPY of the register in os.tmpdir(): the same row, now ready. The
// copy is re-read through the same canonical parser, so the escalation comes
// from the row's status rather than from a value this script wrote into memory,
// and the real register is never touched.
const line = registerText
  .split(/\r?\n/)
  .find((candidate) => candidate.includes('"' + blockedRow.work_item_id + '"'));
if (!line || !line.includes('"' + blockedRow.status + '"')) {
  console.error(`CONTROL_FAILURE: the register line for ${blockedRow.work_item_id} was not found`);
  process.exit(2);
}
const tamperedLine = line.replace('"' + blockedRow.status + '"', '"READY_FOR_AUTHOR"');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-20-03-'));
const tmpRegister = path.join(tmpDir, 'register.csv');
fs.writeFileSync(
  tmpRegister,
  registerText.replace(line, () => tamperedLine),
  'utf8'
);
const tamperedRow = parseRegisterCsv(fs.readFileSync(tmpRegister, 'utf8'), null).find(
  (row) => row.work_item_id === blockedRow.work_item_id
);
fs.rmSync(tmpDir, { recursive: true, force: true });

if (!tamperedRow || tamperedRow.status !== 'READY_FOR_AUTHOR') {
  console.error(
    `CONTROL_FAILURE: the tampered copy did not re-read ${blockedRow.work_item_id} as READY_FOR_AUTHOR`
  );
  process.exit(2);
}

const tamperedResult = reconcileRegister([tamperedRow], { cwd: root });
const tamperedSpecMissing = tamperedResult.findings.find((f) => f.code === 'SPEC_MISSING');

if (!tamperedSpecMissing) {
  console.error('SPEC_MISSING_NOT_ESCALATED: SPEC_MISSING not reported for ready row');
  process.exit(2);
}

if (tamperedSpecMissing.severity !== 'error') {
  console.error(
    `SPEC_MISSING_NOT_ESCALATED: ready row reported as ${tamperedSpecMissing.severity}, expected error`
  );
  process.exit(2);
}

console.error(
  `SPEC_MISSING_ESCALATED: ${tamperedRow.work_item_id} status=READY_FOR_AUTHOR -> SPEC_MISSING severity=error`
);

process.exit(1);
