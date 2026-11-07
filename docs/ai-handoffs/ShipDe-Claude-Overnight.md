# ShipDe — Kế hoạch hoàn tất luồng, bàn giao 07/11/2026

## Lệnh thực hiện hiện hành

Claude tự điều phối và thực hiện hết phạm vi bên dưới, không chờ người dùng duyệt từng bước và không hẹn xong khi chưa có bằng chứng. **Phần kế hoạch này ưu tiên hơn các trạng thái hoặc giới hạn giai đoạn cũ trong phụ lục.** Không dùng “chưa được giao scoring/JEV” để đứng chờ nữa. Việc gọi kiểm thật chỉ trong quyền và ngân sách sẵn có theo mục 8. Merge/restart dịch vụ chung vẫn cần quyền hiện hành rõ ràng, không suy từ “làm hết”.

Mục tiêu cuối: cùng một phiếu đi qua nguồn/catalogue → bằng chứng đủ điều kiện → điểm có nguồn → quyết định Controller/JEV → argv nguyên vẹn → worker tạo diff → kiểm test/review; gặp lỗi thì giữ diff và fallback/dừng đúng giới hạn. Không lấy số PR merge, fixture PASS hay lệnh dựng được thay cho kết quả này.

## 0. Chốt trạng thái và giám sát trước khi mở lượt

- Đọc AGENTS.md, Work Item, hướng dẫn Karpathy #519 và R01–R16 trong phụ lục. Đo RAM khả dụng/commit/paging và tiến trình đang có. Không restart phiên đang làm chỉ để nạp hướng dẫn.
- Kiểm GitHub/local HEAD, PR, branch và diff thực. Các số dưới đây là mốc báo cáo để tìm lại, không phải trạng thái hiện tại: main từng 185459dc; #528 e57af507; #526 5ff595e6; SCORE/ROUTE chưa commit; OC2 17/17 chưa review; ORDER/H/G đã push chưa PR.
- Tạo bảng RUNS từng phiếu: owner, vai trò/model/route, worktree/PID/run ID, SHA, giai đoạn, tín hiệu tiến triển cuối, lần kiểm tiếp, RAM, blocker và bước tiếp. Ghi nguồn lựa chọn; Codex làm tác giả tạm không được ghi là Controller chọn.
- Kiểm mọi worker/review/CI/refresh ít nhất mỗi 2 phút. 5 phút đứng thì xem PID/log/test/diff; trước 10 phút phải hành động. Test dài có heartbeat hợp lệ tiếp tục theo dõi; log lặp/PID sống không đủ. Nếu không giám sát nổi thì giảm concurrency.
- **Đạt:** bảng bao phủ tất cả việc đang chạy; không phiên kẹt vô chủ; RAM và số luồng có số đo, không đoán.

## 1. Hoàn tất #528 — cache catalogue và lỗi dispatch treo

**Điểm bắt đầu:** priors.js/liveModelIds/getRouterPrefixes và test cache; báo cáo 11.904 dòng bị đọc lại nhiều lần, >280 giây xuống 9 giây/377 ứng viên. Đọc diff hiện tại để xác nhận đường gây lặp, không chỉ dựa vào profile kể lại.
- Chốt test cú pháp/format/cache tại exact HEAD. Kiểm cache đổi khi file thay, file thiếu/lỗi đọc, không tái dùng dữ liệu từ checkout khác. So trước/sau cùng catalogue và phiếu; ghi thời gian, số đọc file, số ứng viên.
- Gọi Codex độc lập review và sửa finding. Xem CI exact SHA. Không push test đang lỗi cú pháp.
- Dùng worktree cố định tại SHA được kiểm. route.js tự checkout origin/main ở p-run-main: thêm cách trỏ checkout kiểm đã được kiểm soát hoặc fixture integration; ghi SHA thực chạy, không sửa trực tiếp worktree tự reset rồi tưởng fix có hiệu lực.
- **Đạt:** test cache/đổi file đạt, không regression mới so base trong điều kiện tương đương, review đúng SHA, dispatch hoàn thành và có phép đo tái hiện. Không bắt buộc merge để kiểm một SHA riêng.

## 2. Refresh chỉ liệt kê, dry-run không âm thầm tiêu inference

**Điểm bắt đầu:** catalogue-refresh.js, quota-scan.js, rolling-onboard.js và nhánh dispatch freshness; đối chiếu #512 đã merge.
- Trace refresh đến từng endpoint. Tách liệt kê /models và metadata khỏi scanScope/probe gọi completions. Refresh mặc định không gọi inference; chỉ probe khi người gọi yêu cầu rõ qua cơ chế cấu hình hiện có.
- Ghi kết quả từng nguồn thành công/thất bại, thời gian và freshness thật. Một nguồn lỗi không làm mất mọi nguồn thành công. Không sửa timestamp hoặc nới gate 48 giờ để qua.
- Dry-run offline: chặn mạng/spawn trước; dùng snapshot/mock. Kiểm đọc combo admin và JEV là yêu cầu cần có chế độ fixture riêng, không coi localhost là tự động không tốn phí nếu nó proxy inference.
- Với lượt 280 giây/refresh 25 phút cũ: phân loại từ log phần CPU, chờ nguồn và inference; số nào chưa đo thì ghi đã kiểm mấy log và cần dữ liệu gì. Không chạy refresh dài lại nếu chưa biết nó tiến triển ở đâu.
- **Đạt:** mock ghi 0 inference trong refresh liệt kê/dry-run offline; catalogue mới đúng đường dispatch đọc; thiếu/stale thật trả lý do cụ thể; nguồn thành công vẫn sử dụng theo contract #512.

## 3. Truy vì sao chọn 61 thay vì 76 — sửa đúng điểm nối

**Điểm bắt đầu:** scratch/route.js:controllerRanking và cli.js dispatch --item/--profile; #516/#521/#527, sources.js:dispatchRoute/qualifyModel, executor.js:resolveRoute.
- Lấy cùng phiếu, thời điểm, snapshot và policy, ghi candidate trước/sau mỗi lọc; giải thích route 76 bị loại hoặc vì sao 61 thắng. Điểm khác thang không được so. Không khẳng định route 76 phải thắng nếu nó không launch được, thiếu quota/ngân sách hoặc năng lực.
- Không parse “Ranked candidates” để mất identity; dùng quyết định cấu trúc của chính phiếu. Giữ source/gateway/modelId/account đã xác minh, scoreBreakdown và reason qua reentry.
- Đọc nhánh thật vinh bằng readComboConfig. Phân biệt gọi cả vinh, chọn nhánh riêng qua 9Router và nguồn ngoài. Nhánh chỉ có catalogue không biến thành thành viên; membership không chứng minh liveness. Explicit config override 0 admin GET; auto read một lần/dispatch, lỗi đọc có mã và không suy danh sách.
- **Đạt:** --item và --profile qua entry point thật cho cùng chính sách/quyết định trên cùng dữ liệu; record giải thích mọi loại/đổi; argv giữ prefix registry đúng một lần và model ID nguyên văn. Không “find theo model” hoặc mượn quyết định TASK-AI-158 cho R4.

