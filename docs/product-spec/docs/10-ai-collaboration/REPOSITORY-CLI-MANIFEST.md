# Ship Dễ Repository and CLI Manifest

## Purpose

This manifest is the complete inventory for preparing the Ship Dễ build environment. It separates source workspaces, machine-wide CLI tools, project dependencies, Docker services and agent guidance so that tools are installed once in the correct place and every agent sees the same repository state.

## Installation rule

Only `vinh05092001/shipde-platform` is cloned as product source. Upstream open-source repositories are not copied beside Ship Dễ. They are consumed through a pinned npm dependency, a pinned Docker image, a reviewed GitHub Action or a reviewed agent-guidance snapshot. Cloning every upstream source repository would create duplicate code, unclear upgrade ownership and no benefit to Gemini, Codex or 9Router.

## Product workspaces

| Local path | Git branch while parked | Owner | Purpose |
|---|---|---|---|
| `C:\Users\gumac\AI\shipde-platform` | `main` | Human | Protected integration baseline |
| `C:\Users\gumac\AI\shipde-claude` | `agent/claude` | Claude | Business and solution analysis only |
| `C:\Users\gumac\AI\shipde-dsh` | `agent/dsh` | 9Router/DSH | Bounded low-risk author |
| `C:\Users\gumac\AI\shipde-gemini` | `agent/gemini` | Gemini | Primary implementation author |
| `C:\Users\gumac\AI\shipde-codex` | `agent/codex-review` | Codex | Planning and fresh independent review |

These are five worktrees of one Git repository, not five independent copies. Branches, commits, Pull Requests and CI are the shared memory between apps.

## Machine-wide CLI layer

