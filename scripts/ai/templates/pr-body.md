## Work Item

- Work Item ID: {{WORK_ITEM}}
- Feature ID: {{FEATURE_ID}}
- Work Item file: docs/product-spec/work-items/{{WORK_ITEM}}.md
- Assigned implementation author: {{AUTHOR}}
- Business outcome: {{BUSINESS_OUTCOME}}

## Source requirements

- Feature/use case/rule IDs: {{SOURCE_RULE_IDS}}
- Screen/API/entity/state IDs: {{SOURCE_ENTITY_IDS}}
- Source documents: {{SOURCE_DOCUMENTS}}

## Scope integrity

- [x] This PR contains exactly one Work Item.
- [x] No unrelated refactor, cleanup or second feature is included.
- [x] All dependencies are merged or use an explicitly approved deterministic mock.
- [x] Changes stay inside the Work Item author boundary and allowed paths.

## Implementation

- UI and user states: {{IMPL_UI_STATES}}
- API/application behavior: {{IMPL_API_BEHAVIOR}}
- Data/migrations: {{IMPL_DATA_MIGRATIONS}}
- Permissions/tenancy/audit: {{IMPL_PERMISSIONS}}
- External adapters/jobs: {{IMPL_ADAPTERS}}

## Acceptance evidence

| AC/Test ID | Result | Automated evidence | Visual/manual evidence |
|---|---|---|---|
{{ACCEPTANCE_ROWS}}

## Verification

| Command | Result | Evidence/notes |
|---|---|---|
{{VERIFICATION_ROWS}}

- [x] Clean install completed.
- [x] Lint/typecheck completed.
- [x] Relevant unit/integration tests completed.
- [x] Relevant E2E acceptance path completed.
- [x] Production build completed.
- [x] Regression impact checked.

## Safety and recovery

- Tenant isolation: {{SAFETY_TENANT_ISOLATION}}
- Authorization: {{SAFETY_AUTHORIZATION}}
- Idempotency/reconciliation: {{SAFETY_IDEMPOTENCY}}
- Sensitive data/secrets: {{SAFETY_SECRETS}}
- Error, timeout and recovery paths: {{SAFETY_ERROR_PATHS}}
- Carrier capability/evidence level: {{SAFETY_CARRIER}}

## Documentation and traceability

- [x] Contracts/schemas are updated or explicitly N/A.
- [x] Work Item evidence is updated.
- [x] Traceability is updated.
- [x] Operational notes/runbook are updated or explicitly N/A.

## Risks and limitations

{{RISKS_AND_LIMITATIONS}}

## Codex review

- Review status: READY_FOR_CODEX
- Reviewed commit: {{REVIEWED_COMMIT}}
- Verdict: {{VERDICT}}

- [x] The implementation author has stopped after opening/updating this PR and has not started another Work Item.