## 4. Chốt SCORE/ROUTE và policy thật cho #526

**Điểm bắt đầu:** phần CODEX POLICY đã viết, scoringPolicy loader, ranking.js:scoreCandidate/rankAndRecord, routing.js:scoreForProfile/rankForProfile, priors.js, cli.js.
- Đóng gói thay đổi SCORE và ROUTE đang dở: kiểm diff/worktree, test 88/88 hoặc test 195 dòng là mốc cũ; chạy lại đúng HEAD, commit/draft đúng phạm vi, review.
- Trace đủ 20 mục từng audit, 15 hardcode là mốc phải xác minh lại. Bảng mỗi trọng số/điểm/bonus/phạt/ngưỡng: giá trị, file:hàm, nguồn, đơn vị/thang/version, số mẫu, độ mới và ảnh hưởng.
- Nạp phép đo đã có: benchmark đúng model/version làm tham chiếu; lịch sử chỉ tính sau diff/test/review xác minh. Không dùng launch count/ping/PASS bị bác làm điểm coding. Không đoán alias; model ID gọi không bị đổi để khớp benchmark.
- Claude tự đề xuất policy từ số liệu và tiêu chí phiếu, kèm rationale/replay để Codex kiểm. Không hỏi chung “anh chọn trọng số nào” rồi đứng chờ. Không bịa trọng số, không chuyển WEIGHTS sang JSON rồi báo real; nếu chưa có dữ liệu đủ cho công thức, nộp chính xác phép đo còn thiếu và dùng trạng thái chưa đủ bằng chứng. Phần nạp/điểm nối vẫn phải hoàn tất trên fixture.
- Dry-run và execute dùng cùng nguồn policy/cùng dữ liệu. Quyết định phải ghi điểm từng phần, nguồn và version; không âm thầm fallback về unsourced nếu phiếu yêu cầu measured.
- **Đạt:** policy được loader thực nạp và đi vào dispatch; có ca dùng dữ liệu đo thực tái tính được kết quả, số tiêu chí đã có/thiếu rõ; 4.000 ca 0 lệch chỉ ghi tương thích, không nhận là hết hardcode. Các 19 ca không chọn được phải phân loại. Không có số đo thì REAL SCORE chưa đạt, nhưng chốt patch và tiếp tục việc độc lập.

## 5. Nối JEV bằng call path thực, không dựa tên wrapper

**Điểm bắt đầu:** cli.js gọi jev.js, jev-wrapper.js, ask-jev.js local, assessTask/buildJevAsk/adviseModelChoice.
- So contract mới trong jev.js với đúng hàm pipeline gọi. Không ai require wrapper không có nghĩa mọi thay đổi #525 đều vô hiệu; tránh thêm ask trùng.
- Phiếu rõ (sửa PR body thiếu mục) skip có lý do. Phiếu mơ hồ hỏi phân loại bằng key đúng. Khi cần hỏi chọn, chỉ gửi routeId trong shortlist đã qua lọc, context tối thiểu có evidence; JEV không mở lại route đã chặn và không ghi đè budget/auth.
- Ghi schema/key, loại câu hỏi, call/skip reason, confidence, probabilities được phép, thời gian và usage quan sát được. Không công khai prompt/body thô/secret.
- Test DECIDED hợp lệ, outside ID, thiếu options/evidence, confidence thấp, timeout và parser. Ca đủ bằng chứng mà UNDECIDED phải điều tra payload/ngưỡng/parser, không hạ ngưỡng ép quyết định. Ca lỗi có kết quả fallback/BLOCKED cụ thể.
- **Đạt:** trace từ cli.js tới request mock và response thể hiện contract đúng; đếm số gọi, skip, DECIDED/UNDECIDED theo lý do, không gọi dư. Live JEV theo cổng mục 8, không nhận mock là live.

## 6. Hoàn tất OC2 và cơ chế lỗi giữa chừng

- Đọc verdict OC/OC2 và diff, sửa finding, chạy lại 17/17 tại SHA cuối và Codex review lại. Chưa cài patch vào runtime thật trước khi kiểm.
- Dùng mock đo OpenCode có tới endpoint không, max_tokens thực và số request khi 402/429. Một request tới mock trước rồi mới chạy ma trận, không lặp bốn ca khi init còn kẹt. Có dependency đã cài thì dùng lại, không dựng thêm hạ tầng chỉ để tránh đọc lỗi đầu tiên.
- Timeout chỉ chặn thời gian, không chứng minh trần request/tiền. Tách retry OpenCode, đổi account/model trong 9Router và đổi worker Controller. 402 không gửi lại cùng yêu cầu; 429 áp đúng phạm vi có bằng chứng.
- Với cùng phiếu: A tạo diff rồi lỗi → xác nhận A dừng → B cùng worktree đọc diff → B lỗi thì dừng ở trần một fallback. Ledger qua restart; không hai worker ghi chung; thiếu connectionId thì không chặn cả account/upstream theo suy đoán.
- **Đạt:** exit code/log/argv/số request từ mock, test restart/diff/limit và Codex PASS đúng SHA. Nếu client không thể đảm bảo yêu cầu, ghi điều kiện live bị chặn và giải pháp nhỏ nhất để kiểm tiếp; không ép bật worker thật.

## 7. Nghiệm thu offline trọn luồng trước khi gọi thật

Claude giữ integration worktree cố định, ghép các commit đã kiểm; review riêng các conflict. Dùng đúng entry point route.js/pipeline, không gọi helper thay rồi nhận là pipeline.
- Phiếu cụ thể có scope, quyền repo, test, budget, policy/version và runId.
- Snapshot/mock catalogue và vinh thật đã che, nguồn ngoài, JEV fixture; chặn network/spawn không mong muốn trước.
- Đi trọn: phiếu → nguồn/nhánh → điều kiện → điểm → JEV/skip → quyết định → executor/argv → stub diff/test → lỗi/fallback/dừng.
- **Đạt:** một artifact có mốc thời gian, exact SHA code/policy/data, route/ID/prefix, lý do loại, score breakdown và số request/spawn; hai route cùng model/account không gộp nhầm, combo không ghi công model con chưa xác nhận. Codex độc lập replay được. Báo OFFLINE PASS, không LIVE PASS.

## 8. Ca gọi model/JEV thật có giới hạn

