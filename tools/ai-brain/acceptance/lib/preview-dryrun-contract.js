'use strict';
// TASK-AI-11 — the preview/dry-run contract the supervisor source must satisfy,
// held in exactly one place.
//
// `ac-11-05-preview-contract.js` (the invariant: the real supervisor declares
// Preview and DryRun switches, emits a [PREVIEW] banner when Preview is set,
// and skips mutating operations when either flag is active) and
// `ac-11-06-preview-contract-broken.js` (the negative proof: a copy of the real
// source with the Preview guard removed is refused) both require this module,
// so the rule exists in exactly one place.
//
// The contract is a CLAIM ABOUT THE SUPERVISOR SOURCE, not a re-implementation
// of it. The supervisor that enforces the preview/dry-run surface is
// `scripts/ai/control.ps1`; these scripts read that real file, and the negative
// proof tampers a copy. The claims are deliberately the properties TASK-AI-11
// must PRESERVE while it extends the preview/dry-run modes: both switches exist
// at the top-level param block, a [PREVIEW] banner is emitted, and a guard
// prevents mutating operations when either flag is set.
//
// Exit codes used by the scripts that require this file:
//   0 the contract holds   1 it is violated   2 it cannot be measured

const SOURCE = 'scripts/ai/control.ps1';

// Each part is one required property of the real supervisor source.
const REQUIRED_PARTS = [
  {
    id: 'PREVIEW_SWITCH',
    label: 'a [switch]$Preview parameter in the top-level param block',
    pattern: /\[switch\]\$Preview\b/,
  },
  {
    id: 'DRYRUN_SWITCH',
    label: 'a [switch]$DryRun parameter in the top-level param block',
    pattern: /\[switch\]\$DryRun\b/,
  },
  {
    id: 'PREVIEW_BANNER',
    label: 'a [PREVIEW] banner emitted when Preview is set',
    pattern: /\[PREVIEW\]/,
  },
  {
    id: 'PREVIEW_GUARD',
    label: 'a guard that skips mutating operations when $Preview is set',
    pattern: /\$Preview\b/,
  },
  {
    id: 'DRYRUN_GUARD',
    label: 'a guard that skips mutating operations when $DryRun is set',
    pattern: /\$DryRun\b/,
  },
];

/** Every part of the contract missing from `source`, in declaration order. */
function missingPreviewDryRunParts(source) {
  return REQUIRED_PARTS.filter((part) => !part.pattern.test(source));
}

module.exports = { SOURCE, REQUIRED_PARTS, missingPreviewDryRunParts };
