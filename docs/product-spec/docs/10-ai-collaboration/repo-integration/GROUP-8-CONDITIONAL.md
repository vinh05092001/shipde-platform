# Group 8 ? 8-CONDITIONAL

Work Item: `GOAL-AUTOCLAW-REPOS-9`. Uses [the existing five-state contract](../REPO-INTEGRATION-EVIDENCE.md).

## Declaration and evidence

```json
[
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-9",
    "toolId": "storybook",
    "repo": "storybookjs/storybook",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unpinned declaration",
    "capability": "catalog beyond Playwright gallery",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-9",
    "toolId": "pact-js",
    "repo": "pact-foundation/pact-js",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unpinned declaration",
    "capability": "consumer/provider contracts",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-9",
    "toolId": "toxiproxy",
    "repo": "Shopify/toxiproxy",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unpinned declaration",
    "capability": "network fault tests",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-9",
    "toolId": "hoverfly",
    "repo": "SpectoLabs/hoverfly",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unpinned declaration",
    "capability": "capture/replay/simulation",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-9",
    "toolId": "prism",
    "repo": "stoplightio/prism",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "@stoplight/prism-cli@5.12.0 (spec only)",
    "capability": "OpenAPI mock/validation server",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-9",
    "toolId": null,
    "repo": "promptfoo/promptfoo",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-8-CONDITIONAL.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unpinned declaration",
    "capability": "prompt/model regression dataset",
    "registrationPending": true
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-9",
    "toolId": "renovate",
    "repo": "renovatebot/renovate",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "39.191.0 (spec only)",
    "capability": "dependency updates",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-9",
    "toolId": "vietnamese-provinces",
    "repo": "thanglequoc/vietnamese-provinces-database",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unpinned declaration",
    "capability": "address-data consumer",
    "registrationPending": false
  }
]
```

`verifiedAt` denotes the inspection date (UTC day marker), not tool execution. Entries with `registrationPending: true` and `toolId: null` are incomplete contract records: no matching manifest entry exists. They remain DECLARED pending a separately scoped manifest registration; this item cannot edit the shared manifest. Existing IDs and evidence references reuse item 1.

## Requirement gate

Trigger: concrete requirement in an approved Work Item. Each capability above identifies the requirement category. Before installation the future item must identify consumer, owner, input fixture, expected artifact and acceptance test. Adapter/caller: not wired. Approved requirement ? documented installation decision. No automatic install. Prism/Renovate refs are spec targets, not installed versions. No packages installed; all entries remain DECLARED.

## Verification and limitations

Task/artifact: inspect repository declarations, run `node --test tools/ai-brain/test/repo-integration-group-8.test.js tools/ai-brain/test/repo-integration-evidence.test.js` and `python docs/product-spec/scripts/validate_docs.py`. Tests check evidence structure, not live tool availability.

SHA: pending Claude commit. No EXECUTION_VERIFIED or ACCEPTED claim. CI and independent review pending.

Local verification on 2026-10-17: group test plus shared evidence test passed 10/10 (zero failures); documentation validation passed with 193 markdown files, 130 feature IDs, 251 delivery rows and 1210 unique identifiers. PR contract deferred to Claude after commit, as requested.