Đây là nghiệm thu có điều kiện đã được giao, không tự chi thêm tiền: dùng route miễn phí đã xác minh hoặc ngân sách đã được phép, credential qua cơ chế sẵn có; không đọc file credential hoặc in key.
- Tự kiểm các nguồn hiện có và quota trước giao; không hỏi người dùng chọn tên model thay Controller. Nếu mọi route thiếu bằng chứng, chỉ nêu đúng quyền/quota/phép đo còn thiếu. Không nạp credit, mua gói hay gọi trả phí không có trần.
- Sau mục 6–7: một bài harness nhỏ trong worktree riêng đọc file, sửa một dòng, chạy test; sau đó một phiếu thực nhỏ nếu harness đạt. JEV một ca nhỏ nếu cần kiểm live và được phép.
- Tối đa một fallback mỗi phiếu, watcher toàn thời gian; lỗi đầu tiên giữ log và sửa nguyên nhân, không thử hết model. Kiểm diff và chạy lại test độc lập; account/model gateway không trả thì ghi không quan sát được và số request đã đối chiếu, không bịa danh tính.
- **Đạt:** log cùng runId từ quyết định tới kết quả, diff/SHA/test độc lập, usage/chi phí nếu trả về; thiếu usage ghi số request đã đo và nguồn thiếu. Ghi riêng MODEL CALL VERIFIED, REAL SCORE VERIFIED, JEV VERIFIED và LIVE TASK PASS, chỉ đánh đạt phần có bằng chứng.

## 9. Repo/công cụ và các việc dở — dùng đúng, không chặn nghiệm thu

- Graphify local đã cài theo báo cáo: kiểm version/index đúng SHA trước dùng; query/path định hướng, mở code/test kiểm lại vì lazy require có thể thiếu cạnh. Không reindex chỉ để đo RAM khi nó chặn luồng chính.
- Mỗi phiếu ghi repo/ref/file:test tái sử dụng. Dùng jcodemunch/rg, Repomix kiểm pack thực vào prompt, Context7 chỉ tra API version khi cần. Model ngoài cũng đọc quy tắc và tài liệu qua công cụ hoặc context đã rà, không có dữ liệu bắt buộc thì không giao.
- Chốt ORDER/H/G đã push thành PR kiểm chứng theo phạm vi và base; không tạo PR trùng. Kiểm lịch sử 54 PR đã rà; 0/65 chỉ nghĩa chưa đối soát được danh sách gốc. Không để tìm danh sách chặn phần core.
- PR cũ/register/OneDrive/dọn >60 worktree/hooks/ai-memory là backlog sau mốc offline; không đổi dịch vụ hoặc xóa thư mục dở tự tiện.
- **Đạt:** bảng đã cài/đã nối/đã quan sát dùng và số liệu đọc/dùng repo; diff/PR/SHA cho phần thực hiện. Không coi có file skill là worker đã dùng.

## 10. Review, bàn giao và quyền tự quyết

- Mỗi phiếu một thay đổi hành vi đủ nhỏ, mục tiêu khoảng 400 dòng; tách theo AC nhưng không thêm tầng kiến trúc. Kiểm code/test/gỡ fix khi cần, chạy liên quan đúng HEAD; kết quả base so cùng điều kiện.
- Codex CLI tài khoản chính hoặc Codex qua AgentRouter review độc lập; nếu Codex là tác giả dùng phiên fresh, không tự duyệt. Gửi PR/base/HEAD/AC/test/risks; verdict file:dòng và evidence. Model reviewer khác chỉ bổ sung khi phiếu yêu cầu Codex.
- Được viết/sửa/push/draft, cập nhật Work Item/register đúng sự thật; tự sửa tái hiện được hoặc giao Codex làm writer khi Controller đang hỏng, ghi rõ tạm thời. Không cần chờ cấp lượt để phân tích offline hoặc tiếp tục phiếu khác.
- Hết fallback dừng phiếu, không dừng kế hoạch. Không reset bằng đổi tên; chỉ mở lượt sau bản sửa nguyên nhân/AC mới có bằng chứng và log quan hệ. Chỉ hỏi khi cần quyền thật, key thiếu hoặc ngân sách, sau khi làm mọi phần độc lập.
- Chưa được merge, restart pipeline/daemon chung, sửa combo vận hành, ghi đè health/evidence thật, thay gate/baseline/allowlist/.github, force-push/reset --hard/--no-verify/--admin. Không đổi quyền plugin sang Allow all actions, không đọc credential, không xuất raw log/PII/prompt đầy đủ ra public.
- Bảng bàn giao cập nhật liên tục: mục 0–10 + A–H/R01–R16, owner, trạng thái, PR/HEAD, test pass/fail/skip, CI/review, thời gian, request/token quan sát được, blocker/người gỡ và bước tiếp. Nếu còn việc chạy thì watcher còn chạy; không dừng progress.log chỉ vì writer đã xong.
- **Hoàn tất** khi mỗi yêu cầu có verdict và bằng chứng; phần không chạy được có blocker cụ thể, số đo đã thử và cách gỡ. Không hứa mốc xong thay kết quả.

---

# Phụ lục: yêu cầu gốc A–H/R01–R16 (giữ để đối chiếu)

## Quyền tự quyết — lệnh mới nhất, thay mọi giới hạn giai đoạn cũ mâu thuẫn

Người dùng giao Claude chủ động hoàn thành A–H và R01–R16. Không hỏi lại cho từng phiếu, từng bản sửa, mở draft, cập nhật Work Item/register hoặc đổi vai trò writer/reviewer. Mốc thời gian trong tên tài liệu không phải hạn tự dừng; làm tiếp tới khi hoàn thành phạm vi hoặc từng blocker được ghi cụ thể.

1. **Được sửa đầy đủ luồng:** #520, #521, STALE_CATALOGUE/catch nuốt lỗi (đối chiếu #512 để dùng lại), nguồn/định danh/health, scoring/trọng số, JEV, dựng phiếu, handoff và điểm nối dispatch/orchestrate/intake. Mỗi phần có phiếu, base SHA, file cho phép, test và PR nhỏ riêng; không gộp cả luồng vào một diff lớn. Tự điều chỉnh thứ tự theo phụ thuộc, làm các phần độc lập trong lúc CI/review chạy.
2. **Được tự làm tác giả khi điều phối bị kẹt:** nếu Controller chưa chọn được route, không gọi lặp pool probe. Claude được tự sửa phần tái hiện được hoặc giao Codex CLI user chính làm writer trong worktree riêng, ghi rõ đây là đường khắc phục tạm chứ không phải Controller đã hoạt động. Reviewer phải là phiên độc lập qua Codex CLI/AgentRouter đủ điều kiện; không tự duyệt. Khi sửa xong quay lại kiểm Controller.
3. **Một fallback giới hạn việc gọi, không giới hạn trách nhiệm:** hết hai lượt thì dừng phiên lỗi, xác nhận đã thoát và giữ diff/log. Claude lập tức tìm nguyên nhân offline hoặc làm mục độc lập khác; không dừng toàn bộ và chờ người dùng cấp lượt. Không đổi tên phiếu để reset số lượt. Chỉ mở lượt khác cho công việc mới có phạm vi/AC khác thực sự hoặc sau khi có bản sửa nguyên nhân và bằng chứng mới, ghi quan hệ với phiếu cũ.
4. **Tự quyết các lựa chọn kỹ thuật có bằng chứng:** giữ prefix theo provider/schema và kiểm argv, không hỏi chỉ vì reviewer có ý kiến khác. Tự tái hiện finding; không đúng thì phản biện bằng code/test, đúng thì sửa rồi review lại. Auth/quota không đoán, thiếu dữ liệu thì thu thập bằng log/config và API đọc đã cho phép, không in secret.
5. **Cổng kiểm thật:** offline chặn mạng trước. Được dùng credential qua cơ chế cấu hình sẵn có và gọi một ca harness/JEV/task nhỏ trên worktree riêng khi route đủ điều kiện, kiểm soát được thời gian/lượt gọi và nằm trong hạn mức miễn phí hoặc ngân sách đã được người dùng cho phép. Không đọc file credential, nạp credit, mua gói hoặc gọi route trả phí khi chưa có ngân sách. Chưa kiểm được giới hạn thì giữ riêng LIVE BLOCKED và tiếp tục sửa offline; không dùng nó để dừng A–H. Không sửa combo vận hành, không restart daemon hoặc pipeline chung.
6. **Giám sát cả người điều phối:** ngoài watcher worker, Claude phải kiểm hàng đợi ít nhất mỗi 2 phút. Không để tất cả việc đứng quá 10 phút vì đợi một lựa chọn kỹ thuật có thể tự giải quyết; chuyển việc độc lập hoặc xử lý root cause. Nếu chỉ còn blocker thật cần người dùng (quyền, key thiếu, tiền chưa duyệt), gửi một báo cáo gộp gồm bước đã thử, lỗi/exit code và yêu cầu tối thiểu, sau khi hoàn tất mọi phần làm được.
7. **Kết thúc:** cập nhật bảng A–H/R01–R16, exact SHA, CI và Codex verdict, số liệu thật và blocker. Được push/draft và sửa contract trung thực; không tick bằng chứng chưa có. Chưa được merge, bỏ gate, force-push hay restart pipeline chung. Không tự sửa quyền plugin sang Allow all actions; báo action cụ thể bị chặn và dùng đường review còn được phép.

