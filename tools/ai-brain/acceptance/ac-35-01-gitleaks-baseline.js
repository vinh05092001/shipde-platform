'use strict';
// AC-AI-35-01 - the baseline rule `AI-35-R01` depends on holds for the real
// repository: Gitleaks is the adopted, blocking, CI-provisioned gate, pinned to
// the exact version `.github/workflows/security-baseline.yml` installs.
//
// The rule lives in exactly one place, `./lib/gitleaks-baseline.js`, which
// AC-AI-35-07 also requires for its negative proof. This row is the positive
// half of that pair, so the two rows cannot drift: any change to the rule
// changes what both of them assert.
//
// The row this replaces carried a JavaScript `||` inside a markdown table cell,
// which splits the cell and makes the command unrunnable as stored, so it was
// moved into a file. It exits 2 outside the repository, so a missing repository
// can never be read as a clean result.
const fs = require('fs');
const path = require('path');
const { checkGitleaksBaseline, provisionedGitleaksVersion } = require('./lib/gitleaks-baseline.js');

const MANIFEST = path.join('tools', 'ecosystem-manifest.json');
const WORKFLOW = path.join('.github', 'workflows', 'security-baseline.yml');

for (const src of [MANIFEST, WORKFLOW]) {
  if (!fs.existsSync(src)) {
    console.error('SOURCE_MISSING: ' + src);
    process.exit(2);
  }
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const provisioned = provisionedGitleaksVersion(fs.readFileSync(WORKFLOW, 'utf8'));

// Control: the workflow must really pin a version, or "the manifest agrees with
// CI" would be satisfied by agreeing with nothing.
if (!provisioned) {
  console.error('CONTROL_FAILED: no GITLEAKS_VERSION pin in ' + WORKFLOW);
  process.exit(2);
}

const reason = checkGitleaksBaseline(manifest, provisioned);
if (reason) {
  console.error('GITLEAKS_BASELINE_RULE_VIOLATED: ' + reason);
  process.exit(1);
}

const entry = manifest.adopted.find((x) => x.id === 'gitleaks');
console.log(
  'GITLEAKS_BASELINE_VERIFIED: ' +
    entry.id +
    ' ' +
    entry.lifecycle_state +
    ' ' +
    entry.blocking_policy +
    ' ' +
    entry.pinned_version_or_commit
);
