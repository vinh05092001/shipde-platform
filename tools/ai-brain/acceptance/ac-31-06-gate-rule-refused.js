'use strict';
// AC-AI-31-06 — Non-compliant grant configuration is refused (negative proof).
// Exit 1 + GATE_VIOLATED when gateRuleFindings returns findings for a bad config.
const fs = require('fs');

const REPO_MARKER = 'tools/ai-brain/qualification-gate.js';
if (!fs.existsSync(REPO_MARKER)) {
  console.error('SOURCE_MISSING: ' + REPO_MARKER);
  process.exit(2);
}

const { gateRuleFindings, GRANT_SOURCE } = require('./lib/qualification-gate');

// Verify the rule module is the same object referenced by qualification-gate.js
const gateModule = require('../qualification-gate');
if (gateModule.grantRule !== require('./lib/qualification-gate')) {
  console.error('RULE_SOURCE_WRONG: qualification-gate.js does not re-export the rule by reference');
  process.exit(2);
}

const now = Date.now();

// Non-compliant 1: outcome is fail
const findings1 = gateRuleFindings({
  outcome: 'fail',
  resultInstant: now - 1000,
  now,
  entry: { roleId: 'author.lowrisk', grantedAt: now, source: GRANT_SOURCE, probeOutcome: 'pass' },
  writtenFields: ['qualifiedRoles'],
  removesRole: false,
});
if (findings1.length === 0) {
  console.error('GATE_VIOLATED: fail outcome was not refused');
  process.exit(2);
}

// Non-compliant 2: forbidden written field
const findings2 = gateRuleFindings({
  outcome: 'pass',
  resultInstant: now - 1000,
  now,
  entry: { roleId: 'author.lowrisk', grantedAt: now, source: GRANT_SOURCE, probeOutcome: 'pass' },
  writtenFields: ['grade'],
  removesRole: false,
});
if (findings2.length === 0) {
  console.error('GATE_VIOLATED: forbidden field "grade" was not refused');
  process.exit(2);
}

// Non-compliant 3: removesRole true
const findings3 = gateRuleFindings({
  outcome: 'pass',
  resultInstant: now - 1000,
  now,
  entry: { roleId: 'author.lowrisk', grantedAt: now, source: GRANT_SOURCE, probeOutcome: 'pass' },
  writtenFields: ['qualifiedRoles'],
  removesRole: true,
});
if (findings3.length === 0) {
  console.error('GATE_VIOLATED: removesRole=true was not refused');
  process.exit(2);
}

process.stderr.write('GATE_VIOLATED: all three non-compliant configs correctly refused (negative proof confirmed)\n');
process.exit(1);