## R16 — Tận dụng RAM và theo dõi từng luồng

- Trước khi chia luồng, đo RAM vật lý tổng/còn khả dụng, bộ nhớ đã commit so với giới hạn, dấu hiệu paging và mức tăng bộ nhớ của các worker đang chạy. Trên Windows dùng Task Manager hoặc bộ đếm hệ thống/PowerShell; tính cả tiến trình con, test/build, daemon và Docker/WSL nếu đang chạy. Ước lượng theo mức đỉnh của tác vụ tương tự; chưa có số liệu thì mở thử từng luồng và đo lại, không đoán số worker từ RAM tổng.
- Xếp hàng theo phụ thuộc và quyền ghi. Chỉ mở thêm luồng độc lập khi số đo cho thấy còn dư địa cho tác vụ mới và các dịch vụ đang chạy; kiểm lại sau mỗi lần mở và khi vào build/test nặng. Khi RAM căng, commit gần giới hạn hoặc paging tăng kéo dài, ngừng mở thêm và giảm tải có kiểm soát; giữ diff, không tự tắt dịch vụ chung. Không tăng số worker nếu thiếu quota, worktree riêng hoặc watcher.
- Claude giữ bảng theo dõi từng luồng: phiếu/worktree, PID hoặc run ID, giai đoạn, RAM quan sát được, tín hiệu tiến triển cuối, lần kiểm tới và hành động. Kiểm ít nhất mỗi 2 phút; lỗi/thoát thì báo ngay, 5 phút không tiến triển thì kiểm PID, log, test và diff. Trước 10 phút phải xác định tình trạng và xử lý: test dài có bằng chứng đang chạy thì tiếp tục theo dõi; luồng kẹt thì dừng đúng phiên, xác nhận đã thoát, giữ diff rồi tối đa một fallback nếu đủ điều kiện; nếu không thì ghi BLOCKED và chuyển việc. Log lặp hoặc PID còn sống đơn thuần không chứng minh tiến triển.
- Nghiệm thu: ghi RAM trước/sau, mức đỉnh quan sát, số luồng chạy đồng thời, lý do tăng/giảm, và thời gian từ tín hiệu cuối đến phát hiện/xử lý từng luồng kẹt. Nếu chưa đo được, ghi rõ số liệu thiếu và phép đo tiếp theo. Việc gọi kiểm nhỏ thực hiện theo quyền tự quyết ở đầu file; pipeline chung vẫn giữ dừng.

## R13–R15 — Hai đường review, phạm vi Controller và quy tắc chung cho mọi model

| ID | Yêu cầu | Cách làm và bằng chứng nghiệm thu |
| --- | --- | --- |
| R13 | Hai đường Codex review | (1) Codex CLI trên máy, chạy bằng tài khoản user chính; (2) Codex qua AgentRouter. Kiểm từng đường riêng về auth, health, quota, quyền đọc checkout và chạy test. Claude chọn qua chính sách Controller cho các route đã nối; nếu lỗi, tối đa một fallback sang đường đủ điều kiện còn lại. Không hardcode agy01 hoặc tên model. Ghi đường đã dùng, route, base/HEAD, lệnh test và verdict đúng SHA. Chỉ gửi dữ liệu đã được phép qua AgentRouter, không gửi secret, PII hay raw log. |
| R14 | Controller xét cả 9Router và nguồn ngoài | Controller là lớp chọn route, không nằm trong combo. Pool có thể gồm cả combo, nhánh thật qua 9Router, và nguồn ngoài/launcher trực tiếp đã khai báo và xác minh. Nguồn ngoài không phải thành viên combo. Có thể thêm model mạnh làm ứng viên writer/reviewer nếu đủ năng lực, quota và quyền chạy; không tự nâng model đó thành người duyệt cuối. Khi phiếu yêu cầu Codex độc lập, review model khác chỉ bổ sung, không thay verdict Codex. Nghiệm thu bằng replay có đủ ba loại route, lý do xét/loại và đúng ID tới argv; không báo route đã nối nếu chỉ có cấu hình. |
| R15 | Model ngoài dùng đúng repo và cùng quy tắc | Claude giao một phiếu MD và worktree riêng, nêu AGENTS.md, Work Item, Karpathy #519 (chưa merge thì đính bốn quy tắc), repo local liên quan, ref và file:test phải đọc, phần phải dùng lại hoặc lý do không dùng. Trước khi sửa, worker trả danh sách đã đọc và hướng dùng; sau khi sửa, nộp file:hàm/test thực sự dùng, diff và log. Model ngoài không có quyền đọc máy thì cung cấp context tối thiểu đã rà qua kênh được phép hoặc loại route nếu thiếu dữ liệu bắt buộc. Claude đối chiếu bằng chứng đọc/dùng và tuân thủ phạm vi, watcher, bảo mật, test như các worker khác; thiếu thì trả phiếu, không nghiệm thu. |

R13 thay quy tắc cũ khóa agy01; quyền thực hiện A–H do mục Quyền tự quyết ở đầu file quyết định.

## Ma trận yêu cầu → cách làm → kết quả phải nộp

