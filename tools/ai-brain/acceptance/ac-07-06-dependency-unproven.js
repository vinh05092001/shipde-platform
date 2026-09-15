'use strict';
// AC-AI-07-06 — negative proof that the real reconciler refuses a dependency
// whose status is not MERGED. The register row is read from disk and only its
// status is degraded, so every other field is exactly what the register holds.
const fs = require('fs');
const path = require('path');

let dependencyProven;
try {
  ({ dependencyProven } = require(path.resolve(process.cwd(), 'tools/ai-brain/reconcile')));
} catch (err) {
  console.error('SOURCE_MISSING: ' + err.message);
  process.exit(2);
}

const REG = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
if (!fs.existsSync(REG)) {
  console.error('SOURCE_MISSING: ' + REG);
  process.exit(2);
}

function fields(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const lines = fs.readFileSync(REG, 'utf8').split(/\r?\n/).filter(Boolean);
const header = fields(lines[0]);
const rows = lines.slice(1).map((l) => Object.fromEntries(header.map((k, i) => [k, fields(l)[i]])));
const real = rows.find((r) => r.work_item_id === 'TASK-AI-06');
if (!real) {
  console.error('SOURCE_MISSING: no TASK-AI-06 row');
  process.exit(2);
}

const probes = { hasCommit: () => true, hasFile: () => true, merged: () => true };

// Control: the real row must be provable, or refusing a degraded copy of it
// says nothing about the rule.
if (!dependencyProven('TASK-AI-06', new Map([['TASK-AI-06', real]]), probes).ok) {
  console.error(
    'CONTROL_FAILED: the real TASK-AI-06 row is not provable, so the negative case is meaningless'
  );
  process.exit(2);
}

const degraded = Object.assign({}, real, { status: 'IN_PROGRESS' });
const verdict = dependencyProven('TASK-AI-06', new Map([['TASK-AI-06', degraded]]), probes);
if (verdict.ok) {
  console.error('DEPENDENCY_WRONGLY_PROVEN');
  process.exit(0);
}
console.error('DEPENDENCY_UNSATISFIED: ' + verdict.why);
process.exit(1);