| Repository/product | Command | Install policy | Authentication or boundary |
|---|---|---|---|
| [Git](https://github.com/git-for-windows/git) | `git` | Existing installation | No shared credential file in the repository |
| [GitHub CLI](https://github.com/cli/cli) | `gh` | Existing installation | Browser OAuth for `vinh05092001` |
| [Node.js](https://github.com/nodejs/node) and npm | `node`, `npm` | Existing Node 24 installation | Runtime for agent CLIs only until foundation migration |
| [pnpm](https://github.com/pnpm/pnpm) | `pnpm` | Install major 11 now; project pins the exact version in `TASK-FOUND-02` | Requires Node 22+; do not use against the current npm prototype before migration |
| [Docker Desktop](https://github.com/docker/compose) / Compose | `docker`, `docker compose` | Install now through Windows Package Manager | Native Windows/Hyper-V or Docker backend; no Ubuntu worktree is required |
| [9Router](https://github.com/decolua/9router) | `9router` | Install if missing; never auto-upgrade during an active Work Item | Bind to localhost; prompt injection and request logging off |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `dsh` | Pin `@deepseek-ai/dsh@0.1.1-rc.2` | Only the `shipde-dsh` worktree; credential kept outside Git |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `gemini` | Install as a supported fallback; record the resolved version | Sign in interactively with the approved Google account |
| Google Antigravity CLI | `agy` | Install from Google's official installer when available | Preferred authenticated Gemini implementation client in `shipde-gemini` |
| OpenAI Codex CLI | `codex` | Install if missing; record the resolved version | Sign in with ChatGPT; use the `shipde-codex` worktree for planning/review |
| Claude Code | `claude` | Install if missing; record the resolved version | Business/solution analysis only in `shipde-claude`; AgentRouter token remains outside Git |

AgentRouter is a direct remote provider for Claude Code, not another product worktree and not a 9Router upstream. Its promotional balance is temporary capacity; the workflow must continue to work if that provider is removed.

The guarded installer is `scripts/ai/install-clis.ps1`. It previews by default, installs only missing tools with `-Apply`, does not upgrade an installed CLI, does not sign in and never reads or stores an API key.

## Project dependency layer

These repositories become versioned dependencies inside `shipde-platform`; they are not global CLI installations.

| Foundation item | Repository/package family | Required result |
|---|---|---|
| `TASK-FOUND-01` | [ESLint](https://github.com/eslint/eslint), Next.js ESLint integration, [Prettier](https://github.com/prettier/prettier), [Gitleaks](https://github.com/gitleaks/gitleaks) | Reproducible lint/format baseline and secret scanning without weakening rules |
| `TASK-FOUND-02` | [pnpm](https://github.com/pnpm/pnpm), [Turborepo](https://github.com/vercel/turborepo) | pnpm 11 supply-chain defaults, exact `packageManager`, lockfile and root workspace commands |
| `TASK-FOUND-03` | [NestJS](https://github.com/nestjs/nest), [Prisma](https://github.com/prisma/prisma), [BullMQ](https://github.com/taskforcesh/bullmq) | API, worker, migration and queue foundations with local health checks |
| `TASK-FOUND-04` | [Vitest](https://github.com/vitest-dev/vitest), [Supertest](https://github.com/ladjs/supertest), [Playwright](https://github.com/microsoft/playwright) | Unit, API integration and browser E2E gates |
| `TASK-FOUND-04` | [Storybook](https://github.com/storybookjs/storybook), `@storybook/addon-a11y`, [axe-core](https://github.com/dequelabs/axe-core) | Reviewable component states, interactions, keyboard/accessibility evidence |
| `TASK-FOUND-04` | [MSW](https://github.com/mswjs/msw), [msw-storybook-addon](https://github.com/mswjs/msw-storybook-addon) | Deterministic API/carrier states without fake production behavior |
| `TASK-FOUND-04` | [openapi-typescript](https://github.com/openapi-ts/openapi-typescript) and OpenAPI validation | Generated frontend contract types and drift detection |
| `TASK-FOUND-04` | [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) | Targeted performance budgets for approved critical routes, not every page on every local edit |

Nest, Prisma, Turbo, Playwright, Storybook and test CLIs must run through root package scripts (`pnpm ...`). Global copies are prohibited because agents could otherwise use different versions.

## Local service layer

`TASK-FOUND-03` supplies Docker Compose with pinned image versions or digests for:

| Service | Purpose | Local installation rule |
|---|---|---|
| PostgreSQL 16+ | Primary relational data and migrations | Container only; do not install a second native PostgreSQL service |
| Redis | Queue and cache backing service | Container only |
| MinIO or another approved S3-compatible image | Local object storage | Container only; production provider is configured separately |

Carrier APIs, bank APIs, SMS/Zalo and production object storage are mocked or disabled until a dedicated Work Item contains verified credentials, capability evidence and safe fallback behavior.

## Agent quality guidance

The following focused repositories may inform implementation but do not replace Ship Dễ product specifications:

- [Vercel agent skills](https://github.com/vercel-labs/agent-skills): only `react-best-practices` and `web-design-guidelines` are approved for audited, commit-pinned use in `TASK-FOUND-04`.
- Next.js version-matched bundled documentation remains the framework authority.
- `DESIGN.md`, the Ship Dễ UX rules and screen specifications remain the product and visual authority.

Do not install all skills from a public collection. Do not install remote skills from a moving branch. The Foundation Pull Request must record the reviewed source commit and vendor only the selected guidance required by both author and reviewer.

## Explicit exclusions

- No BMAD, Spec Kit, SuperClaude, Superpowers or second orchestration framework.
- No Ponytail, Caveman, generic dashboard/theme repository or auto-generated design system.
- No duplicate OpenCode/Cline/Cursor author while DSH and Gemini already own implementation routes.
- No WSL or Ubuntu requirement for the current Windows-native workflow.
- No globally installed framework/build/test CLI that should be pinned in the project.
- No provider credential, request log, browser session or model token committed to Git.

## Readiness evidence

Repository and CLI preparation is complete only when:

1. all five Ship Dễ worktrees are clean and point to the intended parked branches;
2. `git`, `gh`, `node`, `npm`, `pnpm`, `docker`, `9router`, `dsh`, `codex`, `claude` and at least one authenticated Gemini client (`agy` preferred, `gemini` fallback) resolve from a new PowerShell window;
3. `docker compose version`, `gh auth status`, Gemini/Antigravity sign-in, Codex ChatGPT sign-in and the Claude/AgentRouter launcher succeed;
4. 9Router and DSH complete the approved `SHIPDE_OK` model smoke test without exposing the key;
5. installed versions are recorded by `doctor.ps1`, and no CLI is auto-upgraded during an active Work Item;
6. project-level repositories are introduced only by their assigned Foundation Pull Request with CI evidence.
