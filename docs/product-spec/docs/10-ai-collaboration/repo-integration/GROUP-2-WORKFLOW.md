# Group 2 — Workflow and skills

Work Item: `GOAL-AUTOCLAW-REPOS-3`.
Uses [the existing five-state contract](../REPO-INTEGRATION-EVIDENCE.md);
no new lifecycle or manifest entry is introduced.

## Declaration and evidence

```json
[
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-3",
    "toolId": null,
    "repo": "obra/superpowers",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-2-WORKFLOW.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "8ca22dba9a94f28898bbce59f2537ff4d87c747d",
    "versionRef": "8ca22dba9a94f28898bbce59f2537ff4d87c747d",
    "capability": "planning, systematic debugging and verification/review",
    "caller": "tools/ai-brain/skills/superpowers/NOTICE.md",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-3",
    "toolId": null,
    "repo": "Fission-AI/OpenSpec",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-2-WORKFLOW.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "unresolved",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "spec/change proposal validation",
    "caller": "docs/product-spec/scripts/validate_docs.py",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-3",
    "toolId": null,
    "repo": "pbakaus/impeccable",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-2-WORKFLOW.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "4e8504f10106a1cd7a99e37a401aa368d1d55576",
    "versionRef": "4e8504f10106a1cd7a99e37a401aa368d1d55576",
    "capability": "UI context, critique and visual iteration",
    "caller": "tools/ai-brain/skills/impeccable/NOTICE.md",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-3",
    "toolId": null,
    "repo": "cli/cli",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-2-WORKFLOW.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "unresolved",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "PR, issue, CI and GitHub evidence",
    "caller": "scripts/ai/control.ps1",
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

Reuse `tools/ai-brain/skill-pack.js`: author roles receive writing-plans,
test-driven-development, systematic-debugging and verification-before-completion;
reviewer/security-review receive review skills; ui/frontend roles receive
Impeccable with approved screen specification, DESIGN.md when approved, and UX
rules first. Unknown roles receive no pack; SHIPDE_SKILL_PACK=off disables it.
This is role selection, not a proven task-intent classifier or browser inspection.
Vendored NOTICE files pin the two upstream commits; vendoring is verifiable,
but absent manifest IDs prevent complete integration records or state promotion.

Work Item spec ID/paths remain the authority. Existing documentation checks are
`docs/product-spec/scripts/validate_docs.py` and
`docs/product-spec/scripts/validate_pr_contract.py`; they are not proof that
the OpenSpec CLI is installed or invoked. Do not create a second spec authority.
Reuse `tools/ai-brain/facts.js` for facts and
`tools/ai-brain/decisions.js` for decision provenance.

## Controller gate evidence

The real gate is `runToolGates` in `tools/ai-brain/orchestrate.js`, called after
format checks and before review. It uses `tools/ai-brain/tool-manifest.js`
gatesFor/appliesTo, runs available commands, records TOOL_GATE_FAILED and allows
one repair; persistent failure returns REFUSED. Missing command/install/executable
records TOOL_GATE_UNAVAILABLE, never a tool pass. Aggregate PASSED can mean no
applicable runnable gates; inspect individual records, not only aggregate status.
Synthetic repo commands with empty triggers do not apply through this gate.
Skill text is guidance, never enforcement.

Offline tests execute the existing Controller function with injected fixtures:
exit 0, persistent exit 1 with one repair, and unavailable command. This is
Controller logic evidence, not a real external scanner or OpenSpec run.
GitHub evidence must bind repository, branch, full SHA and checks; PR creation
does not grant merge authority. No GitHub mutation or authenticated lookup was run.
Task artifact: role-selected pack and in-memory gate records from the tests.
Spec validation runs separately below; no claim that loader invokes validation.

## Verification and handoff

Baseline inspected: `88933580ab502132a24ca18573db4e1efba69688`.
SHA: pending Claude commit. Changes remain uncommitted; CI and independent review
are pending. No EXECUTION_VERIFIED or ACCEPTED claim.

- `node --test tools/ai-brain/test/repo-integration-group-2.test.js tools/ai-brain/test/repo-integration-evidence.test.js`
- `python docs/product-spec/scripts/validate_docs.py`
- Check worktree status against the item's four allowed deliverable files.
- PR contract deferred to Claude after commit per operator update 17/10.
- Prettier check the changed Markdown and JavaScript; CSV has no Prettier parser.

The referenced appendix is available in the operator's hermes-live handoff but is
absent from this baseline. It is not copied outside the permitted item paths.
The item spec is copied verbatim and its register row appended verbatim.

Local verification on 2026-10-17: required group plus shared-contract tests
passed 12/12, zero failures. Documentation validation passed with 203 Markdown files,
130 feature IDs, 256 delivery rows and 1210 unique identifiers. Worktree status
contains exactly the item spec, one register update, this document and the group
test. Spec SHA256 and the appended register row match the hermes-live originals;
register diff is one insertion, zero deletions. Prettier check passed for the
JavaScript test; repository .prettierignore excludes docs/ (validated by Python),
and CSV has no Prettier parser. PR contract was intentionally not run before commit.

