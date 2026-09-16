'use strict';
// AC-AI-35-07 - negative proof that the baseline rule behind `AI-35-R01`
// rejects a tampered copy of the real ecosystem manifest. Both the manifest
// entry and the version actually provisioned by the CI workflow are read from
// the real files; nothing is restated as a literal. The files on disk are never
// written.
//
// The rule itself is not written here. It is required from
// `./lib/gitleaks-baseline.js`, the same module AC-AI-35-01 uses for its
// positive assertion, so this negative proof exercises the rule the positive
// row runs rather than a private copy of it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkGitleaksBaseline, provisionedGitleaksVersion } = require('./lib/gitleaks-baseline.js');

const MANIFEST = 'tools/ecosystem-manifest.json';
const WORKFLOW = '.github/workflows/security-baseline.yml';

for (const src of [MANIFEST, WORKFLOW]) {
  if (!fs.existsSync(src)) {
    console.error('SOURCE_MISSING: ' + src);
    process.exit(2);
  }
}

const provisioned = provisionedGitleaksVersion(fs.readFileSync(WORKFLOW, 'utf8'));
if (!provisioned) {
  console.error('CONTROL_FAILED: no GITLEAKS_VERSION pin in ' + WORKFLOW);
  process.exit(2);
}

const real = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// Control: the untouched real manifest must be accepted, or the tampered copy
// proves nothing.
const controlReason = checkGitleaksBaseline(real, provisioned);
if (controlReason) {
  console.error('CONTROL_FAILED: the untouched manifest is already rejected — ' + controlReason);
  process.exit(2);
}

const tampered = JSON.parse(JSON.stringify(real));
const target = tampered.adopted.find((x) => x.id === 'gitleaks');
target.lifecycle_state = 'PENDING';
target.blocking_policy = 'NON_BLOCKING';

const tmp = path.join(os.tmpdir(), 'shipde-ac35-07-' + process.pid + '.json');
fs.writeFileSync(tmp, JSON.stringify(tampered));
const reread = JSON.parse(fs.readFileSync(tmp, 'utf8'));
const reason = checkGitleaksBaseline(reread, provisioned);
fs.unlinkSync(tmp);

if (!reason) {
  console.error('GITLEAKS_BASELINE_TAMPER_ACCEPTED: the rule accepted a downgraded gate');
  process.exit(0);
}
console.error('GITLEAKS_BASELINE_TAMPER_REJECTED: ' + reason);
process.exit(1);
