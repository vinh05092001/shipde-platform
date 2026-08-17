# SHIP DỄ — AUTHORITATIVE SOURCE LOCK (KHÓA NGUỒN CHUẨN)
## HỆ THỐNG KIỂM SOÁT VẬN HÀNH LOGISTICS SHIP DỄ (R1 CONTROL-FIRST)

---

## 1. THÔNG SỐ XÁC THỰC FILE NGUỒN (SOURCE AUTHENTICATION)

* **Tên file nguồn chính thức**: `ShipDe-Ma-tran-Truy-vet-CURRENT.xlsx`
* **Kích thước file**: `26362 bytes`
* **Mã băm SHA-256**: `bb03f76cfb1104a35a620b798460fbaea12f312995c4e864ca9e10ad20dff170`
* **Cấu trúc Sheet `05_CN`**: `max_row = 27` (1 Header + 26 Dòng dữ liệu)
* **Số dòng dữ liệu CN**: `26`
* **Tổng số ca nghiệm thu (`acceptance_total`)**: `98`
* **Tình trạng khóa nguồn**: `LOCKED & VERIFIED`

> `[SOURCE-INCONSISTENCY]`: Dòng "Đặc tả chức năng tìm kiếm" trong sheet `07_Con_thieu` là dữ liệu tồn đọng của bản nháp trước. Nguồn chân lý hiện tại đã chính thức chuẩn hóa thành **CN-26: Danh sách, tìm kiếm và xuất vận đơn** (5 ca nghiệm thu).

---

## 2. BẢNG NGUYÊN VĂN 26 CHỨC NĂNG (SHEET `05_CN`)

`[SOURCE-CONFIRMED: ShipDe-Ma-tran-Truy-vet-CURRENT.xlsx]`

| STT | Mã (Mục) | Tên Chức Năng Nguyên Văn | Tác Nhân | Kênh | Truy Vết | Số Ca |
|:---:|---|---|---|---|---|:---:|
| 1 | **CN-01** | Kết nối nguồn đơn và nạp lịch sử | Chủ shop, Quản trị tích hợp | Web | FR-SRC-001, FR-SRC-002; BR-15, BR-19 | 4 |
| 2 | **CN-02** | Nhận đơn mới và đồng bộ thay đổi | Hệ thống | Webhook, Job nền | FR-SRC-003, FR-SRC-006; BR-01, BR-17 | 4 |
| 3 | **CN-03** | Ghép mã đơn với mã vận đơn | Hệ thống, Vận hành | Job nền, Web | FR-SRC-004, FR-SRC-005; BR-49; NFR-04 | 4 |
| 4 | **CN-04** | Kết nối tài khoản hãng | Chủ shop, Quản trị tích hợp | Web | FR-CAR-001, FR-CAR-002, FR-CAR-005; BR-15 | 4 |
| 5 | **CN-05** | Quản lý ma trận năng lực hãng | Quản trị Ship Dễ | Backoffice | FR-CAR-003, FR-CAR-004, FR-ADM-002; BR-19, BR-26, BR-44 | 3 |
| 6 | **CN-06** | Theo dõi trạng thái: polling và webhook | Hệ thống | Job nền, Webhook | FR-TRK-001…006; BR-02, BR-03, BR-04, BR-17, BR-18, BR-25, BR-29 | 4 |
| 7 | **CN-07** | Timeline hợp nhất | Mọi vai trò theo phạm vi | Web, App | FR-TRK-007; BR-21 | 3 |
| 8 | **CN-08** | Phát hiện và mở hồ sơ ngoại lệ | Hệ thống | Job nền | FR-EXC-001…004; BR-31, BR-32 | 3 |
| 9 | **CN-09** | Hộp việc và giao việc | Vận hành, Chăm sóc khách hàng | Web, App | FR-EXC-005, FR-EXC-006; BR-27 | 3 |
| 10 | **CN-10** | Gửi yêu cầu giao lại theo mức năng lực | Vận hành, Chăm sóc khách hàng | Web, App | FR-EXC-007…009; BR-22, BR-26, BR-33, BR-44 | 4 |
| 11 | **CN-11** | Theo dõi hàng hoàn | Hệ thống, Kho | Job nền, Web | FR-RET-001…003; BR-32 | 3 |
| 12 | **CN-12** | Quét nhận hàng hoàn | Nhân viên kho | App, Web | FR-RET-004, FR-RET-005, FR-MOB-008; BR-35, BR-36, BR-40 | 4 |
| 13 | **CN-13** | Nhập sao kê COD và cước | Kế toán | Web | FR-COD-001, FR-COD-002; BR-02, BR-36 | 4 |
| 14 | **CN-14** | Chạy đối soát COD, cước và phụ phí | Kế toán, Hệ thống | Web, Job nền | FR-COD-003…007; BR-16, BR-28, BR-29, BR-51 | 5 |
| 15 | **CN-15** | Xử lý chênh lệch và chốt kỳ | Kế toán, Chủ shop | Web | FR-COD-008; BR-11, BR-12, BR-22, BR-27, BR-28 | 4 |
| 16 | **CN-16** | Mở hồ sơ khiếu nại | Vận hành, Kế toán, Kho | Web, App | FR-CLM-001…004; BR-36, BR-37, BR-48 | 4 |
| 17 | **CN-17** | Gửi và theo dõi khiếu nại | Vận hành, Kế toán | Web | FR-CLM-005, FR-CLM-006; BR-44, BR-47 | 3 |
| 18 | **CN-18** | Ba sổ giá trị và báo cáo | Chủ shop, Kế toán | Web | FR-CLM-007, FR-WEB-003; BR-45 | 4 |
| 19 | **CN-19** | Cấu hình thông báo | Chủ shop, Quản lý vận hành | Web | FR-WEB-004; BR-23, BR-34, BR-42 | 3 |
| 20 | **CN-20** | Trang tra cứu hành trình công khai | Người nhận hàng | Mobile web, không đăng nhập | FR-WEB-006; BR-42 | 4 |
| 21 | **CN-21** | Hộp việc và thông báo đẩy trên app | Vận hành, CSKH, Kho, Kế toán | App | FR-MOB-003…006; BR-42 | 4 |
| 22 | **CN-22** | Hàng đợi quét offline và đồng bộ | Nhân viên kho, Hệ thống | App | FR-MOB-009; BR-40 | 4 |
| 23 | **CN-23** | Hàng chờ trạng thái chưa ánh xạ | Quản trị Ship Dễ | Backoffice | FR-ADM-001; BR-18, BR-19 | 3 |
| 24 | **CN-24** | Mời người dùng và gán quyền | Chủ shop | Web | FR-IAM-002, FR-IAM-003; BR-12 | 4 |
| 25 | **CN-25** | Quản lý biểu giá hợp đồng | Kế toán, Chủ shop | Web | FR-RATE-001…005; BR-19, BR-51 | 4 |
| 26 | **CN-26** | Danh sách, tìm kiếm và xuất vận đơn | Mọi vai trò theo phạm vi | Web, App | FR-WEB-007…009, FR-SRC-007, FR-MOB-010; BR-13, NFR-01 | 5 |