Đây là checklist nghiệm thu chính; chi tiết kỹ thuật nằm ở các mục sau. Trạng thái mỗi dòng: TODO / RUNNING / OFFLINE PASS / LIVE PASS / BLOCKED / N/A có lý do. Không đổi trạng thái nếu chưa có bằng chứng; ghi người giữ, bước tiếp, giờ kiểm, PR và exact SHA. Claude được thực hiện A–H theo quyền tự quyết ở đầu file; chưa merge hoặc restart pipeline chung. Cột kết quả là tiêu chí cần đạt, không phải tuyên bố đã đạt.

| ID | Yêu cầu | Phương pháp | Kết quả và bằng chứng phải nộp |
| --- | --- | --- | --- |
| R01 | Claude điều phối nhiều worker, không lan man | Tách A–H theo file không chồng, một việc/worktree, chọn bằng Controller/JEV qua route.js; kiểm route, năng lực, quota và ngân sách. Đọc AGENTS.md, Work Item và Karpathy #519; chưa merge thì gửi bốn quy tắc. | Phiếu MD có base/SHA, file:dòng, lỗi gốc, hướng sửa, code dùng lại, AC, test và watcher; lý do chọn route, người giữ, mốc kiểm. |
| R02 | Không để phiên chết 10 phút | Kiểm mỗi ≤2 phút; 5 phút đứng thì kiểm PID/log/test/diff; trước 10 phút xác nhận còn tiến triển hoặc dừng đúng phiên, giữ diff. | Mốc giao/tín hiệu cuối/xử lý; không chạy trùng worktree, không quá một fallback mỗi phiếu. |
| R03 | Kiểm kê hơn 30 repo và đợt 65 PR AGY | Dedupe repo/worktree, tìm lại danh sách bàn giao gốc, nối repo/ref → TASK-AI/PR/SHA → file:test tái sử dụng. | Số repo thực, số trùng, số đọc/nối/dùng; số tìm lại trên 65, số đã kiểm và phần thiếu; không thay bằng 65 PR gần nhất. |
| R04 | Công cụ cài rồi phải được dùng đúng việc | Trace manifest→launcher→đầu ra; jcodemunch/rg tìm code; Repomix kiểm pack vào prompt; Context7 tra API khi cần; PR-Agent không thay review độc lập; LiteLLM/RouteLLM chỉ nhận là dùng nếu có code/test cụ thể. | Bảng công cụ đã cài/đã nối/đã quan sát dùng, log hoặc file:hàm, đầu ra thực dùng và lý do nếu không phù hợp. |
| R05 | #521 tự đọc vinh, phân biệt nhánh/combo/nguồn ngoài | Dùng bộ đọc #518; truyền role writer vào candidate assembly. Lọc thành viên chỉ trong pool combo; catalogue chỉ đối chiếu ID. Replay --item và --profile có chặn mạng ngoài. | Auto GET một lần; file override 0; lỗi 401/timeout có lý do, giữ route gọi cả combo; cooldown loại đúng nhánh; route riêng được xét theo chính sách; ID tới argv không đổi. |
| R06 | Health/quota đúng route | Đối chiếu #515/#520, xkiro trực tiếp, 9Router upstream/connection; tách catalogue, ping, harness. Không mượn quota model mẫu hoặc mở rộng 401 thiếu bằng chứng. | A lỗi không phạt B/key chung sai; ghi scope, số ca, lỗi gốc đã che và dữ liệu thiếu. Sửa logic quotaScope trên nhánh và kiểm bản sao; không ghi đè store vận hành. |
| R07 | Phiếu phải đúng lỗi thật | Trace từ check/log qua dựng phiếu; replay TASK-AI-169. | Lỗi thiếu mục PR body chỉ giao sửa PR body; không lẫn yêu cầu RunLedger. Phiếu nêu đúng quyền, test và ngân sách. |
| R08 | Không hardcode model/điểm/trọng số/giới hạn/danh sách | Trace writer và reviewer qua scorer, config, JEV; kiểm mặc định, bonus/phạt, ngưỡng và tie-break. Mỗi giá trị truy về dữ liệu đo hoặc chính sách đã duyệt có phiên bản; đổi sang JSON không tính. Giữ ID gọi, chỉ gộp alias cùng phiên bản có bằng chứng. | Bảng số giá trị rà/có nguồn/hardcode/thiếu, thang, mẫu và độ mới. Cùng snapshot dry-run/execute cùng chính sách; không ép thiếu điểm thành 0, không ưu tiên theo tên. Được sửa bằng patch riêng, có test và Codex review độc lập. |
| R09 | JEV hỏi đúng và đo được | Trace kind/key, payload, options, ngưỡng, parser. Việc rõ bỏ qua; mơ hồ hỏi phân loại; chọn chỉ trong shortlist hợp lệ. Mock ca đủ dữ liệu, confidence thấp, timeout và ID sai. | Tổng ca, gọi/bỏ, DECIDED/UNDECIDED theo lý do. Ca đáng phải quyết định mà UNDECIDED là FAIL và phải truy nguyên; không hạ ngưỡng để ép kết quả. Được sửa contract bằng patch riêng; gọi kiểm nhỏ theo ngân sách và cổng nghiệm thu ở đầu file. |
| R10 | Core tự chọn rồi gọi, fallback không mất diff | Quyết định của chính phiếu qua route.js → #516/executor; không mượn quyết định hoặc viết router mới. Stub A sửa rồi 429 → dừng A → B thấy diff → 402 thì dừng; kiểm restart và tách retry client/gateway/Controller. | Cùng run ID: yêu cầu → lý do chọn/loại → điểm có nguồn → argv → diff/test. Không lượt ba hoặc hai worker cùng ghi. Báo riêng replay, điểm thật, request thật và task thật; Chạy thử có giới hạn theo quyền đầu file; pipeline chung vẫn dừng. |
| R11 | Tìm nguyên nhân, sửa đúng lớp | Tái hiện nhỏ nhất trên base/HEAD cùng điều kiện, lấy lỗi đầu tiên, trace file:hàm, chứng minh đỏ trước/xanh sau hoặc gỡ fix thì đỏ. | Exit code, số test pass/fail/skip, lỗi mới so base và diff đúng AC; thiếu dữ liệu ghi đã kiểm bao nhiêu, thiếu gì, đo tiếp thế nào. |
| R12 | Review và kiểm soát thay đổi | Diff khoảng 400 dòng, quá thì cắt theo AC. Claude tự kiểm diff/test, dùng một trong hai đường Codex dưới đây trong worktree riêng; review lại nếu HEAD đổi. Tuân thủ các cấm Git/bảo mật bên dưới. | Verdict đúng SHA, CI và bằng chứng test; chưa merge/restart. Khi được phép merge mới áp PASS + CI xanh + CLEAN, đọc log PASS và so dòng xóa trước lệnh merge riêng. |

## Bổ sung bắt buộc — repo local, 65 PR AGY và trọng số có bằng chứng

Các mục này bổ sung A–H và được thực hiện theo quyền tự quyết ở đầu file; không cho phép merge hoặc tự nạp credit. Claude giao hai phiếu audit độc lập; ưu tiên repo/PR liên quan A–H, backlog phần còn lại.

