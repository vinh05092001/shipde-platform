# Group 3 — Code and context

Work Item: `GOAL-AUTOCLAW-REPOS-4`.
Uses [the existing five-state contract](../REPO-INTEGRATION-EVIDENCE.md);
no new lifecycle or manifest entry is introduced.

## Declaration and evidence

```json
[
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-4",
    "toolId": null,
    "repo": "oraios/serena",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-3-CODE-CONTEXT.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "unresolved",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "symbol, references/callers; semantic editing requested but read-only pilot",
    "caller": "tools/ai-brain/serena.js",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-4",
    "toolId": "ast-grep",
    "repo": "ast-grep/ast-grep",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": false,
    "requestedRef": "unresolved",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "structural search and preview before codemod",
    "caller": "tools/ai-brain/data/tool-manifest.json",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-4",
    "toolId": "repomix",
    "repo": "yamadashy/repomix",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": "node tools/ai-brain/context-pack.js --spec <work-item.json> --output <contextPack>",
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": false,
    "requestedRef": "0.3.3",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "scoped files/dependencies context packing with token budget required",
    "caller": "tools/ai-brain/context-pack.js",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-4",
    "toolId": "context7",
    "repo": "upstash/context7",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": false,
    "requestedRef": "ctx7@0.5.9",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "library/version docs lookup with citations",
    "caller": "tools/ai-brain/data/tool-manifest.json",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-4",
    "toolId": null,
    "repo": "rtk-ai/rtk",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-3-CODE-CONTEXT.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "No complete integration execution evidence at an exact reviewed SHA; requested external behavior remains unverified.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "registrationPending": true,
    "requestedRef": "unresolved",
    "versionRef": "unresolved; requestedRef is specification inventory, not observed installation",
    "capability": "terminal output compression with raw fallback",
    "caller": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
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

Reuse `tools/ai-brain/serena.js` for symbol/reference queries. Its local
read-only pilot is not proof of the upstream Serena MCP installation, indexed
project, semantic callers or semantic editing. Mutation flags throw MUTATION_REFUSED.
Any future transform must show matches and preview diff before application, then
verify diff/project/index. No ast-grep transform caller is proven here.

Reuse `tools/ai-brain/context-pack.js` for explicit Work Item allowedPaths,
dependencies supplied as sources and cited spec paths. safeRelative rejects
absolute/traversal paths. Never pack the whole repository by default.
Current limits are maxFileBytes/maxTotalBytes, NOT a token budget. A future
integration needs explicit positive token budget, tokenizer/version, selected files,
actual token count and refusal/truncation evidence before dispatch.
The current adapter also needs separate symlink-containment and empty-manifest
external-run validation before treating it as a security boundary.
No upstream repomix execution or token-budget enforcement is claimed.

Context7 lookup must retain library/version, query, source citations and result
artifact when API details are uncertain; no authenticated lookup was run.
RTK must use the existing terminal-output policy: raw fallback for failures,
test investigation and evidence-sensitive/debug logs. No dedicated RTK adapter
or live raw-fallback execution has been established by this item.
Do not compress away evidence. No package install or new runtime adapter.

## Task and missing execution evidence

Offline test task packs one fixture file, excludes an unrelated file, checks
unsafe path rejection and byte-limit failure; artifact and manifest are verified
inside an OS temporary directory and cleaned afterwards.
Serena mutation rejection is also exercised without a provider.
These checks establish local wrapper behavior only. Search/transform preview,
citation-preserving lookup, raw terminal fallback and token-budget acceptance
remain NOT_RUN / blocked. No full-repository pack is needed to run these tests.

## Verification and handoff

Baseline inspected: `88933580ab502132a24ca18573db4e1efba69688`.
SHA: pending Claude commit. Changes remain uncommitted; CI and independent review
are pending. No EXECUTION_VERIFIED or ACCEPTED claim.

- `node --test tools/ai-brain/test/repo-integration-group-3.test.js tools/ai-brain/test/repo-integration-evidence.test.js`
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

