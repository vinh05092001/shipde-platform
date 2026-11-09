# Kiểm kê repo trên máy (bổ sung 1), 09/11/2026

**Phương pháp:** quét chỉ đọc các thư mục người dùng, công cụ và thư mục worker (sâu 5 cấp, bỏ qua `node_modules`, `AppData`, cache và `.worktrees` của ShipDe). Mỗi `.git` được phân loại là repo hay worktree, rồi dedupe theo `remote.origin.url`. Không đọc credential, không ghi đường dẫn cá nhân. "Dùng thật" chỉ ghi khi có bằng chứng chạy hoặc dòng code được tái sử dụng.

## Số đếm

| Chỉ số | Số |
|---|---|
| Thư mục `.git` tìm thấy | 53 (32 repo, 21 worktree) |
| Remote GitHub khác nhau | 12 |
| Không có remote | 30 bản sao: worktree Paseo, probe của worker, bộ nhớ Codex, cache |
| Bản sao trùng của `shipde-platform` | 8, chưa tính `.worktrees/` |
| Liên quan trực tiếp tới TASK-AI-171 | 5: shipde-platform cùng 4 repo tham khảo |
| Đã đọc trong phiên 09/11 | 1 (shipde-platform) |
| Đã dùng thật, có bằng chứng | 1 (shipde-platform). gstack là skill của Claude, không phải code đi vào ShipDe |

Mốc "hơn 30 repo" trong file bàn giao gần với 32 repo đếm được. Nhưng chỉ có **12 repo nguồn khác nhau**, phần còn lại là bản sao và worktree.

## Từng repo nguồn

| Remote | Bản sao | Vai trò | Nối vào ShipDe | Đã dùng thật | Ghi chú |
|---|---|---|---|---|---|
| vinh05092001/shipde-platform | 8 | Repo chính | — | Có | — |
| sadmann7/shadcn-table (tablecn) | 1 (`ref/`) | Tham khảo bảng phía server (TASK-AI-155) | Chưa | **Chưa có bằng chứng** | Có tên trong prompt worker |
| realstandal/redwood-rls-demo | 1 (`ref/`) | Tham khảo RLS / tách tenant | Chưa | **Chưa có bằng chứng** | Có tên trong prompt worker |
| jonathanong/ssrf-guard | 1 (`ref/`) | Kiểm URL gọi ra ngoài | Chưa | **Chưa có bằng chứng** | Có tên trong prompt worker |
| DavidAnson/markdownlint | 1 (`ref/`) | Lint tài liệu | Chưa | **Chưa có bằng chứng** | Có tên trong prompt worker |
| garrytan/gstack | 2 | Skill cho agent (Claude, Codex) | Không | Không áp dụng | Công cụ của agent |
| openai/skills | 1 | Skill cho Codex | Không | Không áp dụng | Công cụ của agent |
| mksglu/context-mode | 1 | Công cụ ngữ cảnh cho agent | Không | Không áp dụng | — |
| automazeio/ccpm | 1 | Quản lý dự án cho agent | Không | Không áp dụng | — |
| openclaw/openclaw | 2 | Agent khác | Không | Không áp dụng | — |
| Agents365-ai/drawio-skill | 1 | Skill vẽ sơ đồ | Không | Không áp dụng | — |
| duclm1x1/Muse-Chat-MCP | 1 | Máy chủ MCP | Không | Không áp dụng | — |

42 công cụ trong `tools/ai-brain/data/tool-manifest.json` được kiểm riêng ở mục G (16 cài trong repo, 9 có lệnh, 2 gate).

## Việc tiếp

1. Với mỗi phiếu đang mở, chọn đúng repo tham khảo (ví dụ: tách tenant thì `redwood-rls-demo`; gọi ra ngoài thì `ssrf-guard`). Bắt worker nộp file:hàm đã đọc hoặc dùng lại, hoặc lý do không dùng.
2. Dọn bản sao trùng và worktree Paseo cũ (`feat-task-ai-64*`). Đây là backlog sau mốc offline, phải được phép trước khi xoá.
