# Bảng bàn giao 09/11/2026, 15:45

Đối chiếu từng yêu cầu của `docs/ai-handoffs/ShipDe-Claude-Overnight.md` (380e57a2) với bằng chứng trên main `744c3ccf`, PR và worktree.

- **Trạng thái:** XONG (có bằng chứng) · ĐANG LÀM · CHƯA GIAO · BỊ CHẶN.
- **OFFLINE PASS** và **LIVE PASS** ghi riêng. Chưa có mục nào đạt LIVE PASS.

## Điều chỉnh 09/11

- **Tạm dừng** giao writer mới qua bộ chọn `route.js`. Lý do: bộ chọn tự chọn lại thay vì giữ `chosen` của Controller, tự tách định danh, ép harness và effort (mục 3, R10, R14). Các việc không phụ thuộc bộ chọn vẫn tiếp tục: rà repo và công cụ, CI, review, chuẩn bị phiếu, tài liệu.
- **Không còn writer khả dụng** lúc 15:40: agy02 hết quota tuần (khoảng 163 giờ); `oc` và `tokenharbor` hết hạn mức free; `dahl` hết chỗ đồng thời; `kr` hết hạn mức tháng; `ag` không có tài khoản; OpenRouter hết tiền.
- RAM lúc 15:45: còn trống 6,0/15,9 GB, commit 17,5/31,7 GB.

## Checkpoint việc làm dở (giao tiếp từ đây, không làm lại)

| Việc | Worktree / nhánh | Checkpoint | Ghi chú cho lượt sau |
|---|---|---|---|
| #558 Route 06 | `w-rpr06` / `fix/task-ai-171-route-pr06-…` | 881eb482 (đã push) | Còn 5 lỗi P1 (review agy01, file `findings-RPR06c`). PR 638 dòng, phải rút test xuống ≤250 dòng |
| PR 09 | `w-rpr09` / `fix/task-ai-171-route-pr09` | 0e005e5a (WIP cục bộ, chưa push) | 474 dòng, chưa kiểm. Có `outcome-history.js` mới và test |
| PR 10 | `w-rpr10` / `fix/task-ai-171-route-pr10` | 9952fdcf (WIP cục bộ, chưa push) | **943 dòng, phải cắt theo AC** trước khi review |
| #560 Route 05 | `w-rpr05` | 4a2238f9 (đã push) | Review vòng 3 còn 5 lỗi P1, cùng gốc "chưa nối vào nơi launch thật". Cần việc sửa tận gốc |

## Mục 0–10

