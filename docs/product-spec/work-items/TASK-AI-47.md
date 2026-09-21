# TASK-AI-47 — Live model rotation view on the AI dashboard

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-47` |
| Feature ID | `N/A` |
| Status | `BACKLOG` |
| Delivery order | `178` |
| Dependencies | `TASK-AI-26` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `.gitignore`, `.gitleaks.toml`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/work-items/TASK-AI-47.md`, `tools/ai-dashboard/ao-adapter.js`, `tools/ai-dashboard/architecture.js`, `tools/ai-dashboard/client.js`, `tools/ai-dashboard/git-adapter.js`, `tools/ai-dashboard/github-adapter.js`, `tools/ai-dashboard/index.html`, `tools/ai-dashboard/progress-view.js`, `tools/ai-dashboard/register-adapter.js`, `tools/ai-dashboard/roster-view.js`, `tools/ai-dashboard/rotation-view.js`, `tools/ai-dashboard/rotation.js`, `tools/ai-dashboard/server.js`, `tools/ai-dashboard/summary-view.js`, `tools/ai-dashboard/test/dashboard.test.js`, `tools/ai-dashboard/test/rotation-parse.test.js`, `tools/ai-dashboard/test/rotation.test.js` (widened on 2026-09-21 to the files this Pull Request actually changes: the cockpit renders the rotation payload, so the panel, its adapters, the page and the shared test files all move together, and the gitleaks allowlist had to follow because the scan reads the same tree) |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-47-rotation-view` |
| Pull Request | `https://github.com/vinh05092001/shipde-platform/pull/105` |

## Business outcome

An operator can see, at a glance, which access sources are currently serving runs through the local dispatcher, what model each is using, how many tokens the active run has consumed so far, and whether any source is on cooldown or out of quota — without reading raw log files or JSON ledgers by hand.

Prior to this Work Item, the AI dashboard (`tools/ai-dashboard`) aggregated work-item state, git health, AO sessions, GitHub CI evidence, usage, and capacity, but had no visual representation of the live dispatch topology. The operator could not tell which source was actively routing, which model was in flight, or why a source had gone silent, without opening `.worktrees/logs/*.log`, `~/.shipde/quota.observations.json`, and `~/.shipde/agy-quota.json` separately.

This Work Item adds a radial "model rotation" view, modelled on 9Router's usage page, served as a new route from the existing dashboard server on port 3333. The hub represents the local dispatcher (9Router / dispatch lanes). Around it, one node per configured access source shows declared limits, measured consumption, remaining headroom, recent run outcomes, and live animated arrows when a run is in progress.

### Data integrity rule

All numbers come from real measurements already on disk. Where a value cannot be measured, the view renders `UNKNOWN` — never zero, never a placeholder, never an invented default. This follows the same principle as `tools/ai-brain/limits.js`: an unattributed figure cannot be checked or withdrawn.

## Requirements

### AI-47-R01: Radial layout

The view is a radial diagram rendered as SVG inside a standalone HTML page at `/rotation`. The hub sits at the centre. Each configured access source occupies a node arranged around the hub. Sources: 9Router, xKiro, agy (local), agy (docker), Cline, AutoClaw, AO, bai (B.AI), tencent, rqsty, thb. Only sources that are actually configured (present in logs, quota store, or limits) appear; unconfigured sources are omitted rather than shown as empty.

### AI-47-R02: Live arrows

An arrow is drawn from the hub to every source that is currently serving a run. The arrow is labelled with the model id and the token count observed so far for that run. The arrow animates (CSS dash-offset animation) only while the run is live. When the run completes, the arrow stops animating and fades.

### AI-47-R03: Cooldown and quota dimming

A source that is on cooldown or out of quota is drawn dimmed (reduced opacity). The node displays the reason (from the cooldown ledger) and the ISO timestamp when it becomes usable again.

### AI-47-R04: Node detail card

Each source node shows:
- Declared limit if known (from `tools/ai-brain/limits.js`). If unknown, the text reads `UNKNOWN`.
- Measured consumption (from `.worktrees/logs/*.log` token counts).
- Remaining headroom (limit minus consumption, or `UNKNOWN` if limit is unknown).
- A small bar chart of the last runs: done / failed / quota-refused.

### AI-47-R05: JSON endpoint

`/api/rotation` returns a JSON payload the HTML page polls. Shape:

```json
{
  "observedAt": "ISO-8601",
  "hub": { "label": "9Router / dispatch lanes" },
  "sources": [
    {
      "id": "9router",
      "label": "9Router",
      "configured": true,
      "status": "live|idle|cooldown|quota-exhausted",
      "activeRun": { "modelId": "string|null", "tokensSoFar": "number|UNKNOWN", "startedAt": "ISO|null" },
      "cooldown": { "reason": "string|null", "until": "ISO|null" },
      "limits": { "declaredLimit": "number|UNKNOWN", "consumption": "number|UNKNOWN", "headroom": "number|UNKNOWN" },
      "recentRuns": [{ "outcome": "done|failed|quota-refused", "at": "ISO" }]
    }
  ]
}
```

