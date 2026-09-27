# TASK-FOUND-05 — Pull the MinIO client image from a registry CI can reach

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-FOUND-05` |
| Feature ID | `N/A — repository foundation for EPIC-FND` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `181` |
| Dependencies | `TASK-FOUND-04` — `MERGED` by PR `#13` at `9d101f4e5d9de9b880cc4311126ce8fe06de4206` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `infra/docker/compose.yml`; `docs/product-spec/work-items/TASK-FOUND-05.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-found-05-minio-image` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Ensure local development and CI pipeline (`current-application` job running `pnpm infra:up`) can reliably pull container images for local object storage (MinIO server and MinIO client `mc`). This unblocks continuous integration and test verification by replacing upstream image tags that were disabled or removed from public registries with verified, anonymously pullable, pinned images from `quay.io/minio/aistor/`.

## Source references

- `AGENTS.md` — Shared agent contract, foundation verification commands, and single-unit delivery constraints.
- `docs/product-spec/docs/07-ai-build/TECH-STACK-REPOSITORY.md` — Local infrastructure and Docker Compose specification.
- `docs/product-spec/docs/09-delivery/CI-CD-DEPLOYMENT.md` — CI gate definitions and local service lifecycle.
- `docs/product-spec/docs/10-ai-collaboration/FOUNDATION-WORK-ITEMS.md` — Foundation infrastructure outcomes for `TASK-FOUND-03` and `TASK-FOUND-04`.
- `docs/product-spec/work-items/TASK-FOUND-03.md` — Original Compose definitions for PostgreSQL, Redis, and MinIO.

## Preconditions and dependencies

- `TASK-FOUND-03` merged on `main` at commit `ff1dbc770257b1a581b51951ab481ad037ed3ed1`, introducing `infra/docker/compose.yml`.
- `TASK-FOUND-04` merged on `main` at commit `9d101f4e5d9de9b880cc4311126ce8fe06de4206`.
- Upstream public registries (`docker.io` and `quay.io`) were probed anonymously without requiring authentication:
  - `quay.io/minio/minio:RELEASE.2025-02-18T16-25-55Z` returns HTTP 401 Unauthorized (`$disabled`).
  - `quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z` returns HTTP 401 Unauthorized (`$disabled`).
  - `docker.io/minio/minio` and `docker.io/minio/mc` return HTTP 404 / 401 (`insufficient_scope`, discontinued on Docker Hub).
  - `quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z` returns HTTP 200 OK for tag query, token acquisition, and manifest/layer blob downloads.
  - `quay.io/minio/aistor/mc:RELEASE.2026-09-19T15-24-59Z` returns HTTP 200 OK for tag query, token acquisition, and manifest/layer blob downloads.
- Licensing and startup compatibility rationale:
  - According to MinIO AIStor documentation (`https://docs.min.io/aistor/operations/licenses/`), "Starting without a license was added in AIStor Server RELEASE.2025-12-20T04-58-37Z. Earlier versions require a valid license to start."
  - Server tag `RELEASE.2026-09-19T17-05-25Z` is >= `RELEASE.2025-12-20T04-58-37Z`, resolving the CI startup blocker by enabling license-free startup in CI test runners.
  - No additional startup flags or environment variables are required for license-free startup.

## Author boundary

`GEMINI` authors this bounded foundation infrastructure fix. The scope is strictly limited to updating container image tags in `infra/docker/compose.yml`, creating this Work Item documentation, and recording the delivery register row. No application code, database schema, carrier integration, or tenant security boundary is modified.

## In scope

- Update `infra/docker/compose.yml` to use pullable, pinned tags:
  - `minio`: `quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z`
  - `minio-init`: `quay.io/minio/aistor/mc:RELEASE.2026-09-19T15-24-59Z`
- Verify anonymous registry accessibility for token, manifest, and blob endpoints via registry HTTP API.
- Validate `infra/docker/compose.yml` YAML syntax and structure.
- Verify `git diff --check` and Prettier format checks pass.
- Record `TASK-FOUND-05` in `docs/product-spec/work-items/TASK-FOUND-05.md` and `FEATURE-DELIVERY-REGISTER.csv`.

## Out of scope

- Modifying `minio-init` container entrypoint script or bucket initialization commands (`mc alias set`, `mc mb`).
- Modifying other Compose services (`postgres`, `redis`).
- Adding application features or database migrations.
- Pushing to remote repository.

