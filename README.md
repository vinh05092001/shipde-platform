# Ship Dễ Platform (shipde.net)

Nền tảng điều hành & kiểm soát vận chuyển cho Shop Online.

## 1. Cấu trúc Monorepo (Workspace Layout)

Repository được tổ chức theo mô hình TypeScript Monorepo sử dụng **pnpm workspaces** và **Turborepo**:

```text
apps/
  web/                  # Ứng dụng Next.js (Web Console & Prototype Workspaces)
  api/                  # Ứng dụng NestJS Modular Monolith API Foundation (TASK-FOUND-03)
  worker/               # Dịch vụ NestJS Background Worker & Outbox Dispatcher (TASK-FOUND-03)
packages/
  contracts/            # Hợp đồng dữ liệu, enumerations, API response types & error codes
  config/               # Cấu hình dùng chung (TypeScript base, constants, validation, logging)
  testkit/              # Bộ công cụ kiểm thử dùng chung & fixtures
  ui/                   # Nền tảng Design System, theme tokens & UI primitives
infra/                  # Cấu hình Docker Compose (PostgreSQL, Redis, MinIO) & migrations
docs/                   # Đặc tả sản phẩm & hồ sơ kiểm toán
scripts/                # Tập lệnh kiểm tra tự động, bảo mật & đối soát
```

## 2. Yêu cầu Môi trường (Prerequisites)

- **Node.js**: `>=24.0.0` (khuyến nghị `v24.15.0`, quản lý qua `.nvmrc` và `.node-version`)
- **pnpm**: `11.23.0` (được ghim chính xác trong trường `packageManager` tại `package.json`)
- **Docker & Docker Compose**: Docker 29+ và Docker Compose v5+ (dùng cho hạ tầng PostgreSQL, Redis, MinIO)
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
| `pnpm test:integration`                 | Kiểm thử tích hợp liveness, readiness, outbox & BullMQ queue |
| `pnpm test:e2e`                         | Chạy 12 kịch bản kiểm thử xuyên suốt (E2E Scenarios)         |
| `pnpm test:baseline`                    | Chạy bộ kiểm thử khói bảo toàn 10 bề mặt điều hành trọng yếu |
| `pnpm infra:up`                         | Khởi chạy Docker Compose (PostgreSQL 16, Redis, MinIO)       |
| `pnpm infra:wait`                       | Chờ tất cả container hạ tầng đạt trạng thái healthy          |
| `pnpm infra:down`                       | Dừng và thu hồi các container hạ tầng                        |
| `pnpm infra:reset`                      | Xóa toàn bộ container và named volumes hạ tầng               |
| `pnpm db:generate`                      | Sinh Prisma client từ schema gốc (prisma/schema.prisma)      |
| `pnpm db:migrate`                       | Triển khai các bản migration vào cơ sở dữ liệu PostgreSQL    |
| `pnpm db:migrate:status`                | Kiểm tra trạng thái đồng bộ migration của cơ sở dữ liệu      |
| `pnpm db:reset`                         | Reset toàn bộ cơ sở dữ liệu và tái thực thi migrations       |
| `pnpm security:secrets`                 | Quét kiểm tra rò rỉ bí mật với Gitleaks                      |
| `pnpm verify:inventory`                 | Kiểm tra tính toàn vẹn và phân loại danh mục tính năng       |
| `pnpm concierge:audit`                  | Thực thi kiểm toán thí nghiệm Concierge trên 3 shop mẫu      |

## 4. Hạ tầng Cục bộ & Cấu hình Môi trường (Local Infrastructure & Env)

Dự án sử dụng file mẫu `.env.example` chứa toàn bộ cấu hình mặc định an toàn cho môi trường phát triển cục bộ:

- **PostgreSQL 16 (Alpine)**: Chạy trên port `5433` (được map từ `5432` bên trong container nhằm tránh xung đột với PostgreSQL service native trên Windows). Chuỗi kết nối mặc định: `postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public`.
- **Redis 7.4 (Alpine)**: Chạy trên port `6379` phục vụ bộ đệm và BullMQ durable outbox dispatch.
- **MinIO S3**: Chạy trên port `9000` (S3 API) và `9001` (Web Console), tài khoản `minioadmin` / `minioadmin`.
- **API Service (`apps/api`)**: Lắng nghe port `3001`. Cung cấp probe vận hành `GET /health/live` và `GET /health/ready`.
- **Worker Service (`apps/worker`)**: Lắng nghe port `3002` phục vụ probe vận hành `GET /health/live` và `GET /health/ready`. Xử lý queue background và dispatch outbox.

Khởi động hạ tầng:

```bash
# 1. Khởi chạy các container
pnpm infra:up

# 2. Chờ hạ tầng sẵn sàng
pnpm infra:wait

# 3. Triển khai migration
pnpm db:migrate

# 4. Chạy kiểm thử tích hợp (tự động biên dịch API và Worker artifacts trước khi chạy)
pnpm test:integration
```

## 5. Chính sách Phê duyệt Lifecycle Scripts (pnpm allowBuilds)

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

## 6. Nguyên tắc Vận hành & Đóng góp

Vui lòng tham khảo chi tiết hợp đồng tác tử và quy tắc chuyển giao tại [AGENTS.md](./AGENTS.md).
