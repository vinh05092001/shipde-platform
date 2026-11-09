# TASK-AI-171 — Việc còn phải làm (09/11/2026, 15:00)

Nguồn: `docs/ai-handoffs/ShipDe-Claude-Overnight.md` (nhánh `docs/claude-overnight-handoff`, 380e57a2), `.oc/route-inventory.md`, review Codex và kiểm tra code trực tiếp trên main `bcafec4d`.

Quy ước trạng thái: **MERGED** đã vào main · **REVIEW** đang review/CI · **FIX** writer đang sửa · **TODO** chưa giao.

## 1. Đã xong hôm nay

| PR | Nội dung | Commit main |
|---|---|---|
| #556 | Tool manifest khớp repo thật | 2ce2bb72 |
| #552 | Route 02 — giữ đủ định danh route, mỗi nguồn nhận một lần | 0274c68d |
| #562 | CI tải gitleaks/trivy/k6 có `--fail --retry` | 83fb0acb |
| #559 | Route 13 — làm mới danh mục tách khỏi chọn writer | e0154bad |
| #561 | Route 08 — ghi nhận worker xong, dừng trước fallback | bcafec4d |
| #555 | Route 03 — lỗi liveness/quota chỉ trong đúng route | 5e222999 |

Trước đó đã merge: Route 01 (#547), Route 12 (#549), WORKER-PLAYBOOK (#553), 65 lỗi R03 (#550), AA join (#544, #545, #548, #551).

## 2. Chuỗi tách route.js (TASK-AI-171)

| Slice | Nội dung | Dòng inventory | PR | Trạng thái | Việc tiếp theo |
|---|---|---|---|---|---|
| 01 | Giữ writer và điểm Controller chọn | B09 B10 B19 B21 B60 B70 B72 | #547 | MERGED | — |
| 02 | Định danh route, admission một lần | B20 B22 B57–B59 B62 B73 | #552 | MERGED | — |
| 03 | Lỗi liveness/quota chỉ trong đúng route | B24 B27–B30 B32 B33 B61 | #555 | MERGED (5e222999) | — |
| 04 | Reviewer khác writer; ngân sách theo cỡ yêu cầu | B04 B06 B08 B11 B13 B31 B40 | — | TODO | Viết phiếu; trần/giá lấy từ dữ liệu sống |
| 05 | Launch đúng harness/tài khoản/effort | B38 B39 B41 B42 B47 B50 | #560 | REVIEW (00a5452a) | Review lại sau 10 lỗi vòng 1 |
| 06 | Mỗi worktree một worker | B43 B44 B45 | #558 | REVIEW (881eb482, 638 dòng) | Review qua AgentRouter; có thể tách B43 |
| 07 | Ledger giữ trần fallback qua crash (Slice A) | B46 B49 C6 | #557 | REVIEW (920b0f98) | Review theo phạm vi Slice A |
| 07b | route-handoff bắt buộc có ledger, sở hữu ghi đĩa | — | — | TODO | Đổi ~40 chỗ gọi trong 5 bộ test |
| 08 | Ghi nhận xong, dừng trước fallback | B26 B51 B52 | #561 | MERGED | — |
| 09 | Chuyển cấp theo review gắn lượt chạy | B12 B35 B36 B65 B69 B71 | — | FIX (DeepSeek V4.1) | Kiểm bài nộp → PR → review |
| 10 | Giữ chỗ quota model/upstream nhất quán | B25 B34 B63 B64 | — | FIX (agy02 Argon) | Kiểm bài nộp → PR → review |
| 11 | Hỏi phần việc còn lại, tách một bước (Jev) | B37 B66 B67 B68 | — | TODO | Jev đưa độ khó vào trước bước chọn |
| 12 | Đầu vào coordinator rõ ràng | B01 B02 B03 B15 B23 B54 B74 B75 | #549 | MERGED | — |
| 13 | Làm mới danh mục ngoài bước chọn | B05 B07 B14 B16–B18 B53 B55 B56 | #559 | MERGED (B05 B14 B17) | Còn B07 B16 B18 B53 B55 B56 |

Tiến độ chuỗi gốc: 6/13 merged, 5 đang review/sửa, 2 chưa giao (≈ 65%).

## 3. Slice mới phát hiện hôm nay (Controller trong repo)

Đã kiểm trực tiếp trên main `bcafec4d`.

| Slice | Vấn đề | Bằng chứng | Mục tiêu |
|---|---|---|---|
| 14 | Combo chỉ gắn tài khoản đầu tiên | `candidates.js:1414` `const acc = bound[0];` | Combo tạo và đánh giá riêng cho từng tài khoản |
| 15 | `direct-http` chạy qua OpenCode | `harness.js:539` `'direct-http': opencodeDirect` | Đường HTTP thật, hoặc báo rõ "không launch được" |
| 16 | Policy và vai trò gắn cứng | `discovery/adapters.js:46` `NOT_PERMITTED` (codex); route.js khoá agy01 và `codex-ar*` cho review | Vai trò writer/reviewer và quyền provider lấy từ cấu hình, gán theo job |
| 17 | Health và parser định danh | `cli.js:1125` chỉ xét `status`, không xét tuổi; `candidates.js:2878,2895`, `writer-combo.js:144` còn `split('::')`; snapshot gộp lý do lỗi, tính Jev là nguồn lỗi | Health có tuổi; một parser `parseCandidateKey`; snapshot phân biệt: không áp dụng / chưa kiểm / lỗi đăng nhập / lỗi kết nối / hết quota |

## 4. route.js (script điều phối ngoài repo)

| Việc | Trạng thái |
|---|---|
| Regex quota `RESOURCE_EXHAUSTED … Resets in` | Đã sửa 09/11 |
| Không hạ vị trí model khi Jev dưới `jev.js DEFAULT_MIN_CONFIDENCE` | Đã sửa 09/11 |
| Loại họ model và nhiều tiền tố route | Đã sửa 09/11 |
| Kiểm quota 5 giờ của đúng nhóm model | Đã sửa 09/11 |
| Giữ nguyên `chosen` của Controller, chuyển quyết định qua `decisionFromDispatch` | Chờ PR 05 + 11 |
| Bỏ `split('::')` tự viết | Chờ PR 17 |
| Ranking và fallback dùng cùng một commit (hiện 83fb0acb so với c6e71fcb) | Việc vận hành, làm sau khi PR 05–08 merge |

## 5. Mục còn lại trong file bàn giao

| Mục | Nội dung | Trạng thái |
|---|---|---|
| 2 | Dry-run không âm thầm tiêu model | Chưa kiểm lại bằng chặn mạng |
| 5 / F | Nối Jev bằng đường gọi thật | Chờ PR 11 |
| 7 | Nghiệm thu offline trọn luồng | Chờ PR 03–11, 14–17 |
| 8 / H | Một ca gọi model thật có giới hạn | LIVE BLOCKED tới khi mục 7 đạt |
| Bổ sung 1 / G | Bảng kiểm kê repo trên máy, công cụ có thật sự dùng | Chưa có bảng số đếm |
| Bổ sung 3 | Bảng trọng số hardcode (file:hàm, giá trị, nguồn, số mẫu) | Mới sửa một phần |
| 10 | Bảng bàn giao cuối A–H/R01–R16 | Chưa cập nhật cho 09/11 |

## 6. Hạ tầng và vận hành

| Việc | Trạng thái |
|---|---|
| Ổ C lên 60 GB trống | Hiện 39 GB; còn Temp, cache Chrome, `C:\ShipDeWorker` |
| `node_modules` repo chính hỏng (prettier không chạy) | Cần `pnpm install` |
| Test chập chờn trên main: `64-25` (so `latencyMs`), `TASK-AI-93` | Chưa giao |
| AGY gateway `127.0.0.1:20140` ECONNREFUSED; Paseo daemon mất kết nối; AgentRouter qua OpenCode 401; Scaleway 403 | Lỗi vận hành; không tự restart daemon chung |
| AGY08–10 cần đăng nhập | Bỏ qua theo chỉ thị |
| Một lane review ChatGPT (agy01) là nút thắt | Đã thêm AgentRouter làm reviewer song song |

## 7. Ngoài phạm vi core (ghi lại, không chặn)

Item 62–63 của bản đối soát 65 lỗi: API prototype `apps/web` orders/shipments thiếu auth/tenant và đồng bộ giả trả thành công. Thuộc code sản phẩm (FEAT), xử lý khi làm phần sản phẩm.

## 8. Thứ tự làm tiếp

1. Merge #555, #557, #560, #558 khi PASS đúng SHA và CI xanh.
2. Kiểm và mở PR cho slice 09, 10.
3. Giao song song 04, 11, 07b, 14, 15, 16, 17 (mỗi phiếu theo dòng inventory, file:dòng, WHERE/WRONG/GOAL/VERIFY, ≤ 400 dòng).
4. Đưa route.js về lớp mỏng: nhận nguyên quyết định qua `decisionFromDispatch`, cùng một commit cho ranking và fallback.
5. Nghiệm thu offline trọn luồng (mục 7), rồi một ca gọi thật có giới hạn (mục 8).
6. Cập nhật bảng bàn giao cuối.

Dự kiến: bước 1–2 trong chiều/tối 09/11; bước 3 sang 10/11; bước 4–6 khoảng 11/11, phụ thuộc quota writer.

## 9. Lệch quy tắc đã ghi nhận trong ngày

- Ba lần review đầu chạy bằng Codex user chính (sau đó chuyển hết sang agy01).
- route.js tự chọn lại writer (vi phạm quy tắc 1) mà không phát hiện sớm; regex quota do Claude viết sai.
- Claude tự viết #557 và một số bản sửa nhỏ (fallback khi không còn writer); reviewer luôn là Codex.
- Một số PR vượt ~400 dòng: #552, #557, #558, #559.
- Phiếu ban đầu của PR 06/07/13 thiếu cụ thể, tốn một lượt writer.
