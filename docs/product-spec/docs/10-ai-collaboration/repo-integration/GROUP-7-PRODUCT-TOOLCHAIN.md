# Group 7 ? 7-PRODUCT-TOOLCHAIN

Work Item: `GOAL-AUTOCLAW-REPOS-8`. Uses [the existing five-state contract](../REPO-INTEGRATION-EVIDENCE.md).

## Declaration and evidence

```json
[
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-8",
    "toolId": "git",
    "repo": "git-for-windows/git",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unpinned declaration",
    "capability": "version control/worktrees",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-8",
    "toolId": "node",
    "repo": "nodejs/node",
    "state": "INSTALLED",
    "evidenceRef": "package.json:engines",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": {
      "node": ">=24.0.0",
      "pnpm": ">=11.0.0"
    },
    "capability": "runtime",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-8",
    "toolId": "pnpm",
    "repo": "pnpm/pnpm",
    "state": "INSTALLED",
    "evidenceRef": "package.json:packageManager",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "pnpm@11.23.0",
    "capability": "dependencies/workspaces/SBOM",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-8",
    "toolId": "compose",
    "repo": "docker/compose",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unpinned declaration",
    "capability": "product test environment/readiness",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-8",
    "toolId": "nestjs",
    "repo": "nestjs/nest",
    "state": "INSTALLED",
    "evidenceRef": "apps/api/package.json:dependencies",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": {
      "@aws-sdk/client-s3": "^3.758.0",
      "@nestjs/common": "^11.0.11",
      "@nestjs/core": "^11.0.11",
      "@nestjs/platform-express": "^11.0.11",
      "@opentelemetry/api": "^1.9.1",
      "@opentelemetry/resources": "^2.11.0",
      "@opentelemetry/sdk-trace-base": "^2.11.0",
      "@opentelemetry/semantic-conventions": "^1.43.0",
      "@prisma/client": "^6.19.2",
      "@shipde/config": "workspace:*",
      "@shipde/contracts": "workspace:*",
      "ioredis": "^5.6.1",
      "reflect-metadata": "^0.2.2",
      "rxjs": "^7.8.2"
    },
    "capability": "backend modules",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-8",
    "toolId": "prisma",
    "repo": "prisma/orm",
    "state": "INSTALLED",
    "evidenceRef": "package.json:devDependencies",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": {
      "@prisma/client": "^6.19.2",
      "@types/js-yaml": "^4.0.9",
      "@types/node": "^20",
      "@typescript-eslint/parser": "^8.68.0",
      "eslint": "^9.39.5",
      "lefthook": "1.11.3",
      "openapi-typescript": "^7.13.0",
      "prettier": "^3.9.6",
      "prisma": "^6.19.2",
      "tsx": "^4.21.0",
      "turbo": "^2.4.4",
      "typescript": "^5"
    },
    "capability": "persistence/schema/migrations",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-8",
    "toolId": null,
    "repo": "taskforcesh/bullmq",
    "state": "DECLARED",
    "evidenceRef": "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-7-PRODUCT-TOOLCHAIN.md:declaration",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": "Unpinned declaration",
    "capability": "product jobs/idempotency/retry",
    "registrationPending": true
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-8",
    "toolId": "turbo",
    "repo": "vercel/turborepo",
    "state": "INSTALLED",
    "evidenceRef": "package.json:devDependencies",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": {
      "@prisma/client": "^6.19.2",
      "@types/js-yaml": "^4.0.9",
      "@types/node": "^20",
      "@typescript-eslint/parser": "^8.68.0",
      "eslint": "^9.39.5",
      "lefthook": "1.11.3",
      "openapi-typescript": "^7.13.0",
      "prettier": "^3.9.6",
      "prisma": "^6.19.2",
      "tsx": "^4.21.0",
      "turbo": "^2.4.4",
      "typescript": "^5"
    },
    "capability": "task graph/cache inputs",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-8",
    "toolId": "lefthook",
    "repo": "evilmartians/lefthook",
    "state": "INSTALLED",
    "evidenceRef": "package.json:devDependencies",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": {
      "@prisma/client": "^6.19.2",
      "@types/js-yaml": "^4.0.9",
      "@types/node": "^20",
      "@typescript-eslint/parser": "^8.68.0",
      "eslint": "^9.39.5",
      "lefthook": "1.11.3",
      "openapi-typescript": "^7.13.0",
      "prettier": "^3.9.6",
      "prisma": "^6.19.2",
      "tsx": "^4.21.0",
      "turbo": "^2.4.4",
      "typescript": "^5"
    },
    "capability": "staged checks/preserve unstaged changes",
    "registrationPending": false
  },
  {
    "workItemId": "GOAL-AUTOCLAW-REPOS-8",
    "toolId": "opentelemetry-js",
    "repo": "open-telemetry/opentelemetry-js",
    "state": "INSTALLED",
    "evidenceRef": "apps/api/package.json:dependencies",
    "command": null,
    "blocked": true,
    "blockedReason": "Execution not verified; await requirement or comparative measurement.",
    "verifiedAt": "2026-10-17T00:00:00.000Z",
    "verifiedBy": "codex",
    "versionRef": {
      "@aws-sdk/client-s3": "^3.758.0",
      "@nestjs/common": "^11.0.11",
      "@nestjs/core": "^11.0.11",
      "@nestjs/platform-express": "^11.0.11",
      "@opentelemetry/api": "^1.9.1",
      "@opentelemetry/resources": "^2.11.0",
      "@opentelemetry/sdk-trace-base": "^2.11.0",
      "@opentelemetry/semantic-conventions": "^1.43.0",
      "@prisma/client": "^6.19.2",
      "@shipde/config": "workspace:*",
      "@shipde/contracts": "workspace:*",
      "ioredis": "^5.6.1",
      "reflect-metadata": "^0.2.2",
      "rxjs": "^7.8.2"
    },
    "capability": "trace Work Item/run/attempt",
    "registrationPending": false
  }
]
```