1. **Kiểm kê toàn bộ repo trên máy.** Quét các thư mục repo đã cấu hình, phân biệt repo với worktree/clone trùng bằng remote và git identity. Báo số repo tìm thấy, số trùng, số liên quan, số đã đọc và số đã dùng thật; hơn 30 là mốc đối chiếu, không phải số mặc định. Mỗi dòng ghi repo/ref, TASK-AI/PR liên quan, file:hàm hoặc test tái sử dụng, chỗ nối vào ShipDe và bằng chứng chạy. Phân biệt đã cài, chỉ tham khảo, đã nối, đã quan sát chạy. Với mỗi phiếu đang sửa, bắt buộc tra repo liên quan và ưu tiên dùng phần phù hợp đã có; nếu không dùng, ghi lý do. Không quét credential, không đưa đường dẫn cá nhân hoặc raw log lên GitHub.
2. **Đối soát danh sách 65 PR từng giao AGY.** Tìm lại nguồn bàn giao gốc và dùng đúng danh sách đó; không suy ra từ 65 PR gần nhất. Ghép từng PR với TASK-AI, repo tham khảo, trạng thái GitHub hiện tại, exact SHA và bằng chứng code/test thực sự được nối. Báo số tìm lại / 65, số đã đối chiếu, số trùng, số còn thiếu, số đã dùng thật. Nếu thiếu danh sách gốc, ghi nơi đã tìm và số truy được, không bịa phần còn lại. Không sửa lại hàng loạt PR cũ; ưu tiên lấy code/test đã có cho phiếu đang mở.
3. **Cấm trọng số hardcode hoặc hardcode trá hình.** Rà đường chọn writer/reviewer qua route.js, rankForProfile/scoreForProfile, rankAndRecord/scoreCandidate, config và JEV. Lập bảng từng giá trị ảnh hưởng thứ hạng: file:hàm, giá trị hiện tại, nguồn dữ liệu, thang/phiên bản, số mẫu, độ mới và tác động. Bao gồm trọng số, điểm mặc định, bonus/penalty, ngưỡng và tie-break ưu tiên model. Không chuyển hằng sang JSON rồi gọi là dữ liệu thật; mọi giá trị dùng để chọn phải truy được về dữ liệu đo hoặc chính sách đã duyệt và có phiên bản. Thiếu dữ liệu thì ghi số mẫu thực, nguồn còn thiếu và phép đo cần chạy; không tự cho 0, không trộn thang, không ngầm ưu tiên tên model. Fixture chỉ chứng minh logic. Khi scope mở, review cùng phiếu/snapshot, đổi dữ liệu đầu vào hợp lệ thì quyết định đổi có giải thích; dry-run/execute cùng chính sách. Báo số trọng số rà được, số có nguồn, số hardcode, số còn thiếu và diff/test cho từng bản sửa.
4. **Claude giữ bảng bằng chứng và Codex review theo R13 đúng SHA.** Không báo repo đã dùng, PR đã xong, model đã gọi hay điểm đã xác minh nếu không có bằng chứng riêng. Chốt báo cáo theo số đếm và mẫu số, link PR/SHA, test và blocker cụ thể.

**Điểm theo dõi duy nhất:** mỗi phiếu A–H ghi người giữ, trạng thái, PR/SHA, bằng chứng, việc kế tiếp và thời điểm kiểm lại. Claude cập nhật bảng trong báo cáo điều phối khi giao, gặp blocker và chốt review. Việc ngoài A–H đưa vào backlog, không mở rộng phiếu đang chạy.

Claude là người điều phối và tích hợp. Đọc AGENTS.md, kiểm HEAD/CI và các worktree trước khi giao. Mục tiêu tối nay: một phiếu tự đi từ đọc nguồn → lọc → chọn → gọi → nghiệm thu, không nạp quyết định tay. Chạy hết việc độc lập; blocker của một nhánh không chặn nhánh khác. Không giao nguyên tài liệu này cho từng worker.

## Lệnh điều phối trên máy — áp dụng ngay, ưu tiên nếu bên dưới mâu thuẫn

- **Hai đường Codex review:** xem R13; không khóa `agy01`, không tự duyệt.
- **Bắt buộc đọc trước khi sửa:** Claude và mỗi worker đọc AGENTS.md, Work Item và phần Karpathy của #519 (upstream multica-ai/andrej-karpathy-skills). Nếu #519 chưa có trên checkout thì cung cấp đúng diff hướng dẫn đã rà hoặc bốn quy tắc trong phiếu; không coi đã merge. Worker xác nhận đã đọc, nêu giả định, phần code dùng lại và cách kiểm.
- **Dùng công cụ đã cài theo việc:** kiểm manifest/cấu hình thực trước khi giao. Dùng jcodemunch hoặc rg để tìm file:hàm; Repomix chỉ đóng gói file liên quan và kiểm pack thực sự vào prompt; Context7 khi cần đối chiếu API theo phiên bản; dùng lại executor/Paseo, OpenCode và 9Router theo đúng lớp và giới hạn giai đoạn. PR-Agent là bổ sung, không thay Codex. LiteLLM/RouteLLM chỉ coi là đã dùng nếu chỉ ra code/test lấy lại và bằng chứng chạy; không tự cài thêm gateway. Ghi công cụ nào chạy, đầu ra nào đã dùng, công cụ nào không phù hợp và vì sao.
- **Theo dõi từ chọn model đến sửa code:** Claude xem lý do Controller/JEV chọn route, bằng chứng gọi được, năng lực và quota trước launch. Duyệt phiếu MD trước khi gửi: một việc, file:dòng, lỗi gốc hoặc giả thuyết cần kiểm, hướng sửa và code tái sử dụng, giới hạn sửa, lệnh nghiệm thu. Theo dõi log/exit code và diff thực; khi worker lệch phạm vi hoặc sửa triệu chứng, dừng và sửa phiếu. Đối chiếu diff từng hunk với AC, tự chạy lại test trọng yếu rồi mới gọi Codex.
- **Không để task chết 10 phút:** watcher bắt lỗi launcher/auth/quota hoặc worker thoát ngay khi thấy; kiểm tiến triển chậm nhất mỗi 2 phút. Nếu 5 phút không có dấu hiệu tiến triển thực, kiểm PID, lệnh test đang chạy, log và worktree; test dài có heartbeat và bằng chứng đang chạy thì tiếp tục theo dõi. Trước mốc 10 phút không tiến triển, phải ghi nguyên nhân và xử lý: dừng đúng phiên, xác nhận đã thoát, giữ diff, rồi tối đa một fallback nếu đủ điều kiện; nếu không thì BLOCKED và chuyển việc khác. Không reset đồng hồ bằng log lặp, không mở hai worker ghi cùng worktree. Báo thời điểm giao, tín hiệu cuối, thời gian kẹt, hành động và kết quả.

## Quy tắc điều phối và cổng nghiệm thu — ưu tiên hơn mọi mục bên dưới