### AI-47-R06: Real data sources

Data must come from:
- Dispatcher logs: `.worktrees/logs/*.log` (one run line per lane attempt, parsed for source, model, tokens, outcome).
- Cooldown ledger: `~/.shipde/quota.observations.json` via `tools/ai-brain/ceiling.js` `readLedger()`.
- Quota store: `~/.shipde/agy-quota.json` via `tools/ai-brain/quota-store.js` `loadStore()`.
- Limits: `tools/ai-brain/limits.js` `resolveLimits()`.

### AI-47-R07: Static render path preserved

The existing static render path (`render-static.js`, `DASHBOARD.html`) continues to work unchanged. The rotation view is an additional route, not a modification of the main dashboard.

### AI-47-R08: Tests

Tests under `tools/ai-dashboard/test/rotation.test.js` using `node:test` cover:
- JSON shape validation (all required fields present, correct types or `UNKNOWN`).
- UNKNOWN propagation: when no log or ledger data exists, limits and consumption read `UNKNOWN`, never `0`.
- Cooldown state: when the ceiling ledger records a refusal, the source transitions to `cooldown` with the correct `until` timestamp.
- Dispatcher log location: a process running in a linked worktree resolves the main checkout's `.worktrees/logs`, counts only launched runs as attempts, keeps pre-flight skips out of that number, and reports `UNKNOWN` when no folder can be read.
- Breakdown integrity: every started run belongs to a source the panel shows, so the per-source cards add up to the headline total.

## Scope widened on 2026-09-18 (operator decision)

The item was written for a standalone page at `/rotation`. The operator asked for the
rotation view to live inside the cockpit's own Capacity tab, for the cockpit to adopt a
component library with one cream theme, for the seven tabs to collapse to three, and for
an architecture diagram. That work necessarily edits `tools/ai-dashboard/index.html`,
`client.js`, `server.js` and the adapters, which the original boundary forbade.

Recorded rather than hidden: `tools/ai-dashboard/rotation.html` is deleted, `/rotation`
now redirects into the cockpit, and `AI-47-R01`/`AI-47-R07` no longer describe a
standalone page. Everything else the item claims - measured values only, `UNKNOWN`
wherever nothing is measured, read-only behaviour - is unchanged and still enforced by
the acceptance tests.

## Out of scope

- Adding new write paths of any kind; the cockpit stays observational.
- Adding new data collection to `tools/ai-brain` (reads existing modules only).
- WebSocket transport (uses polling like the rest of the dashboard).
- Write operations of any kind.

## Acceptance matrix

| AC ID | Scenario | Expected result | Evidence |
|---|---|---|---|
| AC-AI-47-01 | GET `/api/rotation` returns valid JSON | 200, body matches schema in AI-47-R05 | `test/rotation.test.js` |
| AC-AI-47-02 | No logs exist on disk | All `limits` fields read `UNKNOWN`, `activeRun.tokensSoFar` reads `UNKNOWN` | `test/rotation.test.js` |
| AC-AI-47-03 | Source has a cooldown entry in ledger | Source `status` is `cooldown`, `cooldown.until` is ISO string, node renders dimmed | `test/rotation.test.js` |
| AC-AI-47-04 | GET `/rotation` serves HTML | 200, `text/html`, contains SVG container | `test/rotation.test.js` |
| AC-AI-47-05 | Active run detected in log | Arrow rendered with model label and token count, CSS animation class applied | Manual verification |
| AC-AI-47-06 | `python docs/product-spec/scripts/validate_docs.py` | Exit 0 | CLI run |
| AC-AI-47-07 | `node --test tools/ai-brain/test/*.test.js` | All pass | CLI run |
| AC-AI-47-08 | Dashboard process runs in a linked worktree while `dispatch.sh` logs into the main checkout | `log.dir` is the main checkout `.worktrees/logs`, and `totals.attempts`/`totals.skipped`/`totals.quotaRefused` equal the dispatcher log's own line counts; a folder that cannot be read yields `UNKNOWN`, not `0` | `test/rotation.test.js` |
| AC-AI-47-09 | Multi-key B.AI consolidation and aggregated status | Consolidated `bai` source reflects aggregate attempts/tokens, displays running key count `B.AI X/Y key`, live when any key active, `quota-exhausted` only when all keys exhausted | `test/rotation.test.js` |
| AC-AI-47-10 | B.AI real balance probing and quota rules | Probes `/v1/balance` with 8s timeout, caches 60s TTL; aggregated headroom is UNKNOWN if any key fails/times out; balance warning at `< 10000`; API key secrets stripped | `test/rotation.test.js` |

