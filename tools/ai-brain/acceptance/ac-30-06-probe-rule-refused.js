'use strict';
// AC-AI-30-06 — negative proof that the probe rule refuses a non-compliant
// configuration (missing bounds, disabled tree kill, unsupported provider,
// unrecorded outcome).
//
// The rule is `./lib/qualification.js`, the same module
// `ac-30-05-probe-rule.js` requires: editing the rule changes both the invariant
// and this proof. The configuration is injected, never a real probe. Run outside
// the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');
const { probeRuleFindings } = require('./lib/qualification');

// Running outside the repository must be detected operationally (exit 2), not as
// a finding (exit 1). AC-AI-30-09 measures this property. The check is relative to
// cwd so a spawned child with a different cwd refuses instead of running against
// the real modules by accident.
const REPO_MARKER = 'tools/ai-brain/qualification.js';
if (!fs.existsSync(REPO_MARKER)) {
  console.error('SOURCE_MISSING: ' + REPO_MARKER);
  process.exit(2);
}

// Control: a fully compliant configuration must be accepted, or refusing a bad one
// says nothing about the rule.
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
  console.error('CONTROL_FAILED: the rule refuses a compliant configuration');
  process.exit(2);
}

const violated = probeRuleFindings({
  timeoutMs: 0,
  treeKill: false,
  cheapestModel: false,
  cacheWindowMs: -1,
  account: { id: 'test-account', provider: 'unknown' },
  provider: 'unknown',
  outcome: 'pass',
  isEntryAdmitted: () => false,
  isProviderSupported: () => false,
  recordOutcome: () => false,
})
  .map((f) => f.replace(/^PROBE_VIOLATED:\s*/, ''))
  .filter((f) => f);

if (violated.length === 0) {
  console.error('PROBE_VIOLATION_NOT_DETECTED');
  process.exit(0);
}
console.error('PROBE_VIOLATED: ' + violated.join('; '));
process.exit(1);
