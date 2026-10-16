# GROUP-4-LINT-FORMAT ? GOAL-AUTOCLAW-REPOS-5

Evidence inspected on 2026-10-17 against baseline `c69b59a3d71bd94376342248d331a3c9b33c2d6a`. Changes are uncommitted.
Lifecycle and mandatory fields reuse `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-EVIDENCE.md`.
The JSON below is an evidence artifact, not a new lifecycle contract. Tests validate repository files,
manifest identity and fail-closed adapter behavior offline; they do not prove native tool execution or CI success.
`verifiedAt` records the UTC inspection time (2026-10-17 locally), not a scanner execution time.
No entry is EXECUTION_VERIFIED or ACCEPTED: no positive/negative native run pair and exact-SHA CI/review/merge evidence is supplied.
The spec references REPO-INTEGRATION-APPENDIX-20261013.md, absent on this baseline; it is not fabricated or copied outside scope.

## Migration inventory and parity matrix

Candidate: `biomejs/biome`, package `@biomejs/biome`. State: DECLARED in this Work Item only;
version/ref unresolved, execution UNAVAILABLE. No repository dependency, config or manifest id exists.
Consequently no contract evidence record with a fabricated toolId is emitted. A later allowed manifest
change must register Biome before promotion; this item does not modify the shared inventory.
Capability target: lint + format + imports. No Oxc is installed alongside it.

| Trigger / scope            | Existing caller / evidence                                                                                | Biome parity                                                              | Decision           |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------ |
| scripts and workspace lint | package.json:scripts.lint; eslint.config.mjs; packages/config/eslint.base.mjs                             | NOT_RUN; TypeScript parser, ignores and workspace rules not compared      | KEEP ESLint        |
| Next.js rules/plugins      | apps/web/eslint.config.mjs imports eslint-config-next                                                     | NOT_RUN; framework rules not mapped                                       | KEEP ESLint        |
| formatting                 | package.json:scripts.format:check; scripts/verify-formatting.ts; .prettierignore                          | NOT_RUN; syntax, ignore, negative fixture and diff semantics not compared | KEEP Prettier      |
| generated output           | scripts/verify-contracts.ts:generateOpenApiTypes calls prettier.format; packages/contracts/src/openapi.ts | NOT_RUN; parser/typescript and resolved config output parity missing      | KEEP Prettier      |
| CI                         | .github/workflows/current-application.yml runs pnpm lint and pnpm format:check                            | NOT_RUN; no Biome CI result at any SHA                                    | KEEP current gates |
| hooks                      | lefthook.yml writer-claim, staged-secret-scan, no-hardcode                                                | NOT_APPLICABLE; no lint/format hook to replace                            | KEEP safety hooks  |
| import organization        | no Biome config or command                                                                                | NOT_RUN; ordering/side effects not compared                               | No migration       |

Input: each current rules/plugin/config/format call plus positive and negative fixtures.
Required output before removal: per-case diagnostics, formatting/import diff, exit codes, artifact paths
and exact commit SHA with CI result. Migration is incremental, never a repository-wide rewrite.
No scope has parity, so neither ESLint nor Prettier may be removed. Current versions are repository
constraints `eslint ^9.39.5`, `prettier ^3.9.6`; these are not claims about resolved machine versions.

## Contract evidence records

```json
[
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-5",
    "toolId": "eslint",
    "repo": "eslint/eslint",
    "state": "WIRED",
    "evidenceRef": "package.json:devDependencies",
    "command": "lint",
    "blocked": false,
    "blockedReason": null,
    "verifiedAt": "2026-10-16T17:26:01.000Z",
    "verifiedBy": "codex",
    "versionRef": "^9.39.5",
    "execution": "NOT_RUN",
    "acceptance": "PENDING",
    "baselineSha": "c69b59a3d71bd94376342248d331a3c9b33c2d6a"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-5",
    "toolId": "prettier",
    "repo": "prettier/prettier",
    "state": "WIRED",
    "evidenceRef": "package.json:devDependencies",
    "command": "format:check",
    "blocked": false,
    "blockedReason": null,
    "verifiedAt": "2026-10-16T17:26:01.000Z",
    "verifiedBy": "codex",
    "versionRef": "^3.9.6",
    "execution": "NOT_RUN",
    "acceptance": "PENDING",
    "baselineSha": "c69b59a3d71bd94376342248d331a3c9b33c2d6a"
  }
]
```

## Local verification ? 2026-10-17

- `node --test tools/ai-brain/test/repo-integration-group-4.test.js tools/ai-brain/test/repo-integration-evidence.test.js`: exit 0, 10 passed, 0 failed, 0 skipped.
- `python docs/product-spec/scripts/validate_docs.py`: exit 0; 191 Markdown files, 130 feature IDs, 250 delivery rows, 1210 unique identifiers.
- Scope: only this document, the group test, this item's copied spec and its single appended register row.
- Prettier checks use the existing repository formatter; CSV has no supported Prettier parser and is checked as an exact copied row.
- PR contract verification deferred to Claude after commit, as instructed on 2026-10-17.
- No commit, push, PR or merge; no final change SHA exists yet. Record native tool evidence and exact-SHA CI/review separately before any lifecycle promotion.
