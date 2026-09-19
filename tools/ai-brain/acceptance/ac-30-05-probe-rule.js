'use strict';
// AC-AI-30-05 — the invariant: the probe rule holds over a compliant, injected
// probe configuration (entry-admitted account, supported provider, bounded config,
// outcome recorded).
//
// The rule lives in `./lib/qualification.js`, the same module the negative proof
// `ac-30-06-probe-rule-refused.js` requires, so the gate and the proof of the gate
// cannot drift apart. No real probe, registry or network is touched: the operational
// checks are injected doubles. Run outside the repository it exits 2, not 0.
const fs = require('fs');
const { probeRuleFindings } = require('./lib/qualification');

// Running outside the repository must be detected operationally (exit 2), not as
// a finding (exit 1). The check is relative to cwd so a spawned child with a
// different cwd refuses instead of running against the real modules by accident.
const REPO_MARKER = 'tools/ai-brain/qualification.js';
if (!fs.existsSync(REPO_MARKER)) {
  console.error('SOURCE_MISSING: ' + REPO_MARKER);
  process.exit(2);
}

// Control: the rule must be able to report a violation at all. A configuration
// missing every required field must be refused.
const control = probeRuleFindings({});
if (control.length === 0) {
  console.error('CONTROL_FAILED: the probe rule cannot report a violation');
  process.exit(2);
}

// A compliant, fully-injected configuration must be accepted.
const compliant = probeRuleFindings({
  timeoutMs: 30_000,
  treeKill: true,
  cheapestModel: true,
  cacheWindowMs: 60_000,
  account: { id: 'test-account', provider: 'claude-code' },
  provider: 'claude-code',
  outcome: 'pass',
  isEntryAdmitted: () => true,
  isProviderSupported: () => true,
  recordOutcome: () => true,
});
if (compliant.length > 0) {
  for (const f of compliant) console.error('UNEXPECTED: ' + f);
  process.exit(1);
}

console.log('PROBE_HOLDS: compliant injected probe configuration accepted');
process.exit(0);
