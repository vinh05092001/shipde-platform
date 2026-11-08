# TASK-AI-171 register reconciliation ? 2026-11-08

## Outcome

Updated 24 register rows to `MERGED`; retained 4 ambiguous rows unchanged. No other register columns except `status` and `pr` were changed. Duplicate TASK-AI-167 rows remain separate and both reference the same merged PR.

## Evidence and method

Offline source: `.oc/prs-all.json`, supplied as the complete PR snapshot (539 PRs). No network requests or credential reads were made. Results describe this snapshot, not live GitHub state.

Snapshot SHA-256: `08338976615a5b951833ab18e8ab19c107384c15d1949807db3f6765f37ea394`.

Checked all 280 register rows using exact Work Item ID boundaries in PR titles and branch names (avoiding numeric-prefix collisions). Merge evidence requires both `state=MERGED` and a nonempty `mergedAt`. Planning-only and explicitly partial PRs do not establish whole-feature completion. Where merged follow-up PRs exist, the PR column points to the primary implementation PR and the table records the follow-ups.

All existing MERGED rows have matching PR evidence, and their recorded PR numbers resolve to merged PRs in the snapshot. No MERGED or READY* row lacks a matching PR. Absence of a PR alone would not determine a replacement status, particularly for READY_FOR_AUTHOR.

## Changed rows

| Delivery order | ID | Old status | New status | PR | Additional merged PRs |
| --- | --- | --- | --- | --- | --- |
| 16 | FEAT-ORG-02 | READY_FOR_CODEX | MERGED | #461 | #474 |
| 17 | FEAT-WH-01 | READY_FOR_CODEX | MERGED | #462 | None |
| 18 | FEAT-ONB-01 | READY_FOR_CODEX | MERGED | #466 | None |
| 20 | FEAT-COM-01 | READY_FOR_CODEX | MERGED | #464 | #473 |
| 264 | TASK-AI-148 | READY_FOR_CODEX | MERGED | #463 | None |
| 265 | TASK-AI-144 | IN_PROGRESS | MERGED | #460 | None |
| 266 | TASK-AI-147 | IN_PROGRESS | MERGED | #465 | #511, #510 |
| 267 | TASK-AI-146 | IN_PROGRESS | MERGED | #472 | None |
| 268 | TASK-AI-151 | READY_FOR_CODEX | MERGED | #475 | None |
| 269 | TASK-AI-156 | IN_PROGRESS | MERGED | #488 | None |
| 270 | TASK-AI-157 | READY_FOR_CODEX | MERGED | #489 | None |
| 271 | TASK-AI-153 | IN_PROGRESS | MERGED | #492 | None |
| 296 | TASK-AI-163 | IN_PROGRESS | MERGED | #502 | None |
| 273 | TASK-AI-162 | IN_PROGRESS | MERGED | #499 | None |
| 291 | TASK-AI-159 | IN_PROGRESS | MERGED | #498 | None |
| 272 | TASK-AI-161 | IN_PROGRESS | MERGED | #495 | None |
| 304 | TASK-AI-154 | IN_PROGRESS | MERGED | #491 | None |
| 294 | TASK-AI-155 | IN_PROGRESS | MERGED | #493 | None |
| 298 | TASK-AI-166 | IN_PROGRESS | MERGED | #497 | #512 |
| 293 | TASK-AI-167 | READY_FOR_CODEX | MERGED | #503 | None |
| 299 | TASK-AI-167 | READY_FOR_CODEX | MERGED | #503 | None |
| 292 | TASK-AI-165 | IN_PROGRESS | MERGED | #501 | None |
| 301 | TASK-AI-168 | READY_FOR_CODEX | MERGED | #506 | None |
| 303 | TASK-AI-170 | READY_FOR_CODEX | MERGED | #507 | None |

## Ambiguous rows retained unchanged

| Delivery order | ID | Retained status | Reason |
| --- | --- | --- | --- |
| 28 | FEAT-COM-09 | READY_FOR_AUTHOR | Only planning approval PR #484 is merged; it does not establish implementation completion. |
| 29 | FEAT-SUP-01 | READY_FOR_AUTHOR | Only planning approval PR #487 is merged; it does not establish implementation completion. |
| 30 | FEAT-CAR-01 | IN_PROGRESS | PR #485 approves planning; #490 explicitly delivers Slice A (API) only. Full feature completion is not established. |
| 300 | TASK-AI-171 | READY_FOR_CODEX | Mixed merged, closed and open routing-core PRs; open #514, #517, #538 and #539 prevent an unambiguous whole-item completion inference. The assigned reconciliation also reuses the ID of the existing routing-core Work Item; that Work Item is unchanged. |

## Validation

`docs/product-spec/scripts/validate_spec.py` does not exist in this checkout; the requested conditional validator could not be run.

Parsed the original and updated CSV: same header, 280 rows in the same order, exactly 24 status changes and 22 PR-cell changes; every other cell is identical. Each changed row has exact-ID merged evidence. `git diff --check` passed. No application code changed.
