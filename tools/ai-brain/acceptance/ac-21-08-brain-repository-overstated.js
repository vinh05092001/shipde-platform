'use strict';
// AC-AI-21-08 — negative proof that the surviving lesson trust-boundary contract
// refuses manifest copies that weaken AI-TOOL-06 (including keyword-preserving
// credential-persistence drift), repoint Hermes to an external repository, or
// re-declare the retired external shipde-brain repository under any ID.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MANIFEST_PATH,
  BRAIN_REPOSITORY,
  BRAIN_URL,
  HERMES_ID,
  UNTRUSTED_POLICY,
  CODES,
  brainRepositoryViolations,
} = require('./lib/brain-repository-contract');

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('SOURCE_MISSING: ' + MANIFEST_PATH);
  process.exit(2);
}

const real = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

if (brainRepositoryViolations(real).length > 0) {
  console.error('CONTROL_FAILED: the real manifest already violates the lesson trust-boundary contract');
  process.exit(2);
}

function verdict(mutate) {
  const copy = JSON.parse(JSON.stringify(real));
  mutate(copy);
  const tmp = path.join(
    os.tmpdir(),
    'shipde-ac21-08-' + process.pid + '-' + Math.random() + '.json'
  );
  fs.writeFileSync(tmp, JSON.stringify(copy));
  const onDisk = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  const violations = brainRepositoryViolations(onDisk);
  return violations[0] || null;
}

const credentialDrift = verdict((manifest) => {
  manifest.policies[UNTRUSTED_POLICY] =
    'Hermes memory is auto-trusted (untrusted until human-reviewed into the repository-local lesson workflow) and may persist credentials despite no PII rules.';
});
if (!credentialDrift || credentialDrift.code !== CODES.UNTRUSTED_POLICY_MISSING) {
  console.error('CONTROL_FAILED: the contract accepted a keyword-preserving weakened AI-TOOL-06 policy');
  process.exit(2);
}

const hermesExternal = verdict((manifest) => {
  const hermes = manifest.adopted.find((entry) => entry.id === HERMES_ID);
  hermes.source_of_truth_boundary =
    'Memory remains untrusted until human-reviewed into the EXTERNAL repository.';
});
if (!hermesExternal || hermesExternal.code !== CODES.HERMES_BOUNDARY_MISSING) {
  console.error('CONTROL_FAILED: the contract accepted Hermes repointed to an external repository');
  process.exit(2);
}

const renamedExternal = verdict((manifest) => {
  manifest.adopted.push({
    id: 'custom-brain-alias',
    repository: BRAIN_REPOSITORY,
    canonical_url: BRAIN_URL,
  });
});
if (!renamedExternal || renamedExternal.code !== CODES.RETIRED_EXTERNAL_DECLARED) {
  console.error('CONTROL_FAILED: the contract accepted a renamed external shipde-brain entry');
  process.exit(2);
}

console.error(CODES.UNTRUSTED_POLICY_MISSING + ': ' + credentialDrift.detail);
process.exit(1);