**TỔNG CỘNG**: `26 Chức năng` | `98 Ca nghiệm thu`

---

## 3. KHÓA BẢNG QUY TẮC NGHIỆP VỤ (SHEET `03_BR`)

`[SOURCE-CONFIRMED: ShipDe-Ma-tran-Truy-vet-CURRENT.xlsx]`

| Mã | Tên Quy Tắc | Nội Dung Nguyên Văn | Phiên Bản |
|---|---|---|:---:|
| **BR-01** | Idempotency | Mọi thao tác có tác động tới hãng phải mang khóa idempotency; cùng khóa nhưng nội dung khác trả 422. | v2.0 |
| **BR-02** | Sự kiện chỉ-thêm | Shipment event, audit log và file sao kê gốc không sửa hoặc xóa được bằng API nghiệp vụ. | v2.0 |
| **BR-03** | Trạng thái dẫn xuất | Trạng thái vận đơn là kết quả tính từ sự kiện mới nhất hợp lệ theo occurred_at. | v2.0 |
| **BR-04** | Trạng thái kết thúc | Delivered, returned, cancelled, lost và damaged không lùi nếu không có sự kiện hiệu chỉnh rõ ràng có audit. | v2.0 |
| **BR-10** | Ranh giới COD | COD đi thẳng từ hãng về tài khoản shop. Ship Dễ không giữ tiền trong bất kỳ phiên bản nào. | v2.0 |
| **BR-11** | Chốt kỳ | Kỳ chỉ đóng khi mọi chênh lệch đã xử lý hoặc được duyệt bỏ qua kèm lý do. | v2.0 |
| **BR-12** | Tách quyền tài chính | Người tạo hoặc xử lý một bản ghi tài chính không được tự duyệt chính bản ghi đó. | v2.0 |
| **BR-13** | Giới hạn tần suất đa tầng | Giới hạn theo merchant, theo tài khoản hãng và theo endpoint; một khách không làm nghẽn khách khác. | v2.0 |
| **BR-15** | Bảo vệ credential | Credential mã hóa khi lưu và không xuất hiện trong log, push, thông điệp lỗi hay phản hồi API. | v2.0 |
| **BR-16** | Timeout đôi | Thao tác tạo tác động tới hãng bị quá thời gian chờ: giữ trạng thái chờ và tra theo mã tham chiếu trước khi cho thử lại. Cấm thử lại mù. | v3.2 |
| **BR-17** | Sự kiện trùng | Nhận diện bằng khóa (vận đơn, trạng thái thô, occurred_at) và bỏ qua nếu đã tồn tại. | v2.0 |
| **BR-18** | Trạng thái lạ | Mã hãng chưa ánh xạ vào hàng chờ, giữ nguyên trạng thái hiện tại, không đoán. | v2.0 |
| **BR-19** | Cấu hình là dữ liệu | Ánh xạ trạng thái, ma trận năng lực, công thức SLA và hạn khiếu nại sửa được qua backoffice có phiên bản. | v2.0 |
| **BR-21** | Audit bất biến | Không người dùng nào, kể cả quản trị nội bộ, được sửa hoặc xóa nhật ký kiểm toán. | v2.0 |
| **BR-22** | Lý do bắt buộc | Bỏ qua chênh lệch, mở lại kỳ, đóng khiếu nại và đóng hồ sơ ngoại lệ bắt buộc có lý do không rỗng. | v2.0 |
| **BR-23** | Chống dội tin | Vượt ngưỡng tin theo kênh và giờ thì gộp; không im lặng bỏ qua sự kiện khẩn. | v2.0 |
| **BR-25** | Polling là chính, webhook là bổ sung | Mọi hãng đều có polling đối chiếu theo SLA, kể cả hãng có webhook hoạt động tốt. | v3.0 |
| **BR-26** | Năng lực khai báo | Thao tác vượt mức năng lực của hãng trả 501 kèm thông điệp rõ; không để lỗi thô của hãng lọt ra giao diện. | v3.2 |
| **BR-27** | Khóa lạc quan | Tài nguyên sửa được mang version; ghi sai phiên bản trả 409 kèm bản hiện tại. | v2.0 |
| **BR-28** | Khóa dòng tiền | Nghiệp vụ tiền dùng khóa dòng hoặc cập nhật nguyên tử, không đọc-rồi-ghi. | v2.0 |
| **BR-29** | Khóa job | Job định kỳ phải lấy khóa phân tán trước khi chạy. | v2.0 |
| **BR-31** | Một hồ sơ ngoại lệ | Mỗi cặp (vận đơn, loại sự cố) chỉ có một hồ sơ mở; sự kiện mới nối vào hồ sơ đó. | v2.0 |
| **BR-32** | SLA cứu đơn | Hạn xử lý tính từ occurred_at của sự kiện hãng, không từ lúc nhân viên mở màn hình. | v2.0 |
| **BR-33** | Khóa giao lại | Mỗi vận đơn chỉ có một yêu cầu giao lại đang gửi; thao tác đồng thời trả 409. | v2.0 |
| **BR-34** | Đồng ý liên hệ | Chỉ liên hệ người mua trong phạm vi thực hiện đơn hàng, theo kênh được phép, có lưu bằng chứng đồng ý. | v2.0 |
| **BR-35** | Nhận hàng hoàn | Một kiện chỉ được xác nhận nhận hoàn một lần; sửa tình trạng cần quyền quản lý và audit. | v2.0 |
| **BR-36** | Chứng cứ có nguồn | Ảnh, video và chứng từ lưu kèm checksum, người tải, thời gian và nguồn thiết bị. | v2.0 |
| **BR-37** | Hạn khiếu nại | Hạn tính bằng rule có phiên bản; đổi rule không làm đổi hạn của hồ sơ đã mở. | v2.0 |
| **BR-40** | Hàng đợi quét lũy đẳng | Lệnh quét tạo khi mất mạng mang mã lệnh duy nhất do client sinh; server chống trùng. Chỉ áp dụng cho sự kiện quét và ảnh chờ tải. | v3.0 |
| **BR-42** | Push tối thiểu dữ liệu cá nhân | Thông báo trên màn hình khóa không chứa tên đầy đủ, số điện thoại, địa chỉ hay giá trị COD. | v2.0 |
| **BR-43** | Biên giới sàn | Đơn do sàn kiểm soát logistics chỉ đọc và phân tích theo quyền API của sàn; không hứa đổi hãng. | v2.0 |
| **BR-44** | Mức tự động hóa phải hiển thị | Mọi hành động ghi rõ đang ở mức L0, L1 hay L2. Không được để người dùng tưởng các hãng ngang nhau. | mới |
| **BR-45** | Ba sổ không cộng lẫn | Tiền thực nhận, đơn cứu được và khả năng kiểm soát là ba sổ riêng, mỗi sổ có định nghĩa và nguồn bằng chứng riêng. | mới |
| **BR-46** | Không tính phí theo kết quả | Không tính phần trăm trên tiền thu hồi. Thuê bao cố định theo dải sản lượng, số tài khoản hãng và số người dùng. | mới |
| **BR-47** | Ủy quyền khiếu nại | Ship Dễ không gửi khiếu nại thay mặt shop khi chưa có ủy quyền bằng văn bản và thỏa thuận xử lý dữ liệu. | mới |
| **BR-48** | Chỉ gửi khi còn hạn | Hồ sơ khiếu nại chỉ vào hàng đợi gửi khi còn trong thời hiệu của hãng; hồ sơ quá hạn đánh dấu riêng. | mới |
| **BR-49** | Công khai tỷ lệ ghép mã | Tỷ lệ ghép mã đơn với mã vận đơn phải hiển thị cho merchant; dưới ngưỡng thì cảnh báo dữ liệu chưa đầy đủ. | mới |
| **BR-50** | Chi phí tránh được của đơn cứu | Đơn cứu thành công vẫn trả phí chiều đi. Chỉ phí hoàn là khoản chắc chắn tránh được. Doanh thu giữ lại ghi riêng kèm giả định, không cộng vào Sổ 2. | v3.2 |
| **BR-51** | Thiếu biểu giá thì không kết luận | Không có biểu giá hợp đồng còn hiệu lực của shop thì không chạy phép dò lệch cước; gắn cờ thiếu dữ liệu thay vì đoán. | v3.2 |

