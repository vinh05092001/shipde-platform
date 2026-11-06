# Lần theo TASK-AI-169 (#505) qua đường đang chạy

Dữ liệu: log và code sẵn, không gọi model. Mã scratch ở `scratch-snapshot/`, SHA gốc ở `SHA1SUMS.txt`. Core tại `1b7a969d`.

## Tổng quan 03/11 08:41 đến 06/11 09:58

| Chỉ số | Giá trị |
|---|---|
| Lượt launch writer | 125 |
| Có dòng lỗi trong log | 46 |
| Không gọi tool nào | 63 |
| Số model/route khác nhau đã thử | 33 nhãn |
| Dòng `route` / `GUARD` / `killed failed` / `killed hung` | 142 / 62 / 58 / 13 |
| Review có ghi nhận | 44: 28 `CHANGES_REQUIRED`, 4 `SKIP`, 12 trống |
| `REVIEWER FAILED` / `STUCK` | 7 / 5 |
| Merge | 0 |

Hơn một nửa số lượt launch (63/125) không làm được gì trước khi kết thúc. Tổng phút writer: UNKNOWN, phép tính từ mtime log không tin được.

## Từng bước

| # | Bước | Scratch (file:hàm) | Đầu vào → đầu ra | Core tương ứng | Tình trạng |
|---|---|---|---|---|---|
| 1 | Nhận lỗi | `codex-delta-review.sh:22` | CI đỏ → `review.txt` kèm log đã cắt bằng grep | `review-loop.js` `runReviewLoop` | Scratch làm lại. Log bị cắt (`--`) |
| 2 | Dựng phiếu | `route.js` nhánh step, `ci-failure.js` | `review.txt` → `task-step.md` | `orchestrate.js:1380` `repairSpec` | Scratch làm lại. B1/B2 đã sửa, mock đạt |
| 3 | Context/tool | `pipeline-run37.sh:50` | Tên file trong review → `pack-spec.json` → `context-pack.md` | `orchestrate.js:4074` `createContextPackAsync` | Scratch gọi được core packer, nhưng output không tới worker |
| 4 | Chọn model | `route.js` | Probe, scoreboard → `choice` | `routing.js`, `cli.js dispatch` | Scratch bỏ qua core; core đang `STALE_CATALOGUE` |
| 5 | Launch | `route.js` `launch()` | Prompt → `opencode run` hoặc `job.json` | `agy-pool-runtime.js` `submitJob` | Scratch bỏ qua khoá `job.lock` |
| 6 | Test/CI | Worker tự chạy; CI GitHub | Commit → kết quả | Như nhau | Writer commit nhưng 4 commit chưa lên PR lúc rà |
| 7 | Review | `reviewer-pick.js`, `review-many.js` | Delta → verdict | `review-loop.js` | Scratch làm lại |
| 8 | Repair hoặc dừng | `pipeline-run37.sh` vòng lặp | Verdict → route lại | `orchestrate.js:8990` `repairRound` | Điều kiện quay vòng rời rạc |

Điều kiện quay vòng: mỗi khoảng 2 phút; không review khi writer còn sống (`:104`); review khi có commit chưa lên hoặc head chưa review (`:105-106`); `STUCK` khi có từ 3 `CHANGES_REQUIRED`, trừ `CI gate`; item bị `GUARD` thì bỏ qua lượt. Thời gian từng bước: UNKNOWN, log không lưu đủ mốc.

## Repo và tool trong task này

| Tool | Khai báo | Cài | Caller thật gọi | Output tới worker | Worker dùng |
|---|---|---|---|---|---|
| repomix | Scratch; dependency trong #494, chưa merge | `<scratch>/repomix-1.18.1` | Có, `pipeline-run37.sh:50` | **Không**, prompt không nhắc | Không |
| context-pack (core) | Có | Có | Có | **Không** | Không |
| jcodemunch | `opencode.json` bật | MCP dùng chung | `route.js` chỉ khởi động server | Tool khả dụng | 3/20 log gần nhất |
| serena | Tắt | UNKNOWN | Không | Không | Không |
| pr-agent | #488 đã merge | UNKNOWN | UNKNOWN trên đường này | UNKNOWN | UNKNOWN |
| markdownlint | Thuộc 164, chưa merge | UNKNOWN | Không | Không | Không |

