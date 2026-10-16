# GROUP-6-SECURITY ? GOAL-AUTOCLAW-REPOS-7

Evidence inspected on 2026-10-17 against baseline `c69b59a3d71bd94376342248d331a3c9b33c2d6a`. Changes are uncommitted.
Lifecycle and mandatory fields reuse `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-EVIDENCE.md`.
The JSON below is an evidence artifact, not a new lifecycle contract. Tests validate repository files,
manifest identity and fail-closed adapter behavior offline; they do not prove native tool execution or CI success.
`verifiedAt` records the UTC inspection time (2026-10-17 locally), not a scanner execution time.
No entry is EXECUTION_VERIFIED or ACCEPTED: no positive/negative native run pair and exact-SHA CI/review/merge evidence is supplied.
The spec references REPO-INTEGRATION-APPENDIX-20261013.md, absent on this baseline; it is not fabricated or copied outside scope.

## Security coverage and operational outcomes

| Repository         | Version/ref evidence                              | Trigger / reused adapter                                                                   | Status and limitations                                                                      |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| gitleaks/gitleaks  | 8.24.0 in .github/workflows/security-baseline.yml | CI Git history; scripts/verify-secrets.ts; .gitleaks.toml; lefthook.yml staged-secret-scan | WIRED repository runner; no native execution pair claimed                                   |
| aquasecurity/trivy | 0.60.0 in scripts/verify-trivy.ts                 | security:trivy target / vulnerability DB / vuln,config scope                               | DECLARED per shared manifest; owned runner exists but native binary/DB execution unverified |
| semgrep/semgrep    | unresolved rules/version pin                      | explicit code scope + pinned rules required                                                | DECLARED; no runnable command or findings artifact                                          |
| snyk/agent-scan    | unresolved executable/version                     | skill directories, MCP manifests before enabling                                           | DECLARED, blocked gate; command null -> TOOL_GATE_UNAVAILABLE, never PASS                   |

Reuse security runners and Controller gate; add no default CI scanner before runtime has been measured.
Gitleaks remains secrets/Git-history authority; Trivy scans vuln,config with HIGH/CRITICAL and ignore-unfixed.
Input includes baseline/config and benign/malicious fixtures. Output separates clean scan (exit 0),
findings (exit 1), operational error (exit 2), unavailable and skipped/no-target. A skip is not a clean scan.
Suppression requires a documented reason and a regression test; no suppression is introduced here.
Do not replace existing coverage with Nox or Cisco scanners before measured coverage parity.

The group test executes existing adapters with injected benign, malicious, missing executable, thrown
spawn, invalid report and operational-error fixtures. These are adapter tests, not native scanner runs.
Native positive/negative scan artifacts, DB freshness, measured time, exact-SHA CI and independent review
remain unavailable. Scanner unavailable/error must never become PASS even when adapter unit tests pass.

## Contract evidence records

```json
[
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-7",
    "toolId": "gitleaks",
    "repo": "gitleaks/gitleaks",
    "state": "WIRED",
    "evidenceRef": "package.json:scripts.security:secrets",
    "command": "security:secrets",
    "blocked": false,
    "blockedReason": null,
    "verifiedAt": "2026-10-16T17:26:01.000Z",
    "verifiedBy": "codex",
    "versionRef": "8.24.0 (CI pin, not a local binary execution)",
    "baselineSha": "c69b59a3d71bd94376342248d331a3c9b33c2d6a",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-7",
    "toolId": "trivy",
    "repo": "aquasecurity/trivy",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "No repository-pinned dependency/executable proven; execution unavailable for this evidence entry.",
    "verifiedAt": "2026-10-16T17:26:01.000Z",
    "verifiedBy": "codex",
    "versionRef": "0.60.0 (runner pin; availability unverified)",
    "baselineSha": "c69b59a3d71bd94376342248d331a3c9b33c2d6a",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-7",
    "toolId": "semgrep",
    "repo": "semgrep/semgrep",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "No repository-pinned dependency/executable proven; execution unavailable for this evidence entry.",
    "verifiedAt": "2026-10-16T17:26:01.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unresolved; declaration only",
    "baselineSha": "c69b59a3d71bd94376342248d331a3c9b33c2d6a",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-7",
    "toolId": "agent-scan",
    "repo": "snyk/agent-scan",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "No repository-pinned dependency/executable proven; execution unavailable for this evidence entry.",
    "verifiedAt": "2026-10-16T17:26:01.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unresolved; declaration only",
    "baselineSha": "c69b59a3d71bd94376342248d331a3c9b33c2d6a",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  }
]
```

## Local verification ? 2026-10-17

- `node --test tools/ai-brain/test/repo-integration-group-6.test.js tools/ai-brain/test/repo-integration-evidence.test.js`: exit 0, 12 passed, 0 failed, 0 skipped.
- `python docs/product-spec/scripts/validate_docs.py`: exit 0; 191 Markdown files, 130 feature IDs, 250 delivery rows, 1210 unique identifiers.
- Scope: only this document, the group test, this item's copied spec and its single appended register row.
- Prettier checks use the existing repository formatter; CSV has no supported Prettier parser and is checked as an exact copied row.
- PR contract verification deferred to Claude after commit, as instructed on 2026-10-17.
- No commit, push, PR or merge; no final change SHA exists yet. Record native tool evidence and exact-SHA CI/review separately before any lifecycle promotion.
