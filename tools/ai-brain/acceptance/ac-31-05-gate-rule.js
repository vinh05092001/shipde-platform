'use strict';
// AC-AI-31-05 — Gate rule holds over a compliant grant configuration.
// Exit 0 + GATE_HOLDS when gateRuleFindings returns empty for a good config.
const fs = require('fs');

const REPO_MARKER = 'tools/ai-brain/qualification-gate.js';
if (!fs.existsSync(REPO_MARKER)) {
  console.error('SOURCE_MISSING: ' + REPO_MARKER);
  process.exit(2);
}

const { gateRuleFindings, GRANT_CACHE_WINDOW_MS, GRANT_SOURCE } = require('./lib/qualification-gate');

// Control: the rule must be able to report a violation at all.
const control = gateRuleFindings({});
if (control.length === 0) {
  console.error('CONTROL_FAILED: the gate rule cannot report a violation');
  process.exit(2);
}

const now = Date.now();
const compliant = gateRuleFindings({
  outcome: 'pass',
  resultInstant: now - 1000,
  now,
  roleId: 'author.lowrisk',
  entry: { roleId: 'author.lowrisk', grantedAt: now, source: GRANT_SOURCE, probeOutcome: 'pass' },
  writtenFields: ['qualifiedRoles', 'qualificationHistory'],
  removesRole: false,
});
if (compliant.length > 0) {
  for (const f of compliant) console.error('UNEXPECTED: ' + f);
  process.exit(1);
}

console.log('GATE_HOLDS: compliant grant configuration accepted');
process.exit(0);
