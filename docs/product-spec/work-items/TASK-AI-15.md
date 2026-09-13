# TASK-AI-15 — Realtime AI delivery cockpit

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-15`                                                                                                                                                                                                                                                                                                                                                                       |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                                                                                              |
| Status          | `READY_FOR_AUTHOR`                                                                                                                                                                                                                                                                                                                                                                 |
| Delivery order  | `148`                                                                                                                                                                                                                                                                                                                                                                              |
| Dependencies    | `TASK-AI-14`, `TASK-FOUND-04`                                                                                                                                                                                                                                                                                                                                                      |
| Assigned author | `GEMINI`                                                                                                                                                                                                                                                                                                                                                                           |
| Risk            | `MEDIUM`                                                                                                                                                                                                                                                                                                                                                                           |
| Allowed paths   | `DASHBOARD.html`; `open-dashboard.bat`; `tools/ai-dashboard/**`; `scripts/ai/start-ai-dashboard.ps1`; `scripts/ai/create-docker-shortcut.ps1`; `docs/product-spec/work-items/TASK-AI-15.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; directly relevant dashboard operating documentation under `docs/product-spec/docs/10-ai-collaboration/**` |
| Reviewer        | `Codex — fresh independent task`                                                                                                                                                                                                                                                                                                                                                   |
| Branch          | `feat/task-ai-15-realtime-ai-cockpit`                                                                                                                                                                                                                                                                                                                                              |
| Pull Request    | `TBD`                                                                                                                                                                                                                                                                                                                                                                              |

## Business outcome

The product and merge owner can open one local, read-only cockpit and understand where AI delivery actually stands: the current Work Item, its dependency and delivery gates, active Agent Orchestrator sessions, branch/commit state, Pull Request/CI/review state, recent activity, and the health and freshness of every source. The cockpit must be visually legible at a glance without presenting simulated operational data as fact.

## Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — approved baseline and decision precedence.
- `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md` — product actor and outcome boundaries.
- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — delivery inventory context.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` — status flow, human gates, GitHub handoff, independent review.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` — governed local toolchain and evidence boundaries.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` — canonical local delivery queue.
- `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md` and `scripts/ai/README.md` — supported local commands and controller behavior.
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` — hierarchy, responsive, accessibility, state, and feedback rules.
- `AGENTS.md` — role separation, exact-head gates, security, evidence, and single-writer contract.

## Preconditions and dependencies

- `TASK-AI-14` is merged and defines native Claude CLI participation.
- `TASK-FOUND-04` is merged and provides authoritative root quality gates.
- Agent Orchestrator, GitHub CLI, git, or the delivery register may independently be unavailable. Partial availability is a normal operating state and must remain diagnosable.
- `FEAT-AUTH-01` remains a separate product Work Item. This cockpit may report it but must not modify, approve, merge, or claim completion for it.

## Author boundary

Gemini is required because this is cross-layer UI composition with a local aggregation service, realtime transport, source normalization, security redaction, responsive states, and deterministic tests. Claude may provide a read-only audit or bounded repair assistance, but only Gemini writes production implementation during the authoring phase. Product meaning, source authority, authentication policy, write actions, and merge policy may not be invented by the author.

## In scope

- Replace the current prototype's fabricated defaults with normalized observations from real, named sources:
  - the delivery register on disk;
  - git branches, commits, and registered worktrees;
  - Agent Orchestrator daemon/session state when reachable;
  - GitHub Pull Request, checks, review verdict, unresolved-thread, and mergeability data only when authenticated and available.
- Expose one versioned local read API plus a realtime update channel using Server-Sent Events, WebSocket, or equivalently bounded polling. Every aggregate and source observation includes `observedAt`, freshness state, provenance, and a stable unavailable/error reason.
- Bind the dashboard service to `127.0.0.1` by default. Do not expose it to the LAN without an explicit future security decision.
- Render an at-a-glance delivery narrative: truthful summary, active delivery lane, gate pipeline, agent/session roster, PR/CI/review evidence, recent activity, and source-health panel.
- Support loading, empty, live, stale, partial, unavailable, error, and recovery states without replacing missing evidence with estimates.
- Provide responsive desktop/mobile layouts, keyboard navigation, visible focus, semantic landmarks, accessible names, minimum practical touch targets, sufficient contrast, reduced-motion support, and non-color-only status cues.
- Redact secrets, credentials, tokens, private environment values, unnecessary PII, and unsafe absolute-path detail from API responses, UI, logs, fixtures, and screenshots.
- Add deterministic automated tests for data normalization, state derivation, source failures, security boundaries, realtime behavior, and key rendered states.
- Provide a documented one-command local start flow and an optional convenience launcher that reports actionable failures.

## Out of scope

- Changing product-feature code or the implementation of `FEAT-AUTH-01`.
- Logging into GitHub, changing credentials, starting paid model requests, or mutating external services from the dashboard.
- Approving, merging, cancelling, retrying, spawning, or otherwise controlling agents and Pull Requests from dashboard UI.
- Fabricated cost, quota, token, latency, heartbeat, progress, model, PR, CI, or authentication values.
- Refactoring the deterministic controller or repairing Agent Orchestrator/Claude configuration drift except where a read-only adapter must report it.
- Internet-facing hosting, multi-user access, persistence of secrets, or telemetry export.

## Business rules and edge cases

- **AI15-R01 — Evidence before status:** A status is `live` only when derived from a successful observation. Cached data is labeled `stale` with its age. Missing data is `unavailable`; it is never replaced with a plausible default.
- **AI15-R02 — Source separation:** Register state, git state, Agent Orchestrator state, and GitHub gate state remain separately attributable. Conflicts are displayed as conflicts and do not silently overwrite the canonical register.
- **AI15-R03 — Gate integrity:** `READY_FOR_HUMAN_MERGE`, `PASS`, green CI, or mergeability is shown only from the authoritative exact-HEAD evidence defined by the workflow. The cockpit never performs the gate transition.
- **AI15-R04 — Single writer:** Agent/session displays distinguish orchestrator, read-only analyst/reviewer, and implementation author; activity alone must not imply authorization to write.
- **AI15-R05 — Safe local service:** Default bind is loopback, request methods are read-only, static file resolution prevents traversal, response content types are explicit, and errors do not leak command lines, environment variables, credentials, or sensitive paths.
- **AI15-R06 — Bounded collection:** Slow or absent commands use timeouts, cancellation, and retry backoff. One failing source does not blank healthy sources or create an unbounded process/event-listener leak.
- **AI15-R07 — Deterministic progress:** Completion is derived from register counts. Per-agent progress appears only if a real source supplies a defined measurement; otherwise the UI uses phase/state wording.
- **AI15-R08 — Honest recovery:** When GitHub is unauthenticated, AO is stopped, the register is malformed, a worktree disappears, or the stream reconnects, the affected panel explains impact and offers a safe diagnostic/retry path.
- **AI15-R09 — No hidden mutation:** Dashboard endpoints and controls are observational. Any future operational action requires a separate approved Work Item, authorization model, audit trail, and confirmation design.

## UI states

- **Loading:** stable skeleton structure with text announcing that sources are being checked; no fake numbers.
- **Empty:** zero tasks/sessions/activity is explicitly valid and names the checked source.
- **Live:** a clear timestamp and freshness indicator accompany the overall state; activity updates without full-page flicker.
- **Partial:** healthy panels remain useful while a prominent source-health summary identifies degraded sources and their impact.
- **Stale:** last known values remain visible only with age and stale labeling; stale gate evidence cannot appear merge-ready.
- **Unavailable/error:** actionable, source-specific message; technical detail is safe and expandable; retry does not create duplicate streams.
- **Conflict:** contradictory register, git, AO, or GitHub observations are shown side by side with provenance.
- **Recovery:** a recovered source visibly returns to live and activity records the transition without a false success toast.
- **Responsive/accessibility:** primary Work Item and next gate remain first on narrow screens; tables become labeled rows rather than horizontal traps; animation honors `prefers-reduced-motion`.

## API, event and data impact

- No database migration, product API, carrier action, or tenant-owned record is introduced.
- Define and document a versioned dashboard payload with `schemaVersion`, aggregate `observedAt`, source-health records, normalized Work Items/gates, sessions, git observations, and sanitized activity records.
- Realtime messages carry an event identifier or monotonic revision so reconnection and duplicate suppression are deterministic. Heartbeat frames contain no fabricated business state.
- Command adapters use fixed executable/argument construction, bounded output, explicit timeouts, and allowlisted parsing. Client input must never be interpolated into shell commands.
- GitHub state is queried only through an existing authenticated local CLI context. Authentication absence is a first-class unavailable state, not an invitation to launch login.
- Compatibility: existing convenience entry files may remain, but they must resolve to the truthful service and fail clearly if prerequisites are missing.

## Acceptance matrix

| AC/Test ID  | Scenario                                                       | Expected result                                                                                                                                       | Evidence required                                               |
| ----------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `AI15-AC01` | Given the repository register, when the dashboard loads        | Totals and current queue state exactly match parsed register rows; no server overlay invents a task or PR                                             | parser/API tests plus screenshot with fixture and live register |
| `AI15-AC02` | Given AO is reachable, stopped, or returns malformed output    | Sessions appear with role/state/freshness when valid; otherwise only AO is marked unavailable and other panels remain live                            | adapter tests and screenshots of live/partial states            |
| `AI15-AC03` | Given GitHub CLI is authenticated or unauthenticated           | Exact-HEAD PR/check/review data is displayed only when verified; unauthenticated state shows no default PR or green gate                              | adapter tests and screenshots of verified/unavailable states    |
| `AI15-AC04` | Given source data changes after initial load                   | The page updates within the documented refresh window, preserves focus/scroll, and shows the new observation time without full reload                 | realtime integration test and short captured evidence/log       |
| `AI15-AC05` | Given a source exceeds freshness or timeout thresholds         | Last observation is labeled stale or unavailable with source, age, impact, and retry/recovery status                                                  | clock-controlled tests and stale/partial screenshot             |
| `AI15-AC06` | Given conflicting register/git/AO/GitHub states                | The UI exposes the conflict and provenance without silently promoting a workflow state                                                                | state-derivation test and conflict screenshot                   |
| `AI15-AC07` | Given requests from the local machine                          | Service binds to `127.0.0.1`; endpoints are read-only; traversal, unsafe methods, oversized output, and secret-shaped fields are rejected or redacted | security tests and bound-address evidence                       |
| `AI15-AC08` | Given keyboard, narrow viewport, high zoom, or reduced motion  | Primary status remains usable; focus is visible; controls are named/reachable; motion is reduced; status is not color-only                            | accessibility assertions and desktop/mobile screenshots         |
| `AI15-AC09` | Given no active task, no sessions, or no recent activity       | Each panel shows a truthful empty state rather than sample records                                                                                    | component/integration tests and empty-state screenshot          |
| `AI15-AC10` | Given service or stream interruption then recovery             | Client reconnects with bounded backoff, does not duplicate events/listeners, and announces restored freshness                                         | deterministic reconnect test and runtime evidence               |
| `AI15-AC11` | Given repository checks run from a clean checkout              | Dashboard tests and all affected root gates pass with no hidden TODO or generated artifact drift                                                      | exact command logs in Pull Request                              |
| `AI15-AC12` | Given an independent fresh Codex review of the authored commit | Reviewer verifies the full Work Item, source truth, screenshots, and security/realtime evidence and returns a recorded verdict                        | exact commit SHA and Codex review comment                       |

## Verification commands

The author must add a deterministic dashboard test command if one is not already exposed, then run from a clean checkout:

```text
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:baseline
pnpm security:secrets
pnpm build
```

Also record:

- the exact dashboard-specific test command and result;
- the listening address proving loopback-only binding;
- live and degraded source snapshots with observation timestamps;
- desktop and mobile screenshots for live, partial/unavailable, stale/conflict, and empty states;
- the exact authored commit and exact commit reviewed by Codex.

## Codex review record

| Review round | Commit                                     | Verdict            | Findings resolved                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1            | `d31a595bec13c40123f866c654b794a65ae25fa3` | `CHANGES_REQUIRED` | Resolved all 8 findings: exact-HEAD gate non-success checks, SHA review tie, unresolved threads, AO Claude repair writer, DSH constraints, PowerShell script root path, freshness-based overall status, stale caching, SSE deduping, responsive tables |

## Residual limitations

None. Any source that cannot be made authoritative in this Work Item must be represented as unavailable, with the limitation and owner recorded in the Pull Request rather than hidden behind mock data.