---

## 4. KHÓA RANH GIỚI BẢN PHÁT HÀNH (R1 / R2 / R3)

`[SOURCE-CONFIRMED: ShipDe-Danh-muc-Chuc-nang-Toan-phan.pdf]`

* **Phạm vi R1 (91 chức năng)**:
  - 2 Hãng cốt lõi: **GHN** (L2 Execute) và **GHTK** (L1 Assist).
  - Nguồn đơn: Đồng bộ Pancake POS Open API (CN-01, CN-02).
  - Ghép mã 3 tầng & Cảnh báo $<95\%$ (CN-03).
  - Giám sát hành trình, Polling & Webhook, Timeline hợp nhất 3 nguồn (CN-06, CN-07).
  - Hộp việc cứu đơn ngoại lệ, Giao lại theo năng lực, Chống can thiệp trùng (CN-08, CN-09, CN-10, CN-11).
  - Tiếp nhận hàng hoàn kho bãi (CN-12, CN-22).
  - Nhập sao kê, 6 phép dò đối soát D1, D2, D4, D5, D6, D7 (CN-13, CN-14).
  - Maker-Checker phê duyệt chênh lệch, Chốt kỳ bất biến (CN-15, BR-12, BR-11).
  - Quản lý hồ sơ khiếu nại đa tác nhân & xuất gói chứng cứ (CN-16, CN-17).
  - Báo cáo Ba Sổ Giá Trị độc lập (CN-18, BR-45, BR-50).
  - Dashboard theo vai trò đăng nhập (FR-WEB-001), Cấu hình thông báo (CN-19), Cổng tra cứu công khai (CN-20).
  - Quản lý biểu giá hợp đồng shop (CN-25, BR-51), Mời thành viên & phân quyền (CN-24).
  - Quản trị nội bộ Backoffice: Ma trận năng lực hãng (CN-05), Hàng chờ trạng thái lạ (CN-23).
  - Danh sách, tìm kiếm và xuất vận đơn (CN-26).