`verifiedAt` denotes the inspection date (UTC day marker), not tool execution. Entries with `registrationPending: true` and `toolId: null` are incomplete contract records: no matching manifest entry exists. They remain DECLARED pending a separately scoped manifest registration; this item cannot edit the shared manifest. Existing IDs and evidence references reuse item 1.

## Existing callers and boundaries

Trigger: existing app/scripts/test infrastructure. No duplicate adapters, fake skills, rewrite or major upgrade.

| Tool          | Caller/config                                                                                                    | Input ? output; limitation                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Git           | scripts/ai/bootstrap-worktrees.ps1                                                                               | ref ? worktree; host presence only                                               |
| Node          | package.json:engines                                                                                             | script ? exit/output; product not executed                                       |
| pnpm          | package.json:packageManager; pnpm-workspace.yaml; pnpm-lock.yaml                                                 | manifests/lock ? dependencies; SBOM not generated                                |
| Compose       | infra/docker/compose.yml; infra/docker/wait.ts                                                                   | environment ? services/readiness; not started                                    |
| NestJS        | apps/api/src/main.ts; apps/api/package.json                                                                      | config ? server; not started                                                     |
| Prisma        | prisma/schema.prisma; package.json:scripts.db:generate                                                           | schema ? client; not generated/migrated                                          |
| BullMQ        | apps/worker/package.json; apps/worker/src/queue/smoke.worker.ts; apps/worker/src/dispatcher/outbox.dispatcher.ts | outbox/job ? processing; idempotency/retry not verified                          |
| Turbo         | turbo.json; package.json:scripts.test                                                                            | graph/cache inputs ? task results; cache not exercised                           |
| Lefthook      | lefthook.yml                                                                                                     | staged index ? guard/secret verdict; hook and unstaged preservation not verified |
| OpenTelemetry | packages/config/src/telemetry.ts; apps/api/package.json                                                          | config ? spans; Work Item/run/attempt correlation not demonstrated               |

Host observations 2026-10-17: `git --version` returned `git version 2.49.0.windows.1`; `node --version` returned `v24.15.0`. Repository package manager pin: `pnpm@11.23.0`. PowerShell pnpm invocation was blocked by execution policy. Host observations do not promote repository states. BullMQ dependency exists in apps/worker/package.json but lacks manifest registration, so this declaration cannot claim INSTALLED. Existing pinned tools are conservatively INSTALLED only; callers alone do not prove execution.

## Verification and limitations

Task/artifact: inspect repository declarations, run `node --test tools/ai-brain/test/repo-integration-group-7.test.js tools/ai-brain/test/repo-integration-evidence.test.js` and `python docs/product-spec/scripts/validate_docs.py`. Tests check evidence structure, not live tool availability.

SHA: pending Claude commit. No EXECUTION_VERIFIED or ACCEPTED claim. CI and independent review pending.

Local verification on 2026-10-17: group test plus shared evidence test passed 10/10 (zero failures); documentation validation passed with 193 markdown files, 130 feature IDs, 251 delivery rows and 1210 unique identifiers. PR contract deferred to Claude after commit, as requested.