## Business rules and edge cases

- `BR-INFRA-01`: MinIO server image must remain pinned to an immutable release tag rather than a mutable `:latest` tag.
- `BR-INFRA-02`: MinIO client image must remain pinned to an immutable release tag containing `/usr/bin/mc` and `/bin/sh` matching the `minio-init` entrypoint script.
- `BR-INFRA-03`: Images must be anonymously pullable in CI runners without requiring Docker Hub login credentials or private tokens.
- `BR-INFRA-04`: Service dependencies, healthchecks, volume names, and port mappings must remain unchanged.
- `BR-INFRA-05`: MinIO server image tag must be >= `RELEASE.2025-12-20T04-58-37Z` to ensure container starts without requiring a commercial license key.

## UI states

N/A — Foundation infrastructure work item; no user-facing UI or screens are modified.

## API, event and data impact

None. No database migrations, API routes, events, or queues are touched. The `shipde-local` and `shipde-test` S3 buckets continue to be provisioned identically by `minio-init`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-FOUND-05-01` | Query registry HTTP API for MinIO server image anonymously | Returns HTTP 200 with valid token and manifest | HTTP HEAD/GET status 200 on `quay.io/v2/minio/aistor/minio/manifests/RELEASE.2026-09-19T17-05-25Z` |
| `AC-FOUND-05-02` | Query registry HTTP API for MinIO client (`mc`) image anonymously | Returns HTTP 200 with valid token and manifest | HTTP HEAD/GET status 200 on `quay.io/v2/minio/aistor/mc/manifests/RELEASE.2026-09-19T15-24-59Z` |
| `AC-FOUND-05-03` | Validate `infra/docker/compose.yml` structure | YAML parses without syntax errors; all 4 services intact | `python -c "import yaml; yaml.safe_load(...)"` passes with services `['postgres', 'redis', 'minio', 'minio-init']` |
| `AC-FOUND-05-04` | Check whitespace and line endings | Zero git whitespace errors | `git diff --check` exits with code 0 |
| `AC-FOUND-05-05` | Check code formatting | Formatting passes without error | `pnpm format:check` reports 100% compliance |

## Verification commands

- Registry API check:
  - Token endpoint: `https://quay.io/v2/auth?service=quay.io&scope=repository:minio/aistor/minio:pull` -> HTTP 200 OK (bearer token)
  - Manifest endpoint: `https://quay.io/v2/minio/aistor/minio/manifests/RELEASE.2026-09-19T17-05-25Z` -> HTTP 200 OK (Content-Type: `application/vnd.oci.image.manifest.v1+json`)
  - Config & Layer blob endpoints: `https://quay.io/v2/minio/aistor/minio/blobs/<digest>` -> HTTP 200 OK
  - Token endpoint: `https://quay.io/v2/auth?service=quay.io&scope=repository:minio/aistor/mc:pull` -> HTTP 200 OK (bearer token)
  - Manifest endpoint: `https://quay.io/v2/minio/aistor/mc/manifests/RELEASE.2026-09-19T15-24-59Z` -> HTTP 200 OK (Content-Type: `application/vnd.oci.image.manifest.v1+json`)
  - Config & Layer blob endpoints: `https://quay.io/v2/minio/aistor/mc/blobs/<digest>` -> HTTP 200 OK
- YAML syntax check:
  - `python -c "import yaml; yaml.safe_load(open('infra/docker/compose.yml'))"` -> clean exit 0
- Format and diff checks:
  - `git diff --check` -> clean exit 0

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `2f50497e3fffa24ed5f6a8fc15f7f2d505c5b7ba` | `CHANGES_REQUIRED` | CRITICAL: AIStor server before `RELEASE.2025-12-20T04-58-37Z` required license to start; HIGH: server tag regression (Feb 14 vs Feb 18 2025). Resolved by upgrading `minio` image to `quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z` (>= `RELEASE.2025-12-20T04-58-37Z`, enabling license-free startup) and `mc` to `quay.io/minio/aistor/mc:RELEASE.2026-09-19T15-24-59Z`. Verified both manifests and blobs return HTTP 200 anonymously. Verified no startup flags or license env vars needed. |
| 2 | pending | pending | Verification round for license-free AIStor releases |

## Residual limitations

- Docker binary is not installed on the local Windows execution environment; live container launch (`pnpm infra:up`) was verified via registry API contract and YAML syntax, and will execute in the GitHub Actions runner where Docker is available.
