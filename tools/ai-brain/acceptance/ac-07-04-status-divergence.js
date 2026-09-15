'use strict';
// AC-AI-07-04 — negative proof for the Control-table/register comparison.
//
// The check lives in a file rather than in the acceptance table because the
// same command has to survive markdown, bash and PowerShell quoting; a
// one-liner that reaches Node mangled fails for a reason unrelated to the
// property under test, and its exit code still looks like the expected one.
//
// It tampers with a COPY of the real specification and runs the same
// comparison AC-AI-07-03 runs. Nothing on disk is modified.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SPEC = 'docs/product-spec/work-items/TASK-AI-07.md';
const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const STATUS_CELL = /\n\| Status \| .([A-Z_]+). \|\n/;

if (!fs.existsSync(SPEC) || !fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: run from the repository root');
  process.exit(2);
}

const md = fs.readFileSync(SPEC, 'utf8');
const m = STATUS_CELL.exec(md);
if (!m) {
  console.error('NO_STATUS_CELL');
  process.exit(2);
}

const registerLine = fs
  .readFileSync(REG, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.includes('"TASK-AI-07"'));
const registerStatus =
  registerLine &&
  (registerLine.match(/"(BACKLOG|MERGED|BLOCKED_[A-Z_]+|READY_FOR_[A-Z]+|SUPERSEDED)"/) || [])[1];
if (!registerStatus) {
  console.error('SOURCE_MISSING: no TASK-AI-07 status in the register');
  process.exit(2);
}

// Control: the untampered file must agree with the register, otherwise the
// tampered case below proves nothing about the comparison.
if (m[1] !== registerStatus) {
  console.error('CONTROL_FAILED: the real specification already diverges from the register');
  process.exit(2);
}

const tampered =
  md.slice(0, m.index) + m[0].replace(m[1], 'READY_FOR_AUTHOR') + md.slice(m.index + m[0].length);
const tmp = path.join(os.tmpdir(), 'shipde-ac07-04-' + process.pid + '.md');
fs.writeFileSync(tmp, tampered);
const observed = STATUS_CELL.exec(fs.readFileSync(tmp, 'utf8'))[1];
fs.unlinkSync(tmp);

if (observed === registerStatus) {
  console.error('DIVERGENCE_NOT_DETECTED');
  process.exit(0);
}
console.error(
  'STATUS_DIVERGENCE_DETECTED: tampered copy ' + observed + ' != register ' + registerStatus
);
process.exit(1);
