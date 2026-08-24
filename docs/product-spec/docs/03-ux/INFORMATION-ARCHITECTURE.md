# Information Architecture

## Primary navigation

1. Tổng quan
2. Đơn hàng
   - Tất cả đơn nguồn
   - Tạo đơn
   - Báo giá và chọn hãng
   - Vận đơn
   - Lấy hàng
   - In nhãn
3. Vận hành giao hàng
   - Tracking
   - Hộp việc ngoại lệ
   - Hàng hoàn
4. Đối soát
   - Kỳ đối soát
   - Nguồn dữ liệu
   - Biểu giá và chính sách
   - Kết quả kiểm toán
   - Batch và ngân hàng
5. Khiếu nại
   - Hồ sơ chênh lệch
   - Deadline
   - Hồ sơ đã gửi
6. Báo cáo
7. Cấu hình
   - Shop/chi nhánh/kho
   - Người dùng và vai trò
   - Tài khoản hãng
   - Quy tắc chọn hãng
   - Thông báo
   - Gói dịch vụ/hóa đơn
8. Quản trị Ship Dễ
   - Carrier capability/config
   - Mapping/import
   - Job/queue
   - Audit/support

## Route catalog

| Screen ID | Route | Screen |
|---|---|---|
| SCR-AUTH-01 | /login | Đăng nhập |
| SCR-AUTH-02 | /register | Đăng ký |
| SCR-ONB-01 | /onboarding | Thiết lập ban đầu |
| SCR-DASH-01 | /dashboard | Tổng quan theo vai trò |
| SCR-USR-01 | /settings/users | Người dùng |
| SCR-RBAC-01 | /settings/roles | Vai trò và quyền |
| SCR-SHOP-01 | /settings/shop | Hồ sơ shop |
| SCR-WH-01 | /settings/warehouses | Chi nhánh/kho |
| SCR-CAR-01 | /settings/carriers | Tài khoản hãng |
| SCR-ORD-01 | /orders | Đơn nguồn |
| SCR-ORD-02 | /orders/new | Tạo/sửa đơn |
| SCR-QUOTE-01 | /orders/:id/options | Tuyến, báo giá và chọn hãng |
| SCR-SHIP-01 | /shipments/:id | Chi tiết vận đơn |
| SCR-LABEL-01 | /shipments/labels | In nhãn |
| SCR-PICK-01 | /pickups | Lấy hàng |
| SCR-TRACK-01 | /tracking/:waybill | Hành trình |
| SCR-EXC-01 | /exceptions | Hộp việc ngoại lệ |
| SCR-RET-01 | /returns | Nhận hàng hoàn |
| SCR-RATE-01 | /reconciliation/rates | Biểu giá/chính sách |
| SCR-PERIOD-01 | /reconciliation/periods | Kỳ đối soát |
| SCR-IMPORT-01 | /reconciliation/imports | Nguồn dữ liệu |
| SCR-AUD-01 | /reconciliation/runs/:id | Kết quả kiểm toán |
| SCR-BATCH-01 | /reconciliation/batches/:id | Batch/ngân hàng |
| SCR-CASE-01 | /claims/cases/:id | Case/khiếu nại |
| SCR-REPORT-01 | /reports | Báo cáo |
| SCR-BILL-01 | /settings/billing | Gói và bảng kê |
| SCR-AUDIT-01 | /admin/audit | Audit log |

## Global interaction capabilities

- Search, filter, sort, pagination, saved views and column configuration.
- Bulk selection/action with per-item outcome.
- Import preview and row-level error download.
- Export with filter/version metadata.
- Attachment, comment, mention and activity timeline.
- Draft preservation and retry after recoverable failures.
- Permission-aware action visibility plus backend enforcement.

