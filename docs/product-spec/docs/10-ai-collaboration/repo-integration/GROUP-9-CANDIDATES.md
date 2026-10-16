# Group 9 ? 9-CANDIDATES

Work Item: `GOAL-AUTOCLAW-REPOS-10`. Uses [the existing five-state contract](../REPO-INTEGRATION-EVIDENCE.md).

## Declaration and evidence

```json
[
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-10",
    "toolId": null,
    "repo": "DeusData/codebase-memory-mcp",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-9-CANDIDATES.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unpinned declaration",
    "capability": "symbol/call-graph/architecture retrieval versus Serena",
    "registrationPending": true
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-10",
    "toolId": null,
    "repo": "Nox-HQ/nox",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-9-CANDIDATES.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unpinned declaration",
    "capability": "each security scope versus current gates",
    "registrationPending": true
  }
]
```

`verifiedAt` denotes the inspection date (UTC day marker), not tool execution. Entries with `registrationPending: true` and `toolId: null` are incomplete contract records: no matching manifest entry exists. They remain DECLARED pending a separately scoped manifest registration; this item cannot edit the shared manifest. Existing IDs and evidence references reuse item 1.

## Comparative measurement gate

Adapter/caller: not wired. Same task corpus/configuration ? reproducible comparative report with refs, commands, fixtures and SHA. Compare codebase-memory-mcp symbol accuracy, references, call-graph edges and architecture retrieval with Serena on the same indexed revision; record correctness, omissions, latency and artifacts. Do not claim replacement of semantic editing before measurement.

Compare Nox per security scope with current Gitleaks, Trivy, Semgrep and agent-scan gates on benign and violating fixtures; report findings, false positives, unavailable/error behavior, exit codes and coverage. Do not remove scanners before coverage parity. No default replacement or installation. All entries remain DECLARED.

## Verification and limitations

Task/artifact: inspect repository declarations, run `node --test tools/ai-brain/test/repo-integration-group-9.test.js tools/ai-brain/test/repo-integration-evidence.test.js` and `python docs/product-spec/scripts/validate_docs.py`. Tests check evidence structure, not live tool availability.

SHA: pending Claude commit. No EXECUTION_VERIFIED or ACCEPTED claim. CI and independent review pending.

Local verification on 2026-10-17: group test plus shared evidence test passed 10/10 (zero failures); documentation validation passed with 193 markdown files, 130 feature IDs, 251 delivery rows and 1210 unique identifiers. PR contract deferred to Claude after commit, as requested.
