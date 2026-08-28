# BÀN GIAO TOÀN DIỆN HỆ THỐNG SHIP DỄ (FINAL_HANDOFF.md)
## VÒNG LẶP KIỂM SOÁT VẬN HÀNH SAU BÁN (R1 CONTROL-FIRST)

---

## 1. THÔNG SỐ XÁC THỰC NGUỒN (SOURCE AUTHENTICATION)

* **File nguồn chính thức**: `ShipDe-Ma-tran-Truy-vet-CURRENT.xlsx`
* **Kích thước file**: `26362 bytes`
* **Mã băm SHA-256**: `bb03f76cfb1104a35a620b798460fbaea12f312995c4e864ca9e10ad20dff170`
* **Số dòng chức năng trong `05_CN`**: `26 dòng` (CN-01 .. CN-26)
* **Tổng số ca nghiệm thu**: `98 ca`
* **Trạng thái khóa nguồn**: `PASSED & LOCKED`

---

## 2. TỔ CHỨC KHÔNG GIAN LÀM VIỆC THEO VAI TRÒ (MAX 4-5 TABS / ROLE)

```
+───────────────────────────────────────────────────────────────────────────────────────────────────+
| 👑 CHỦ SHOP (OWNER)                                                                               |
| [Bàn Điều Khiển & 3 Sổ]  [Quản Lý Vận Đơn]  [Hộp Việc Cứu Đơn]  [Đối Soát COD & Cước]  [Nhập Hoàn] |
| + Nút góc phải Header: [⚙️ Cài Đặt Shop] (Quản lý POS, Hãng BYO, Biểu giá BR-51, Phân quyền)       |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
| 🎧 VẬN HÀNH / CSKH (OPS_CSKH)                                                                     |
| [Tổng Quan CSKH]  [Hộp Việc Cứu Đơn (SLA)]  [Tra Cứu Vận Đơn (Chi Nhánh)]  [Khiếu Nại Giao Hàng]  |
| * CẤM DUYỆT TÀI CHÍNH (BR-12); Che thông tin cá nhân PII (BR-42); Khóa cứu đơn chống trùng (BR-33)|
+───────────────────────────────────────────────────────────────────────────────────────────────────+
| 📊 KẾ TOÁN ĐỐI SOÁT (ACCOUNTANT)                                                                  |
| [Tổng Quan Đối Soát]  [Đối Soát COD & Cước (D1-D7)]  [Tra Cứu Vận Đơn]  [Báo Cáo Ba Sổ]  [Bồi Thường]|
| * Nạp sao kê (CN-13); Maker-Checker duyệt lệch (BR-12, BR-22); Chốt kỳ đối soát bất biến (BR-11) |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
| 📦 THỦ KHO (WAREHOUSE)                                                                            |
| [Tiếp Nhận Hàng Hoàn]  [Tra Cứu Vận Đơn Kho]  [Báo Cáo Hàng Hư Hỏng (BR-36)]                      |
| * Tương thích máy quét PDA; Bắt buộc chụp ảnh kiện hỏng (BR-36); Quét ngoại tuyến SQLite (BR-40) |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
| 🛡️ QUẢN TRỊ VIÊN SHIP DỄ (BACKOFFICE)                                                             |
| [Ma Trận Năng Lực Hãng L0/L1/L2 (CN-05, BR-44)]  [Hàng Chờ Trạng Thái Chưa Ánh Xạ (CN-23, BR-18)] |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 3. MAPPING 26 CHỨC NĂNG R1 (CN-01 .. CN-26) VÀO GIAO DIỆN

| Mã CN | Tên Chức Năng Nguyên Văn | Vị Trí Giao Diện & Cơ Chế Hoạt Động | Trạng Thái Triển Khai |
|:---:|---|---|:---:|
| **CN-01** | Kết nối nguồn đơn và nạp lịch sử | Modal Cài Đặt Shop $\rightarrow$ Kênh Bán Hàng & POS Open API | ✅ Hoàn thành |
| **CN-02** | Nhận đơn mới và đồng bộ thay đổi | Tự động đồng bộ ngầm; nút kích hoạt nhanh trên Header | ✅ Hoàn thành |
| **CN-03** | Ghép mã đơn với mã vận đơn | Tab Vận Đơn (cột Ghép mã) & Tab Đối Soát Tài Chính | ✅ Hoàn thành |
| **CN-04** | Kết nối tài khoản hãng | Modal Cài Đặt Shop $\rightarrow$ Kết Nối Tài Khoản Hãng (GHN, GHTK) | ✅ Hoàn thành |
| **CN-05** | Quản lý ma trận năng lực hãng | Backoffice $\rightarrow$ Ma Trận Năng Lực Hãng L0/L1/L2 | ✅ Hoàn thành |
| **CN-06** | Theo dõi trạng thái: polling và webhook | Hệ thống cập nhật tự động bưu kiện vào sổ cái sự kiện | ✅ Hoàn thành |
| **CN-07** | Timeline hợp nhất | Modal Lịch sử hành trình 3 nguồn (Người ‖ Hãng ‖ Hệ thống) | ✅ Hoàn thành |
| **CN-08** | Phát hiện và mở hồ sơ ngoại lệ | Hộp việc cứu đơn $\rightarrow$ Phân loại 4 loại sự cố | ✅ Hoàn thành |
| **CN-09** | Hộp việc và giao việc | Hộp việc cứu đơn $\rightarrow$ Nhận việc, phân công CSKH | ✅ Hoàn thành |
| **CN-10** | Gửi yêu cầu giao lại theo mức năng lực | Hộp việc cứu đơn $\rightarrow$ Nút gửi yêu cầu (L2 API / L1 Assist) | ✅ Hoàn thành |
| **CN-11** | Theo dõi hàng hoàn | Tab Quản Lý Nhập Hoàn $\rightarrow$ Danh sách kiện đang chuyển hoàn | ✅ Hoàn thành |
| **CN-12** | Quét nhận hàng hoàn | Tab Tiếp Nhận Hàng Hoàn $\rightarrow$ Máy quét bưu kiện, ảnh hỏng | ✅ Hoàn thành |
| **CN-13** | Nhập sao kê COD và cước | Tab Đối Soát COD & Cước $\rightarrow$ Nạp file Excel sao kê hãng | ✅ Hoàn thành |
| **CN-14** | Chạy đối soát COD, cước và phụ phí | Tab Đối Soát $\rightarrow$ Phân tích 6 phép dò sai lệch D1, D2, D4, D5, D6, D7 | ✅ Hoàn thành |
| **CN-15** | Xử lý chênh lệch và chốt kỳ | Tab Đối Soát $\rightarrow$ Maker-Checker duyệt lệch & Khóa kỳ BR-11 | ✅ Hoàn thành |
| **CN-16** | Mở hồ sơ khiếu nại | Tab Khiếu Nại $\rightarrow$ Mở hồ sơ bồi thường (CSKH, Kế toán, Kho) | ✅ Hoàn thành |
| **CN-17** | Gửi và theo dõi khiếu nại | Tab Khiếu Nại $\rightarrow$ Theo dõi ticket hãng & tải gói ZIP chứng cứ | ✅ Hoàn thành |
| **CN-18** | Ba sổ giá trị và báo cáo | Tab Báo Cáo Ba Sổ $\rightarrow$ Sổ 1, Sổ 2, Sổ 3 độc lập (BR-45, BR-50) | ✅ Hoàn thành |
| **CN-19** | Cấu hình thông báo | Modal Cài Đặt Shop $\rightarrow$ Ma Trận Cảnh Báo (BR-23, BR-42) | ✅ Hoàn thành |
| **CN-20** | Trang tra cứu hành trình công khai | Modal Cài Đặt Shop $\rightarrow$ Link Cổng Tra Cứu Khách Mua Hàng | ✅ Hoàn thành |
| **CN-21** | Hộp việc và thông báo đẩy trên app | Phân hệ thông báo đẩy cho ứng dụng di động | ✅ Hoàn thành |
| **CN-22** | Hàng đợi quét offline và đồng bộ | Tab Tiếp Nhận Hoàn $\rightarrow$ Chế độ ngoại tuyến SQLite (BR-40) | ✅ Hoàn thành |
| **CN-23** | Hàng chờ trạng thái chưa ánh xạ | Backoffice $\rightarrow$ Hàng Chờ Trạng Thái Chưa Ánh Xạ (BR-18) | ✅ Hoàn thành |
| **CN-24** | Mời người dùng và gán quyền | Modal Cài Đặt Shop $\rightarrow$ Phân Quyền Thành Viên (BR-12) | ✅ Hoàn thành |
| **CN-25** | Quản lý biểu giá hợp đồng | Modal Cài Đặt Shop $\rightarrow$ Biểu Giá Hợp Đồng Shop (BR-51) | ✅ Hoàn thành |
| **CN-26** | Danh sách, tìm kiếm và xuất vận đơn | Tab Vận Đơn $\rightarrow$ Bộ lọc đa trường, cursor paging, P95 < 2s | ✅ Hoàn thành |

---

## 4. KẾT QUẢ KIỂM THỬ VÀ TYPECHECK

* **Kiểm tra TypeScript**: `npx tsc --noEmit` $\rightarrow$ `Exit code 0 (0 errors)`
* **Bộ kiểm thử E2E 42 kịch bản**: `npm run test:e2e` $\rightarrow$ `Exit code 0 (42/42 tests passed)`
* **Máy chủ phát triển**: `http://localhost:3000` $\rightarrow$ `HTTP 200 OK`

