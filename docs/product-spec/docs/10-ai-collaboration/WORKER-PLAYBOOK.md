# Worker playbook

How every author, repairer and reviewer works in this repository, which attached tools and
repositories to use for which job, and what to run before handing work back. It applies to every
model and every route. `AGENTS.md` (source of truth, roles, prohibitions) takes precedence.

## 1. Who does what

| Step | Who | Rule |
| --- | --- | --- |
| Choose the writer | Controller (`cli.js dispatch`, `route.js` until the route slices land) | Never hand-pick a model. Difficulty comes from JEV; the score scale is the AA policy. |
| Write | The chosen writer | Works in its own worktree; never reviews its own work. |
| Review | An independent reviewer on a different model from the writer | `PASS`, `CHANGES_REQUIRED` or `BLOCKED` at an exact SHA. |
| Repair | The writer; after two rounds without convergence, the coordinator or another strong model | The repairer never reviews its own repair. |
| Merge | Only with reviewer `PASS` at the head SHA and green CI | Squash, `--match-head-commit`. |

## 2. Before writing any code

1. Read `AGENTS.md`, the Work Item and its acceptance matrix, then the source documents it cites.
2. Apply the four shared rules (from `multica-ai/andrej-karpathy-skills`, adapted in `AGENTS.md`):
   - think before coding: state assumptions that change the result;
   - keep the solution small: reuse existing code, tools and tests;
   - make focused edits: every change belongs to the Work Item;
   - define and verify success: name the check, report what ran and what is unverified.
3. Map the code before opening files (skill `graphify-local`):
   - `bash C:/Tools/graphify/sha-check.sh <worktree> <graphSha8>`; if the SHA differs, the graph does not cover newer files;
   - `node C:/Tools/graphify/q.js <sha8> <functionName>` for callers and callees (works in sandboxes);
   - a missing edge never means no call: grep before concluding.
4. Take the tool list the Controller selects for your role and files (`tools/ai-brain/tool-manifest.js toolsFor`).
5. Read the reference repository for the domain (section 4) before writing new code.

## 3. Attached tools: real state on main

`tools/ai-brain/data/tool-manifest.json` lists 42 tools. A listed tool is not a running tool:
only entries with a `command` run, and only `gate: true` entries run automatically through
`orchestrate.js gatesFor()`. State measured 2026-11-08 at `5c574f7a`:

| Tool | Use it for | How to run it | State |
| --- | --- | --- | --- |
| eslint | lint JS/TS | `pnpm lint` | command |
| prettier | formatting | `pnpm format:check`; fix with `npx prettier@3.9.6 --write <files>` | command |
| gitleaks | secret scan | `pnpm security:secrets` | command, gate |
| prisma | client generation | `pnpm db:generate` | command |
| repomix | context pack | `node tools/ai-brain/context-pack.js --spec <work-item.json> --output <pack>` | command |
| playwright | browser and a11y tests | `pnpm --filter @shipde/web test:a11y`; stubbed suites with their own config | used, manifest says not installed |
| axe-core | accessibility | `@axe-core/playwright` inside Playwright specs | used, manifest says not installed |
| msw, supertest, nock | API mocking and HTTP tests | inside unit and integration tests | installed or not, no command |
| openapi-typescript | API types from OpenAPI | per Work Item | installed, no command |
| semgrep, ast-grep | security and structural review | not yet runnable | not installed |
| trivy, syft | vulnerabilities, SBOM | not yet runnable | not installed |

The remaining entries (storybook, k6, pact-js, prism, hoverfly, toxiproxy, renovate, context7,
tokentracker, vietnamese-provinces, lighthouse-ci, compose, agent-scan) are declared only. Add
a project dependency only when a Work Item needs it, with execution evidence at a reviewed SHA
(`REPO-INTEGRATION-EVIDENCE.md`). Never report a tool as used unless its command ran.

## 4. Reference repositories by job

Local clones live in `C:\Users\gumac\AI\ref`. Read the relevant one before writing; copy ideas
and tests, not code, and keep each repository's licence notice where code is adapted.

| Job | Read first |
| --- | --- |
| Server-driven data tables (filters, paging, URL state) | `ref/tablecn` (used by TASK-AI-155) |
| Tenant isolation, row-level security | `ref/redwood-rls-demo` |
| Outbound URL fetching, SSRF safety | `ref/ssrf-guard` |
| Markdown and docs lint | `ref/markdownlint` |
| Coding discipline | `multica-ai/andrej-karpathy-skills` via `AGENTS.md` shared rules |

## 5. No hardcoding

`scripts/ai/check-no-hardcode.mjs` fails CI on hardcoded model ids, model lists, benchmark or
quality scores, provider or account lists, and numeric attempt or probe caps under
`tools/ai-brain` (code and `data/*.json`).

- Values come from live sources: provider `/models`, leaderboards, route health, quota scans,
  policy files (`data/scoring-policy.json`) or configuration.
- Data that names models and is fetched at runtime is written by a script and gitignored, like
  `data/model-priors-live.json` and `data/aa-intelligence.json` (written by `aa-snapshot.js`).
- Tests use fixtures under `tools/ai-brain/test/fixtures/`, which the guard excludes.
- When data is missing, report `UNKNOWN`; never fill a default score or cap.
- Run `node scripts/ai/check-no-hardcode.mjs` before committing.

## 6. Reuse before writing

- Search with graphify and `rg` for an existing module, helper or test before adding one.
- Port behaviour into the module that already owns it; never copy an outside script whole.
- Extend existing test files and fixtures; add a new file only for a new behaviour.
- New dependencies need the Work Item's approval and integration evidence.

## 7. Fixing a review finding

1. Read the finding as WHERE / WRONG / GOAL / VERIFY.
2. Write a test that reproduces it and fails on the reviewed SHA.
3. Fix the cause at WHERE; keep the change inside the finding.
4. Run the new test, the suites named in the review and the commands in section 8.
5. Ask for a delta review of the fix only.

## 8. Before handing back

| Check | Command |
| --- | --- |
| Formatting | `npx prettier@3.9.6 --check <changed files>` |
| No hardcode | `node scripts/ai/check-no-hardcode.mjs` |
| Focused tests | `node --test <changed and named test files>` (brain); `npx tsx <test>` (web) |
| Types and lint for apps | `npx tsc --noEmit -p apps/<app>`; `pnpm lint` |
| Size | under about 400 changed lines; split by acceptance criterion otherwise |
| Work Item | append a section to the Work Item file (the contract check requires it) |
| PR body | the ten sections of `.github` contract: Work Item, Source requirements, Scope integrity, Implementation, Acceptance evidence, Verification, Safety and recovery, Documentation and traceability, Risks and limitations, Codex review |

Report exact commands and counts, what passed, what failed and what remains unverified.
