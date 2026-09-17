'use strict';
// AC-AI-20-02: Negative proof - the identity rule rejects a tampered copy
//
// Expected: exit 1, print "SPEC_IDENTITY_MISMATCH_DETECTED:" after proving the
// untouched file matches its row.
//
// CONTROL: reads the real register and a real Work Item file, proves the
// untouched file's Control table matches the register row, then tampers only a
// copy written to os.tmpdir() - its Control table is rewritten to name a
// DIFFERENT real register row - and shows the same rule rejecting it.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { REGISTER_PATH, registerRows, specExists, specIdentity } = require('./lib/spec-coverage');

const root = process.cwd();
const registerPath = path.resolve(root, REGISTER_PATH);

// Exit 2 when no register exists - AC-AI-20-04 exercises this.
if (!fs.existsSync(registerPath)) {
  console.error('SOURCE_MISSING: no register at', registerPath);
  process.exit(2);
}

const registerText = fs.readFileSync(registerPath, 'utf8');
const rows = registerRows(registerText);

// Find a real row whose specification exists.
const realRow = rows.find((r) => r.work_item_path && specExists(r, root));
if (!realRow) {
  console.error('SOURCE_MISSING: no specified row found for CONTROL');
  process.exit(2);
}

// CONTROL: prove the untouched real specification matches its row.
const realIdentity = specIdentity(realRow, root);
if (!realIdentity.matches) {
  console.error(
    `CONTROL_FAILURE: real row ${realRow.work_item_id} already mismatched before tampering`
  );
  process.exit(2);
}

console.log(
  `CONTROL: ${realRow.work_item_id} -> "${realIdentity.path}" declares "${realIdentity.declaredId}" OK`
);

// The borrowed identity is never written into this script: it is read out of the
// register, so the tampered copy names a row that really exists rather than a
// literal that names nothing.
const otherRow = rows.find((r) => r.work_item_id && r.work_item_id !== realRow.work_item_id);
if (!otherRow) {
  console.error('SOURCE_MISSING: no second register row to borrow an identity from');
  process.exit(2);
}

// Tamper a copy: change the Control table to name a different register row.
const realPath = path.resolve(root, realRow.work_item_path);
const realContent = fs.readFileSync(realPath, 'utf8');
const tamperedContent = realContent.replace(
  /(\|\s*Work Item ID\s*\|\s*`?)([^`|\s]+)(`?\s*\|\s*)/m,
  (_match, before, _id, after) => before + otherRow.work_item_id + after
);

if (tamperedContent === realContent) {
  console.error('CONTROL_FAILURE: tamper pattern did not match real file');
  process.exit(2);
}

const tmpDir = os.tmpdir();
const tmpPath = path.join(tmpDir, `tampered-${Date.now()}.md`);
fs.writeFileSync(tmpPath, tamperedContent, 'utf8');

// Create a tampered row pointing at the tampered file.
const tamperedRow = { ...realRow, work_item_path: tmpPath };
const tamperedIdentity = specIdentity(tamperedRow, '');

if (tamperedIdentity.matches) {
  console.error('SPEC_IDENTITY_MISMATCH_NOT_DETECTED: tampered file was not rejected');
  fs.unlinkSync(tmpPath);
  process.exit(2);
}

console.error(
  `SPEC_IDENTITY_MISMATCH_DETECTED: tampered file declares "${tamperedIdentity.declaredId}", row expects "${realRow.work_item_id}"`
);

// Clean up.
fs.unlinkSync(tmpPath);
process.exit(1);
