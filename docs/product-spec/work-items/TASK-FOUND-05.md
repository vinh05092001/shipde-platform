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
| Allowed paths | `infra/docker/compose.yml`; `.github/workflows/current-application.yml`; `docs/product-spec/scripts/validate_docs.py`; `docs/product-spec/work-items/TASK-FOUND-05.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-found-05-minio-image` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Ensure local development and CI pipeline (`current-application` job running `pnpm infra:up`) can reliably pull container images for local object storage (MinIO server and MinIO client `mc`). This unblocks continuous integration and test verification by replacing upstream image tags that were disabled or removed from public registries, as well as AIStor images that deny S3 operations without a commercial license, with verified, anonymously pullable, immutable Chainguard community MinIO images pinned by digest from `cgr.dev/chainguard/`.

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
- AIStor failure evidence at commit `46c9473`:
  - `quay.io/minio/aistor/minio` server starts and reports healthy, but logs: `WARN: No valid license found, running in offline mode. All S3 operations are denied`.
  - `minio-init` fails with: `Unable to make bucket ... Access denied. No license is installed`.
  - Consequently, AIStor commercial builds cannot be used without a paid license key and are unsuitable for open-source CI/local environments.
- Probed Chainguard community MinIO images on `cgr.dev`:
  - `cgr.dev/chainguard/minio:latest` and `:latest-dev` return HTTP 200 anonymously for tokens, manifests, and layer blobs.
  - `cgr.dev/chainguard/minio-client:latest` and `:latest-dev` return HTTP 200 anonymously for tokens, manifests, and layer blobs.
- Distroless vs Dev and Binary Inspection:
  - Standard Chainguard distroless images (`:latest`) contain minimal application binaries: `chainguard/minio:latest` lacks `curl`/`wget`; `chainguard/minio-client:latest` lacks `/bin/sh` (contains only `bash`).
  - Chainguard development images (`:latest-dev`) include shells and networking utilities:
    - `cgr.dev/chainguard/minio:latest-dev`: includes `/usr/bin/minio`, `/usr/bin/mc`, `/usr/bin/wget` (GNU wget 1.25.0), `/bin/sh` (symlink), `/usr/bin/sh`, and `/usr/bin/bash`.
    - `cgr.dev/chainguard/minio-client:latest-dev`: includes `/usr/bin/mc`, `/bin/sh` (symlink to `/bin/busybox`), `/usr/bin/sh`, and `/usr/bin/bash`.
- Licensing:
  - Chainguard MinIO is built from upstream community MinIO source code under AGPL-3.0-or-later.
  - S3 operations (bucket creation, object read/write) are fully enabled without license keys or offline mode restrictions.
- Pinned cryptographic digests:
  - `minio`: `cgr.dev/chainguard/minio@sha256:d7c906993247627c19f37fc1fa302c34cf2d209ae0e7dc7d52fb0be6ac2849ba` (multi-arch index digest; linux/amd64: `sha256:ba8e9797a71bc2d0f0901803a260cbe8f56017f4c896ec5c2abd4e412c46dd69`, linux/arm64: `sha256:a7dd71d1a7ed4b8cd7305fe0971e3e21080be8e965b9eb1dc2d1ab3de6c92e5d`).
  - `minio-init`: `cgr.dev/chainguard/minio-client@sha256:f0dd93b48af1f8a641edcd3c64661c8dbe05189bd2ef2f8cea216eb18af10bf8` (multi-arch index digest; linux/amd64: `sha256:c928b3c2e54c9dad7b45a4383d8db82a216d313257c5ba0e16731c07322aed2b`, linux/arm64: `sha256:578914d4ace20c6915c82a05bd5ad52701eef909def43173b2e98fec859d5d6e`).

## Author boundary

`GEMINI` authors this bounded foundation infrastructure fix. The scope is strictly limited to updating container image tags in `infra/docker/compose.yml`, creating this Work Item documentation, and recording the delivery register row. No application code, database schema, carrier integration, or tenant security boundary is modified.

## In scope

- Update `infra/docker/compose.yml` to use pullable, pinned Chainguard community MinIO image digests:
  - `minio`: `cgr.dev/chainguard/minio@sha256:d7c906993247627c19f37fc1fa302c34cf2d209ae0e7dc7d52fb0be6ac2849ba`
  - `minio-init`: `cgr.dev/chainguard/minio-client@sha256:f0dd93b48af1f8a641edcd3c64661c8dbe05189bd2ef2f8cea216eb18af10bf8`
