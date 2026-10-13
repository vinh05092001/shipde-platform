# AutoClaw: bàn giao tích hợp repo ngoài (2026-10-12)

Chỉ là gói bàn giao. Người soạn (Claude) không code, không chọn model, không mở lượt worker.
Không có secret trong thư mục này. Không clone hoặc cài lại repo nào khi chưa có Work Item cho nó.

## 0. Đọc trước

| Mục | Đường dẫn tuyệt đối |
|---|---|
| Gói bàn giao này | `C:\Users\gumac\AI\shipde-platform\.worktrees\handoff\autoclaw-repo-20261012\` |
| **Quyết định từng repo (nguồn chính)** | `...\autoclaw-repo-20261012\source-docs\REPO-DECISIONS-20261006.md` (bản r2, đã áp dụng operator review ngày 6/10) |
| Điểm nối với Controller | `...\source-docs\REUSE-AUDIT-r4-20261006.md` mục 5–7 |
| Yêu cầu theo từng mục | `...\source-docs\REUSE-AUDIT-ALL-REQUIREMENTS-r3-20261006.md` |
| Bảng 88 repo (bản r3, trước r2) | `...\source-docs\A-88-repo-requirements-r3.md` |
| Kiểm kê gốc | `...\source-docs\REPO-INVENTORY-CANONICAL-20261004.json` |
| Trạng thái lúc dừng | `...\source-docs\STOP-AND-STATUS-20261006.md`, `POC-A-PREFLIGHT-20261006.md` |
| TSV đã gửi trước đó | `...\source-docs\repos-to-integrate-2026-10-12.tsv` (bản gốc: `C:\Users\gumac\AI\shipde-platform\.worktrees\logs\repos-to-integrate-2026-10-12.tsv`) |
| Gốc của các tài liệu audit | PR #221, nhánh `audit221`, head `faab46b999badf31fd63e84558cb62e69ef5316f`, **OPEN, ghi "do not merge"** |
| Danh mục công cụ Controller đang dùng | `tools/ai-brain/data/tool-manifest.json` trên `origin/main` |

### Mâu thuẫn cần biết (không tự suy đoán)
1. **TSV ngày 12/10 dùng cột trạng thái cũ** (ADOPTED, PENDING, PILOT… của WS2/r3). Bản r2 `REPO-DECISIONS` đã đổi nhiều quyết định. Ví dụ:
   - `cline`, `openhands`, `agent-orchestrator`, `deepseek-harness`, `llmlingua`, `sylph`, `vercel-labs/agent-skills`, `beads` thành **DROP**;
   - `promptfoo` thành **DEFERRED_QUALIFICATION_TOOL**;
   - `openspec` thành **DEFERRED**.

   **Lấy r2 làm chuẩn; TSV chỉ để tra link.**
2. Quyết định r2 nằm trên PR #221 chưa merge. Bản r2 ghi đã áp dụng operator review ngày 6/10, nhưng trên `main` không có bản ghi quyết định chính thức nào. → Trước khi làm nhóm nào ngoài Nhóm 1, cần operator xác nhận r2 vẫn còn hiệu lực.
3. TSV có 64 dòng, r2 có 88 + 13 dòng. TSV **không có** các mục ngoài kiểm kê đã quyết USE: `obra/superpowers`, `rtk-ai/rtk`, `pbakaus/impeccable`, `anomalyco/opencode`, `getpaseo/paseo`.
4. `tool-manifest.json` trên main có 33 mục ghi `installed: "UNKNOWN"` và phần lớn `command: null` / `evidenceRef: null`. Manifest đang **liệt kê** công cụ chứ chưa chứng minh chúng chạy được.

## 1. Base và trạng thái máy

- **Base để làm việc:** `origin/main` = `13e729166b12ee8700092fbd1a405f932877bf93` (kiểm lúc 2026-10-12, chiều).
- **Checkout chính** `C:\Users\gumac\AI\shipde-platform`:
  - đang ở `HEAD` tách rời `9912e673`, **không phải main**;
  - có thay đổi chưa commit: `M apps/web/src/tests/regression-audit.test.ts` và nhiều file chưa track (`HANDOFF.md`, `apps/web/src/app/login/`, `ResetPasswordView.tsx`, `tools/account-failover/`, các script `get_*.ps1`…).
  - → **Không làm việc trong checkout này, không commit các file đó.** Tạo worktree mới từ `origin/main`.
- **Worktree đang giữ việc của luồng khác (không đụng):**
  - `.worktrees\ai141sc`: nhánh `fix/task-ai-141-source-coverage`, có sửa `source-discovery.js` chưa commit và test AutoClaw source chưa track;
  - `.worktrees\ai141dg`: nhánh `fix/task-ai-141-drop-writer-gates`;
  - `.worktrees\ai141qi`, `ai141mp`, `ai141pr`, `ai141ca`, `ai141ca2`, `isolation`.

## 2. Phạm vi agy đang giữ: AutoClaw tránh

Theo giới hạn đã chốt, **nguồn và model do agy phụ trách**. Không sửa các file sau:
- `tools/ai-brain/source-discovery.js`, `sources.js`, `sources.json`, `data/sources.json`
- `candidates.js`, `routing.js`, `priors.js`, `data/model-priors.json`, `data/external-model-priors.json`, `priors-sources/`
- `qualification-auto.js`, `data/evidence/`, phần proofFloor trong `cli.js` và `work-item-planner.js`
- mọi thứ liên quan 9router, agy-pool, AutoClaw source, key môi trường

**Chưa xác minh:** lúc soạn gói này, `C:\Tools\agy-runs\agy01..07\job.json` chỉ chứa lệnh `quota`. Em không thấy job code nào của agy đang chạy, nên danh sách trên lấy theo **phạm vi được giao**, không theo file agy đang mở. Nếu agy được giao thêm file khác thì cập nhật mục này.

**Hermes làm sau.** Không sửa `harness.js` phần Hermes, cấu hình Hermes trong `%LOCALAPPDATA%`, hay kanban/delegate.

## 3. Phân loại (theo r2)

| Loại | Repo | Việc cho AutoClaw |
|---|---|---|
| **Đã tích hợp (KEEP_RUNTIME)** | shipde-platform, cli/cli (gh), 9router, opencode, paseo, Hermes one-shot | Không làm. 9router thuộc phạm vi agy; Hermes làm sau |
| **Đã tích hợp vào Controller** (có code và test trên main) | superpowers, impeccable (`tools/ai-brain/skills/`, `skill-pack.js`, test `task-ai-109-*.test.js`); RTK (`cli.js --rtk`, `task-ai-109-rtk.test.js`); repomix (`context-pack.js`); gitleaks (`security:secrets`, gate=true); serena dạng pilot (`serena.js`, `serena.test.js`) | Chỉ kiểm lại bằng chứng (Nhóm 1). Không viết lại |
| **Cần tích hợp, dạng công cụ (USE_AS_TOOL)** | trivy, semgrep, agent-scan, ast-grep, context7, tokentracker, axe-core, lighthouse-ci, playwright/-cli/-mcp, chrome-devtools-mcp, storybook/addon-a11y, msw, prism, openapi-typescript, pact-js, toxiproxy, supertest, nock, hoverfly, k6, syft, vietnamese-provinces | Theo các nhóm 2–4 bên dưới |
| **Công cụ nền đã có** | node, git, pnpm, prettier, eslint, prisma, turborepo, vitest, lefthook, renovate, docker compose, nest, opentelemetry-js (cho sản phẩm) | Không cần tích hợp vào Controller; chỉ ghi bằng chứng cài đặt vào manifest (Nhóm 1) |
| **CLI tác tử** | codex, gemini-cli, antigravity, claude-code | Là harness/nguồn → thuộc phạm vi agy. Không làm |
| **Thử nghiệm / hoãn** | promptfoo (DEFERRED_QUALIFICATION_TOOL), openspec (DEFERRED), BMAD (ALTERNATIVE_WORKFLOW), ECC (PILOT_WINDOWS), RTK đo trước khi bật mặc định | Không làm khi chưa có quyết định mới |
| **Chỉ tham khảo (PATTERN_ONLY / REPLACED_BY)** | agentgateway, litellm, e2b, emdash, langgraph, langgraph-supervisor, deepagents, open-swe, agent-framework, openai-agents-python, software-agent-sdk, serena (app GPL), spec-kit, swe-rex, temporal sdk, workmux, ruflo, anthropics/skills, Agent-Skills-for-Context-Engineering, gsd-core; ccpm, claude-codex-orchestrator, codex-startup-factory, ui-ux-pro-max (đã được thay) | Không cài, không thêm dependency. Nếu muốn áp ý tưởng thì cần Work Item riêng |
| **Không dùng (DROP)** | cline (chỉ còn là upstream 9router), openhands, agent-orchestrator, deepseek-harness, llmlingua, beads, sylph, vercel-labs/agent-skills, daytona, ntm, cmux, claude-squad, openshell, opa, bullmq, swe-agent, context-mode, pi | Không làm |

## 4. Các nhóm việc theo thứ tự phụ thuộc

Mỗi nhóm là một Work Item, một nhánh, một PR, theo `AGENTS.md`. Bằng chứng gồm lệnh và output thật; không ghi "đã cài" nếu chưa chạy.

### Nhóm 1: Manifest phản ánh sự thật ← **LÀM ĐƯỢC NGAY**
- **Mục đích:** `tool-manifest.json` hiện ghi `installed: "UNKNOWN"` cho 33 công cụ. Controller không biết công cụ nào thật sự dùng được.
- **Repo:** toàn bộ dòng USE_AS_TOOL và công cụ nền ở mục 3.
- **Quyết định đã duyệt:** r2: USE_AS_TOOL = "app/dev/CI toolchain or agent CLI; not part of the brain".
- **Còn thiếu:** với mỗi công cụ, cần biết:
  - có cài hay không (phiên bản thật, đọc từ `package.json` / lockfile hoặc lệnh `--version`);
  - lệnh gọi (`command`);
  - bằng chứng (`evidenceRef`).
- **Cách làm:** chỉ đọc. Ghi `installed: true` kèm `evidenceRef` (file:dòng hoặc output version). Chưa cài thì ghi `false`. **Không cài thêm gì.**
- **File được sửa:** `tools/ai-brain/data/tool-manifest.json`, một test mới `tools/ai-brain/test/tool-manifest-truth.test.js`, `docs/product-spec/work-items/<ID>.md`.
- **Nghiệm thu:**
  - không còn `"UNKNOWN"`;
  - mọi mục `installed: true` có `evidenceRef` trỏ tới file có thật;
  - mục có `gate: true` (gitleaks, agent-scan) phải có `command`, hoặc bị đánh dấu chặn kèm lý do;
  - test mới kiểm các điều trên.
- **Lệnh kiểm chứng:** `node --test tools/ai-brain/test/tool-manifest-truth.test.js tools/ai-brain/test/task-ai-109-tools.test.js tools/ai-brain/test/manifest-audit.test.js`, rồi `pnpm format:check`.
- **Thông tin thiếu:** `agent-scan` đang `gate: true` nhưng `installed: "UNKNOWN"`, `command: null`. Không rõ gate này hiện có chặn gì không. Ghi lại phát hiện, **không tự sửa logic gate**.

### Nhóm 2: Công cụ cho reviewer và bảo mật (sau Nhóm 1)
- **Repo:** semgrep (r2 USE_AS_TOOL, trước đó PILOT), trivy, agent-scan (r2: "scan installed skills/MCP before enabling them"), ast-grep (tùy chọn).
- **Còn thiếu:** chưa cài trên máy (cần Nhóm 1 xác nhận). Chưa có lệnh nào trong `package.json`.
- **Cách tích hợp:**
  - thêm script npm chạy cục bộ, không bật mặc định trong CI khi chưa đo thời gian;
  - agent-scan quét `tools/ai-brain/skills/` trước khi skill được dùng.
- **File được sửa:** `package.json` (scripts), `tool-manifest.json` (`command`), test, tài liệu Work Item. **Không sửa** `orchestrate.js` gate.
- **Nghiệm thu:**
  - mỗi lệnh chạy được trên Windows và trả mã thoát đúng với một mẫu lỗi cố ý;
  - output không chứa secret.
- **Lệnh kiểm chứng:** **THIẾU.** Phụ thuộc phiên bản cài thật; Work Item phải ghi lệnh cụ thể sau Nhóm 1.
- **Cần operator quyết:** có cài semgrep (LGPL-2.1) và trivy trên máy không. Có đưa vào CI không.

### Nhóm 3: Công cụ UI cho Work Item FEAT (sau Nhóm 1)
- **Repo:** playwright / playwright-cli / playwright-mcp, chrome-devtools-mcp, axe-core, lighthouse-ci, storybook + addon-a11y, msw-storybook-addon.
- **Quyết định:** USE_AS_TOOL; impeccable (đã tích hợp) là vai trò UI, chạy theo screen spec.
- **Còn thiếu:**
  - chưa rõ cái nào đã nằm trong `package.json` của `apps/web`;
  - `ms-playwright` đã có trình duyệt (`%LOCALAPPDATA%\ms-playwright`, 1,4 GB).
- **Cách tích hợp:** gắn vào vai trò `ui` trong manifest. Kiểm a11y bằng axe trong test e2e có sẵn (`pnpm test:e2e`).
- **File được sửa:** `apps/web` test config, `tool-manifest.json`, tài liệu Work Item.
- **Nghiệm thu:** `pnpm test:e2e` có bước axe trên ít nhất một màn hình; báo cáo vi phạm hiện trong output.
- **Lệnh kiểm chứng:** `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`.
- **Thông tin thiếu:** chưa có `DESIGN.md` được duyệt (theo AGENTS.md dùng `DESIGN-SYSTEM-UX-RULES.md`).

### Nhóm 4: Công cụ test API của sản phẩm (độc lập Controller, sau Nhóm 1)
- **Repo:** msw, prism, openapi-typescript, pact-js, toxiproxy, supertest, nock, hoverfly, k6, vietnamese-provinces-database.
- **Quyết định:** USE_AS_TOOL, phục vụ test sản phẩm, không phải bộ não.
- **Cách tích hợp:** chỉ thêm khi một Work Item FEAT cần. **Không** cài sẵn hàng loạt.
- **Nghiệm thu / lệnh:** theo từng FEAT Work Item (`pnpm test`, `pnpm test:e2e`).
- **Ghi chú:** prism từng để lại tiến trình mock server khiến verdict cách ly ra PARTIAL. Test dùng prism phải tắt tiến trình khi xong.

### Nhóm 5: Đo trước khi bật (chờ quyết định)
- **Repo:**
  - RTK: đã tích hợp, chưa đo mức tiết kiệm;
  - tokentracker;
  - context7;
  - serena: đang ở POC, app là GPL.
- **Còn thiếu:** số đo trước và sau trên ShipDe (r2: "savings on ShipDe not measured").
- **Cần operator quyết:** có cho bật mặc định không. AutoClaw chỉ đo và báo cáo, không bật.

### Không làm trong gói này
- 9router, agy, AutoClaw source, các CLI tác tử, priors và benchmark: **phạm vi agy**.
- Hermes kanban/delegate/memory: **làm sau**.
- OpenSpec, BMAD, ECC, promptfoo: **đang hoãn**.
- Mọi repo PATTERN_ONLY / REPLACED_BY / DROP.

## 5. Luật bắt buộc khi làm
- Một Work Item, một nhánh `feat|fix/<id>-<slug>`, một PR `[<ID>] <outcome>`, theo `AGENTS.md`.
- Không `--no-verify`, không đổi `core.hooksPath`, không `reset --hard`, không `git clean`.
- Không in hoặc ghi key/token. Không đọc `~/.openclaw-autoclaw/.gateway-token` vào output.
- Không cài global hàng loạt. Cài gì phải ghi phiên bản và lý do trong PR.
- Review độc lập đúng SHA cộng CI xanh trước khi merge. Tác giả không tự duyệt.
- Thiếu thông tin hoặc mâu thuẫn thì ghi vào PR mục "Known limitations", không đoán.