Với 169 lúc 09:44, pack chỉ gói `.oc/pr-body-remote.md` và `AGENTS.md` (6.5 KB), không có code liên quan: `pipeline-run37.sh:50` lấy tên file bằng regex trong `review.txt`, nên review CI không nêu file thì pack vô nghĩa. Bản 134 KB trước đó cũng không tới worker.

Code mượn: repomix chạy nguyên bản bằng CLI. 169 không mượn repo ngoài: `run-ledger.js` tự viết và trong lượt này được yêu cầu làm adapter mỏng trên `ProgressLedger` có sẵn của repo. Thời gian mất ở tích hợp, CI, review, gọi lại model: chưa tách được. Bằng chứng gián tiếp: 63/125 lượt không có tool, 46 lượt có lỗi, tức phần lớn mất ở gọi lại model.

## Lỗi có thể giao sửa

| ID | Lỗi | Ca tái hiện | File được sửa | Test chứng minh | Người giữ |
|---|---|---|---|---|---|
| T1 | ĐÃ SỬA: PR body không tới GitHub | 169: nhiều commit sửa body nhưng `contract` vẫn đỏ | `pipeline-run37.sh` | Log `synced PR body to #505` 09:58; cần `contract` xanh | Claude |
| T2 | Pack không tới worker | 169 có `context-pack.md`, `task.md` không nhắc | `route.js` `launch()` | Mock: có pack thì prompt chứa đường dẫn; không có thì không | Claude |
| T3 | Pack không có code khi review không nêu file | `pack-spec.json` 09:44 | `pipeline-run37.sh:50` | Mock: lỗi CI tên test thì spec có file đó và file đổi của PR | Claude |
| T4 | Commit repair chưa lên PR | Nhánh `ahead 4`, PR vẫn `b5b7cc68`, `SKIP` lúc 09:44 | `pipeline-run37.sh`, `codex-delta-review.sh` | Mock: ahead > 0 thì push trước khi review, hoặc log lý do | Claude |
| T5 | Phiếu ghi "Jev rated hard" khi tách bước do `roundsSoFar>=3` | Mock 169: Jev `simple`, phiếu vẫn ghi hard | `route.js` | Mock kiểm câu đúng nguồn | Claude |
| T6 | Log CI trong review bị cắt | Mẫu contract có `--`, mất mục | `codex-delta-review.sh:22` | Mẫu log đủ 10 mục giữ đủ | Claude |
| T7 | `route.js:390` bỏ qua `job.lock` (A2) | Job quét 09:14 ghi đè `job.json` | `route.js` `launch()` | Mock: lane có lock thì không ghi | Claude |
| T8 | Lần launch 0 tool vẫn được tính như một lượt | 63/125 | Ranking, health | Dùng route-log làm fixture | AGY |

Repair không chạy mà review lại cùng SHA: chỉ thấy 1 SHA review 2 lần (`e214960f`) trong 31 file review. Không phải vấn đề chính ở 169, không giao sửa. Kẹt chính là T1, T4.

## Scratch bỏ qua core

- Chọn route: toàn bộ.
- Khoá lane AGY: T7.
- Repair và review: chạy song song với `repairRound`, `runReviewLoop`, chưa đối chiếu từng hàm: UNKNOWN phần nào thay thế được ngay.
- JEV: `ask-jev.js` gọi `jev.advise` trực tiếp, không qua `routing.js`.
- Dùng core: `context-pack.js`, `health`, `route-health.js`, `cli.js dispatch` (đang lỗi).
