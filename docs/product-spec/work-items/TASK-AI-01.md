# TASK-AI-01 — Establish semi-manual AI delivery workflow

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-01` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | Existing product specification and CI baseline at commit `31a75ae` |
| Assigned author | `Codex document owner` |
| Risk | `LOW` |
| Allowed paths | `AGENTS.md`, `.agents/**`, `.github/**`, `docs/product-spec/**` |
| Reviewer | `Fresh independent Codex task plus human merge owner` |
| Branch | `chore/ai-semi-manual-workflow` |
| Pull Request | Recorded after PR creation |

## Business outcome

The product owner can coordinate 9Router, Gemini and Codex without copying code or allowing agents to edit the same workspace. Low-cost models receive bounded low-risk work, Gemini owns primary implementation, Codex independently reviews every Work Item, and the human retains all material decisions and merge authority.

## Source references

- Root and product-spec `AGENTS.md` contracts.
- Product baseline and delivery queue under `docs/product-spec/docs/`.
- Existing GitHub issue, Pull Request and CI contract gates.
- Human decision: use semi-manual control with isolated DSH, Gemini and Codex worktrees.

## Preconditions and dependencies

- GitHub repository and existing product specification are available.
- Worktrees `shipde-dsh`, `shipde-gemini` and `shipde-codex` exist at the same baseline.
- Existing CI validates documentation, lint, build and E2E behavior.

## Author boundary

This is a documentation and workflow-control change. It must not change application behavior, product business rules, database schema, runtime dependencies or deployment behavior.

## In scope

- Replace the ZCode-only operating contract with explicit Claude, 9Router, Gemini, Codex and human responsibilities.
- Add deterministic routing and escalation rules.
- Add dedicated Gemini and 9Router start/fix prompts.
- Record assigned author, risk and allowed paths in every prepared Work Item.
- Rename `READY_FOR_ZCODE` to `READY_FOR_AUTHOR` in active delivery control artifacts.
- Update issue/PR templates and documentation validation.
- Separate the always-on contract gate from path-scoped application checks without changing application commands.
- Remove Ponytail as an always-on repository rule and skill.

## Out of scope

- Configuring DSH provider credentials or 9Router endpoints.
- Installing Gemini CLI or Codex CLI.
- Adding automatic orchestration.
- Implementing product features or changing production code.
- Changing existing application CI commands; this task only scopes when those commands run.

## Business rules and edge cases

- One implementation author works on one Work Item and one branch.
- 9Router is allowed only for bounded low-risk deterministic work.
- Two failed 9Router correction rounds require escalation to Gemini.
- Gemini is the default for foundation, vertical, UI, security, money, carrier-effect and cross-layer work.
- Codex review uses a fresh task and never self-approves implementation.
- Only the human may merge or accept residual risk.
- Missing or contradictory business decisions block implementation.

## UI states

Not applicable. This Work Item changes workflow documentation only.

## API, event and data impact

None. No runtime contract, event, migration or product data is changed.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-01` | Any agent opens the repository | Root and nested `AGENTS.md` describe the same semi-manual roles and source precedence | File diff and documentation validator |
| `AC-AI-02` | Human assigns a prepared item | Separate Gemini and 9Router prompts enforce branch, scope, evidence and stop conditions | Prompt files and workflow cross-references |
| `AC-AI-03` | Planning marks an item ready | Register, template and validator accept `READY_FOR_AUTHOR` consistently | CSV and validator evidence |
| `AC-AI-04` | An agent begins UI/code work | No Ponytail always-on rule or skill can override completeness or UX sources | Deleted `.agents` files and root UI rule |
| `AC-AI-05` | Pull Request opens | Contract validation runs for every PR; install, lint, build and E2E run for application-affecting paths | GitHub Actions results and workflow path filters |

## Verification commands

For this documentation-only Pull Request:

- `cd docs/product-spec && python3 scripts/validate_docs.py`
- `python3 docs/product-spec/scripts/validate_pr_contract.py --event "$GITHUB_EVENT_PATH"`

For every application-affecting Pull Request, the path-scoped workflow continues to require:

- `npm ci`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | Recorded by reviewer | Pending | Pending |

## Residual limitations

The DSH-to-9Router provider connection and GitHub branch protection remain explicit one-time local/repository settings after this documentation Pull Request. The prototype currently declares an `eslint` script without the `eslint` development dependency; `TASK-FOUND-01` must repair and prove the application baseline before product feature work.