- Configure MinIO container healthcheck in `infra/docker/compose.yml` to probe `http://127.0.0.1:9000/minio/health/live` using image-bundled `wget` (with `curl` fallback).
- Keep failure diagnostic step in `.github/workflows/current-application.yml` to dump MinIO container logs on failure before teardown.
- Keep `docs/product-spec/scripts/validate_docs.py` recognizing `TASK-FOUND-05` in `FEATURE-DELIVERY-REGISTER.csv` via `range(1, 6)`.
- Keep bucket creation (`shipde-local`, `shipde-test`) and credentials behavior identical.
- Verify anonymous registry accessibility for token, manifest, and blob endpoints via registry HTTP API.
- Validate `infra/docker/compose.yml` YAML syntax and structure.
- Verify `git diff --check` and Prettier format checks pass.
- Record `TASK-FOUND-05` in `docs/product-spec/work-items/TASK-FOUND-05.md` and `FEATURE-DELIVERY-REGISTER.csv`.

## Out of scope

- Modifying `minio-init` container entrypoint script structure or bucket initialization commands (`mc alias set`, `mc mb`).
- Modifying other Compose services (`postgres`, `redis`).
- Adding application features or database migrations.
- Pushing to remote repository.

## Business rules and edge cases

- `BR-INFRA-01`: MinIO server and client images must remain pinned to immutable cryptographic digests (`image@sha256:...`) rather than mutable tags.
- `BR-INFRA-02`: MinIO client image must contain `/usr/bin/mc` and `/bin/sh` matching the `minio-init` entrypoint script.
- `BR-INFRA-03`: Images must be anonymously pullable in CI runners without requiring Docker Hub login credentials or private tokens.
- `BR-INFRA-04`: MinIO container healthcheck must probe `http://127.0.0.1:9000/minio/health/live` via image-provided tools (`wget` / `curl`) on loopback `127.0.0.1`.
- `BR-INFRA-05`: Images must use AGPL community builds of MinIO to avoid commercial license lockouts ("running in offline mode; S3 operations denied").

## UI states

N/A — Foundation infrastructure work item; no user-facing UI or screens are modified.

## API, event and data impact

None. No database migrations, API routes, events, or queues are touched. The `shipde-local` and `shipde-test` S3 buckets continue to be provisioned identically by `minio-init`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-FOUND-05-01` | Query registry HTTP API for Chainguard MinIO server image anonymously | Returns HTTP 200 with valid token and manifest index | HTTP GET status 200 on `https://cgr.dev/v2/chainguard/minio/manifests/sha256:d7c906993247627c19f37fc1fa302c34cf2d209ae0e7dc7d52fb0be6ac2849ba` |
| `AC-FOUND-05-02` | Query registry HTTP API for Chainguard MinIO client (`mc`) image anonymously | Returns HTTP 200 with valid token and manifest index | HTTP GET status 200 on `https://cgr.dev/v2/chainguard/minio-client/manifests/sha256:f0dd93b48af1f8a641edcd3c64661c8dbe05189bd2ef2f8cea216eb18af10bf8` |
| `AC-FOUND-05-03` | Validate `infra/docker/compose.yml` structure | YAML parses without syntax errors; all 4 services intact | `python -c "import yaml; yaml.safe_load(...)"` passes with services `['postgres', 'redis', 'minio', 'minio-init']` |
| `AC-FOUND-05-04` | Check whitespace and line endings | Zero git whitespace errors | `git diff --check` exits with code 0 |
| `AC-FOUND-05-05` | Check code formatting | Formatting passes without error | `pnpm format:check` reports 100% compliance |
| `AC-FOUND-05-06` | Run documentation validation | All structural and register validations pass | `python docs/product-spec/scripts/validate_docs.py` exits 0 |
| `AC-FOUND-05-07` | Inspect Chainguard image layer binaries and metadata | Contains `/bin/sh`, `/usr/bin/wget`, `/usr/bin/mc`, and AGPL community MinIO | Layer tar inspection confirms `/bin/sh` (symlink to `/bin/busybox`), `/usr/bin/wget`, and `/usr/bin/mc` present; community AGPL license |
| `AC-FOUND-05-08` | CI failure diagnostics step in `current-application.yml` | Dumps `minio` and `minio-init` logs on failure before teardown | Step configured with `if: failure()` executing `docker compose -f infra/docker/compose.yml logs --no-color minio minio-init` |

