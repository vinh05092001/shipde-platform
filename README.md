# Ship Dễ Platform (shipde.net)

Nền tảng điều hành & kiểm soát vận chuyển cho Shop Online.

## 1. Cấu trúc Monorepo (Workspace Layout)

Repository được tổ chức theo mô hình TypeScript Monorepo sử dụng **pnpm workspaces** và **Turborepo**:

```text
apps/
  web/                  # Ứng dụng Next.js (Web Console & Prototype Workspaces)
packages/
  contracts/            # Hợp đồng dữ liệu, enumerations, API response types & error codes
  config/               # Cấu hình dùng chung (TypeScript base, constants)
  testkit/              # Bộ công cụ kiểm thử dùng chung & fixtures
  ui/                   # Nền tảng Design System, theme tokens & UI primitives
infra/                  # Cấu hình hạ tầng & migration (TASK-FOUND-03)
docs/                   # Đặc tả sản phẩm & hồ sơ kiểm toán
scripts/                # Tập lệnh kiểm tra tự động, bảo mật & đối soát
```

## 2. Yêu cầu Môi trường (Prerequisites)

- **Node.js**: `>=24.0.0` (khuyến nghị `v24.15.0`, quản lý qua `.nvmrc` và `.node-version`)
- **pnpm**: `11.23.0` (được ghim chính xác trong trường `packageManager` tại `package.json`)
- **Git**: Hỗ trợ Windows & Linux line endings chuẩn hóa

## 3. Lệnh Thao tác Chuẩn (Root Commands)

Tất cả các lệnh được điều phối từ thư mục gốc qua `pnpm` và `Turborepo`:

| Lệnh                             | Mô tả tác vụ                                                 |
| -------------------------------- | ------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | Cài đặt chính xác các phụ thuộc theo `pnpm-lock.yaml`        |
| `pnpm dev`                       | Khởi chạy máy chủ phát triển ứng dụng (`apps/web`)           |
| `pnpm build`                     | Biên dịch toàn bộ các gói và ứng dụng                        |
| `pnpm lint`                      | Kiểm tra quy tắc mã nguồn qua ESLint                         |
| `pnpm format:check`              | Kiểm toán định dạng gia tăng với Prettier (Fail-Closed)      |
| `pnpm format:write`              | Tự động định dạng toàn bộ mã nguồn                           |
| `pnpm typecheck`                 | Kiểm tra kiểu dữ liệu TypeScript trên toàn workspace         |
| `pnpm test`                      | Chạy bộ kiểm toán hồi quy & bất biến nghiệp vụ               |
| `pnpm test:e2e`                  | Chạy 12 kịch bản kiểm thử xuyên suốt (E2E Scenarios)         |
| `pnpm test:baseline`             | Chạy bộ kiểm thử khói bảo toàn 10 bề mặt điều hành trọng yếu |
| `pnpm security:secrets`          | Quét kiểm tra rò rỉ bí mật với Gitleaks                      |
| `pnpm concierge:audit`           | Thực thi kiểm toán thí nghiệm Concierge trên 3 shop mẫu      |

## 4. Nguyên tắc Vận hành & Đóng góp

Vui lòng tham khảo chi tiết hợp đồng tác tử và quy tắc chuyển giao tại [AGENTS.md](./AGENTS.md).
