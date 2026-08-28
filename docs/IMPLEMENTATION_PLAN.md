# KẾ HOẠCH TRIỂN KHAI & PHẢN BIỆN TỰ CHỦ (IMPLEMENTATION_PLAN.md)

## HỆ THỐNG KIỂM SOÁT VẬN HÀNH LOGISTICS SHIP DỄ (R1 CONTROL-FIRST)

---

## 1. MAPPING KIẾN TRÚC THÔNG TIN THEO VAI TRÒ (MAX 5 KHU VỰC)

### A. CHỦ SHOP (`OWNER`):

1. **Tổng quan**: Dashboard việc cần xử lý hôm nay (FR-WEB-001) + Tóm tắt Ba Sổ Giá Trị (CN-18).
2. **Vận đơn**: Tra cứu và xuất danh sách toàn trình (CN-26).
3. **Cứu đơn**: Giám sát hộp việc ngoại lệ và hiệu quả cứu đơn (CN-08..CN-11).
4. **Tài chính**: Đối soát 6 phép dò (CN-13..CN-15) + Báo cáo Ba Sổ độc lập (CN-18).
5. **Cài đặt Shop**: Quản lý kết nối POS Pancake (CN-01), Tài khoản hãng GHN/GHTK BYO (CN-04), Biểu giá hợp đồng (CN-25), Phân quyền thành viên (CN-24), Cấu hình thông báo (CN-19), Link cổng tra cứu (CN-20).

### B. VẬN HÀNH / CSKH (`OPS_CSKH`):

1. **Tổng quan**: Hàng đợi các đơn gặp sự cố cần cứu + Cảnh báo hạn SLA gần nhất.
2. **Vận đơn**: Tra cứu vận đơn theo chi nhánh được phân công (CN-26), xem Timeline (CN-07).
3. **Hộp việc cứu đơn**: Xử lý đơn giao thất bại/chậm lấy, cập nhật SĐT, gửi yêu cầu giao lại (CN-09, CN-10, BR-44).
4. **Khiếu nại**: Mở và theo dõi hồ sơ khiếu nại giao hàng với hãng (CN-16, CN-17).

### C. KẾ TOÁN ĐỐI SOÁT (`ACCOUNTANT`):

1. **Tổng quan**: Bảng COD đến hạn, quá hạn và chênh lệch cước cần xử lý hôm nay.
2. **Vận đơn**: Tra cứu vận đơn toàn hệ thống phục vụ đối chiếu dữ liệu (CN-26).
3. **Đối soát sao kê**: Nạp file Excel sao kê hãng (CN-13), 6 phép dò D1..D7 (CN-14), Ghép mã nguồn (CN-03).
4. **Phê duyệt chênh lệch & Chốt kỳ**: Quy trình Maker-Checker (CN-15, BR-12, BR-11, BR-22).
5. **Ba Sổ Giá Trị & Khiếu nại**: Giám sát tiền về Sổ 1, hồ sơ khiếu nại bồi thường (CN-16, CN-17, CN-18).

### D. THỦ KHO (`WAREHOUSE`):

1. **Tiếp nhận hàng hoàn**: Máy quét mã bưu kiện, phân loại tình trạng, chụp ảnh hư hỏng (CN-12, BR-36).
2. **Hàng đợi ngoại tuyến**: Quản lý các kiện hàng đã quét khi mất mạng chờ đồng bộ (CN-22, BR-40).
3. **Tra cứu vận đơn kho**: Kiểm tra bưu kiện trong phạm vi kho quản lý (CN-26).
4. **Khiếu nại hư hỏng**: Mở hồ sơ bồi thường hàng vỡ/hỏng tại kho (CN-16, BR-36).

### E. QUẢN TRỊ VIÊN NỘI BỘ SHIP DỄ (`BACKOFFICE`):

- Truy cập khu vực riêng biệt: Quản lý ma trận năng lực hãng L0/L1/L2 (CN-05) và Hàng chờ trạng thái chưa ánh xạ (CN-23).

