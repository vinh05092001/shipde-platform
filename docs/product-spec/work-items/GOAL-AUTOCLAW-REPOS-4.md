# GOAL-AUTOCLAW-REPOS-4 — Nhóm 3 - Code và context

## Control

| Field | Value |
|---|---|
| Work Item ID | `GOAL-AUTOCLAW-REPOS-4` |
| Feature ID | `GOAL-AUTOCLAW-REPOS` |
| Status | `BACKLOG` |
| Delivery order | `256` |
| Dependencies | `GOAL-AUTOCLAW-REPOS-1` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-3-CODE-CONTEXT.md`, `tools/ai-brain/test/repo-integration-group-3.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/goal-autoclaw-repos-4-impl` |
| Pull Request | `Pending` |

## Business outcome

> Ghi và kiểm bằng chứng gắn nhóm 3 (code và context), chỉ pack context theo phạm vi và token budget.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-APPENDIX-20261013.md`
- `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-3-CODE-CONTEXT.md`

## Preconditions and dependencies

- Preconditions: GOAL-AUTOCLAW-REPOS-1.

## Author boundary

- Author: GEMINI. Follow AGENTS.md operating contract.
- Allowed paths: `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-3-CODE-CONTEXT.md`, `tools/ai-brain/test/repo-integration-group-3.test.js`.
- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.

## In scope

- Nhóm 3 - Code và context.
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
| AC-1 | Repo/package + version/ref: oraios/serena, ast-grep/ast-grep, yamadashy/repomix@0.3.3, upstash/context7 (ctx7@0.5.9), rtk-ai/rtk. | Passes automated verification | Automated check passes |
| AC-2 | Năng lực: symbol/references/callers và semantic editing; structural search và codemod; pack context có phạm vi; docs lookup library/version; giảm output lệnh. | Passes automated verification | Automated check passes |
| AC-3 | Trigger: task cần symbol, transform cấu trúc, context theo files, API chưa chắc chắn, output lệnh lớn. | Passes automated verification | Automated check passes |
| AC-4 | Adapter/caller tái dùng (không tạo trùng): tools/ai-brain/serena.js, terminal-output adapter theo policy hiện có. | Passes automated verification | Automated check passes |
| AC-5 | Hợp đồng vào/ra: query symbol -> references/callers; pattern -> preview diff trước khi áp dụng; files/dependencies + token budget -> context pack; không pack toàn repo mặc định. | Passes automated verification | Automated check passes |
| AC-6 | Task chạy thực + artifact: search/transform có preview, docs lookup giữ citations, terminal raw fallback. | Passes automated verification | Automated check passes |
| AC-7 | Trạng thái: DECLARED; chỉ lên WIRED/EXECUTION_VERIFIED/ACCEPTED khi có test và SHA; limitation: không lọc bằng chứng hoặc debug log nhạy với mất thông tin. | Passes automated verification | Automated check passes |
| AC-8 | Test passes: tools/ai-brain/test/repo-integration-group-3.test.js | Passes automated verification | Automated check passes |

## Verification commands

- `node --test tools/ai-brain/test/repo-integration-group-3.test.js`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `Pending` | `Pending` |

## Residual limitations

None.

### 2026-10-20 — ast-grep/ast-grep: EXECUTION_VERIFIED

- **Repo/ref:** `@ast-grep/cli` `0.51.0`, a root devDependency. Its postinstall, which only links the prebuilt platform binary, is allowed in `pnpm-workspace.yaml`. ast-grep moves from candidates (WATCH) to adopted.
- **Capability:**
  - Structural search and codemod. Agents preview with `ast-grep run -p <pattern> --rewrite <fix>` and apply with `-U` only after the diff is reviewed, as documented in `sgconfig.yml`.
  - Blocking structural rules in `tools/ast-grep/rules`. The first rule, `no-empty-catch`, flags a catch that swallows a failure silently.
- **Trigger:** `pnpm lint:ast` (rule tests, then scan of `apps` and `packages`); CI step after `pnpm lint` in `current-application.yml`.
- **Real run:**
  - Live pattern searches over `apps` and `packages`: `$X as any` finds 43 matches and `console.log($$$)` finds 295.
  - The first scan with `no-empty-catch` found 3 silent catches in `apps/web/src/tests/regression-audit.test.ts` (lines 781, 1103 and 1301). All three ignore errors deliberately, so each now records why in a comment.
  - After that the scan exits 0. A planted empty catch in `apps/api/src` makes it exit 1; the probe was removed.
- **Tests:** `ast-grep test` passes 1/1, with valid and invalid cases including a commented catch. The manifest audit (alias `@ast-grep/cli` added to `PACKAGE_ALIASES`) reports error 0. `ecosystem.ps1 validate` passes. The root devDependency snapshots in `GROUP-7-PRODUCT-TOOLCHAIN.md` gain `@ast-grep/cli`; manifest-audit and repo-integration tests pass 54/0.
