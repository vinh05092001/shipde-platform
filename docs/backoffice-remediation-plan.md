# KẾ HOẠCH TỔNG THỂ CẢI TỔ TOÀN DIỆN SHIP DỄ BACKOFFICE

## (docs/backoffice-remediation-plan.md)

---

## 1. CURRENT-STATE AUDIT (KIỂM TOÁN HIỆN TRẠNG)

### 1.1. Cấu trúc Repository & Công nghệ

- **Framework**: Next.js 16 (App Router, Turbopack) + React 19 + TypeScript.
- **Styling**: Tailwind CSS v4 + Vanilla CSS Custom Properties.
- **Icons & Visuals**: Lucide React + Recharts.
- **Core Domains**:
  - `src/core/`: `exception-engine.ts`, `ledger-calculator.ts`, `maker-checker.ts`, `matching-engine.ts`, `offline-queue.ts`, `reconciliation.ts`.
  - `src/adapters/`: `ghn.adapter.ts`, `ghtk.adapter.ts`, `pancake.adapter.ts`, `csv.adapter.ts`.
  - `src/server/db.ts`: In-memory persistent database model.
  - `src/tests/`: `e2e-scenarios.test.ts`, `comprehensive-rules.test.ts`.

### 1.2. Phân loại vấn đề theo mức độ nghiêm trọng (P0 / P1 / P2)

#### 🔴 P0 — Tính Đúng Đắn, Dữ Liệu & Bảo Mật (Safety & Truthfulness)

1. **Lệch số liệu giữa các màn hình**:
   - Dashboard trước đây hiển thị số tổng 1.420 đơn nhưng danh sách vận đơn chỉ có 50 đơn; badge Hộp việc báo 3 nhưng danh sách có 5.
   - _Giải pháp_: Xây dựng `src/services/unifiedDataStore.ts` - bộ dữ liệu chuẩn duy nhất (Single Source of Truth) kết nối thực giữa Vận đơn $\leftrightarrow$ Sự cố $\leftrightarrow$ Khoản lệch $\leftrightarrow$ Khiếu nại $\leftrightarrow$ Nhập hoàn. Mọi KPI, badge, và bảng dữ liệu đều tính trực tiếp từ cùng một mảng bản ghi.
2. **SLA và thời gian không nhất quán**:
   - Cùng một đơn lúc ghi còn 4h, lúc ghi còn 6h.
   - _Giải pháp_: Chuẩn hóa hàm tính SLA countdown từ `occurred_at` theo đúng loại sự cố (Giao thất bại: 12h, Lấy chậm: 6h, Tắc trung chuyển: 48h).
3. **Bảo mật Secret & PII**:
   - Token API hãng hiển thị dạng text/icon mắt lỏng lẻo.
   - _Giải pháp_: Áp dụng chuẩn **Write-Only Secret** (hiển thị `ghn_live_••••••••9842`), không load secret thô về client; che PII số điện thoại `090***5678` với nút unmask có quyền và ghi log kiểm toán; tách IP nhân viên sang màn hình Quản lý phiên thiết bị.
4. **Tránh action giả / no-op**:
   - Mọi nút bấm trên giao diện phải có tác dụng thực hoặc disable kèm lý do rõ ràng.

#### 🟡 P1 — Kiến Trúc Thông Tin & Trải Nghiệm Vai Trò (IA & Role Workspaces)

1. **Xóa bỏ Modal Cài Đặt Shop lồng ghép**:
   - Cài đặt hệ thống quá phức tạp để nhét vào một dialog nhỏ.
   - _Giải pháp_: Chuyển Cài Đặt thành **Full-Page Settings Layout** với thanh điều hướng phụ (Cửa Hàng, Nhân Sự, Tích Hợp Kênh & Hãng, Cảnh Báo, Bảo Mật).
