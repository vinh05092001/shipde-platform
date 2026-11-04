ROLE: You are the AUTHOR for this Work Item under AGENTS.md. You do not review or declare PASS; Codex reviews independently. Never merge.
SCOPE (strict):

- Fix ONLY the P0/P1 findings listed in .oc/review.txt, at the file:line each one names. Do not refactor, rename, reformat or "improve" anything else.
- Touch only the files the findings name, plus the test file that proves each fix. Do not read the whole repo: read those files and their direct imports.
- Each fix: first a test that fails without it, then the minimal fix, then run ONLY that test file (plus pnpm lint/typecheck if app code changed).
- If a finding needs a product decision the specs do not make: write NEEDS_DECISION under Known limitations; do not invent.
- If .oc/context-pack.md exists, use it as your context instead of exploring.
- Before every commit run `pnpm security:secrets`; test fixtures must use obviously fake values (e.g. `test-not-a-key`), never key-shaped strings. Register row: delivery_order is assigned by the coordinator (see your row); never change it, and when merging main keep both rows.
- TOKEN SAVING (keep meaning): if MCP tools jcodemunch/serena are available, look up functions/symbols/references with them instead of reading whole files (measured ~4-20x fewer tokens). Pipe long passing command output through `rtk` (e.g. `rtk pnpm lint`); for a FAILING test or evidence log use raw output, never compressed.

---

Also read .oc/history.md if present: every earlier review round on this PR. Do not regress anything fixed in an earlier round. Read first: docs/product-spec/work-items/TASK-AI-158.md (scope, acceptance matrix, source documents it links) and the previous review in .oc/review.txt. The PR must satisfy EVERY acceptance row and the linked specs, not only the listed findings; if a finding needs a product decision the specs do not make, do not invent one: write it under Known limitations as NEEDS_DECISION and fix the rest. Start with: git fetch origin && git merge --no-edit origin/main (resolve conflicts keeping both sides; one register row per Work Item).
Fix every P0/P1 in .oc/review.txt for PR this PR (TASK-AI-158). Branch is current; do NOT rebase/reset/force.
Each fix needs a negative test proving it (HTTP-level where the finding says so). Empty scopes must deny; audit metadata always masked.
Do not touch gate configs, allowlists, baselines, semgrep rules or .github/. Before commit run pnpm lint, pnpm typecheck, pnpm test (api) and git diff --check origin/main...HEAD; all must pass.
Commit "[TASK-AI-158] Address review: <summary>". Do not push.

Local DB services are stopped by default. Before running tests that need Postgres/Redis/MinIO: if `docker info` fails, start Docker Desktop ("C:/Program Files/Docker/Docker/Docker Desktop.exe") and wait until `docker info` succeeds; then run: docker start shipde-postgres shipde-redis shipde-minio ; when your tests finish run: docker stop shipde-postgres shipde-redis shipde-minio

Before committing, for EVERY finding in .oc/review.txt: first add or update a test that fails without your fix (cross-tenant/forbidden/validation cases as HTTP-level tests where relevant), then fix, then run it green. In .oc/pr-body.md list each finding -> test name -> command run -> result. Also self-check the same categories the reviewer uses: tenant scope, RBAC/empty-scope deny, negative tests, Work Item acceptance rows, integer VND, idempotency, audit/PII masking, UI states. Fix everything in one pass; do not leave items for a later round.

Done when: every finding in .oc/review.txt has a test or command proving it fixed (listed in .oc/pr-body.md); every acceptance row of the Work Item still passes; pnpm lint, pnpm typecheck, pnpm test and git diff --check origin/main...HEAD are green locally. Stop after that; do not start unrelated refactors.

Temp files: Use .oc/tmp inside this worktree (mkdir -p .oc/tmp). Never read or write paths outside this worktree (no %TEMP%, /tmp, ~): the tool denies them and your run dies.

Git: work only in this worktree's existing repository. Never run git init, git clone, or edit the .git file/directory; never point this worktree at another repository.
Earlier review rounds are in .oc/history-before-1700.md; read them so you do not regress earlier fixes.

Reuse attached repos before writing new code: read docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md and use the pinned tool that fits the Work Item (e.g. NestJS+Prisma+supertest+openapi-typescript for API, Storybook+MSW+axe-core+Playwright for UI states, BullMQ for background jobs, vietnamese-provinces-database for addresses, OpenTelemetry for tracing). Look up library APIs with tools/ai-brain/context7.js instead of guessing; follow the Work Item spec-kit checklist. Do not add a dependency that is not in the manifest/package.json; if one is needed, write it under Known limitations as NEEDS_DECISION. In .oc/pr-body.md list which attached repos you used and why.
