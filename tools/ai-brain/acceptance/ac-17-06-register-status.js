'use strict';
// AC-AI-17-06 — the delivery register records TASK-AI-17 at READY_FOR_CODEX.
//
// The stored row was prose ("CSV row inspection"). This script reads the REAL
// register and asserts the one field the row names, and it proves the reader is
// live by pointing it at a tampered COPY where that row says MERGED. A reader
// that finds nothing would otherwise pass on any input.
//
// Exit codes: 0 the claim holds - 1 the claim is violated - 2 cannot measure.
const fs = require('fs');
const os = require('os');
const path = require('path');

const REGISTER = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const ITEM = 'TASK-AI-17';
const EXPECTED_STATUS = 'READY_FOR_CODEX';

if (!fs.existsSync(REGISTER)) {
  console.error('SOURCE_MISSING: run from the repository root (' + REGISTER + ')');
  process.exit(2);
}

/** Quote-aware CSV split, enough for this register (no embedded newlines). */
function splitRow(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

function statusOf(text, workItemId) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitRow(lines[0]);
  const idAt = header.indexOf('work_item_id');
  const statusAt = header.indexOf('status');
  if (idAt < 0 || statusAt < 0) return { error: 'register header lacks work_item_id/status' };
  const rows = lines.slice(1).map(splitRow);
  const matches = rows.filter((r) => r[idAt] === workItemId);
  if (matches.length !== 1) return { error: workItemId + ' matched ' + matches.length + ' rows' };
  return { status: matches[0][statusAt] };
}

const text = fs.readFileSync(REGISTER, 'utf8');

// Control: the reader must see a status change in a copy.
const tmp = path.join(os.tmpdir(), 'shipde-ac17-06-' + process.pid + '.csv');
fs.writeFileSync(tmp, text.replace(/("TASK-AI-17")([^\n]*?)"READY_FOR_CODEX"/, '$1$2"MERGED"'));
const control = statusOf(fs.readFileSync(tmp, 'utf8'), ITEM);
fs.unlinkSync(tmp);
if (control.error || control.status === EXPECTED_STATUS) {
  console.error('CONTROL_FAILED: the reader did not observe the tampered status');
  process.exit(2);
}
console.log('CONTROL: tampered register read as ' + control.status);

const real = statusOf(text, ITEM);
if (real.error) {
  console.error('REGISTER_UNREADABLE: ' + real.error);
  process.exit(2);
}
console.log('REGISTER ' + ITEM + ': ' + real.status);
if (real.status !== EXPECTED_STATUS) {
  console.error('REGISTER_STATUS_WRONG: ' + ITEM + ' is ' + real.status);
  process.exit(1);
}
console.log('AC-AI-17-06 register status held');
process.exit(0);
