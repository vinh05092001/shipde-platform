'use strict';
// AC-AI-35-07 — negative proof that the baseline check behind AI-35-R01 rejects
// a tampered copy of the real ecosystem manifest. Both the manifest entry and
// the version actually provisioned by the CI workflow are read from the real
// files; nothing is restated as a literal. The files on disk are never written.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MANIFEST = 'tools/ecosystem-manifest.json';
const WORKFLOW = '.github/workflows/security-baseline.yml';

for (const src of [MANIFEST, WORKFLOW]) {
  if (!fs.existsSync(src)) {
    console.error('SOURCE_MISSING: ' + src);
    process.exit(2);
  }
}

const workflow = fs.readFileSync(WORKFLOW, 'utf8');
const provisioned = workflow.match(/GITLEAKS_VERSION\s*=\s*"([^"]+)"/);
if (!provisioned) {
  console.error('SOURCE_MISSING: GITLEAKS_VERSION in ' + WORKFLOW);
  process.exit(2);
}

// The check under test: the manifest must declare gitleaks as the adopted,
// blocking, CI-provisioned gate pinned to the version the workflow installs.
function reject(manifest) {
  const entry = (manifest.adopted || []).find((x) => x.id === 'gitleaks');
  if (!entry) return 'gitleaks absent from the adopted set';
  if (entry.lifecycle_state !== 'ADOPTED') return 'lifecycle_state is ' + entry.lifecycle_state;
  if (entry.blocking_policy !== 'BLOCKING_GATE')
    return 'blocking_policy is ' + entry.blocking_policy;
  if (entry.install_method !== 'ci-provisioned') return 'install_method is ' + entry.install_method;
  if (entry.pinned_version_or_commit !== provisioned[1])
    return 'pinned ' + entry.pinned_version_or_commit + ' but CI installs ' + provisioned[1];
  return null;
}

const real = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// Control: the untouched real manifest must be accepted, or the tampered copy
// proves nothing.
const controlReason = reject(real);
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
const reason = reject(reread);
fs.unlinkSync(tmp);

if (!reason) {
  console.error('GITLEAKS_BASELINE_TAMPER_ACCEPTED: the check accepted a downgraded gate');
  process.exit(0);
}
console.error('GITLEAKS_BASELINE_TAMPER_REJECTED: ' + reason);
process.exit(1);
