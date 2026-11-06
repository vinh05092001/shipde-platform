# Rà đường giao việc và gọi model — 06/11/2026

Bản tóm tắt. Không kèm raw log, prompt đầy đủ, key, cookie hay dữ liệu tài khoản. Đường dẫn cục bộ được thay bằng `<scratch>` (thư mục làm việc tạm của phiên điều phối, nằm ngoài repo) và `<runs>` (thư mục job của AGY pool). Lane AGY chỉ ghi chung là "AGY lane".

Phương pháp: chỉ đọc code và log sẵn. Không gọi model, không quét catalogue, không sửa code.

## Đường chạy thật

- Điều phối là scratch pipeline `<scratch>/pipeline-run37.sh`, chọn writer bằng `<scratch>/route.js`, cwd là worktree `p-run-main` ở `1b7a969d`.
- Không có tiến trình Hermes, `next --loop`, `intake` hoặc `orchestrate` lúc rà.
- 60 lượt route gần nhất: 54 `origin=probe`, 6 `origin=scoreboard`, 0 từ Controller.

## Nhóm phát hiện

| Mã | Nhóm |
|---|---|
| A | Gọi sai model/account |
| B | Giao việc thiếu |
| C | Gán cứng |
| D | Chấm điểm lệch |
| E | Bỏ qua JEV |
| F | Hỏi JEV sai mục đích/format |

## CONFIRMED

| ID | Nhóm | Phát hiện | Bằng chứng | Tác động | Đề xuất |
|---|---|---|---|---|---|
| A1 | A | Launcher thay model đã chọn bằng combo `vinh`, log vẫn ghi điểm model cũ. Hiện đã tắt, chỉ bật khi đặt `ROUTE_VIA_COMBO` | `route.js:630`; lượt 169 lúc 07:23 ghi `ninerouter/vinh` điểm 84.5 | Không biết model thật đã chạy; các writer treo | Combo phải là ứng viên có điểm riêng |
| A2 | A | Job quét ghi đè `job.json` của AGY lane, mất trường model và cwd của writer | `<runs>/.../job.json` lúc 09:14 chỉ có `command,cwd,accountId,jobId,printTimeoutSec`, cwd `p-run-main`, kết quả 5 giây | Job writer có thể bị thay thế | Tách đường job quét; lane bận thì bỏ qua |
| B1 | B | Lỗi `contract` (PR body thiếu mục) được giao thành "tái hiện CI", trong khi note cấm đọc CI | `route.js` nhánh tách bước (từ dòng 564); `task.md` của 169, 160 | Chỉ dẫn mâu thuẫn | Tách kiểu việc |
| B2 | B | Dòng "lỗi" lấy từ văn bản task, không từ log CI. Mẫu 169: `error: 1. Make RunLedger a THIN ADAPTER` | `route.js:544` | Sai đầu vào cho task và JEV | Lấy từ log CI |
| B3 | B | Context pack được sinh nhưng prompt không nhắc tới | `context-pack.md` 134 KB ở 169; `task.md`, `note.txt` không có chuỗi này | 14/20 log không dùng pack, repomix, jcodemunch | Đưa vào prompt hoặc bỏ bước sinh |
| B4 | B | Mỗi vòng repair mở phiên mới; chỉ 3 log có resume | `route.js:408`; đếm `oc-continue` | Đọc lại repo mỗi vòng | Tái dùng session khi cùng head |
| B5 | B | Item chạy theo `GUARD` không có đường xử lý | Log: 160 `MERGE_CONFLICT` từ 22:36; COM-03 `FOREIGN` từ 08:59 | Hai item đứng im | Có nhánh xử lý cho từng outcome |
| C1 | C | Loại mọi route `codex-ar*` là "reserved as reviewer" dù reviewer không dùng | `route.js:256`; `reviewerModel()` rỗng; 0 lượt Codex/AgentRouter trong 60 lượt | 4 route `gpt-5.6-sol`, `gpt-6-astra` không có cơ hội | Chỉ giữ chỗ khi reviewer dùng thật |
| C2 | C | Chia ứng viên theo số mức thang và ép lấy đầu khi `roundsSoFar>=3`, sau bước chọn | `route.js:623-624` | Xếp hạng lại ngoài Controller | Bỏ khi Controller chọn |
| C3 | C | Ngưỡng 0.7 trong code và cấu hình, bị `minConfidence:0` của wrapper bỏ qua | `tools/ai-brain/jev.js:17`; `sources.json:431`; `ask-jev.js:12` | Hai nguồn giá trị mâu thuẫn | Thay bằng quy tắc từ dữ liệu |
| D1 | D | Trộn hai thang: AA percentile và prior thô | `aaScore` trả `none` cho `gpt-5.6-luna`, `glm-5`, `dots-3`; route ghi 84.5, 52.9, 64.4 | Model chưa có điểm AA đứng trên model có điểm | Một thang; thiếu thì UNKNOWN |
| D2 | D | Quota không vào health: `402 MONTHLY_REQUEST_COUNT` 7 lượt, route vẫn `AVAILABLE` | Log 08:00-08:34 `kr/glm-5`, `-agentic`; `health-bridge.js:73`; `route.js:587` chỉ nhớ một tên | Mất 7 lượt | Coi là lỗi mức nguồn; gộp biến thể |
| D3 | D | Lỗi `[Error] at capacity` không khớp mẫu `^Error:` | `health-bridge.js:44`; log grok | Bị chọn lại | Khớp cả hai dạng |
| D4 | D | Quét với prompt ngắn báo OK, session thật `402` | 166 lúc 07:30 | Số model sống báo dư | Kiểm theo kích thước thật |
| D5 | D | Probe cũ 962 phút | `notes` trong route-log | Xếp hạng theo trạng thái 16 giờ trước | Dùng `pnpm ai:refresh-catalogue` |
| E1 | E | `dispatch` dừng ở `STALE_CATALOGUE` trước bước JEV. Local return, không có HTTP | `tools/ai-brain/cli.js:2132`; PR #512 sửa nguyên nhân | Controller không chạy từ #497 | Merge #512 |
| E2 | E | Reviewer bị tắt hỏi JEV bằng `if (false)`. Cố ý theo audit #10 | `reviewer-pick.js:72` | Không phải lỗi nếu chính sách là JEV không chọn route | Bỏ nhánh chết |
| F1 | F | Câu chấm độ khó gửi `kind:'pick-writer'`, khoá thành `weightProfile` | `ask-jev.js:12`; `jev.js` `buildJevAsk`, khoá `eligibleModel` chỉ dành cho `select-eligible-model` | Sai contract, parser vẫn nhận nên không lộ lỗi | Dùng kind đúng mục đích |
| F2 | F | Thang chấm không phân biệt: 96/97 lượt `hard` | `<scratch>/jev-raw.jsonl`, tổng hợp | Gần như luôn chọn nhóm trên | Chấm từ việc còn mở |
| F3 | F | 81/97 lượt dưới 0.7 vẫn được dùng, thấp nhất 0.28 | Như trên; `ask-jev.js:12` | Kết quả yếu vẫn đổi đường chạy | Quy tắc theo xác suất |
| F4 | F | Cùng evidence gọi lại tới 20 lần, không cache | Như trên | Lặp gọi không thêm thông tin | Cache theo hash |
| F5 | F | Trước 05/11 20:06 có 15 lượt hỏi JEV chọn route, trái audit #10 | `<scratch>/jev-raw.jsonl` | Đã dừng | Không quay lại |

