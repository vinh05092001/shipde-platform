'use strict';
// AC-AI-20-02 — negative proof that the specification-identity rule rejects a
// spec whose Control table belongs to another register row.
//
// The real register is read, a real Work Item file that it names is located, and
// a CONTROL confirms the untouched file matches its row. The tampering is then
// done on a COPY written to os.tmpdir(): the Control table is rewritten to
// declare a different Work Item ID, and the same rule AC-AI-20-01 runs must
// reject it. Nothing inside the repository is modified.
//
// The rule is ./lib/spec-coverage.js, required by AC-AI-20-01 as well, so the
// gate and the proof of the gate cannot drift apart. Exit 2, never 1, when run
// outside the repository, so an absent register cannot read as a rejection.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REGISTER_PATH, registerRows, specIdentity } = require('./lib/spec-coverage');

if (!fs.existsSync(REGISTER_PATH)) {
  console.error('SOURCE_MISSING: ' + REGISTER_PATH.split(path.sep).join('/'));
  process.exit(2);
}

const root = process.cwd();
const rows = registerRows(fs.readFileSync(REGISTER_PATH, 'utf8'));

// CONTROL: a real row whose spec really does declare it, or rejecting a tampered
// copy says nothing about the rule.
const row = rows.find(
  (candidate) => candidate.work_item_path && specIdentity(candidate, root).matches
);
if (!row) {
  console.error('CONTROL_FAILED: no register row names a spec that declares it');
  process.exit(2);
}

const other = rows.find(
  (candidate) => candidate.work_item_id && candidate.work_item_id !== row.work_item_id
);
if (!other) {
  console.error('SOURCE_MISSING: no second register row to borrow an identity from');
  process.exit(2);
}

const original = fs.readFileSync(path.resolve(root, row.work_item_path), 'utf8');
const tampered = original.replace(
  /(^\|\s*Work Item ID\s*\|\s*`?)([^`|\s]+)(`?\s*\|\s*$)/m,
  '$1' + other.work_item_id + '$3'
);
if (tampered === original) {
  console.error('CONTROL_FAILED: the tamper changed nothing, so the Control cell was not found');
  process.exit(2);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-20-02-'));
const tmpSpec = path.join(tmpDir, 'tampered.md');
fs.writeFileSync(tmpSpec, tampered);

// specIdentity resolves absolute paths unchanged, so the copy lives outside the
// repository while the row still names its own path.
const probe = Object.assign({}, row, { work_item_path: tmpSpec });
const verdict = specIdentity(probe, root);
fs.rmSync(tmpDir, { recursive: true, force: true });

if (verdict.matches) {
  console.error('SPEC_IDENTITY_MISMATCH_NOT_DETECTED');
  process.exit(0);
}
console.error(
  'SPEC_IDENTITY_MISMATCH_DETECTED: ' +
    row.work_item_path +
    ' declares ' +
    verdict.declaredId +
    ', register row is ' +
    row.work_item_id
);
process.exit(1);
