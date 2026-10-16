# GOAL-AUTOCLAW-REPOS-1 — Nhóm 10 - Hợp đồng bằng chứng "đã gắn" và manifest phản ánh sự thật

## Control

| Field | Value |
|---|---|
| Work Item ID | `GOAL-AUTOCLAW-REPOS-1` |
| Feature ID | `GOAL-AUTOCLAW-REPOS` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | `253` |
| Dependencies | `None` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-EVIDENCE.md`, `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md`, `tools/ai-brain/data/tool-manifest.json`, `tools/ai-brain/test/tool-manifest-truth.test.js`, `tools/ai-brain/test/repo-integration-evidence.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/goal-autoclaw-repos-1-impl` |
| Pull Request | `Pending` |

## Business outcome

> tool-manifest.json không còn installed UNKNOWN và mọi mục có evidenceRef thật; thêm hợp đồng bằng chứng 5 trạng thái dùng chung cho mọi Work Item gắn repo.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-APPENDIX-20261013.md`
- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-EVIDENCE.md`
- `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md`

## Preconditions and dependencies

- Preconditions: None.

## Author boundary

- Author: GEMINI. Follow AGENTS.md operating contract.
- Allowed paths: `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-EVIDENCE.md`, `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md`, `tools/ai-brain/data/tool-manifest.json`, `tools/ai-brain/test/tool-manifest-truth.test.js`, `tools/ai-brain/test/repo-integration-evidence.test.js`.
- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.

## In scope

- Nhóm 10 - Hợp đồng bằng chứng "đã gắn" và manifest phản ánh sự thật.
- Unit and integration verification commands matching acceptance criteria.

## Out of scope

- Modifying unallowed paths or inventing business rules.

## Business rules and edge cases

- Strict adherence to repository baseline and source specifications.

## UI states

- Full state coverage where UI is affected; N/A for pure backend.

## API, event and data impact

- Safe contract and schema handling within allowed paths.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-1 | Mọi mục tool-manifest.json có installed là true hoặc false (không còn UNKNOWN) và evidenceRef trỏ tới file có thật trong repo. | Passes automated verification | Automated check passes |
| AC-2 | Mục gate true (gitleaks, agent-scan) có command hoặc bị đánh dấu chặn kèm lý do. | Passes automated verification | Automated check passes |
| AC-3 | REPO-INTEGRATION-EVIDENCE.md định nghĩa 5 trạng thái DECLARED/INSTALLED/WIRED/EXECUTION_VERIFIED/ACCEPTED và trường bắt buộc cho mỗi Work Item. | Passes automated verification | Automated check passes |
| AC-4 | Không cài thêm công cụ nào; chỉ đọc và ghi bằng chứng. | Passes automated verification | Automated check passes |
| AC-5 | Test passes: tools/ai-brain/test/tool-manifest-truth.test.js | Passes automated verification | Automated check passes |
| AC-6 | Test passes: tools/ai-brain/test/repo-integration-evidence.test.js | Passes automated verification | Automated check passes |

## Verification commands

- `node --test tools/ai-brain/test/tool-manifest-truth.test.js tools/ai-brain/test/repo-integration-evidence.test.js`

## Implementation evidence

Author: Hermes (host-authenticated session, direct author — experiment routing, no Controller dispatch).

Files changed:

| File | Change |
|---|---|
| `tools/ai-brain/data/tool-manifest.json` | 33 entries moved off `installed: "UNKNOWN"` to boolean `true`/`false`; every entry now carries a real `evidenceRef`; `agent-scan` keeps `command: null` and gains `blocked: true` plus `blockedReason` (its `note` is retained). |
| `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-EVIDENCE.md` | New. Defines the five states `DECLARED / INSTALLED / WIRED / EXECUTION_VERIFIED / ACCEPTED`, the forward-only transition rules, the mandatory per-Work-Item evidence fields, and the baseline state of the current manifest. |
| `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md` | Points the inventory at the five-state contract and records that `tool-manifest.json` carries a boolean `installed` plus a real `evidenceRef`; adds readiness item 7. |
| `tools/ai-brain/test/tool-manifest-truth.test.js` | New. AC-1/AC-2/AC-4 truth checks that re-read the repository's real files. |
| `tools/ai-brain/test/repo-integration-evidence.test.js` | New. AC-3 contract checks plus `validateEvidenceRecord()` negative cases. |

Commands run and exact results:

- `node --test tools/ai-brain/test/tool-manifest-truth.test.js tools/ai-brain/test/repo-integration-evidence.test.js` → `tests 16, pass 16, fail 0` (see AC-5/AC-6).
- `node --test tools/ai-brain/test/task-ai-109-tools.test.js tools/ai-brain/test/task-ai-129.test.js` → `tests 27, pass 27, fail 0` (no regression on the pre-existing manifest schema and tool-gate tests; `agent-scan` still has `command: null` and a non-empty `note`).

Determination of `installed` (AC-4 — read-only, nothing installed):

- Project dependencies were proven by re-reading the cited file. Verified true: `eslint`, `lefthook`, `openapi-typescript`, `prettier`, `prisma`, `turbo` (`package.json:devDependencies`); `gitleaks` (`package.json:scripts.security:secrets`); `node` (`package.json:engines`); `pnpm` (`package.json:packageManager`); `supertest` (`apps/api/package.json:devDependencies`); `nestjs`, `opentelemetry-js` (`apps/api/package.json:dependencies`); `msw` (`packages/testkit/package.json:dependencies`).
- Everything else is `installed: false` (= `DECLARED`) with `evidenceRef` to `REPOSITORY-CLI-MANIFEST.md`. Machine-wide CLIs (git, gh, docker, 9router, dsh, codex, claude, gemini/agy, trivy, syft, ast-grep, promptfoo) are installed by `scripts/ai/install-clis.ps1` on operator machines, not by this repository, so this repository cannot point at a file that proves them and they stay `DECLARED` until their Foundation Work Item pins or wraps them.

Acceptance results:

| AC | Result |
|---|---|
| AC-1 | Pass — 0 entries report `installed: "UNKNOWN"`; every `evidenceRef` resolves to an existing file; every `installed: true` claim is re-read from its cited `package.json`. |
| AC-2 | Pass — `gitleaks` has `command: "security:secrets"` (script exists); `agent-scan` is `blocked: true` with a non-empty `blockedReason` and `command: null`. |
| AC-3 | Pass — the contract defines the five states, the ladder, and the mandatory fields; `validateEvidenceRecord()` rejects each broken record. |
| AC-4 | Pass — no tool installed, no auth/credential file read; the manifest and tests only read repository files. |
| AC-5 | Pass — `tool-manifest-truth.test.js`. |
| AC-6 | Pass — `repo-integration-evidence.test.js`. |

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `Pending` | `Pending` |

## Residual limitations

- The source named in "Source references", `REPO-INTEGRATION-APPENDIX-20261013.md`, does not exist anywhere in this repository; the contract was implemented from the Work Item's acceptance matrix and the existing manifest schema. Recorded here as a source-reference conflict, not silently chosen.
- `installed` in `tool-manifest.json` means "this repository can prove the tool is present" (pinned dependency, engine, package-manager pin or checked-in script). A CLI that merely exists on an operator's machine is `DECLARED`, not `INSTALLED`; that distinction is stated in `REPO-INTEGRATION-EVIDENCE.md`.
