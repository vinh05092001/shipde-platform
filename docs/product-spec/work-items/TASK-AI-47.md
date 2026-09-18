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
| Allowed paths | `docs/product-spec/work-items/TASK-AI-47.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-dashboard/rotation.js`, `tools/ai-dashboard/rotation.html`, `tools/ai-dashboard/server.js`, `tools/ai-dashboard/test/rotation.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-47-rotation-view` |
| Pull Request | |

## Business outcome

An operator can see, at a glance, which access sources are currently serving runs through the local dispatcher, what model each is using, how many tokens the active run has consumed so far, and whether any source is on cooldown or out of quota — without reading raw log files or JSON ledgers by hand.

Prior to this Work Item, the AI dashboard (`tools/ai-dashboard`) aggregated work-item state, git health, AO sessions, GitHub CI evidence, usage, and capacity, but had no visual representation of the live dispatch topology. The operator could not tell which source was actively routing, which model was in flight, or why a source had gone silent, without opening `.worktrees/logs/*.log`, `~/.shipde/quota.observations.json`, and `~/.shipde/agy-quota.json` separately.

This Work Item adds a radial "model rotation" view, modelled on 9Router's usage page, served as a new route from the existing dashboard server on port 3333. The hub represents the local dispatcher (9Router / dispatch lanes). Around it, one node per configured access source shows declared limits, measured consumption, remaining headroom, recent run outcomes, and live animated arrows when a run is in progress.

### Data integrity rule

All numbers come from real measurements already on disk. Where a value cannot be measured, the view renders `UNKNOWN` — never zero, never a placeholder, never an invented default. This follows the same principle as `tools/ai-brain/limits.js`: an unattributed figure cannot be checked or withdrawn.

## Requirements

### AI-47-R01: Radial layout

The view is a radial diagram rendered as SVG inside a standalone HTML page at `/rotation`. The hub sits at the centre. Each configured access source occupies a node arranged around the hub. Sources: 9Router, xKiro, agy (local), agy (docker), Cline, AutoClaw, AO. Only sources that are actually configured (present in logs, quota store, or limits) appear; unconfigured sources are omitted rather than shown as empty.

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
