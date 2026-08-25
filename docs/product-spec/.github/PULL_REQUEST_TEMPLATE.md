## Work Item

- Work Item ID: <FEAT-ID, TASK-FOUND-ID or TASK-AI-ID>
- Feature ID: <FEAT-ID or N/A>
- Work Item file: <path>
- Assigned implementation author: <GEMINI or 9ROUTER>
- Business outcome: <actor can now do what>

## Source requirements

- Feature/use case/rule IDs: <IDs>
- Screen/API/entity/state IDs: <IDs>
- Source documents: <paths and headings>

## Scope integrity

- [ ] This PR contains exactly one Work Item.
- [ ] No unrelated refactor, cleanup or second feature is included.
- [ ] All dependencies are merged or use an explicitly approved deterministic mock.
- [ ] Changes stay inside the Work Item author boundary and allowed paths.

## Implementation

- UI and user states: <summary or N/A>
- API/application behavior: <summary or N/A>
- Data/migrations: <summary or N/A>
- Permissions/tenancy/audit: <summary>
- External adapters/jobs: <summary or N/A>

## Acceptance evidence

| AC/Test ID | Result | Automated evidence | Visual/manual evidence |
|---|---|---|---|
| <ID> | <PASS/FAIL> | <test/file> | <screenshot/log/N/A> |

## Verification

| Command | Result | Evidence/notes |
|---|---|---|
| <command> | <PASS/FAIL> | <summary> |

- [ ] Clean install completed.
- [ ] Lint/typecheck completed.
- [ ] Relevant unit/integration tests completed.
- [ ] Relevant E2E acceptance path completed.
- [ ] Production build completed.
- [ ] Regression impact checked.

## Safety and recovery

- Tenant isolation: <evidence>
- Authorization: <evidence>
- Idempotency/reconciliation: <evidence or N/A>
- Sensitive data/secrets: <evidence>
- Error, timeout and recovery paths: <evidence>
- Carrier capability/evidence level: <verified state or N/A>

## Documentation and traceability

- [ ] Contracts/schemas are updated or explicitly N/A.
- [ ] Work Item evidence is updated.
- [ ] Traceability is updated.
- [ ] Operational notes/runbook are updated or explicitly N/A.

## Risks and limitations

<Write None or list each limitation, owner and accepted risk. Do not leave blank.>

## Codex review

- Review status: READY_FOR_CODEX
- Reviewed commit: <filled by Codex>
- Verdict: <PASS/CHANGES_REQUIRED/BLOCKED — filled by Codex>

- [ ] The implementation author has stopped after opening/updating this PR and has not started another Work Item.
