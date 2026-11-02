# TASK-AI-161 — Lean AGENTS.md operating card; details moved verbatim

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-161` |
| Feature ID | `N/A — documentation-only operating-card split` |
| Status | `IN_PROGRESS` |
| Delivery order | `272` |
| Dependencies | `None` |
| Assigned author | `Codex — document owner, directly assigned by the operator` |
| Risk | `LOW` |
| Allowed paths | `AGENTS.md`; `docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/work-items/TASK-AI-161.md`; `.oc/pr-body.md` |
| Local verification artifacts | Formatting only: `.oc-codex-task.md`, `.oc/pr-body-template.md`, `.oc/task.md`; pre-existing untracked files, backed up and excluded from the requested commit |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-161-lean-agents-md` |
| Pull Request | `None — local commit only; do not push` |

## Business outcome

Agents get a short, human-curated operating card with direct links to the complete contract. The operator-approved split reduces automatically loaded context while preserving every original rule verbatim; no runtime or token reduction is claimed as measured in this repository.

## Source references

- Operator approval dated 2026-11-02: card contents and approximate 120-line ceiling; verbatim relocation; unchanged rule meanings; protected-path exclusions; one Work Item/register row; ten PR sections; LF; specified checks and local commit without push.
- Operator-provided rationale: a short accurate `AGENTS.md` cut agent runtime 28.6% and output tokens 16.6% ([arXiv 2601.20404](https://arxiv.org/abs/2601.20404)); long/generated context files raised cost >20% ([arXiv 2602.11988](https://arxiv.org/abs/2602.11988)). These external figures are not local acceptance measurements.
- Root `AGENTS.md` at `c6e71fcb9354cd2b14d1f5dcaed794abff306991`: opening paragraph, all 13 level-two sections, all six Code review rules subsections, and closing hardcode rule. The [section map](../docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#section-map) names each destination.
- [Baseline and Decisions — Change control](../docs/00-control/BASELINE-AND-DECISIONS.md#change-control), [Product Vision and Scope — Boundaries](../docs/01-product/PRODUCT-VISION-SCOPE.md#boundaries), and [Master Feature Catalog](../docs/01-product/MASTER-FEATURE-CATALOG.md): no product behavior, feature scope or decision changes.
- [Work Item template — Control through Residual limitations](../docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md#control) and `.oc/pr-body-template.md` — all ten level-two sections.
- Acceptance criteria: `AC-AI-161-01` through `AC-AI-161-06`; rules `BR-CARD-01` through `BR-CARD-05` below.

## Preconditions and dependencies

- Operator approval granted on 2026-11-02.
- Worktree `p-task-ai-161` is already on `feat/task-ai-161-lean-agents-md`; starting `HEAD` and local `origin/main` both resolve to `c6e71fcb9354cd2b14d1f5dcaed794abff306991`.
- Existing uncommitted task drafts are completed in place. The committed root contract is the preservation reference; unrelated local task/template files stay outside the commit.
- No gate config, allowlist, baseline, semgrep rule or `.github/` file is a dependency of this change.

## Ambiguity and clarification markers

None. The operator instruction bounds the card contents, the verbatim move, the register row and the commit.

## Author boundary

Codex is acting as the document owner directly assigned by the operator. Only the five allowed documentation/register paths are candidates for the requested commit. The three pre-existing local verification artifacts above receive formatter-only changes so the required workspace check can run cleanly; their originals are backed up outside the repository and they are not commit candidates. Proof is exact comparison with the original Git blob, structural documentation inspection and the requested checks. No production code or architecture, authentication, authorization, tenant isolation, money, carrier effect, database ownership or product UX decision is in scope. A fresh independent task must perform review; this author supplies no review verdict.

## Slice sizing rule

One documentation Work Item, one branch and one local commit prepared for one eventual Pull Request. The complete verbatim contract relocation plus its coverage evidence exceeds the advisory ~400 changed-line target. The operator explicitly requested this single-item move; splitting the card from its complete contract would leave an incomplete handoff. No generated files are used to discount the size. API-before-UI ordering is not applicable because neither layer changes.

## In scope

- Rewrite root `AGENTS.md` to at most about 120 lines: source-of-truth order; one-Work-Item-per-branch/PR rules; exact verification commands; Definition of Done bullets; hard prohibitions; role separation in five lines; links to the detailed docs.
- Move every removed paragraph verbatim into `docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md` under the same headings, with a section map at the top.
- Create this Work Item at status `IN_PROGRESS` and exactly one register row.
- Write `.oc/pr-body.md` with the ten template sections, a rule-coverage list, and `READY_FOR_CODEX`.

## Out of scope

- Changing the meaning of any rule.
- Touching `.github/`, gate configs, allowlists, baselines or semgrep.
- Editing `docs/product-spec/AGENTS.md` or any other contract copy.
- Pushing the branch.

## Business rules and edge cases

- `BR-CARD-01`: Every former root `AGENTS.md` rule remains verbatim in the details file.
- `BR-CARD-02`: The operating card states the source order, prohibitions and all 12 verification commands without weakening them; its five role lines retain an explicit link to the existing conditional controller merge authorization.
- `BR-CARD-03`: Exactly one new register row is added; existing rows are not rewritten.
- `BR-CARD-04`: Files use LF line endings.
- `BR-CARD-05`: Preserve original heading names and wording, including historical descriptions and references. In relocated text, "this file" continues to mean root `AGENTS.md`; source-of-truth precedence still governs. A missing paragraph, changed command, duplicate row, broken section link or protected-path edit fails acceptance and must be corrected before handoff.

## Constitution check

- [x] **Tenant scope**: Preserved; no tenant logic modified.
- [x] **RBAC & permissions**: Preserved; no permissions modified.
- [x] **Audit & sensitive data**: Preserved; no secrets or tokens handled.
- [x] **VND integer arithmetic**: Preserved; no currency logic modified.
- [x] **Carrier reconciliation**: Preserved; no carrier operations modified.
- [x] **Tests at the lowest useful level, test-first where executable**: Acceptance uses `docs-inspection` and command logs. No production implementation or behavioral tests are introduced; each row explains why a new test is not applicable. Repository checks still run and their actual outcomes are recorded.

## UI states

N/A — documentation only; no user interface is modified.

## API, event and data impact

N/A — no database models, migrations, or HTTP endpoints modified.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-161-01 | Root `AGENTS.md` rewritten | At most 120 lines, only the seven permitted sections, five role bullets, all 12 exact commands, checkable DoD and complete prohibitions | docs-inspection: count lines/roles and compare commands with the original; test not applicable: documentation-only change |
| AC-AI-161-02 | Removed paragraphs moved | Every original paragraph and heading is preserved byte for byte in `AGENT-CONTRACT-DETAILS.md`; top section map covers all sections and subsections | docs-inspection: reconstruct the original blob after removing only the added mapping/preamble and wrapper headings; test not applicable: documentation-only change |
| AC-AI-161-03 | Work Item and register | All template sections exist; status stays `IN_PROGRESS`; exactly one appended row matches this Work Item, path and actual branch; all prior rows unchanged | docs-inspection: compare template headings and parse/compare CSV with the original; test not applicable: documentation-only change |
| AC-AI-161-04 | PR body | Exactly the ten template sections, a complete rule-coverage list and `- Review status: READY_FOR_CODEX`; no author-issued review verdict | docs-inspection: compare heading sequences and check every mapping target; test not applicable: documentation-only change |
| AC-AI-161-05 | No protected-path edits | Only the five allowed paths enter the commit; no `.github/`, gate config, allowlist, baseline or semgrep changes | docs-inspection: inspect staged and committed path lists; test not applicable: documentation-only change |
| AC-AI-161-06 | Verification and local handoff | LF files; actual check outcomes recorded; exact requested commit message; branch is not pushed | docs-inspection and logs: run the commands below, inspect bytes and final local commit; test not applicable: no production behavior changes |

## Task breakdown

- [x] `T01` Rewrite root `AGENTS.md` as the operating card.
- [x] `T02` Write `AGENT-CONTRACT-DETAILS.md` with the section map and verbatim former text.
- [x] `T03` Create `docs/product-spec/work-items/TASK-AI-161.md` and append one register row.
- [x] `T04` Write `.oc/pr-body.md`.
- [x] `T05` Verify preservation, template/coverage links, LF and the single register row; run the requested checks and record their exact outcomes in `.oc/pr-body.md`.
- [ ] `T06` Commit only the five allowed files with `[TASK-AI-161] Lean AGENTS.md operating card; details moved verbatim`; verify the committed diff. Blocked: both staging and commit fail because Git cannot create `.git/worktrees/p-task-ai-161/index.lock` (permission denied). No push occurred.

## Verification commands

- `pnpm format:check`
- `pnpm lint`
- `git diff --check origin/main...HEAD`
- `node scripts/ai/check-no-hardcode.mjs`
- `python docs/product-spec/scripts/validate_docs.py`

Use the Windows `pnpm.cmd` entry point for the same pnpm scripts without changing PowerShell execution policy. Formatting and lint pass after local dependency provisioning and formatter-only cleanup of the three untracked verification artifacts. The documentation validator and no-hardcode guard also pass. All five delivery files have LF endings, no BOM or trailing whitespace, and valid links. The 79-line card retains all 12 commands and five role bullets; the full 179-line original contract reconstructs byte for byte; all 21 section mappings, 18 Work Item template sections, ten PR sections and the single appended register row pass inspection.

`git diff --check` passes for the tracked working-tree changes. `git diff --check origin/main...HEAD` exits 0 but checks an empty committed diff: Git cannot stage or commit because its metadata is read-only. Once that external restriction is lifted, stage only the five delivery files, check the staged diff, create the requested commit and repeat the three-dot check against it. Checks ran in the isolated authoring checkout; a clean-install regression gate, application suites and production build are not claimed. Exact outcomes are in `.oc/pr-body.md`.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| None | Not yet independently reviewed | Pending fresh independent review | None |

## Residual limitations

The local commit is blocked by read-only Git metadata: both `git add` for the five delivery files and the exact requested `git commit -m` fail with `Unable to create '.../.git/worktrees/p-task-ai-161/index.lock': Permission denied`. Nothing is staged, committed or pushed; `HEAD` and local `origin/main` remain `c6e71fcb9354cd2b14d1f5dcaed794abff306991`. Owner: operator/session environment for restoring normal Git write access; next action: stage the five delivery files, commit with the requested message, and verify the resulting diff. No permission bypass or human acceptance is claimed.

Original historical wording is retained as requested; reconciling other contract copies or later decisions is outside this item. The documentation move exceeds the advisory size target for the reason above. Remote CI, independent review and any eventual merge remain pending because the operator requested a local commit without push. Owner: operator for any later publication; independent reviewer for a future verdict. No review approval or merge acceptance is claimed.