---

## 2. TỰ PHẢN BIỆN KẾ HOẠCH (INDEPENDENT REVIEW & SELF-CRITIQUE)

|   STT    | Điểm Rủi Ro / Nghi Vấn                                                      | Kết Quả Tự Phản Biện                                                                                                                | Quyết Định Điều Chỉnh Kế Hoạch                                                                                                                                                                                                              |
| :------: | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CR-1** | Có bị lẫn chức năng R2 tạo đơn thủ công và 2 hãng Viettel Post / J&T không? | **Có nguy cơ** nếu vẫn giữ form CreateOrderModal và các mock data Viettel Post/J&T trong R1.                                        | **ĐIỀU CHỈNH**: Gỡ bỏ hoàn toàn nút "+ Tạo đơn hàng" trên Header. Trong R1 chỉ hiển thị 2 hãng cốt lõi GHN (L2) và GHTK (L1). Viettel Post / J&T gắn cờ `DEFERRED (R2)`.                                                                    |
| **CR-2** | Trang Vận đơn có đáp ứng đủ các tham số của CN-26 không?                    | Nếu dùng pagination kiểu số trang cũ sẽ sai CN-26 (`cursor-based pagination`).                                                      | **ĐIỀU CHỈNH**: Triển khai Cursor Pagination (`[Trang trước]` / `[Trang sau]` dựa trên ID/thời gian con trỏ); tích hợp bộ lọc `match_status` (khớp chính xác, khớp mờ, chưa khớp), `date_range` (tối đa 90 ngày) và toggle `has_open_case`. |
| **CR-3** | Báo cáo Sổ 2 có bị nhầm lẫn công thức tính phí hoàn không?                  | Báo cáo cũ dùng 1 mức phí chung là sai BR-50.                                                                                       | **ĐIỀU CHỈNH**: Sổ 2 tính đúng: `SUM(phí hoàn thực tế tránh được của từng đơn)` theo biểu giá hợp đồng của đơn đó; không dùng con số nhân trung bình.                                                                                       |
| **CR-4** | Tách quyền BR-12 có chặn nhầm toàn bộ vai trò không?                        | BR-12 là tách quyền ở **cấp bản ghi** (người tạo/sửa bản ghi không được tự duyệt chính bản ghi đó), không phải cấm toàn bộ Kế toán. | **ĐIỀU CHỈNH**: Kiểm tra `currentUserId === record.created_by                                                                                                                                                                               |     | currentUserId === record.updated_by` để disable nút Duyệt đối với chính người đó; Kế toán khác hoặc Chủ shop vẫn duyệt được bình thường. |
| **CR-5** | Microcopy có còn phô trương hoặc dùng raw enum không?                       | Cần quét toàn bộ mã nguồn để thay thế từ ngữ kỹ thuật.                                                                              | **ĐIỀU CHỈNH**: Sử dụng ngôn ngữ tác nghiệp thuần túy: _"Gửi yêu cầu giao lại"_, _"Tạo hồ sơ hỗ trợ tại cổng hãng"_, _"Còn [X] giờ tới hạn xử lý"_.                                                                                         |

---

## 3. LỘ TRÌNH THỰC THI 5 PHASES

- **Phase 1**: Refactor Header & App Shell theo vai trò (`OWNER`, `OPS_CSKH`, `ACCOUNTANT`, `WAREHOUSE`).
- **Phase 2**: Refactor Trang Vận Đơn bám sát 100% CN-26 & Timeline CN-07.
- **Phase 3**: Refactor Dashboard FR-WEB-001 & Hộp việc cứu đơn CSKH (CN-08..CN-11).
- **Phase 4**: Refactor Đối soát tài chính, Maker-Checker BR-12, Khiếu nại (CN-16, CN-17), Ba Sổ Giá Trị (CN-18), Cài đặt Shop & Backoffice.
- **Phase 5**: Kiểm tra toàn hệ thống, chạy E2E tests, typecheck và bàn giao.
