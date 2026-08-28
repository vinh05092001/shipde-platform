# CI/CD and Deployment

## Environments

- Local: deterministic mock carriers and seeded data.
- Test: ephemeral database per CI suite where practical.
- Staging: production-like infrastructure, sandbox carrier accounts and anonymized fixtures.
- Production: real credentials, mocks disabled, restricted admin access.

## Pull-request pipeline

1. Install with lockfile.
2. Format/lint.
3. Typecheck.
4. Unit/property tests.
5. JSON Schema/OpenAPI/document validation.
6. Database migration on clean and previous-version fixture.
7. API integration tests.
8. Build web/api/worker.
9. E2E smoke using mock carriers.
10. Secret/dependency/security scan.

## Deployment

1. Verify artifact/image provenance.
2. Back up or verify recovery point.
3. Run forward-compatible migration.
4. Deploy backend/workers, then frontend as compatible.
5. Run health/readiness and smoke.
6. Verify queue/webhook/provider health.
7. Monitor error/latency/unknown command metrics.

## Rollback

- Prefer application rollback with backward-compatible schema.
- Destructive migrations require expand-migrate-contract across releases.
- Feature flags disable new external actions independently.
- Unknown commands are reconciled before any replay.
- Rollback does not delete audit/evidence records.

## Production readiness

- UAT and security sign-off.
- Carrier partner/sandbox evidence.
- No production mock adapter.
- Restore drill.
- Alert routing and on-call owner.
- Runbooks reviewed.
- Data retention and support access configured.