**Hiện tại:** đối chiếu GitHub, HEAD, worktree và tiến trình để lập trạng thái thực; không dùng trạng thái phiên trước làm lý do đứng chờ. Tất cả A–H được phép sửa và review theo phạm vi đầu file. Giữ #518 tập trung combo, patch 401 riêng; `/v1/models` chỉ đối chiếu ID, không suy thành viên. Không sửa cấu hình combo vận hành hoặc ghi đè dữ liệu thật.

**Vai trò:** Claude sở hữu kế hoạch, giao việc, watcher, đối chiếu bằng chứng và bàn giao; Controller/JEV chọn writer/reviewer qua route.js theo chính sách, không gắn model cố định. Kiểm route gọi được, năng lực/độ mới và quota trước giao; không loại chỉ vì loại giá hoặc một lỗi hiếm, nhưng không vượt ngân sách đã duyệt. Mỗi worker nhận một việc và một worktree; Codex reviewer độc lập dùng đường đủ điều kiện theo R13; không có đường thì ghi review đang chờ. Tối đa một fallback mỗi phiếu, không reset khi restart. Người điều phối không tự duyệt.

**Phiếu giao bắt buộc:** ID | vai trò | mục tiêu/AC | base SHA + worktree | file:dòng và phạm vi được sửa | log/lệnh tái hiện | kết quả mong đợi và lệnh nghiệm thu qua entry point thật (offline trước, kiểm thật theo cổng đầu file) | đầu ra diff/test/SHA | watcher, giới hạn và điều kiện dừng. Prompt đủ ngay lần đầu, mỗi worker có watcher. Áp dụng #519: làm rõ giả định, dùng lại code, sửa đúng phạm vi, kiểm bằng chứng. Không hardcode model, điểm, giới hạn hoặc danh sách nghiệp vụ; dùng nguồn sống/cấu hình có xuất xứ và fixture đóng băng để replay. Không thêm bộ chọn trong scratch.

**Khi lỗi:** lưu lệnh, mã thoát, dòng lỗi đã che, run ID và SHA; tái hiện nhỏ nhất trên base và HEAD cùng điều kiện; trace tới file:hàm đầu tiên làm lệch kết quả. Chứng minh nguyên nhân bằng test đỏ trước/xanh sau hoặc gỡ đúng fix thì đỏ lại; sửa tại lớp gây lỗi, không che triệu chứng bằng đổi model, tăng retry hay nới gate. Replay offline phải chặn mạng trước và ghi số request/spawn. Nếu chưa tìm ra, ghi đã kiểm bao nhiêu ca, dữ liệu cụ thể còn thiếu, phép đo tiếp theo và người giữ việc; không điền UNKNOWN trống hoặc bịa số.

**Phiếu review bắt buộc:** PR + exact HEAD/base, AC, danh sách file và số dòng thêm/xóa, lệnh và số test pass/fail/skip, lỗi mới so base, log đã che. Khoảng 400 dòng là mốc: quá thì cắt theo AC hoặc tách slice. Codex qua đường đã chọn ở R13 đọc diff và chạy lại ca trọng yếu; trả PASS/CHANGES_REQUIRED/BLOCKED kèm file:dòng, mức độ, bằng chứng và điều kiện gỡ. HEAD đổi thì review lại. Giai đoạn này chưa merge; khi được phép, chỉ merge nếu PASS đúng SHA + CI xanh + CLEAN, đã đọc log PASS, so dòng bị xóa với main, rồi merge bằng lệnh riêng. Tiết kiệm GitHub API.

**JEV:** UNDECIDED là tín hiệu cần truy nguyên, không phải nghiệm thu hay nguyên cớ ép chọn. Đo tổng ca, số skip đúng chính sách, số gọi thật/mock, DECIDED/UNDECIDED theo reason, confidence/latency/usage nếu quan sát được. Case đủ dữ liệu, shortlist hợp lệ và kỳ vọng quyết định mà UNDECIDED thì FAIL: trace câu hỏi/key, payload, options, ngưỡng, parser và response; sửa đúng lớp khi được mở scope. Ca cố ý thiếu ứng viên, confidence thấp thật hoặc timeout phải kiểm đường fallback/BLOCKED rõ lý do; không hạ ngưỡng, bịa điểm hay gọi lại vô hạn. #521 chỉ kiểm tác động đến route, không sửa scoring/JEV.

**Bảo mật/Git:** không đọc file credential (~/.pgpass, .env*, file auth); không in/ghi key, Authorization hoặc URL có secret; che secret/PII; không đưa raw log, prompt đầy đủ hay credential lên repo công khai. Không dùng --no-verify, reset --hard, force-push, --admin; không đổi gate config, allowlist, baseline, semgrep, .github/ hay git config toàn cục. Không bật lại Defender, không docker prune -a/--volumes.

## Mở các phiếu song song

| Phiếu | Giao cho worker | Phạm vi và nghiệm thu |
| --- | --- | --- |
| A — Combo và route | Một model giỏi sửa wiring | #521 trên #518. Truyền ngữ cảnh writer vào assembleForDispatch. Phân biệt thành viên thật của vinh, route riêng qua 9Router và nguồn ngoài. Không loại route riêng nếu phiếu cho phép. Replay --item và --profile: đọc tự động một lần, file override không gọi API, lỗi đọc không suy từ catalogue, cooldown loại đúng nhánh, model ID giữ nguyên tới argv. |
| B — Phiếu giao việc | Một model giỏi parse log/test | Tách phần dựng phiếu từ lỗi check thật; replay TASK-AI-169: thiếu mục PR body chỉ giao sửa PR body, không lấy câu RunLedger từ spec làm lỗi. Trả helper và test; Claude giữ scratch/route.js để nối. |
| C — Điểm và định danh | Một model giỏi đọc logic | Trace rankForProfile và rankAndRecord trên cùng fixture. Chuẩn hóa đường quyết định để dry-run phản ánh execute; không trộn thang hoặc ép UNKNOWN thành 0. Nạp điểm tham chiếu/lịch sử có provenance; chỉ chia điểm khi xác minh cùng model/version. Giữ ID gọi nguyên văn. Worker tránh cli.js của A; đề xuất điểm nối để Claude tích hợp sau. |
| D — Launcher và fallback | Một model giỏi adapter/test | Dùng lại #516, executor/Paseo, firstLaunch/afterFailure. Kiểm mode tương thích, bảo toàn worktree/diff, ledger qua restart, 429 → một fallback → 402 → dừng. Tách retry trong OpenCode/9Router khỏi chuyển worker. Chỉ sửa adapter/guard cần thiết; không sửa scratch/route.js của Claude. |
| E — Quota và bằng chứng | Một model giỏi fixture | Kiểm #515/#520 trên đúng SHA: auth không rõ phạm vi không chặn cả key; xkiro trực tiếp không mượn health 9Router; quota mẫu không chứng minh nhánh khác sống. Dùng log/cache hiện có; không in key, sửa store thật hay suy hạn mức miễn phí. |

