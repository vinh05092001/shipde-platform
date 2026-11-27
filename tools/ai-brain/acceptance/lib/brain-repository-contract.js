'use strict';
// TASK-AI-21 / TASK-AI-238 Addendum 5 — repository-local lesson trust-boundary contract.
//
// The external `vinh05092001/shipde-brain` repository declaration was retired in
// TASK-AI-238 Addendum 5; reviewed lessons live in the repository-local workflow
// (`tools/ai-brain/lessons/lesson-schema.json`, `lesson-seed.json`).
//
// `ac-21-07-brain-repository-contract.js` (invariant) and
// `ac-21-08-brain-repository-overstated.js` (negative proof) both require this
// module so the gate and its proof cannot drift apart.
//
// Exit codes used by scripts that require this file:
//   0 the contract holds   1 it is violated   2 it cannot be measured

const MANIFEST_PATH = 'tools/ecosystem-manifest.json';
const BRAIN_ID = 'shipde-brain';
const BRAIN_REPOSITORY = 'vinh05092001/shipde-brain';
const BRAIN_URL = 'https://github.com/' + BRAIN_REPOSITORY;
const HERMES_ID = 'hermes-agent';
const UNTRUSTED_POLICY = 'AI-TOOL-06';
const CANONICAL_POLICY =
  'Hermes memory and self-created skills are untrusted until human-reviewed into the repository-local lesson workflow; no PII or credential persistence.';
const CANONICAL_HERMES_BOUNDARY =
  'Memory and self-created skills are untrusted until human-reviewed into the repository-local lesson workflow; no PII or credential persistence.';

const CODES = {
  RETIRED_EXTERNAL_DECLARED: 'RETIRED_BRAIN_REPOSITORY_DECLARED',
  UNTRUSTED_POLICY_MISSING: 'BRAIN_UNTRUSTED_UNTIL_REVIEWED_MISSING',
  HERMES_BOUNDARY_MISSING: 'HERMES_TRUST_BOUNDARY_MISSING',
};

/** Return any entry re-declaring the retired external shipde-brain by id, repository, or URL. */
function brainEntry(manifest) {
  return (
    (manifest.adopted || []).find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const id = String(entry.id || '').toLowerCase();
      const repo = String(entry.repository || '').toLowerCase();
      const url = String(entry.canonical_url || '').toLowerCase();
      return (
        id === BRAIN_ID ||
        repo === BRAIN_REPOSITORY ||
        url === BRAIN_URL ||
        url.includes('/' + BRAIN_REPOSITORY)
      );
    }) || null
  );
}

/** Every way `manifest` violates the surviving lesson trust-boundary contract. */
function brainRepositoryViolations(manifest) {
  const violations = [];
  if (!manifest || typeof manifest !== 'object') {
    violations.push({
      code: CODES.UNTRUSTED_POLICY_MISSING,
      detail: 'manifest must be a JSON object',
    });
    return violations;
  }

  const retired = brainEntry(manifest);
  if (retired) {
    violations.push({
      code: CODES.RETIRED_EXTERNAL_DECLARED,
      detail:
        'retired external repository ' +
        BRAIN_REPOSITORY +
        ' must not be declared in ' +
        MANIFEST_PATH +
        ' (found id=' +
        JSON.stringify(retired.id) +
        ')',
    });
  }

  const policy = (manifest.policies || {})[UNTRUSTED_POLICY];
  if (policy !== CANONICAL_POLICY) {
    violations.push({
      code: CODES.UNTRUSTED_POLICY_MISSING,
      detail:
        UNTRUSTED_POLICY +
        ' must match canonical trust-boundary policy: ' +
        JSON.stringify(CANONICAL_POLICY),
    });
  }

  const hermes = (manifest.adopted || []).find((entry) => entry && entry.id === HERMES_ID);
  if (!hermes || hermes.source_of_truth_boundary !== CANONICAL_HERMES_BOUNDARY) {
    violations.push({
      code: CODES.HERMES_BOUNDARY_MISSING,
      detail:
        HERMES_ID +
        '.source_of_truth_boundary must match canonical boundary: ' +
        JSON.stringify(CANONICAL_HERMES_BOUNDARY),
    });
  }

  return violations;
}

module.exports = {
  MANIFEST_PATH,
  BRAIN_ID,
  BRAIN_REPOSITORY,
  BRAIN_URL,
  HERMES_ID,
  UNTRUSTED_POLICY,
  CANONICAL_POLICY,
  CANONICAL_HERMES_BOUNDARY,
  CODES,
  brainEntry,
  brainRepositoryViolations,
};
