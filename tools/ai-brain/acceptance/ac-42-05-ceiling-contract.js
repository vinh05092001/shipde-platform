'use strict';
// AC-AI-42-05 — the invariant: scheduler enforces concurrent implementation
// ceiling of 1 and requires a governed decision to raise it.
//
// The rule lives in `./lib/implementation-ceiling.js`, the same module the
// negative proof `ac-42-06-unvetted-setting-rejected.js` requires.
// The contract is evaluated against the real `tools/ai-brain/scheduler.js`.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const { SCHEDULER_SOURCE, missingCeilingParts } = require('./lib/implementation-ceiling');

if (!fs.existsSync(SCHEDULER_SOURCE)) {
  console.error('SOURCE_MISSING: ' + SCHEDULER_SOURCE);
  process.exit(2);
}

const source = fs.readFileSync(SCHEDULER_SOURCE, 'utf8');
const missing = missingCeilingParts(source);

if (missing.length > 0) {
  console.error(
    'CEILING_CONTRACT_VIOLATED: ' + missing.map((m) => m.id + ': ' + m.label).join('; ')
  );
  process.exit(1);
}

console.log(
  'CEILING_GOVERNANCE_CONTRACT_HOLDS: scheduler enforces implementation ceiling of 1 and requires a governed decision to raise it'
);
process.exit(0);
