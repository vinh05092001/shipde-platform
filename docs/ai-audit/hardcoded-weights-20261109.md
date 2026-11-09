# Bảng trọng số và ngưỡng ảnh hưởng thứ hạng (bổ sung 3), 09/11/2026

Rà trên main `744c3ccf` và script điều phối ngoài repo `route.js`. **Nguồn** là nơi giá trị được đo hoặc được duyệt có phiên bản. "Không" nghĩa là hằng số trong code, không truy được về dữ liệu đo hay chính sách có phiên bản.

## Có nguồn

| File:vị trí | Giá trị | Nguồn / phiên bản | Số mẫu, độ mới | Tác động |
|---|---|---|---|---|
| `data/scoring-policy.json` | Điểm chất lượng = percentile AA Intelligence Index v5, trọng số 1 | `AA-II-5.0.1-percentile-v1`; quyết định của operator 04/11, làm rõ 07/11 | Theo snapshot `aa-intelligence.json`, `maxAgeMs` 30 ngày | Điểm route.js dùng để xếp writer |
| `scoring-policy.json` `notMeasured` | latency, cost, reliability | Khai báo trung thực là chưa đo | — | Không được cộng vào điểm |

## Hardcode, không có nguồn

| File:vị trí | Giá trị hiện tại | Dùng ở đâu | Ghi chú |
|---|---|---|---|
| `ranking.js:40` `WEIGHTS` | evidence 30, capability 25, headroom 20, spread 15, cost 10 | `scoreCandidate` / `rankAndRecord` | Không có rationale hay số mẫu |
| `ranking.js:332-333` | Mỗi reservation trừ 20, sàn 10 | headroom | Hằng số |
| `ranking.js:88` | Reservation TTL 2 giờ | Giữ chỗ | Hằng số |
| `routing.js:92` `WEIGHT_PROFILES` | LATENCY_FIRST 55/20/25; BALANCED 34/33/33; QUALITY_FIRST 10/65/25 | `scoreForProfile`; là các lựa chọn hỏi Jev | Không có nguồn đo |
| `routing.js:103` `ROLE_FALLBACK_PROFILE` | writer BALANCED, reviewer QUALITY_FIRST… | Khi Jev UNDECIDED | Chính sách chưa có phiên bản |
| `routing.js:122` | `BUSY_PENALTY_PER_RESERVATION` = 20 | Phạt khi bận | Hằng số |
| `routing.js:129` | `UNKNOWN_EVIDENCE_PENALTY` = 15 | Thiếu bằng chứng | Hằng số |
| `routing.js:132-133` | Phạt tuổi tối đa 15, tin trong 30 ngày | Bằng chứng cũ | Hằng số |
| `routing.js:82` | Regex họ Claude bị loại theo chính sách | Loại route | Chính sách viết cứng theo tên |
| `routing.js:118-119` | Treo 7 phút / 12 phút | Chọn lại route | Hợp đồng TASK-AI-65; có ghi chú nhưng không có phép đo |
| `priors.js:15` `TIER_BONUSES` | T1 +6, T2 +4, T3 +2, T4 0 | Điểm prior | Hằng số |
| `priors.js:23` `ROLE_BENCHMARK_WEIGHTS` | writer: coding 0,6 / agentic 0,25 / intelligence 0,15 … | Trộn benchmark theo vai trò | Mâu thuẫn với chính sách "một thang AA, trọng số 1" |
| `priors.js:22` | `FALLBACK_COVERAGE` 0,25 | Benchmark dự phòng | Hằng số |
| `route.js:53` | `MIN_WEEKLY` 0,05 | Loại lane agy | Hằng số |
| `route.js:92` | `MAX_PER_MODEL` 3 lần / 20 phút | Giới hạn launch | Hằng số (slice 10 sẽ chuyển thành dữ liệu) |
| `route.js:314` | `COOLDOWN_H` 3 giờ | Làm nguội route lỗi | Hằng số |
| `route.js` (chọn cuối) | Lấy 5 ứng viên đầu, chia theo các mức của rubric | Chọn writer | Chính sách operator 05/11 (Jev chấm độ khó, không chọn route); số 5 là hằng số |

## Số đếm

| Chỉ số | Số |
|---|---|
| Nhóm giá trị đã rà | 19 |
| Có nguồn và phiên bản | 2 |
| Hardcode, không có nguồn | 17 |
| Trong đó mâu thuẫn chính sách đã duyệt | 1 (`ROLE_BENCHMARK_WEIGHTS` so với "một thang AA") |

## Việc tiếp

1. Làm rõ nơi chọn cuối cùng:
   - Controller chấm điểm theo `scoring-policy.json`.
   - Jev chỉ chấm độ khó (chính sách 05/11).
   - route.js không được tự chấm lại.
2. Chuyển các hằng số còn dùng vào `scoring-policy.json` hoặc file chính sách có `version` và `rationale`, kèm số đo hiện có. Thiếu số đo thì ghi `notMeasured`, không tự đặt giá trị 0.
3. `ROLE_BENCHMARK_WEIGHTS` và `WEIGHT_PROFILES`: hoặc bỏ cho khớp "một thang AA", hoặc đưa ra để anh duyệt có phiên bản.
