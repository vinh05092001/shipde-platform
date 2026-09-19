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
- A Git pre-commit hook, installed and managed by **Lefthook** from `lefthook.yml`, blocks
  commits when another active session holds the target branch.

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

### How the hook gets installed

The hook is installed explicitly through **Lefthook**, never by an install lifecycle
script. The repository's regression audit forbids `preinstall`, `install`,
`postinstall` and `prepare` in the root and web manifests, because an install hook
runs whatever the dependency tree says it should — a supply-chain surface the
project has deliberately closed.

The hook definition lives in the version-controlled `lefthook.yml` at the repository
root. `lefthook install` (pinned 1.11.3) writes a delegate `pre-commit` into Git's
common hooks directory, so one install covers the main checkout and every worktree.
The legacy `.githooks` directory and the `core.hooksPath = .githooks` override are
retired (TASK-AI-36): an override shadows the Lefthook delegate and silently disables
the guard, so `cli.js install` unsets any existing `core.hooksPath` before installing.

`pnpm install` does **not** install the hook. That is deliberate, and it is the
whole point of the paragraph above.

### Installing it

To install or verify:

```bash
pnpm lefthook install    # canonical way — runs the pinned Lefthook
node tools/ai-guard/cli.js install    # retires any core.hooksPath override, delegates
                                      # to lefthook install, then VERIFIES the result
```

`cli.js install` refuses to run when `lefthook.yml` is missing (Lefthook would
invent an empty config and install an empty hook) and only reports success after
re-reading the hook Git will actually execute and confirming `lefthook.yml` still
declares the `writer-claim` guard command.

To verify installation:

```bash
node tools/ai-guard/cli.js status
```

Output includes:

```
Git hook: ĐÃ CÀI ĐẶT (lefthook @ C:\...\shipde-platform\.git\hooks)
```

and when the guard is absent it prints remediation commands
(`pnpm lefthook install`, restoring `lefthook.yml`, or unsetting an override).

To uninstall:

```bash
node tools/ai-guard/cli.js uninstall
```

This only retires a bespoke `core.hooksPath` override; it intentionally does not
remove the Lefthook delegate from the common hooks directory (use
`lefthook uninstall pre-commit` for that).

## CLI Reference

| Command                                                                                | Purpose                                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `node tools/ai-guard/cli.js install [--strict]`                                        | Retires any `core.hooksPath` override, runs pinned `lefthook install`, and verifies the resulting hook. |
| `node tools/ai-guard/cli.js uninstall [--strict]`                                      | Unsets a bespoke `core.hooksPath` override; leaves the Lefthook delegate in place.                      |
| `node tools/ai-guard/cli.js status`                                                    | Shows current branch, resolved identity, hook manager/state, live AO sessions, and direct claims.       |
| `node tools/ai-guard/cli.js claim [--branch X] [--owner X] [--ttl 120] [--note "..."]` | Claims a branch for direct work with an expiration TTL (default: 120 minutes).                          |
| `node tools/ai-guard/cli.js release [--branch X]`                                      | Releases a direct claim on a branch.                                                                    |
| `node tools/ai-guard/cli.js check`                                                     | Evaluates single-writer safety for current branch. Exits 0 if allowed, 1 if blocked.                    |

## Verification Suite

Unit tests cover claim lifecycles, cross-session collisions, `defaultOwner` hierarchy, and hook installation lifecycle:

```bash
node --test tools/ai-guard/test/*.test.js
```