2. **Tối đa 5 Tabs chính cho từng vai trò**:
   - **Chủ Shop (`OWNER`)**: `Bàn Điều Khiển`, `Vận Đơn`, `Cứu Đơn`, `Đối Soát COD`, `Nhập Hoàn` + Link `Cài Đặt Shop`.
   - **CSKH (`OPS_CSKH`)**: `Hộp Việc Cứu Đơn`, `Tra Cứu Vận Đơn`, `Khiếu Nại Giao Hàng`.
   - **Kế Toán (`ACCOUNTANT`)**: `Đối Soát COD & Cước`, `Khoản Lệch Chờ Duyệt`, `Báo Cáo Ba Sổ`, `Tra Cứu Vận Đơn`.
   - **Thủ Kho (`WAREHOUSE`)**: `Quét Nhập Hoàn`, `Hàng Đợi Ngoại Tuyến`, `Lịch Sử Nhận Kho`.
   - **Quản Trị (`BACKOFFICE`)**: `Tích Hợp & Cổng Hãng`, `Ma Trận Năng Lực`, `Hàng Chờ Trạng Thái Lạ`, `Logs & Giả Lập Webhook`.
3. **Cổng Tra Cứu Khách Hàng (Public Tracking)**:
   - Tách thành Route/Preview độc lập, không nhúng toàn bộ vào cài đặt nội bộ.

#### 🟢 P2 — Ngôn Ngữ Thiết Kế Thương Hiệu Ship Dễ & Tinh Chỉnh Microcopy

1. **Bộ Design Tokens Thương Hiệu (Ship Dễ Brand)**:
   - **Font**: Inter (Google Fonts) + JetBrains Mono cho số liệu tài chính.
   - **Màu chủ đạo (Brand Primary)**: Cam rực rỡ `#EA4B12` (thay thế màu xanh SaaS chung chung `#2563EB`).
   - **Màu nền (Canvas Background)**: Nền ấm `#FDFCFB` (ấm áp, hiện đại, không gây mỏi mắt).
   - **Màu chữ & Khung đậm (Ink/Navy)**: `#0C1421`.
   - **Bề mặt (Surfaces)**: Trắng `#FFFFFF` với viền trung tính ấm `#EAE7E4`.
   - **Semantic Colors**: Green (`#16A34A`), Amber (`#D97706`), Red (`#DC2626`).
2. **Loại bỏ hoàn toàn mã kỹ thuật trên giao diện người dùng**:
   - Xóa bỏ các nhãn `CN-xx`, `BR-xx`, `FR-WEB-xxx`, `D2_FREIGHT` khỏi màn hình vận hành.
   - Thay bằng thuật ngữ nghiệp vụ thuần Việt: _"Tự động qua API"_, _"Hỗ trợ dán cổng"_, _"Lệch cước hợp đồng"_, _"Lệch cân tính phí"_.
3. **Mật độ thông tin & Trải nghiệm**:
   - Body font tối thiểu 14px; metadata tối thiểu 12px; không dùng chữ 10px cho dữ liệu nghiệp vụ.
   - Bảng dữ liệu có chiều cao hàng thoải mái (48-52px), header tương phản rõ ràng.

---

## 2. ROLE-TO-NAVIGATION MATRIX (MA TRẬN ĐIỀU HƯỚNG THEO VAI TRÒ)

| Vai Trò                     | Tab 1                 | Tab 2                 | Tab 3                  | Tab 4                    | Tab 5             | Hành Động Nhanh        |
| --------------------------- | --------------------- | --------------------- | ---------------------- | ------------------------ | ----------------- | ---------------------- |
| **Chủ Shop (`OWNER`)**      | Bàn Điều Khiển & 3 Sổ | Quản Lý Vận Đơn       | Hộp Việc Cứu Đơn       | Đối Soát COD & Cước      | Quản Lý Nhập Hoàn | `⚙️ Cài Đặt Cửa Hàng`  |
| **CSKH (`OPS_CSKH`)**       | Hộp Việc Cứu Đơn      | Tra Cứu Vận Đơn       | Khiếu Nại Giao Hàng    | —                        | —                 | `Tìm nhanh ⌘K`         |
| **Kế Toán (`ACCOUNTANT`)**  | Đối Soát COD & Cước   | Khoản Lệch Cần Duyệt  | Báo Cáo Ba Sổ          | Tra Cứu Vận Đơn          | Hồ Sơ Bồi Thường  | `Nạp sao kê Excel`     |
| **Thủ Kho (`WAREHOUSE`)**   | Tiếp Nhận Hàng Hoàn   | Hàng Đợi Ngoại Tuyến  | Lịch Sử Nhận Kho       | Tra Cứu Vận Đơn Kho      | —                 | `Quét mã vạch tự động` |
| **Quản Trị (`BACKOFFICE`)** | Tích Hợp Kênh & Hãng  | Ma Trận Năng Lực Hãng | Hàng Chờ Trạng Thái Lạ | Webhook Simulator & Logs | —                 | `Giả lập sự kiện`      |

