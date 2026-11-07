# Missing regression proof fixture

## Source references

- [Baseline](docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md#baseline-statement)

## Open questions

## Unchanged behaviour

| Preserved behaviour | Regression test |
| --- | --- |
| CLI remains read-only | `ready-cli-does-not-write` |

- Existing diagnostics mask synthetic-review-canary.

## Acceptance matrix

| AC/Test ID | Scenario | Proof |
| --- | --- | --- |
| AC-READY-01 | Existing behaviour | `preserves-existing-behaviour` |
