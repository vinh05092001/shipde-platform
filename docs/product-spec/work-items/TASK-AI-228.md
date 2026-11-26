# TASK-AI-228 — Align the AI delivery register with verified merges

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-228` |
| Feature ID | N/A |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | 350 |
| Dependencies | `TASK-AI-227` merged in #647 |
| Base | `aad5862b7798bc6d23dfd34a4c564538638f8051` |
| Assigned author | `GEMINI` |
| Risk | LOW. Documentation and register metadata only. |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/work-items/TASK-AI-228.md` |
| Reviewer | Independent reviewer on a different model |
| Branch | `feat/task-ai-228-reconcile-delivery-register` |

## Business outcome

Operators see which AI Work Items have actually shipped. Keep the historical records and avoid rerouting work when the register has fallen behind GitHub.

## Scope

- Audit these 50 candidates against the frozen base: TASK-AI-154, 155, 159, 161, 162, 163, 166, 171, 180, 182, 185, 186–217 and 221–227. Reuse the existing register parser and read-only reconciliation evidence where practical. Treat commit subjects as leads. Confirm the PR belongs to the Work Item and actually delivered it, is merged to main, and has an exact merge SHA in the base ancestry. For an ID with multiple PRs, explain which integration completes this item and why. Keep ambiguous or unverifiable rows unchanged and report them explicitly.
- Update only status to MERGED and the PR and merge_commit fields of verified rows. Preserve an existing verdict and other fields. Fill a blank verdict only with durable independent review evidence tied to the shipped head. Leave older already-MERGED rows unchanged except for the duplicate listed below.
- Remove duplicate delivery row 299 for TASK-AI-167 after confirming that its other fields match row 293 and PR #503. Preserve row 293 and the Work Item file.
- Keep delivery row 167 for TASK-AI-34 as SUPERSEDED. Clear its dead work_item_path after confirming the file is absent and TASK-AI-35 through TASK-AI-38 are merged. Preserve the successor explanation.
- No changes to product Work Items, historical evidence files, source code, scripts, gates or dependencies. No filesystem cleanup in this Work Item.

## Acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Each of the 50 candidates has one reported outcome, either reconciled with verified evidence or unchanged with a reason. | In the PR body or this WI, list WI ID, PR, full merge SHA and outcome; justify overlaps or ambiguous matches. |
| AC2 | The duplicate row is gone, the surviving TASK-AI-167 row is unchanged, and TASK-AI-34 remains SUPERSEDED with no dead file link. | Compare parsed CSV rows against the base and verify the successor rows. |
| AC3 | Scope is limited to the two allowed files. Other rows, columns and historical WI files are preserved. CSV quoting and ordering remain valid. | Parse before and after, check the allowlisted changes by delivery_order and verify preservation of other records. |

## Verification

- `python docs/product-spec/scripts/validate_docs.py`
- `git diff --check`
- `node scripts/ai/check-no-hardcode.mjs`

This is a data reconciliation, so application tests are not applicable. Report the read-only evidence checks and any unresolved row alongside the exact head. Stop after the register changes and send the head for independent review.

## Reconciliation evidence (base `aad5862b7798bc6d23dfd34a4c564538638f8051`)

- **Duplicate removal (AC2):** Confirmed `TASK-AI-167` delivery rows `293` and `299` matched on every non-order field (`status=MERGED`, `pr=503`, `work_item_path=docs/product-spec/work-items/TASK-AI-167.md`). Removed row `299`; preserved row `293` and the Work Item file.
- **Dead path cleanup (AC2):** Confirmed `docs/product-spec/work-items/TASK-AI-34.md` is absent and successors `TASK-AI-35` through `TASK-AI-38` are all `MERGED`. Preserved `TASK-AI-34` row `167` as `SUPERSEDED` with its successor explanation and cleared `work_item_path`.
- **Verdict preservation:** Existing `codex_verdict` values were preserved verbatim; blank verdicts on reconciled rows were left blank rather than invented.