| Mục | Yêu cầu | Trạng thái | Bằng chứng / blocker | Bước tiếp theo |
|---|---|---|---|---|
| 0 | Bảng RUNS, đo RAM, kiểm mỗi 2 phút | ĐANG LÀM | Watcher có giới hạn vòng; bảng `jobs.md` ngoài repo. Chưa ghi đủ PID/RAM theo luồng | Ghi bảng RUNS theo mẫu R16 trong file này mỗi lần giao |
| 1 | #528 cache catalogue | XONG | #528 merged | — |
| 2 | Refresh chỉ liệt kê, dry-run 0 inference | ĐANG LÀM | #512 merged; #559 (PR 13) merged: dispatch không tự gọi mạng khi danh mục cũ, ghi dấu làm mới chỉ khi thành công. Chưa có phép đo "0 inference" với mạng bị chặn. Snapshot gộp lý do lỗi và tính Jev là nguồn lỗi | Chạy replay dry-run chặn mạng và đếm request. Slice 17 sửa phân loại snapshot |
| 3 | Vì sao chọn 61 thay vì 76; giữ identity tới argv | ĐANG LÀM | Route 01 và 02 merged. 09/11 phát hiện route.js tự chọn lại và hạ vị trí theo độ khó; đã sửa phần hạ vị trí và regex quota | PR 05 (#560) và 11. route.js nhận nguyên quyết định qua `decisionFromDispatch` |
| 4 | SCORE/ROUTE, policy thật, bảng trọng số | ĐANG LÀM | AA join #544/545/548/551 merged. #526 đóng, chia thành các slice. **Chưa có bảng trọng số** | Bổ sung 3: lập bảng file:hàm, giá trị, nguồn, số mẫu |
| 5 | Nối JEV bằng call path thật | CHƯA GIAO | Phụ thuộc PR 11. route.js đã bỏ hạ vị trí khi Jev dưới `DEFAULT_MIN_CONFIDENCE` | Giao PR 11 khi có writer |
| 6 | OC2, lỗi giữa chừng, ledger qua restart | ĐANG LÀM | Route 07 Slice A (#557) và Route 08 (#561) merged. Route 06 (#558) đang sửa. Mock đếm request OpenCode khi 402/429 chưa làm | Xong #558, rồi PR 07b. Lập mock đo request |
| 7 | Nghiệm thu offline trọn luồng | CHƯA GIAO | Phụ thuộc 03–11, 14–17 | Sau khi chuỗi slice xong |
| 8 | Ca gọi model/JEV thật có giới hạn | BỊ CHẶN | Mục 7 chưa đạt; không còn route free khả dụng lúc 15:40 | LIVE BLOCKED cho tới khi mục 7 đạt và có route trong ngân sách |
| 9 | Repo/công cụ dùng đúng | ĐANG LÀM | Manifest 42 công cụ: 16 cài trong repo, 9 có lệnh, 2 gate (#556). 4 repo tham khảo đã clone. WORKER-PLAYBOOK (#553). Chưa có bằng chứng worker thật sự dùng | Bổ sung 1 và G |
| 10 | Review, bàn giao, quyền | ĐANG LÀM | Review AC qua agy01, có khoá chống ghi đè. Bảng này | Cập nhật bảng khi trạng thái đổi |

## R01–R16

| ID | Trạng thái | Bằng chứng / blocker | Bước tiếp theo |
|---|---|---|---|
| R01 Điều phối nhiều worker | ĐANG LÀM | Phiếu theo dòng inventory, WHERE/WRONG/GOAL/VERIFY. Lúc đầu phiếu PR 06/07/13 chưa cụ thể | Giữ mẫu phiếu; thêm "lý do chọn route" lấy từ Controller |
| R02 Không để phiên chết 10 phút | ĐANG LÀM | Watcher có phát hiện treo 15 phút. Mục tiêu ≤10 phút chưa đạt | Hạ ngưỡng phát hiện treo xuống 5 phút |
| R03 Kiểm kê repo, 65 PR AGY | PARTIAL | 65 lỗi ngày 03/11 đã đối soát (#550); danh sách 65 PR AGY chưa tìm lại. **Kiểm kê repo trên máy chưa có bảng số đếm** | Chạy kiểm kê: số repo, trùng, đã đọc, đã dùng |
| R04 Công cụ cài rồi phải được dùng | ĐANG LÀM | `tool-usage-20261107.md`; manifest khớp repo (#556). Chưa có bằng chứng dùng thật | Mục G |
| R05 #521 tự đọc vinh | XONG một phần | #518 merged; #521 đóng. Combo chỉ gắn tài khoản đầu (`candidates.js:1414`) | Slice 14 |
| R06 Health/quota đúng route | ĐANG LÀM | Route 03 (#555) merged. Health không xét tuổi (`cli.js:1125`) | Slice 17 |
| R07 Phiếu đúng lỗi thật | XONG một phần | Phiếu B (dựng phiếu từ check thật) đã merge trước 09/11 | Replay TASK-AI-169 khi nghiệm thu |
| R08 Không hardcode | ĐANG LÀM | Đã sửa một phần qua AA join. route.js còn luật cứng (agy01, `codex-ar*`); discovery cấm codex (`adapters.js:46`) | Bảng trọng số (bổ sung 3), slice 16 |
| R09 JEV hỏi đúng, đo được | CHƯA GIAO | Phụ thuộc PR 11 và phiếu F | PR 11 |
| R10 Core tự chọn rồi gọi, fallback giữ diff | ĐANG LÀM | Route 07A và 08 merged. route.js chưa giữ `chosen` | PR 05, 06, 07b, 11 |
| R11 Tìm nguyên nhân, sửa đúng lớp | ĐANG LÀM | Test mới trượt trên bản gốc, qua trên bản sửa (verify-pr.sh) | Giữ nguyên |
| R12 Review và kiểm soát thay đổi | ĐANG LÀM | PASS đúng SHA + CI xanh trước mỗi merge. Có PR vượt 400 dòng (#552, #557, #558, #559) | Cắt PR 10 và #558 |
| R13 Hai đường Codex review | ĐANG LÀM | agy01 dùng được. AgentRouter trả 400/401. Chỉ thị 09/11 của anh: review ChatGPT chỉ qua agy01 (thay chỉ dẫn "không khoá agy01" trong file bàn giao) | Kiểm xác thực AgentRouter |
| R14 Controller xét 9Router và nguồn ngoài | ĐANG LÀM | `direct-http` chạy qua OpenCode (`harness.js:539`); route.js loại http/hermes/qwen/paseo | Slice 15, 16 |
| R15 Model ngoài dùng đúng repo và quy tắc | ĐANG LÀM | Prompt có tool-manifest, graphify, 4 quy tắc, repo tham khảo. Chưa chọn repo theo việc; chưa kiểm báo cáo đã đọc/đã dùng | Bắt worker nộp danh sách đã đọc/đã dùng; trả lại nếu thiếu |
| R16 RAM và theo dõi từng luồng | ĐANG LÀM | Đo RAM lúc 15:45. Chưa ghi đỉnh theo luồng | Ghi RAM trước/sau mỗi lần giao |

## Phiếu A–H

| Phiếu | Trạng thái | Bằng chứng / blocker | Bước tiếp theo |
|---|---|---|---|
| A Combo và route | XONG một phần | #518 merged; Route 01/02 merged | Slice 14 (combo theo tài khoản) |
| B Phiếu giao việc | XONG | Đã merge trước 09/11 | — |
| C Điểm và định danh | ĐANG LÀM | AA join merged; Route 02 merged; parser cũ còn trong Controller | Slice 17, bảng trọng số |
| D Launcher và fallback | ĐANG LÀM | Route 07A, 08 merged; #560, #558 đang sửa | Sửa tận gốc #560; #558; PR 07b |
| E Quota và bằng chứng | ĐANG LÀM | Route 03 merged; PR 10 WIP 943 dòng | Cắt PR 10 theo AC |
| F JEV thật | CHƯA GIAO | — | PR 11 |
| G Repo/công cụ dùng thật | CHƯA GIAO | Manifest đúng (#556) nhưng chưa có bảng INSTALLED/WIRED/OBSERVED/NOT USED | Lập bảng bằng log và file:hàm (không cần writer) |
| H Nghiệm thu gọi model, chấm điểm thật | BỊ CHẶN | Chờ mục 7 và route khả dụng | — |

## Bổ sung bắt buộc

| Mục | Trạng thái | Bước tiếp theo |
|---|---|---|
| 1 Kiểm kê repo trên máy | CHƯA GIAO | Quét các thư mục repo đã cấu hình, dedupe theo remote, ra số đếm |
| 2 Đối soát 65 PR AGY | PARTIAL | #550 đối soát **65 lỗi của anh (03/11)**, không phải danh sách 65 PR giao AGY: 4 FIXED, 41 PARTIAL, 8 OPEN, 12 UNVERIFIED, mỗi dòng có file:dòng/test. **Danh sách gốc 65 PR AGY chưa tìm lại được** (git log, docs/, register không có) | Tìm nguồn bàn giao gốc (lịch sử chat/handoff cũ, register 03/11); nếu không có, ghi nơi đã tìm và số truy được |
| 3 Bảng trọng số hardcode | CHƯA GIAO | Rà route.js, rankForProfile/scoreForProfile, rankAndRecord/scoreCandidate, JEV |
| 4 Bảng bằng chứng, Codex review đúng SHA | ĐANG LÀM | File này cùng `remaining-work-20261109.md` |

## Việc làm được ngay, không cần writer

1. Mục G và bổ sung 1: bảng công cụ và kiểm kê repo, dùng log, manifest và rg.
2. Bổ sung 3: bảng trọng số hardcode.
3. Mục 2: replay dry-run chặn mạng, đếm request.
4. Sửa bộ chọn: route.js nhận nguyên `chosen` của Controller, chỉ sau khi kiểm bằng replay offline mới mở lại giao writer.
