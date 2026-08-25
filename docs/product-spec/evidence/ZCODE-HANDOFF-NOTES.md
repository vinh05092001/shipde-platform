# TASK-FOUND-01 — ZCode-to-Gemini handoff notes

## Purpose

This checkpoint preserves the inventory draft supplied by ZCode after its token limit was reached. It is an implementation handoff, not a completion or review verdict. Gemini must continue on the same branch and satisfy the complete Work Item before opening the Pull Request.

## Integrity findings in the supplied draft

- Declared analysis base: `31a75ae4a62f0256f71670c8b2af70b456abddec`.
- Expected feature coverage: 130 catalog IDs, exactly once each.
- Supplied draft: 116 unique IDs and 150 total ID occurrences.
- Sections 8–10 are duplicated after the first `FEAT-CAS-02` row.
- The document ends in an incomplete `FEAT-CLM-02` row.
- The following 14 feature IDs do not occur at all:
  - `FEAT-ADM-01`
  - `FEAT-ADM-02`
  - `FEAT-ADM-03`
  - `FEAT-BIL-01`
  - `FEAT-BIL-02`
  - `FEAT-CLM-03`
  - `FEAT-CLM-04`
  - `FEAT-DASH-01`
  - `FEAT-DASH-02`
  - `FEAT-DASH-03`
  - `FEAT-DASH-04`
  - `FEAT-REP-01`
  - `FEAT-SEC-01`
  - `FEAT-SEC-02`
- Markdown table headers are malformed and must be normalized.
- No command result, duration, repository-area/file-count inventory, or automated 130-ID coverage result is included.

## Required continuation

Gemini must:

1. Verify every retained classification and path/line citation against the base commit.
2. Remove duplicate/corrupt rows and produce exactly one complete row for each of all 130 catalog IDs.
3. Complete every implemented-layer and missing-layer field required by the Work Item.
4. Add the repository-area inventory and file counts required by `AC-FOUND-01-02`.
5. Create `docs/product-spec/evidence/PROTOTYPE-GAPS-AND-RISKS.md`.
6. Add the smallest reliable preservation smoke-test harness required by `AC-FOUND-01-05`.
7. Run every command listed in `TASK-FOUND-01.md` and record exact results, durations and failure evidence.
8. Keep the Work Item and delivery register at `IN_PROGRESS` until all acceptance criteria are met.
9. When complete, change the status to `READY_FOR_CODEX`, push, open one Pull Request to `main`, and stop for an independent Codex review.

Do not classify a feature as REAL from UI presence, in-memory state, mock arrays, generated references or simulated external behavior.