| Work Item ID | PR | Full merge SHA | Outcome | Notes |
| --- | --- | --- | --- | --- |
| `TASK-AI-154` | #491 | `1b7a969df3bcb8563f42752f2d77a4809bf9d93c` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-155` | #493 | `1423479c581d9a7216fbd6a4b62d9afc14429f18` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-159` | #498 | `5d989fb616888ecde0fb5c4949eec9712e2c7e7a` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-161` | #495 | `052e81e3c76aae9f9d714203bed2a3982a60f8c5` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-162` | #499 | `604fe6a7466901471b1ba9d902f943b87a0cedee` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-163` | #502 | `7c328ba76493b884a56465deb38b54d52bdd92ce` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-166` | #512 | `89c0c673e7526fa2f84898780c30cb855b0cfceb` | `RECONCILED_MERGED` | Two PRs (#497 initial catalogue refresh, #512 completing per-source partial refresh); recorded completing PR #512 |
| `TASK-AI-171` | #605 | `b33782abfccad618a161fa7d89047175acb7a2d9` | `RECONCILED_MERGED` | 66 sequential PRs (#509..#605); recorded final completing consolidation PR #605 |
| `TASK-AI-180` | #519 | `710fdd5aa61e0dc71e573dda9a2a4108efaf0d8b` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-182` | #606 | `0e962a3cf689787ba4c84af41a9ece18f472e909` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-185` | #607 | `9e0420477da27d26ad9b044baf2fb85b4daab20f` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-186` | #608 | `bea1ac5ee22892b6cbe53881504bcf0e200881c4` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-187` | #620 | `d37aed703273e4e4f2f5fde8f1286b3dd97dd41c` | `RECONCILED_MERGED` | Two PRs (#609 docs-only planning, #620 actual CLI + F2 implementation); recorded implementation PR #620 |
| `TASK-AI-188` | #610 | `0cea11730be4342f312dfc8e78e6530a9df9d416` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-189` | #611 | `6c7850aefddcc80c2d84fcda7d707bb676dbbd2d` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-190` | #612 | `8c8cd3ea27f9fdd35d6bfb30894d5509643a3c95` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-191` | #613 | `238ef1750afb6c4e06bccb65b8cc7d7a864414fd` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-192` | #614 | `cbe14420ff653ff03ccb2d7ce0ce188de99f35f0` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-193` | #615 | `3586341dbf79af950a88eafd1d31bebf3d6bf2a1` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-194` | #616 | `335017c36e27e4ffd8595c15167c3634fe8364d8` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-195` | #617 | `d04798d75c35b93b05be89e2dde8de954743f46e` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-196` | #618 | `87a0836bd7023089a9e2aef43823409fe2a8b004` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-197` | #619 | `86bac4b11f1b55e69f2b737551291ad6a5a70c97` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-198` | #621 | `ef37995ec239a4737a2a89992bd2369d8fb01e2a` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-199` | #624 | `484bcaef259b46b75bcc963b8d5274df3df08a87` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-200` | #626 | `0debbcd9da5e4cb993b4f2d384af9360c785cdc2` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-201` | #627 | `c5efb86923abf78250942c03cd1b950f571a8754` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-202` | #622 | `0e9c3e2dcc61a8c67dc5ca1de579709c70e41407` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-203` | #623 | `71f4b952dbcbe503328efa10350dab78332d8f19` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-204` | #625 | `4e31d78a927a3d2d0b40a97040701bf91ab9cccc` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-205` | #628 | `a85d2e8040423c16b50bcbaa71a5f157ab8de810` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-206` | #629 | `42c087890b41a53ac85ddc1d594680ff6c161c22` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-207` | #630 | `789d16601c5570e6689e0ecbb1d8394a67289293` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-208` | #631 | `db8be31138017b94083ad2f18698ab404572b975` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-209` | #632 | `32198f3797b2dadcc78e483f74e524535ce67b7f` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-210` | #633 | `6d829552e249c9b9a8f50db8ef62995fb0e3a35c` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-211` | #640 | `663264c78f9e6d6403a067262743b8c3ddfebda3` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-212` | #634 | `f1061baf739ce579e06a4459eb562072659ec148` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-213` | #635 | `53c291fb5736d4ee83f0260971282de216d707da` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-214` | #636 | `4fe60b4a37020a1467977fecee40e3d06eac2ff3` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-215` | #637 | `ac61e79633d24e2482d658ce9573cc8c0f51ce36` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-216` | #638 | `5a60c79df57ae4969880da0d322e06e247bf4953` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-217` | #639 | `7f9bc9256f88e3c15984c901eb320889b8c48ffb` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-221` | #641 | `d7fb0cf497d4b46cc7c1a5241bd03d9ae2b82cdf` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-222` | #642 | `158e5048477e861b044b21c49d122b7980d04e8c` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-223` | #643 | `dd15cf84d794b54b2756d4ef8cfd1fbfafd64eb2` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-224` | #644 | `e9b45ed4d66dc3b86594d101650f709ca746a6c8` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-225` | #645 | `9e0a62a8ddb0aa7643d82be87e7b99b9b734c60a` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-226` | #646 | `886cbe297ffa7ce5456d126309a4d26a53a1178f` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
| `TASK-AI-227` | #647 | `7a6de8760b1bfe969433fd1c2efbb938126a1d78` | `RECONCILED_MERGED` | Single PR-tagged squash merge in base ancestry |