## B.AI consolidation and quota probing on 2026-09-19

The dispatcher operates multiple rotation lanes `bai1`–`bai7` mapped to separate API keys (`BAI_API_KEY_1`..`7`).
In the dashboard rotation panel, displaying seven separate nodes cluttered the layout and obscured operational status.
These lanes are consolidated into a single access source:

- **Source representation**: Unified source ID `'bai'` with label `'B.AI'`, blue accent color `#2563eb`, and dynamic node label `B.AI X/Y key` displaying active vs configured key count.
- **Quota probing**: Queries real balances from `https://api.b.ai/v1/balance` with an 8-second abort timeout and a 60-second in-memory TTL cache (`probeBai`).
- **Aggregated quota rules**:
  - Headroom equals sum of all key balances when all keys report successfully.
  - If any key probe fails, errors or times out, the aggregated headroom is set to `'UNKNOWN'` (never 0 or inaccurate partial sums).
  - A warning notice is generated if total headroom falls below 10,000 credits.
  - Overall status is marked `'quota-exhausted'` only when all configured keys are in cooldown/exhausted; otherwise `'idle'` or `'live'`.
- **Security & PII minimization**: Strips secret keys entirely from returned payloads; only key IDs (`bai1`, etc.) and numeric balances are published.

## Data correction on 2026-09-18 (đối chiếu dashboard với nguồn thật)

The rotation panel reported `0 lượt chạy` while the dispatcher had recorded 114 attempts. The cause was
not the parser: `.worktrees/logs/dispatch.sh` writes with `L=$REPO/.worktrees/logs`, i.e. always the main
checkout, whereas the panel joined its own `rootDir` with `.worktrees/logs`. Inside a linked worktree that
folder does not exist, so `parseLogLines` honestly returned nothing and the empty result looked like a
measurement of zero.

Fixed by resolving the log location from git (`--git-common-dir`, with an ordered candidate list and a
parent-directory walk as fallbacks), keeping `ROTATION_LOG_DIR`/`opts.logDir` as the explicit override, and
publishing what was read as `log.dir`, `log.exists`, `log.candidates` and `log.reason` so the panel can name
its source instead of implying an empty one.

Two accounting errors surfaced by the same comparison and corrected here:

- Pre-flight skips (`--- skip <lane> <model>: <reason> ---`, written before the CLI is launched) were counted
  as runs. `entries[].started` now separates launched runs from skips, so attempts, skips and refusals do not
  overlap.
- Token totals matched any `inputTokens`/`outputTokens` text inside a run transcript, including source code
  the agent was editing. Only a line that parses as JSON with a `usage` object, or the Codex CLI's final
  `tokens used` block, is a measurement now.

After the fix the panel matched every independently counted figure: 114 attempts, 21 skips, 44 quota refusals
(23 exhausted + 21 skipped), 244,102 tokens and the per-lane breakdown, against the dispatcher logs, the run
transcripts and xKiro's own `/v1/usage` response. See `.worktrees/logs/data-verify.md` for the full table.

### Formatting gate and bookkeeping state

- The `current-application` job scans every file the Pull Request changes with `pnpm format:check`. Earlier
  commits in this Pull Request left eight of them unformatted: `architecture.js`, `client.js`, `index.html`,
  `progress-view.js`, `roster-view.js`, `summary-view.js`, `test/dashboard.test.js`,
  `test/rotation-parse.test.js`. The operator accepted the format-only churn (1.223 added / 425 deleted
  lines) so the gate can go green inside this Pull Request instead of a separate one; the commit carries no
  behavior change and `node --test tools/ai-dashboard/test` stayed at 136 pass / 0 fail. CI run `35369676861`
  on `5c424d7` then reported all four workflows green, `format:check` included.
- Those eight paths sit outside the Allowed paths list above, which the earlier UI commits of this Pull
  Request had already widened beyond. The reviewer should either extend that list to the files this Pull
  Request really touches or split the presentation work out.
- The register row and the Control block still read `BACKLOG` with branch
  `feat/task-ai-47-rotation-view`, while the code lives on `feat/task-ai-47-rotation-view-094708` under
  Pull Request #105. Advancing that status is the controller/human step, so it is recorded here rather than
  changed by the author.

## Verification commands

```powershell
# Dashboard rotation tests
node --test tools/ai-dashboard/test/rotation.test.js

# Existing brain tests (regression)
node --test tools/ai-brain/test/*.test.js

# Doc validation
python docs/product-spec/scripts/validate_docs.py

# Start server for manual verification
node tools/ai-dashboard/server.js
# Then open http://127.0.0.1:3333/rotation
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
