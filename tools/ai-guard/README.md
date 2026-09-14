# Ship Dễ — ai-guard: Single-Writer Collision Guard

`ai-guard` ensures that multiple concurrent agents or human authors do not collide by attempting to commit or write to the same Git branch at the same time.

## Problem Context

The Agent Orchestrator (AO) enforces single-writer constraints over sessions it spawns. However:

1. Sessions started directly in a terminal or external CLI (e.g. direct Claude Code, Antigravity, or human shell) are invisible to AO.
2. In `TASK-AI-15`, an unobserved direct terminal session rebuilt a realtime AI cockpit while an AO worker (`shipde-platform-14`) was actively developing on `feat/task-ai-15-realtime-ai-cockpit`.
3. Neither session noticed the other until merge collisions occurred.

Rather than forcing all work through AO (which destroys the ability to run quick direct edits), `ai-guard` widens visibility across both worlds:

- **AO sessions** are queried live from the local AO daemon via `http://127.0.0.1:<AO_PORT>/api/v1/sessions`.
- **Direct sessions** record expiring advisory claim files in `~/.ao/data/writer-claims/`.
- A Git pre-commit hook (`.githooks/pre-commit`) blocks commits when another active session holds the target branch.

## How the Hook Works

When `git commit` is executed:

1. The hook executes:
   ```sh
   node tools/ai-guard/cli.js check
   ```
2. `ai-guard` checks:
   - Does the commit target `main` or `master`? (Refused outright: work must occur on dedicated branches).
   - Who is the current writer? (`defaultOwner()`).
   - Does any active AO worker or direct claim hold this branch under a different identity?
     - If yes: logs conflicting sessions and exits with code `1` to abort the commit.
     - If no: exits with code `0` to allow the commit.
3. If an intentional exception is needed, the hook can be bypassed:
   ```sh
   git commit --no-verify
   ```

## Identity Resolution (`defaultOwner`)

The session identity is derived in strict precedence:

1. `SHIPDE_WRITER`: Explicit operator environment variable override.
2. `AO_SESSION_ID`: Set in AO worker sessions (e.g., `shipde-platform-17`), directly matching `session.id` in `/api/v1/sessions`.
3. `AO_REVIEW_WORKER_SESSION_ID`: Set in AO review sessions to represent the worker whose branch is under review.
4. `AO_REVIEW_SESSION_ID`: Set in AO review sessions to identify the review session itself.
5. `CLAUDE_CODE_SESSION_ID`: Set by Anthropic's Claude Code CLI.
6. `CLAUDE_SESSION_ID`: Legacy fallback for Claude Code sessions.
7. `user@hostname`: Local host user fallback for direct unmanaged terminal sessions.

In an AO worker session, `AO_SESSION_ID` matches the worker's own holder row in the daemon API, allowing the worker to commit to its assigned branch without self-collision.

## Installation & Setup

### Automatic Installation

The hook is installed explicitly, never by an install lifecycle script. The
repository's regression audit forbids `preinstall`, `install`, `postinstall`
and `prepare` in the root and web manifests, because an install hook runs
whatever the dependency tree says it should — a supply-chain surface the
project has deliberately closed.

So `core.hooksPath` is set in three explicit places instead: by
`scripts/ai/bootstrap-worktrees.ps1` when a worktree is created, by
`pnpm guard:install` on demand, and it is verified by `scripts/ai/doctor.ps1`,
which names the command to run when it is missing. Running:

```bash
pnpm install
```

automatically installs the hook.

### Manual Installation

To install or verify manually:

```bash
node tools/ai-guard/cli.js install
```

This configures `git config core.hooksPath .githooks`.

To verify installation:

```bash
node tools/ai-guard/cli.js status
```

Output includes:

```
Git hook: ĐÃ CÀI ĐẶT (.githooks)
```

To uninstall:

```bash
node tools/ai-guard/cli.js uninstall
```

## CLI Reference

| Command                                                                                | Purpose                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `node tools/ai-guard/cli.js install [--global] [--strict]`                             | Configures `core.hooksPath` to `.githooks`.                                                       |
| `node tools/ai-guard/cli.js uninstall [--global] [--strict]`                           | Unsets `core.hooksPath`.                                                                          |
| `node tools/ai-guard/cli.js status`                                                    | Shows current branch, resolved identity, hook install state, live AO sessions, and direct claims. |
| `node tools/ai-guard/cli.js claim [--branch X] [--owner X] [--ttl 120] [--note "..."]` | Claims a branch for direct work with an expiration TTL (default: 120 minutes).                    |
| `node tools/ai-guard/cli.js release [--branch X]`                                      | Releases a direct claim on a branch.                                                              |
| `node tools/ai-guard/cli.js check`                                                     | Evaluates single-writer safety for current branch. Exits 0 if allowed, 1 if blocked.              |

## Verification Suite

Unit tests cover claim lifecycles, cross-session collisions, `defaultOwner` hierarchy, and hook installation lifecycle:

```bash
node --test tools/ai-guard/test/*.test.js
```
