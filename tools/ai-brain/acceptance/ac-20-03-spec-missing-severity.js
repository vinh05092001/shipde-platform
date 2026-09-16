'use strict';
// AC-AI-20-03 — negative proof that the reconciler's SPEC_MISSING severity
// escalates with lifecycle, using the real rule in tools/ai-brain/reconcile.js.
//
// The register's own SPEC_MISSING finding is what stops an item being worked on
// without a specification. For a row that is still blocked it is only `info`;
// for a row that is READY_FOR_AUTHOR or beyond it is an `error`, because a ready
// item whose document does not exist is exactly the overstatement the
// reconciler exists to refuse. This script proves the escalation with the real
// module: it reads the real register, finds a real blocked row whose spec is
// genuinely absent, CONTROLs that its current status yields only `info`, then
// rewrites a COPY of the register in os.tmpdir() with that row's status set to
// READY_FOR_AUTHOR and asserts the same real check now reports `error`.
//
// The rule lives in tools/ai-brain/reconcile.js — the module the reconciler
// itself uses — so the positive half (AC-AI-20-05, `cli.js reconcile`) and this
// negative half can never disagree about what SPEC_MISSING means.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REGISTER_PATH, registerRows } = require('./lib/spec-coverage');
const { reconcileRegister } = require('../reconcile');

if (!fs.existsSync(REGISTER_PATH) || !fs.existsSync(path.join(__dirname, '..', 'reconcile.js'))) {
  console.error('SOURCE_MISSING: ' + REGISTER_PATH.split(path.sep).join('/') + ' or reconcile.js');
  process.exit(2);
}

const root = process.cwd();
const original = fs.readFileSync(REGISTER_PATH, 'utf8');
const rows = registerRows(original);

function specMissing(rowsIn) {
  return reconcileRegister(rowsIn, { cwd: root }).findings.filter((f) => f.code === 'SPEC_MISSING');
}

const blocked = rows.filter(
  (row) =>
    row.work_item_path &&
    /^BLOCKED/.test(row.status || '') &&
    !fs.existsSync(path.resolve(root, row.work_item_path))
);
if (blocked.length === 0) {
  console.error('SOURCE_MISSING: no blocked register row with an absent spec');
  process.exit(2);
}
const row = blocked[0];

// CONTROL: while the row is blocked, its absent spec is reported as `info`.
const control = specMissing([row]);
if (control.length !== 1 || control[0].severity !== 'info') {
  console.error('CONTROL_FAILED: a blocked row with an absent spec was not reported as info');
  process.exit(2);
}

// Tamper a COPY of the register in the OS temp directory: same row, now ready.
const line = original
  .split(/\r?\n/)
  .find((candidate) => candidate.includes('"' + row.work_item_id + '"'));
if (!line || !line.includes('"' + row.status + '"')) {
  console.error('CONTROL_FAILED: the register line for ' + row.work_item_id + ' was not found');
  process.exit(2);
}
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-20-03-'));
const tmpRegister = path.join(tmpDir, 'register.csv');
fs.writeFileSync(
  tmpRegister,
  original.replace(line, line.replace('"' + row.status + '"', '"READY_FOR_AUTHOR"'))
);

const reread = registerRows(fs.readFileSync(tmpRegister, 'utf8')).find(
  (candidate) => candidate.work_item_id === row.work_item_id
);
const escalated = specMissing([reread]);
fs.rmSync(tmpDir, { recursive: true, force: true });

if (escalated.length !== 1 || escalated[0].severity !== 'error') {
  console.error('SPEC_MISSING_ESCALATION_NOT_DETECTED');
  process.exit(0);
}
console.error(
  'SPEC_MISSING_ESCALATED: ' + row.work_item_id + ' info -> error once READY_FOR_AUTHOR'
);
process.exit(1);
