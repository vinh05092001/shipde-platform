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

| Lệnh                                    | Mô tả tác vụ                                                 |
| --------------------------------------- | ------------------------------------------------------------ |
| `pnpm install --prod --frozen-lockfile` | Kiểm chứng cài đặt production không chạy CLI chỉ có ở dev    |
| `pnpm install --frozen-lockfile`        | Cài đặt chính xác toàn bộ phụ thuộc theo `pnpm-lock.yaml`    |
| `pnpm dev`                              | Khởi chạy máy chủ phát triển ứng dụng (`apps/web`)           |
| `pnpm build`                            | Sinh Prisma Client rồi biên dịch toàn bộ workspace           |
| `pnpm lint`                             | Kiểm tra quy tắc mã nguồn qua ESLint                         |
| `pnpm format:check`                     | Kiểm toán định dạng gia tăng với Prettier (Fail-Closed)      |
| `pnpm format:write`                     | Tự động định dạng toàn bộ mã nguồn                           |
| `pnpm typecheck`                        | Kiểm tra kiểu dữ liệu TypeScript trên toàn workspace         |
| `pnpm test`                             | Chạy bộ kiểm toán hồi quy & bất biến nghiệp vụ               |
| `pnpm test:audit`                       | Chạy kiểm toán hồi quy độc lập (tự động build prerequisite)  |
| `pnpm test:e2e`                         | Chạy 12 kịch bản kiểm thử xuyên suốt (E2E Scenarios)         |
| `pnpm test:baseline`                    | Chạy bộ kiểm thử khói bảo toàn 10 bề mặt điều hành trọng yếu |
| `pnpm security:secrets`                 | Quét kiểm tra rò rỉ bí mật với Gitleaks                      |
| `pnpm db:generate`                      | Sinh Prisma client từ schema gốc (prisma/schema.prisma)      |
| `pnpm concierge:audit`                  | Thực thi kiểm toán thí nghiệm Concierge trên 3 shop mẫu      |

## 4. Chính sách Phê duyệt Lifecycle Scripts (pnpm allowBuilds)

Repository không khai báo `preinstall`, `install`, `postinstall` hoặc `prepare` để gọi Prisma CLI. Prisma Client chỉ được sinh bằng `pnpm db:generate` hoặc bước đầu của `pnpm build`, sau khi dev dependencies đã được cài đầy đủ. CI phải chạy lệnh production-only trên clean checkout để ngăn lifecycle hook làm hỏng production image.

Nhằm đảm bảo an toàn chuỗi cung ứng (supply chain security), toàn bộ dependency lifecycle scripts bị từ chối mặc định (`deny by default`). Chỉ có 6 gói phụ thuộc sau được phê duyệt rõ ràng trong `pnpm-workspace.yaml`:

| Gói phụ thuộc     | Lý do cụ thể                              | Tính năng yêu cầu                       | Kết quả thẩm định                    | Tính chấp nhận được                  |
| ----------------- | ----------------------------------------- | --------------------------------------- | ------------------------------------ | ------------------------------------ |
| `@prisma/client`  | Sinh TypeScript client bindings từ schema | `apps/web/src/server/db.ts` & 17 models | Sinh mã local trong `.prisma/client` | Bắt buộc cho type-safe ORM           |
| `@prisma/engines` | Tải pre-compiled query engine binaries    | CLI validation & client execution       | Binaries xác thực checksum           | Cần thiết cho Prisma query engine    |
| `esbuild`         | Cài đặt native binary cho host OS         | `tsx` chạy root scripts & Turbo build   | Native binary đóng gói sẵn           | Bundler chuẩn cho TypeScript scripts |
| `prisma`          | Thiết lập Prisma CLI command              | Schema generation & validation          | Local CLI wrapper                    | Tooling quản trị schema              |
| `sharp`           | Cài đặt native libvips image processor    | Next.js Image optimization              | Xử lý ảnh pod/logo local             | Tối ưu hóa ảnh trong `apps/web`      |
| `unrs-resolver`   | Native Rust module resolution             | ESLint / TypeScript linting resolver    | Phân giải import path static         | Cần thiết cho `pnpm lint` workspace  |

## 5. Nguyên tắc Vận hành & Đóng góp

Vui lòng tham khảo chi tiết hợp đồng tác tử và quy tắc chuyển giao tại [AGENTS.md](./AGENTS.md).