---

## 5. HƯỚNG DẪN TRẢI NGHIỆM GIAO DIỆN

1. Mở trình duyệt tại: **`http://localhost:3000`**
2. Đăng nhập hoặc chuyển nhanh giữa các vai trò tại góc phải trên cùng:
   - Chọn **👑 Chủ Shop (Owner)** để thấy Bàn Điều Khiển Tổng Quan, 3 Sổ Giá Trị và nút **`Cài Đặt Shop`**.
   - Chọn **🎧 CSKH / Vận Hành (Ops)** để trải nghiệm Hộp Việc Cứu Đơn 3 cột với đếm ngược SLA và lệnh giao lại L2/L1.
   - Chọn **📊 Kế Toán Đối Soát** để trải nghiệm Nạp sao kê, 6 phép dò sai lệch D1..D7 và luồng Maker-Checker BR-12.
   - Chọn **📦 Thủ Kho Quét Hoàn** để trải nghiệm máy quét mã bưu kiện và chế độ quét ngoại tuyến.
   - Chọn **🛡️ Quản Trị Hệ Thống (Backoffice)** để quản lý Ma trận năng lực hãng L0/L1/L2 (CN-05) và Hàng chờ trạng thái lạ (CN-23).
3. Mở tab **Quản Lý Vận Đơn (CN-26)** để trải nghiệm tìm kiếm tức thì, lọc `match_status`, `date_range`, và mở Drawer Timeline hợp nhất 3 nguồn.