## UNKNOWN

| ID | Nhóm | Câu hỏi | Lý do chưa kết luận | Cần gì |
|---|---|---|---|---|
| U1 | A | Account và connectionId nào thực thi mỗi lượt 9router | Không có log nhánh đọc được | Bật usage log 9router |
| U2 | A | Lượt AGY lane lúc 08:34 của COM-03 có chạy đúng model không | Job gốc đã bị ghi đè; có commit `313e3055` | Lưu bản sao job theo jobId |
| U3 | A | Combo `vinh` treo vì head giới hạn đồng thời? | 6 yêu cầu song song: 1 về sau 56 giây, 5 hết giờ; model đơn 5 giây. Chỉ là suy ra | Xem cơ chế fallback của 9router |
| U4 | B | Vì sao 160 không nhận khối gỡ xung đột | `merge-tree` thoát 1 nhưng `task.md` không có khối đó | Ghi `conflict` vào route-log |
| U5 | B | Lý do `FOREIGN` của COM-03 | Chưa đọc guard | Đọc `FEAT-COM-03-API.guard` |
| U6 | B | Vì sao jcodemunch chỉ dùng ở 3/20 log | Đã bật trong opencode, chưa rõ writer có thấy tool không | Đọc danh sách tool của writer |
| U7 | B | Prompt có khớp đầy đủ Work Item không | Chỉ đối chiếu task, nhánh, worktree của 4 item | Đối chiếu từng AC |
| U8 | D | Điểm từng phần và trọng số mỗi lượt | Log không lưu; `rejected` cắt còn 12 | Ghi đầy đủ vào route-log |
| U9 | D | Chi phí UNKNOWN có đổi thứ hạng trong Controller không | `route.js` không dùng cost; Controller chưa chạy thật | Rà sau #512 |
| U10 | D | Dòng `paseo` đầu bảng có gọi được không; 40 dòng `QUALITY_UNKNOWN` | Chưa kiểm sau khi Controller sống lại | Chạy refresh sau #512 |
| U11 | F | `confidence` của JEV có phải khoảng cách hai phương án đầu | Chỉ từ 3 mẫu, chưa đọc phía JEV | Đọc contract JEV |
| U12 | F | Latency và stderr các lượt JEV | Không lưu | Ghi thêm |

Trước 05/11 tối, `confidence` thật và `probabilities` của lượt `UNDECIDED` đã mất; số liệu F2, F3 chỉ từ `jev-raw.jsonl` trở đi.

## Không tìm thấy

Không thấy lỗi sai ID model hay sai prefix ở các lượt đã xem. Các lỗi là quota, capacity và timeout: `kr/` → `kiro/` đúng ánh xạ alias.

## Lượt mẫu

| Lượt | Loại | Chọn | Thực thi | Kết quả |
|---|---|---|---|---|
| COM-03, 08:49 | Nhẹ | `kgw/dots-3` | Đúng | Xong, 8 tool |
| 169, 07:58 | Khó | `explabs/deepseek-v4.1-flash` | Đúng | Xong, 16 tool |
| 166, 07:30 | Lỗi | `openrouter/.../gpt-5.6-luna` | Đúng | Timeout, resume ra `402` |
| COM-03, 08:00 | Lỗi | `kr/glm-5` | Đúng | `402` quota |
| 169, 07:23 | Lỗi | Điểm 84.5, launcher gửi `vinh` | Không rõ nhánh | Timeout 300 giây |

## Phân công đề xuất

- Điều phối (prompt, caller, launcher): A1, A2, B1-B5, C2, E2.
- AGY (ranking, health, quota, contract JEV): C1, C3, D1-D5, F1-F5.
