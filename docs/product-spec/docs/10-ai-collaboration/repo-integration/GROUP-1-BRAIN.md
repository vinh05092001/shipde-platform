# Group 1 — Brain and orchestration

Work Item: `GOAL-AUTOCLAW-REPOS-2`.
Uses [the existing five-state contract](../REPO-INTEGRATION-EVIDENCE.md);
no new lifecycle or manifest entry is introduced.

## Declaration and evidence

```json
[
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-2",
    "toolId": null,
    "repo": "vinh05092001/shipde-platform",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-1-BRAIN.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "origin/main 68e8b862",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "Controller routing, dispatch, quota, fallback, checkpoint, watchdog and evidence",
    "caller": "tools/ai-brain/orchestrate.js",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-2",
    "toolId": null,
    "repo": "NousResearch/hermes-agent",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-1-BRAIN.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "0.21.4",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "chat, reasoning, skills and recall bound to Controller candidate",
    "caller": "tools/ai-brain/hermes-session.js",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-2",
    "toolId": null,
    "repo": "vinh05092001/shipde-brain",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-1-BRAIN.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "unresolved",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "task facts, lessons and prompts with provenance",
    "caller": "tools/ai-brain/facts.js",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-2",
    "toolId": null,
    "repo": "decolua/9router",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-1-BRAIN.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "0.5.99",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "gateway errors, quota and account evidence",
    "caller": "tools/ai-brain/route-health.js",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-2",
    "toolId": null,
    "repo": "anomalyco/opencode",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-1-BRAIN.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "opencode-ai@1.18.31",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "worker/reviewer harness",
    "caller": "tools/ai-brain/executor.js",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-2",
    "toolId": "codex",
    "repo": "openai/codex",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": false,
    "requestedRef": "@openai/codex@0.162.0",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "worker/reviewer harness",
    "caller": "tools/ai-brain/executor.js",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-2",
    "toolId": "gemini-cli",
    "repo": "google-gemini/gemini-cli",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": false,
    "requestedRef": "@google/gemini-cli@0.58.0",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "worker/reviewer harness",
    "caller": "tools/ai-brain/executor.js",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-2",
    "toolId": null,
    "repo": "getpaseo/paseo",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-1-BRAIN.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "@getpaseo/cli@0.8.0",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "session status, cancel/resume when API supports it",
    "caller": "tools/ai-brain/executor.js",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-2",
    "toolId": "claude-code",
    "repo": "anthropic-ai/claude-code",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": false,
    "requestedRef": "@anthropic-ai/claude-code@2.1.296",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "handoff evidence supervision",
    "caller": "tools/ai-brain/executor.js",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  }
]
```

`verifiedAt` is the UTC inspection day marker, not a tool execution timestamp.
All lifecycle claims remain DECLARED. UNAVAILABLE describes execution availability,
not a sixth lifecycle state. `registrationPending: true` and `toolId: null`
are explicitly incomplete contract records: the shared manifest has no entry.
They are not valid complete attachment evidence and cannot be promoted until a
separately scoped item registers the tool. Existing IDs/references reuse item 1.
Caller files prove repository code exists, not that the upstream package ran.
Requested versions are copied from the Work Item; unresolved versions were not
observed on a host. No live provider, credentials or login is needed by CI.

## Caller, triggers and boundaries

Goal run dispatch uses `tools/ai-brain/orchestrate.js`; chat uses
`tools/ai-brain/hermes-session.js`. Reuse `tools/ai-brain/sources.js` for
source identity and `tools/ai-brain/route-probe.js` plus
`tools/ai-brain/route-health.js` for gateway failure/quota feedback.
Work Item + Controller candidate + worktree + permissions + timeout enter
`tools/ai-brain/executor.js`; logs/artifacts/exit status return to Controller.
Hermes must not select source/model/account or run a parallel dispatcher.
Gateway fallback and Controller fallback require one owner, never overlapping retries.
Paseo manages sessions, not scheduling. Harness qualification belongs to Controller;
a package name alone grants no role.

`tools/ai-brain/facts.js` is a local facts reader, not proof of a connected
shipde-brain repository. External memory requires task-scoped reads and writes
with commit/source provenance and recheck conditions; storing a file is insufficient.
Claude authority follows the current operator contract, not an older appendix role label.
The manifest uses anthropic-ai/claude-code; the appendix's anthropics spelling
is an alias, not a second installation.

## Task and missing execution evidence

Required real acceptance: chat -> execution -> independent review -> response,
with candidate identity, decision log, launch result, run/session ID and exact SHA.
No such live task was run by this documentation item. Decision/launch artifacts
are NOT_RUN, review and acceptance PENDING; local adapter checks do not establish
live Hermes recall, gateway availability or a completed review.
9router credentials for multiple providers remain unverified; never inspect or
print credentials to fill this gap. The requested 68e8b862 baseline is historical,
not the checked-out baseline. Reproduce offline with the verification command below.

## Verification and handoff

Baseline inspected: `88933580ab502132a24ca18573db4e1efba69688`.
SHA: pending Claude commit. Changes remain uncommitted; CI and independent review
are pending. No EXECUTION_VERIFIED or ACCEPTED claim.

- `node --test tools/ai-brain/test/repo-integration-group-1.test.js tools/ai-brain/test/repo-integration-evidence.test.js`
- `python docs/product-spec/scripts/validate_docs.py`
- Check worktree status against the item's four allowed deliverable files.
- PR contract deferred to Claude after commit per operator update 17/10.
- Prettier check the changed Markdown and JavaScript; CSV has no Prettier parser.

The referenced appendix is available in the operator's hermes-live handoff but is
absent from this baseline. It is not copied outside the permitted item paths.
The item spec is copied verbatim and its register row appended verbatim.

Local verification on 2026-10-17: required group plus shared-contract tests
passed 11/11, zero failures. Documentation validation passed with 203 Markdown files,
130 feature IDs, 256 delivery rows and 1210 unique identifiers. Worktree status
contains exactly the item spec, one register update, this document and the group
test. Spec SHA256 and the appended register row match the hermes-live originals;
register diff is one insertion, zero deletions. Prettier check passed for the
JavaScript test; repository .prettierignore excludes docs/ (validated by Python),
and CSV has no Prettier parser. PR contract was intentionally not run before commit.