* **Phạm vi R2 (41 chức năng - KHÔNG ĐƯA VÀO R1)**:
  - Tạo vận đơn thủ công (nhóm `SHP`).
  - Kết nối thêm Viettel Post và J&T Express.
  - In ấn tem nhãn bưu kiện A6/A5/A4.
  - Phép dò phụ phí vùng xa D3 (yêu cầu bảng vùng hãng R2).
* **Phạm vi R3 (21 chức năng - KHÔNG ĐƯA VÀO R1)**:
  - Nền tảng Public Developer API cho bên thứ ba.
  - Tự động hóa định tuyến nâng cao.

---

## 5. TÌNH TRẠNG NGUỒN TÀI LIỆU (SOURCE MATURITY)

1. **Giai đoạn Concierge (Tập 0)**: Chưa có văn bản nghiệm thu Concierge đạt GO: `[UNKNOWN]`. Hoàn thiện prototype hiện tại bám sát thiết kế chuẩn R1 Control-first.
2. **Trạng thái tài liệu Tập 2, Tập 3, Tập 4**: Hiện tại là `DRAFT/Pre-validation`.
3. **Mốc cảnh báo 48 giờ**: Là mốc cảnh báo trước hạn trích từ bảng cấu hình cảnh báo của **Tập 4** (`ShipDe-Tap4-Ky-thuat-va-Van-hanh-v1.3-DRAFT.pdf`).
4. **Quy tắc BR-37**: Quy định thời hiệu khiếu nại được tính động bằng rule có phiên bản theo từng hãng.

---
`SOURCE_LOCK_STATUS = PASS`