Giao theo năng lực, bằng chứng làm việc tương tự, launcher tương thích và quota/ngân sách có thể kiểm. Ưu tiên các model khác nhau nếu có route đủ điều kiện; không hardcode tên hay ép đa dạng khi route không chạy được. Worktree riêng từng phiếu, prompt chỉ gồm mục tiêu, file cho phép, fixture, test và đầu ra. Tận dụng phiên và công cụ đã cài. Ping PASS không đủ để xác nhận coding. Không có route đủ điều kiện thì Claude tự làm phần offline hoặc ghi BLOCKED; không thử hết bảng model, nạp tiền hay mở lượt trả phí chưa được phép.

## Claude tích hợp và nghiệm thu

1. Nối A/C để Controller tự đọc danh sách và ra quyết định cho chính phiếu; dùng B để dựng phiếu. Nối D qua entry point pipeline thật, dùng executor hiện có. Tránh viết thêm router. Không mượn quyết định TASK-AI-158 cho R4. Với việc rõ, bỏ JEV; nếu cần hỏi, mock đúng contract phân loại hoặc chọn trong shortlist đã lọc; confidence thấp/ID ngoài shortlist không được ghi đè quyết định.
2. Replay cùng một phiếu bằng stub, chặn mạng: yêu cầu → route được xét/loại và nguồn điểm → quyết định → argv → diff → test/review. Kiểm ca route riêng và gọi combo; không gán account khi gateway không xác nhận. Kiểm lỗi trước khi launch, A sửa dở rồi lỗi → dừng A → B thấy diff → dừng đúng giới hạn. Bài stub đạt thì báo OFFLINE PASS. Chỉ chạy một ca nhỏ thật nếu đã xác minh trần chi phí/retry và được phép dùng route; nếu không, ghi LIVE BLOCKED và lý do. Giữ pipeline chung dừng.
3. Đối chiếu commit/diff thật và tự kiểm test; không tin SHA worker báo nếu git không xác nhận. Push các draft nhỏ đúng stack, ghi base/HEAD, CI và test đỏ mới hay có sẵn. Sau từng patch hoặc khi đủ tích hợp, gọi **Codex độc lập** qua kênh đã cấu hình: đưa PR, exact SHA, diff, yêu cầu, bằng chứng và xin PASS/CHANGES_REQUIRED/BLOCKED. Sửa finding đã xác minh và review lại đúng SHA. Không tự duyệt; nếu Codex không khả dụng thì ghi REVIEW_PENDING kèm phiếu. Không merge hoặc restart pipeline chung.
4. Cuối lượt gửi một bảng: phiếu, model/route, PR/SHA, test/CI, verdict Codex, blocker. Nêu rõ OFFLINE PASS khác LIVE PASS. Không báo xong nếu chỉ mới nối module hoặc CI xanh.

## Phiếu bổ sung — chạy song song với A–E

### F — JEV thật và hợp đồng quyết định
Worker giữ phần JEV, không đụng cli.js của A. Trace scratch ask-jev và tools/ai-brain/jev.js từ câu hỏi tới request/response. Rà việc dùng pick-writer/weightProfile cho độ khó, wrapper bỏ ngưỡng, và nhánh STALE_CATALOGUE chặn trước JEV. Dùng fixture TASK-AI-169: phiếu rõ chỉ sửa PR body thì không gọi; ca mơ hồ hỏi phân loại phiếu bằng contract được xác minh; ca chọn chỉ gửi shortlist đã lọc, nhận routeId hợp lệ. Test confidence thấp, lỗi, timeout, ID ngoài shortlist; Controller giữ quyền quyết định. Mỗi lượt ghi lý do gọi/bỏ, question kind/key, confidence, latency và usage nếu có, không log prompt thô hoặc secret. Sau mock, nếu quyền và quota sẵn có cho phép, chạy một ca JEV thật nhỏ và ghi payload đã che + kết quả; không có thì JEV LIVE BLOCKED. Không coi mock là JEV thật.

### G — Repo/công cụ đã gắn có thực sự được dùng
Worker đối chiếu manifest, launcher, log và đường gọi. Lập bảng INSTALLED / WIRED / OBSERVED / NOT USED kèm file:hàm hoặc log cho từng công cụ thực sự có trong checkout: 9Router, Paseo/executor, OpenCode, Repomix, jcodemunch, Context7, PR-Agent và hướng dẫn Karpathy #519. Không coi khai báo là dùng. Xác minh pack Repomix thật sự vào prompt, tra code theo phạm vi bằng jcodemunch hoặc rg, Context7 chỉ khi tra API theo phiên bản; PR-Agent chỉ bổ sung review khi cần, không thay Codex độc lập. Với LiteLLM và RouteLLM, báo rõ code/test nào tái sử dụng hoặc chỉ tham khảo; không tự lắp gateway thứ hai. Ưu tiên nối công cụ sẵn có vào một ca có bằng chứng sử dụng, không cài hàng loạt. Ghi context thực gửi, số lượt gọi và usage nếu có.

### H — Nghiệm thu core gọi model và chấm điểm thật
Claude giữ tích hợp, worker chuẩn bị fixture và truy vết điểm. Không tuyên bố hiện đã đạt: ca #521 cũ chỉ mock, QUALITY_UNKNOWN; các lần R4 từng lỗi và chưa có ca sửa đạt. Nạp điểm từ lịch sử có diff/test kiểm lại hoặc benchmark đúng model/version, ghi nguồn/thang/số mẫu/độ mới. Tách quality, health, quota/chi phí; không dùng ping, điểm hardcode, PASS bị bác, số lượt launch hay alias chưa xác minh làm điểm coding. Replay cùng phiếu có ít nhất hai ứng viên có điểm truy được; đối chiếu chọn dry-run/execute và ghi điểm từng phần. So vinh, nhánh riêng qua 9Router và nguồn ngoài: combo chỉ ghi công model con nếu xác nhận nó thực thi; trạng thái connection không thấy thì UNKNOWN. Nếu có route đã xác minh, miễn phí hoặc trong ngân sách đã cho phép, và trần retry/output đã đo: chạy một task thật có giới hạn; ghi cùng run ID từ phiếu → score thật → quyết định → argv → log request/provider nếu quan sát được → diff thật → test chạy lại → Codex review đúng SHA. Báo riêng REAL SCORE VERIFIED, MODEL CALL VERIFIED và LIVE TASK PASS/BLOCKED. Không hạ chuẩn hoặc chọn tay rồi gọi là Controller tự chọn.

### Điều phối cuối
A–G chạy song song khi file không đụng nhau; Claude giữ điểm nối chung và H. Tối nay chốt các phần có thể làm, blocker live không được cản hoàn tất patch offline. Báo bảng A–H, kết quả JEV thật, repo nào được dùng thật, điểm thật và lượt gọi thật; mục thiếu bằng chứng ghi UNKNOWN hoặc BLOCKED. Codex review độc lập đúng HEAD, chưa merge/restart pipeline chung.