# GROUP-5-TESTING ? GOAL-AUTOCLAW-REPOS-6

Evidence inspected on 2026-10-17 against baseline `c69b59a3d71bd94376342248d331a3c9b33c2d6a`. Changes are uncommitted.
Lifecycle and mandatory fields reuse `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-EVIDENCE.md`.
The JSON below is an evidence artifact, not a new lifecycle contract. Tests validate repository files,
manifest identity and fail-closed adapter behavior offline; they do not prove native tool execution or CI success.
`verifiedAt` records the UTC inspection time (2026-10-17 locally), not a scanner execution time.
No entry is EXECUTION_VERIFIED or ACCEPTED: no positive/negative native run pair and exact-SHA CI/review/merge evidence is supplied.
The spec references REPO-INTEGRATION-APPENDIX-20261013.md, absent on this baseline; it is not fabricated or copied outside scope.

## Coverage, callers and limitations

| Repository / capability                                      | Trigger and reused caller                                               | Evidence / missing proof                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| microsoft/playwright ? E2E, API, screenshot, component tests | acceptance paths; root test:e2e -> workspace tests                      | DECLARED in manifest; current apps/web test:e2e is tsx scenarios, not Playwright browser assertions                              |
| microsoft/playwright-cli ? browser interaction               | on-demand browser wrapper                                               | adoption @playwright/cli@0.1.2 only; no checked-in session lifecycle/teardown wrapper; unavailable                               |
| dequelabs/axe-core ? DOM accessibility                       | root test:a11y -> scripts/verify-a11y.ts                                | DECLARED; current gate is not proof of axe DOM execution; violations and incomplete results require findings                     |
| googlechrome/lighthouse-ci ? runtime budgets                 | root test:perf -> scripts/verify-perf.ts                                | DECLARED; no Lighthouse report tied to SHA                                                                                       |
| grafana/k6 ? load/performance                                | explicit workload, target and budget                                    | DECLARED; no workload/report verified                                                                                            |
| ChromeDevTools/chrome-devtools-mcp ? browser diagnosis       | on-demand profile in REPOSITORY-CLI-MANIFEST.md                         | DECLARED candidate; absent shared manifest id; no fabricated evidence record or active session                                   |
| mswjs/msw ? request fixtures                                 | packages/testkit/src/msw/msw.test.ts via testkit test                   | INSTALLED; retain handlers and request assertions                                                                                |
| forwardemail/supertest ? API integration assertions          | apps/api/package.json; packages/testkit/package.json and integration.ts | INSTALLED; retain API assertions                                                                                                 |
| openapi-ts/openapi-typescript ? OpenAPI types                | contract:generate / contract:check -> scripts/verify-contracts.ts       | INSTALLED conservatively per shared manifest; OpenAPI -> packages/contracts/src/openapi.ts, drift gate and typecheck must remain |

Browser wrapper acceptance requires explicit session create/reuse, isolated context, assertion-backed
steps, screenshots/reports and finally teardown on success, failure and timeout. Clicking successfully
is not test acceptance. This wrapper has not been installed or executed here.
Keep MSW/Supertest until each migrated fixture, status/body assertion, error path and teardown reaches
parity. No replacement, dependency removal or browser assertion claim is made.
All future reports must carry command, exit, exact SHA, environment, artifact path and assertion counts;
accessibility incomplete/violations become findings, performance budget breaches fail their gate.

## Contract evidence records

```json
[
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-6",
    "toolId": "playwright",
    "repo": "microsoft/playwright",
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
    "workItemId": "GOAL-AUTOCLAW-REPOS-6",
    "toolId": "playwright-cli",
    "repo": "microsoft/playwright-cli",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "No repository-pinned dependency/executable proven; execution unavailable for this evidence entry.",
    "verifiedAt": "2026-10-16T17:26:01.000Z",
    "verifiedBy": "codex",
    "versionRef": "@playwright/cli@0.1.2 (adoption pin only)",
    "baselineSha": "c69b59a3d71bd94376342248d331a3c9b33c2d6a",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-6",
    "toolId": "axe-core",
    "repo": "dequelabs/axe-core",
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
    "workItemId": "GOAL-AUTOCLAW-REPOS-6",
    "toolId": "lighthouse-ci",
    "repo": "googlechrome/lighthouse-ci",
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
    "workItemId": "GOAL-AUTOCLAW-REPOS-6",
    "toolId": "k6",
    "repo": "grafana/k6",
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
    "workItemId": "GOAL-AUTOCLAW-REPOS-6",
    "toolId": "msw",
    "repo": "mswjs/msw",
    "state": "INSTALLED",
    "evidenceRef": "packages/testkit/package.json:dependencies",
    "command": null,
    "blocked": false,
    "blockedReason": null,
    "verifiedAt": "2026-10-16T17:26:01.000Z",
    "verifiedBy": "codex",
    "versionRef": "^2.15.0",
    "baselineSha": "c69b59a3d71bd94376342248d331a3c9b33c2d6a",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-6",
    "toolId": "supertest",
    "repo": "forwardemail/supertest",
    "state": "INSTALLED",
    "evidenceRef": "apps/api/package.json:devDependencies",
    "command": null,
    "blocked": false,
    "blockedReason": null,
    "verifiedAt": "2026-10-16T17:26:01.000Z",
    "verifiedBy": "codex",
    "versionRef": "^7.2.2",
    "baselineSha": "c69b59a3d71bd94376342248d331a3c9b33c2d6a",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-6",
    "toolId": "openapi-typescript",
    "repo": "openapi-ts/openapi-typescript",
    "state": "INSTALLED",
    "evidenceRef": "package.json:devDependencies",
    "command": null,
    "blocked": false,
    "blockedReason": null,
    "verifiedAt": "2026-10-16T17:26:01.000Z",
    "verifiedBy": "codex",
    "versionRef": "^7.13.0",
    "baselineSha": "c69b59a3d71bd94376342248d331a3c9b33c2d6a",
    "execution": "NOT_RUN",
    "acceptance": "PENDING"
  }
]
```

## Local verification ? 2026-10-17

- `node --test tools/ai-brain/test/repo-integration-group-5.test.js tools/ai-brain/test/repo-integration-evidence.test.js`: exit 0, 10 passed, 0 failed, 0 skipped.
- `python docs/product-spec/scripts/validate_docs.py`: exit 0; 191 Markdown files, 130 feature IDs, 250 delivery rows, 1210 unique identifiers.
- Scope: only this document, the group test, this item's copied spec and its single appended register row.
- Prettier checks use the existing repository formatter; CSV has no supported Prettier parser and is checked as an exact copied row.
- PR contract verification deferred to Claude after commit, as instructed on 2026-10-17.
- No commit, push, PR or merge; no final change SHA exists yet. Record native tool evidence and exact-SHA CI/review separately before any lifecycle promotion.
