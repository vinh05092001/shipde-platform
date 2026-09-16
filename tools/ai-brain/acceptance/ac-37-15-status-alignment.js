'use strict';
// AC-AI-37-15 — the Control table `Status` cell and delivery register row 170
// cannot silently diverge.
//
// The stored row could not run as written: its regular expression was written
// with markdown-escaped pipes (`\n\| Status \| .([A-Z_]+). \|\n`). Copied out of
// the rendered table the backslashes vanish and the expression becomes an
// alternation of empty branches, so `re.search` matched at offset 0 and the
// command died with `TypeError: can only concatenate str (not "NoneType") to str`
// (measured exit 1, expected 0). A command that cannot survive being copied out
// of its own table is not a check.
//
// This script parses the real Control table and the real register, and exits 2
// outside the repository rather than reporting a match it never made.
const fs = require('fs');
const path = require('path');

const SPEC = path.join('docs', 'product-spec', 'work-items', 'TASK-AI-37.md');
const REGISTER = path.join(
  'docs',
  'product-spec',
  'docs',
  '10-ai-collaboration',
  'FEATURE-DELIVERY-REGISTER.csv'
);

for (const source of [SPEC, REGISTER]) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source.split(path.sep).join('/'));
    process.exit(2);
  }
}

const STATUS_CELL = /^\|\s*Status\s*\|\s*`?([A-Z_]+)`?\s*\|\s*$/m;

function controlStatus(markdown) {
  const match = markdown.match(STATUS_CELL);
  return match ? match[1] : null;
}

const markdown = fs.readFileSync(SPEC, 'utf8');
const declared = controlStatus(markdown);

// CONTROL: the parser must really extract a value, and must notice a divergent
// one, or "matches" would be vacuous.
if (declared === null) {
  console.error('CONTROL_FAILED: no Control table Status cell parsed from ' + SPEC);
  process.exit(2);
}
if (
  controlStatus(markdown.replace(/^\|\s*Status\s*\|.*$/m, '| Status | `READY_FOR_CODEX` |')) ===
  declared
) {
  console.error('CONTROL_FAILED: the parser cannot tell two different Control statuses apart');
  process.exit(2);
}

// The register is quoted CSV whose values contain commas (`key_behavior` for
// row 170 reads "Vulnerability, misconfiguration, secret and SBOM scanning…").
// A naive `split(',')` shifts every later column, so the line is scanned.
function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

const rows = fs
  .readFileSync(REGISTER, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim() !== '');
const header = parseCsvLine(rows[0]);
const workItemColumn = header.indexOf('work_item_id');
const statusColumn = header.indexOf('status');
if (workItemColumn < 0 || statusColumn < 0) {
  console.error('REGISTER_MALFORMED: work_item_id/status column missing');
  process.exit(2);
}

let registered = null;
for (const line of rows.slice(1)) {
  const cells = parseCsvLine(line);
  if (cells[workItemColumn] === 'TASK-AI-37') {
    registered = cells[statusColumn];
    break;
  }
}
if (registered === null) {
  console.error('REGISTER_ROW_MISSING: TASK-AI-37');
  process.exit(2);
}

if (declared !== registered) {
  console.error('STATUS_DIVERGENCE: ' + declared + ' vs ' + registered);
  process.exit(1);
}
console.log('CONTROL: parser distinguishes statuses and register row 170 was located');
console.log('Control status matches register row 170: ' + registered);
