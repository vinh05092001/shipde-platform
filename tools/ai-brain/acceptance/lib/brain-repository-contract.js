'use strict';
// TASK-AI-21 — the shipde-brain repository contract, held in exactly one place.
//
// `ac-21-05-brain-repository-contract.js` (the invariant: the real ecosystem
// manifest declares shipde-brain as a governed knowledge repository) and
// `ac-21-06-brain-repository-overstated.js` (the negative proof: a copy of the
// real manifest with the brain repointed or unpinned is refused) both require
// this module, so the gate and the proof of the gate cannot drift apart.
//
// The contract is a CLAIM ABOUT THE REAL MANIFEST, not a re-implementation of
// the audit. The audit that decides whether a manifest entry is trustworthy is
// `tools/ai-brain/manifest-audit.js`, and `AC-AI-21-10` runs that real module
// against the real manifest. This file states only what this Work Item requires
// of the brain's entry:
//   * the brain is a knowledge repository with a canonical source, not a
//     provider, a runtime or an orchestration layer (AI-TOOL-13's pattern);
//   * it is pinned to an exact commit, never to a movable ref (AI-TOOL-11);
//   * its contract surface — role, source-of-truth boundary, permissions, health
//     check and rollback — is declared rather than left implicit;
//   * agent memory stays untrusted until a human reviews it in (AI-TOOL-06).
//
// Exit codes used by the scripts that require this file:
//   0 the contract holds   1 it is violated   2 it cannot be measured

const MANIFEST_PATH = 'tools/ecosystem-manifest.json';
const BRAIN_ID = 'shipde-brain';
const BRAIN_REPOSITORY = 'vinh05092001/shipde-brain';
const COMMIT = /^[0-9a-f]{40}$/;
const UNTRUSTED_POLICY = 'AI-TOOL-06';

// The fields whose absence would leave the brain's boundary implicit.
const DECLARED_SURFACE = [
  'role',
  'source_of_truth_boundary',
  'permissions',
  'health_check',
  'rollback',
];

const CODES = {
  MISSING: 'BRAIN_REPOSITORY_MISSING',
  UNSOURCED: 'BRAIN_REPOSITORY_UNSOURCED',
  UNPINNED: 'BRAIN_REPOSITORY_UNPINNED',
  UNDECLARED: 'BRAIN_REPOSITORY_UNDECLARED_SURFACE',
  IS_ORCHESTRATOR: 'BRAIN_REPOSITORY_IS_ORCHESTRATOR',
  UNTRUSTED_POLICY_MISSING: 'BRAIN_UNTRUSTED_UNTIL_REVIEWED_MISSING',
};

/** The brain's manifest entry, or null when the manifest does not declare it. */
function brainEntry(manifest) {
  return (manifest.adopted || []).find((entry) => entry.id === BRAIN_ID) || null;
}

/** Every way `manifest` fails the brain contract. Empty means the contract holds. */
function brainRepositoryViolations(manifest) {
  const violations = [];
  const entry = brainEntry(manifest);

  if (!entry) {
    violations.push({
      code: CODES.MISSING,
      detail: BRAIN_ID + ' is not declared in ' + MANIFEST_PATH,
    });
    return violations;
  }

  if (
    entry.repository !== BRAIN_REPOSITORY ||
    entry.canonical_url !== 'https://github.com/' + BRAIN_REPOSITORY
  ) {
    violations.push({
      code: CODES.UNSOURCED,
      detail:
        BRAIN_ID + ' is sourced from ' + entry.repository + ' rather than ' + BRAIN_REPOSITORY,
    });
  }

  if (
    typeof entry.pinned_version_or_commit !== 'string' ||
    !COMMIT.test(entry.pinned_version_or_commit)
  ) {
    violations.push({
      code: CODES.UNPINNED,
      detail:
        BRAIN_ID +
        ' is pinned to ' +
        JSON.stringify(entry.pinned_version_or_commit) +
        ' rather than a 40-character commit',
    });
  }

  for (const field of DECLARED_SURFACE) {
    if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
      violations.push({
        code: CODES.UNDECLARED,
        detail: BRAIN_ID + ' does not declare ' + field,
      });
    }
  }

  const runtime = manifest.orchestrator_runtime || {};
  if (runtime.id === BRAIN_ID) {
    violations.push({
      code: CODES.IS_ORCHESTRATOR,
      detail: BRAIN_ID + ' is declared as the orchestration runtime, which it is not',
    });
  }

  const policy = (manifest.policies || {})[UNTRUSTED_POLICY];
  if (
    typeof policy !== 'string' ||
    !policy.includes(BRAIN_ID) ||
    !policy.includes('human-reviewed')
  ) {
    violations.push({
      code: CODES.UNTRUSTED_POLICY_MISSING,
      detail:
        UNTRUSTED_POLICY +
        ' does not record that memory stays untrusted until human-reviewed into ' +
        BRAIN_ID,
    });
  }

  return violations;
}

module.exports = {
  MANIFEST_PATH,
  BRAIN_ID,
  BRAIN_REPOSITORY,
  DECLARED_SURFACE,
  UNTRUSTED_POLICY,
  CODES,
  brainEntry,
  brainRepositoryViolations,
};
