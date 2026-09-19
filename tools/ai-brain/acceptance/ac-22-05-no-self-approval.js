'use strict';
// AC-AI-22-05 — the invariant: no approved or superseded lesson the repository
// ships was approved by its own proposer or by an agent.
//
// The rule is `./lib/lesson-promotion.js`, the same module the negative proof
// `ac-22-06-self-approval-detected.js` requires. The seed is read from disk.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const { SEED_PATH, approvalViolations, promotedCount } = require('./lib/lesson-promotion');

if (!fs.existsSync(SEED_PATH)) {
  console.error('SOURCE_MISSING: ' + SEED_PATH);
  process.exit(2);
}

let seed;
try {
  seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
} catch (error) {
  console.error('SOURCE_MISSING: ' + SEED_PATH + ' is not JSON: ' + error.message);
  process.exit(2);
}

const violations = approvalViolations(seed);
if (violations.length > 0) {
  console.error('PROMOTION_CONTRACT_VIOLATED: ' + violations.join('; '));
  process.exit(1);
}

console.log(
  'NO_SELF_APPROVAL: every promoted lesson in ' +
    SEED_PATH +
    ' names an approver who is neither its proposer nor an agent (inspected: ' +
    promotedCount(seed) +
    ')'
);
