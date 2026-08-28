# BÁO CÁO AUDIT UX & ĐÁNH GIÁ HIỆN TRẠNG GIAO DIỆN (UX_AUDIT.md)

## DỰ ÁN HỆ THỐNG ĐIỀU HÀNH VẬN CHUYỂN SHIP DỄ (R1 CONTROL-FIRST)

---

## 1. TỔNG QUAN HIỆN TRẠNG KỸ THUẬT VÀ GIAO DIỆN

- **Môi trường kỹ thuật**:
  - Framework: Next.js 16 (App Router) + React 19.
  - Styling: TailwindCSS v4 + Custom Tokens trong `src/app/globals.css`.
  - Iconography: `lucide-react` (đã có trong dependencies).
  - Charts: `recharts` (đã có trong dependencies).
  - Typography: `Be Vietnam Pro`, `Plus Jakarta Sans`, `JetBrains Mono` (Google Fonts imported trong `globals.css`).
  - Phân quyền & RBAC: `UserRole` (OWNER, OPS_CSKH, WAREHOUSE, ACCOUNTANT) trong `src/types/domain.ts` và `src/context/AuthContext.tsx`.

---

## 2. CÁC PHÁT HIỆN KIỂM TOÁN UX & MỨC ĐỘ NGHIÊM TRỌNG

|     Mã     | Thành Phần                                        | Hiện Trạng Phát Hiện                                                                                                                                                                            | Đánh Giá Tác Động Vận Hành                                                                                 |   Mức Độ    |
| :--------: | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | :---------: |
| **AUD-01** | **Thanh Điều Hướng Toàn Cục**                     | Menu dàn trải quá nhiều tab ngang hàng; trộn lẫn chức năng Backoffice (`CN-05`, `CN-23`), Cài đặt (`CN-24`, `CN-25`), và Tác nghiệp.                                                            | Gây ngợp nhận thức; người dùng mất 5–10 giây mới tìm được nơi làm việc của mình.                           | **Blocker** |
| **AUD-02** | **Phân Quyền Theo Vai Trò (Role Scoping)**        | Tất cả các vai trò (CSKH, Kho, Kế toán) đều thấy chung toàn bộ menu và dashboard; chưa hiển thị Dashboard việc cần xử lý theo vai trò đăng nhập (FR-WEB-001).                                   | CSKH nhìn thấy tài chính; Kho nhìn thấy sao kê; vi phạm tính tập trung tác vụ và bảo mật.                  | **Blocker** |
| **AUD-03** | **Trộn Phạm Vi R2/R3 Vào R1**                     | Nút `+ Tạo Đơn Hàng`, bộ so sánh cước thủ công 4 hãng (kèm Viettel Post/J&T) xuất hiện nổi bật trên Header.                                                                                     | Sai bản chất R1 (nhận đơn tự động từ POS Pancake); làm người dùng tưởng đây là app bán hàng.               | **Blocker** |
| **AUD-04** | **Trang Vận Đơn (CN-26)**                         | Chưa bám sát tiêu chí CN-26: thiếu bộ lọc `match_status` (khớp chính xác/mờ/chưa khớp), thiếu `date_range` giới hạn 90 ngày, thiếu `has_open_case`, đặt nhầm 4 thẻ KPI tài chính lên đầu trang. | Gây nhiễu màn hình tra cứu; không phục vụ mục tiêu chính là "tìm và mở đúng vận đơn cần xử lý trong < 2s". |  **High**   |
| **AUD-05** | **Ngôn Ngữ & Thuật Ngữ Kỹ Thuật**                 | Xuất hiện các mã kỹ thuật thô (`draft`, `out_for_delivery`, `L1/L2`, `BR-xx`) và từ ngữ phô trương ("bắn lệnh tức thì").                                                                        | Người vận hành phải tự dịch trong đầu; vi phạm tiêu chuẩn microcopy nghiệp vụ chuyên nghiệp.               |  **High**   |
| **AUD-06** | **Hộp Việc Cứu Đơn (CN-08..CN-10)**               | Chưa hiển thị rõ đồng hồ đếm ngược SLA từ `occurred_at` (BR-32); chưa có cơ chế khóa mềm 30 phút (CN-09) và nhãn mức tự động hóa rõ ràng theo BR-44.                                            | CSKH dễ bị lỡ hạn can thiệp của hãng; nguy cơ tranh chấp đơn giữa các nhân viên.                           |  **High**   |
| **AUD-07** | **Độ Tương Phản & Khả Năng Đọc (Visual Density)** | Một số nhãn phụ màu xám quá nhạt (`text-slate-400`); khoảng cách padding chưa nhất quán; số tiền chưa luôn căn phải và dùng tabular-nums.                                                       | Gây mỏi mắt khi nhân viên làm việc liên tục 8 tiếng trên màn hình 1366×768 hoặc 1440×900.                  | **Medium**  |

---

## 3. MỤC TIÊU TÁI CẤU TRÚC THEO 5 PHASES

- **Phase 1**: App Shell & Điều hướng theo vai trò (tối đa 5 khu vực/vai trò, loại R2/R3, tách Cài đặt Shop & Backoffice).
- **Phase 2**: Trang Vận đơn chuyên biệt bám sát 100% CN-26 (Bộ lọc đa trường, cursor pagination, P95 < 2s, Timeline hợp nhất CN-07).
- **Phase 3**: Dashboard việc cần xử lý theo vai trò (FR-WEB-001) & Hộp việc cứu đơn chuyên nghiệp (CN-08..CN-11, BR-32, BR-33, BR-44).
- **Phase 4**: Tài chính đối soát 6 phép dò, Maker-Checker BR-12, Khiếu nại đa tác nhân (CN-16, CN-17, BR-37), Ba Sổ Giá Trị chuẩn (CN-18, BR-45, BR-50), Cài đặt Shop & Backoffice.
- **Phase 5**: Toàn hệ thống & Visual QA trên 1366×768 và 1440×900, bảo đảm 0 Blocker/High.
