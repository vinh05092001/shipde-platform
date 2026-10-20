# GOAL-AUTOCLAW-REPOS-7 — Nhóm 6 - Security

## Control

| Field           | Value                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `GOAL-AUTOCLAW-REPOS-7`                                                                                                                   |
| Feature ID      | `GOAL-AUTOCLAW-REPOS`                                                                                                                     |
| Status          | `BACKLOG`                                                                                                                                 |
| Delivery order  | `259`                                                                                                                                     |
| Dependencies    | `GOAL-AUTOCLAW-REPOS-1`                                                                                                                   |
| Assigned author | `GEMINI`                                                                                                                                  |
| Risk            | `LOW`                                                                                                                                     |
| Allowed paths   | `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-6-SECURITY.md`, `tools/ai-brain/test/repo-integration-group-6.test.js` |
| Reviewer        | `Codex — fresh independent task`                                                                                                          |
| Branch          | `feat/goal-autoclaw-repos-7-impl`                                                                                                         |
| Pull Request    | `Pending`                                                                                                                                 |

## Business outcome

> Ghi và kiểm bằng chứng gắn nhóm 6 (security), scanner unavailable hoặc error không được thành PASS.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-APPENDIX-20261013.md`
- `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-6-SECURITY.md`

## Preconditions and dependencies

- Preconditions: GOAL-AUTOCLAW-REPOS-1.

## Author boundary

- Author: GEMINI. Follow AGENTS.md operating contract.
- Allowed paths: `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-6-SECURITY.md`, `tools/ai-brain/test/repo-integration-group-6.test.js`.
- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.

## In scope

- Nhóm 6 - Security.
- Unit and integration verification commands matching acceptance criteria.

## Out of scope

- Modifying unallowed paths or inventing business rules.

## Business rules and edge cases

- Strict adherence to repository baseline and source specifications.

## UI states

- Full state coverage where UI is affected; N/A for pure backend.

## API, event and data impact

- Safe contract and schema handling within allowed paths.

## Acceptance matrix

| AC/Test ID | Scenario                                                                                                                                   | Expected result               | Evidence required      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ---------------------- |
| AC-1       | Repo/package + version/ref: gitleaks/gitleaks, aquasecurity/trivy, semgrep/semgrep, snyk/agent-scan.                                       | Passes automated verification | Automated check passes |
| AC-2       | Năng lực: secrets/Git-history gate; vulnerability/config scopes; code-security rules; agent/MCP/skill security.                            | Passes automated verification | Automated check passes |
| AC-3       | Trigger: CI/hooks, target/DB/scope, rules pin, directories/manifests.                                                                      | Passes automated verification | Automated check passes |
| AC-4       | Adapter/caller tái dùng (không tạo trùng): security runner và gate hiện có; không bật mặc định trong CI khi chưa đo thời gian.             | Passes automated verification | Automated check passes |
| AC-5       | Hợp đồng vào/ra: baseline và fixtures -> findings; suppression phải có lý do và test; scanner lỗi -> không PASS.                           | Passes automated verification | Automated check passes |
| AC-6       | Task chạy thực + artifact: benign và malicious fixtures, exit status rõ; chưa thay toàn bộ bằng Nox hoặc Cisco scanners.                   | Passes automated verification | Automated check passes |
| AC-7       | Trạng thái: DECLARED; chỉ lên WIRED/EXECUTION_VERIFIED/ACCEPTED khi có test và SHA; limitation: không bỏ scanner cũ trước coverage parity. | Passes automated verification | Automated check passes |
| AC-8       | Test passes: tools/ai-brain/test/repo-integration-group-6.test.js                                                                          | Passes automated verification | Automated check passes |

## Verification commands

- `node --test tools/ai-brain/test/repo-integration-group-6.test.js`

## Codex review record

| Review round | Commit    | Verdict   | Findings resolved |
| ------------ | --------- | --------- | ----------------- |
| 1            | `Pending` | `Pending` | `Pending`         |

## Residual limitations

None.

### 2026-10-20 — aquasecurity/trivy: EXECUTION_VERIFIED

- Repo/ref: Trivy `0.75.0`, provisioned in CI from the release tarball after a `sha256sum -c` check against the release checksums. The version is read from `TRIVY_PINNED_VERSION` in `scripts/verify-trivy.ts`, so it is pinned in one place. The previous pin `0.60.0` is no longer published.
- Capability: blocking HIGH/CRITICAL (fixable) vulnerability and misconfiguration gate over the workspace.
- Trigger: `pnpm security:trivy`; CI job `dependency-scan` in `security-baseline.yml`.
- Contract: `trivy fs --scanners vuln,misconfig --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed .`. Exit 0 means clean, 1 means a finding, 2 means the scan did not run. Trivy 0.75 removed `--security-checks` and `config`; the gate now uses `--scanners` and `misconfig`. The secret-scanning guard still rejects `secret` under both flags.
- Real run: the first run found 26 dependency advisories (23 HIGH, 3 CRITICAL) in `next`, `sharp`, `postcss`, `proxy-addr`, `multer`, `source-map-js` and `deepmerge-ts`, plus Dockerfile DS-0002. Fixes: `next`/`eslint-config-next` were raised to 16.3.8 and pnpm overrides raise the transitive packages. After that the scan exits 0.
- Accepted exception: DS-0002 for `scripts/ai/docker-worker/Dockerfile`, a local agy worker image whose login state lives under `/root`. The reason is recorded in `.trivyignore`.
- Regression: `pnpm lint`, `typecheck`, `test`, `test:e2e`, `build` and `test:a11y` pass locally after the upgrades.

### 2026-10-20 — semgrep/semgrep: EXECUTION_VERIFIED

- **Repo/ref:** Semgrep `1.181.0`. It is installed in CI with pip, and the version is read from the manifest entry, so the pin lives in one place. It moves from candidates (PILOT) to adopted.
- **Capability:** a blocking code-security gate over `apps` and `packages`, using repository-owned rules in `tools/semgrep/rules/shipde.yml`:
  - `shipde-no-dynamic-code`: `eval` and `new Function`;
  - `shipde-no-unsafe-raw-sql`: Prisma `$queryRawUnsafe` and `$executeRawUnsafe`;
  - `shipde-no-dangerous-html`: `dangerouslySetInnerHTML`;
  - `shipde-no-secret-in-log`: password, secret, token, OTP or API key arguments to console or logger calls.

  No registry rulesets are fetched, so results do not change without review. `--metrics=off` is set.
- **Trigger:** `pnpm security:semgrep`; CI job `code-scan` in `security-baseline.yml`.
- **Rule tests:** `semgrep --test tools/semgrep/rules` passes 4/4. Each rule has positive (`ruleid:`) and negative (`ok:`) fixtures in `shipde.ts` and `shipde.tsx`.
- **Real run:**
  - The scan of the current `apps` and `packages` exits 0 with no findings.
  - Negative proof: a planted `console.log("pw", password)` in `apps/api/src` makes the scan exit 1. The probe file was removed afterwards.
- **Validator:** `scripts/ai/ecosystem.ps1` no longer requires exactly 10 candidates. It now rejects a candidate whose id is also adopted. `validate` passes.