---

## 3. DESIGN TOKENS CHUẨN (CSS VARIABLES)

```css
:root {
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Brand Palette (Shipde.net) */
  --brand-orange: #ea4b12;
  --brand-orange-hover: #d03e0b;
  --brand-orange-subtle: #fff5f0;
  --brand-orange-border: #fdddd0;

  --ink-primary: #0c1421;
  --ink-secondary: #3b4352;
  --ink-muted: #697386;
  --ink-dim: #9da6b8;

  --bg-app: #fdfcfb;
  --bg-surface: #ffffff;
  --bg-subtle: #f6f5f3;
  --bg-hover: #f2f0ec;

  --border-subtle: #eae7e4;
  --border-strong: #d5d1cb;
  --border-focus: #ea4b12;

  /* Semantic Status */
  --status-ok-bg: #f0fdf4;
  --status-ok-text: #15803d;
  --status-ok-border: #bbf7d0;

  --status-warn-bg: #fffbeb;
  --status-warn-text: #b45309;
  --status-warn-border: #fde68a;

  --status-risk-bg: #fef2f2;
  --status-risk-text: #b91c1c;
  --status-risk-border: #fecaca;
}
```

---

## 4. KẾ HOẠCH TRIỂN KHAI 7 GIAI ĐOẠN (EXECUTION PHASES)

- **Phase 1**: Kiểm toán hiện trạng và khởi tạo `src/services/unifiedDataStore.ts` đồng bộ 100% dữ liệu bưu kiện, sự cố, lệch cước, khiếu nại.
- **Phase 2**: Thiết lập test hồi quy (`src/tests/regression-audit.test.ts`) kiểm tra tính toàn vẹn dữ liệu, quyền Maker-Checker và công thức đối soát.
- **Phase 3**: Cập nhật `src/app/globals.css` và `src/components/ui/OperationalComponents.tsx` áp dụng Design Tokens thương hiệu Ship Dễ (Inter + `#EA4B12` + `#FDFCFB`).
- **Phase 4**: Tái cấu trúc AppShell, Information Architecture và tách phân hệ Settings thành Full-Page Layout độc lập.
- **Phase 5**: Refactor từng màn hình vận hành:
  1. Login & Auth View
  2. Bàn Điều Khiển (Dashboard)
  3. Quản Lý Vận Đơn (Shipments Explorer)
  4. Hộp Việc Cứu Đơn (Exceptions Workbox)
  5. Đối Soát COD & Cước (Reconciliation)
  6. Nhập Hoàn Kho (Return Scan Mobile-First)
  7. Cài Đặt Hệ Thống & Tích Hợp Kênh/Hãng (Settings & Integrations)
- **Phase 6**: Khử triệt để PII leakage, đảm bảo Write-Only Secrets, và đồng bộ thống kê thời gian thực.
- **Phase 7**: Visual QA, Responsive QA (1440, 1280, 768, 390px), Accessibility QA (WCAG AA, single h1), và Security Review.

---

## 5. REGRESSION CHECKLIST (TIÊU CHÍ NGHIỆM THU)

- [x] Tổng số đơn trên Dashboard = Tổng số đơn trong bảng Vận đơn.
- [x] Badge số sự cố = Đúng số lượng dòng trong Hộp việc cứu đơn.
- [x] Badge khoản lệch = Đúng số lượng dòng trong Bảng đối soát.
- [x] Tiền thực nhận trong Ba Sổ = Đúng tổng số tiền bồi thường đã chấp thuận.
- [x] Phân quyền Maker-Checker chặn người tạo tự duyệt chênh lệch.
- [x] Secret token của hãng không bị lộ ra ngoài client dạng plaintext.
- [x] Số điện thoại người nhận được che `090***5678` và chỉ mở khi bấm nút có kiểm toán.
- [x] Không còn mã `CN-xx`, `BR-xx` trên giao diện người dùng.
- [x] Toàn bộ test suite và typecheck đạt 100% PASS (0 lỗi).