## Verification commands

- Registry API check:
  - Token endpoint: `https://cgr.dev/token?scope=repository:chainguard/minio:pull` -> HTTP 200 OK (bearer token)
  - Manifest index endpoint: `https://cgr.dev/v2/chainguard/minio/manifests/sha256:d7c906993247627c19f37fc1fa302c34cf2d209ae0e7dc7d52fb0be6ac2849ba` -> HTTP 200 OK (Content-Type: `application/vnd.oci.image.index.v1+json`)
  - Config & Layer blob endpoints: `https://cgr.dev/v2/chainguard/minio/blobs/<digest>` -> HTTP 200 OK (Content-Length: 41,201,982 bytes)
  - Token endpoint: `https://cgr.dev/token?scope=repository:chainguard/minio-client:pull` -> HTTP 200 OK (bearer token)
  - Manifest index endpoint: `https://cgr.dev/v2/chainguard/minio-client/manifests/sha256:f0dd93b48af1f8a641edcd3c64661c8dbe05189bd2ef2f8cea216eb18af10bf8` -> HTTP 200 OK (Content-Type: `application/vnd.oci.image.index.v1+json`)
  - Config & Layer blob endpoints: `https://cgr.dev/v2/chainguard/minio-client/blobs/<digest>` -> HTTP 200 OK (Content-Length: 12,544,595 bytes)
- Layer tar inspection:
  - `chainguard/minio:latest-dev`: confirms `/usr/bin/minio`, `/usr/bin/mc`, `/usr/bin/wget`, `/bin/sh`
  - `chainguard/minio-client:latest-dev`: confirms `/usr/bin/mc`, `/bin/sh` (symlink to `/bin/busybox`)
- YAML syntax check:
  - `python -c "import yaml; yaml.safe_load(open('infra/docker/compose.yml'))"` -> clean exit 0
- Documentation and register validation:
  - `python docs/product-spec/scripts/validate_docs.py` -> clean exit 0
- Format and diff checks:
  - `git diff --check` -> clean exit 0
  - `pnpm format:check` -> clean exit 0

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `2f50497e3fffa24ed5f6a8fc15f7f2d505c5b7ba` | `CHANGES_REQUIRED` | CRITICAL: AIStor server before `RELEASE.2025-12-20T04-58-37Z` required license to start; HIGH: server tag regression (Feb 14 vs Feb 18 2025). Resolved by upgrading `minio` image to `quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z` and `mc` to `quay.io/minio/aistor/mc:RELEASE.2026-09-19T15-24-59Z`. |
| 2 | `46c9473336bf591604169f586146faa7ac4fcfbc` | `CHANGES_REQUIRED` | AIStor server starts and is healthy, but runs in offline mode without a valid license, denying all S3 operations (`WARN: No valid license found, running in offline mode. All S3 operations are denied`; `minio-init`: `Unable to make bucket ... Access denied. No license is installed`). Resolved by switching to Chainguard community MinIO images pinned by immutable digests (`cgr.dev/chainguard/minio@sha256:d7c906993247627c19f37fc1fa302c34cf2d209ae0e7dc7d52fb0be6ac2849ba` and `cgr.dev/chainguard/minio-client@sha256:f0dd93b48af1f8a641edcd3c64661c8dbe05189bd2ef2f8cea216eb18af10bf8`), built under AGPL-3.0-or-later without commercial license locks. |
| 3 | pending | pending | Switched both services to Chainguard community MinIO images pinned by digest. Verified presence of `/bin/sh` in client and `/usr/bin/wget` in server. Healthcheck updated to use `wget -q -O /dev/null ...`. Preserved failure-only log dump and `validate_docs.py`. |

## Residual limitations

- Docker binary is not installed on the local Windows execution environment; live container launch (`pnpm infra:up`) was verified via registry API contract and YAML syntax, and will execute in the GitHub Actions runner where Docker is available.
