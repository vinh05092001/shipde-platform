# TASK-AI-103 — Canonical failure-domain blocking

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-103` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `216` |
| Dependencies | `None` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/cli.js`; `tools/ai-brain/routing.js`; `tools/ai-brain/test/task-ai-103.test.js`; `docs/product-spec/work-items/TASK-AI-103.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-103-canonical-failure-domain` |
| Pull Request | `Pending` |

## Business Outcome

Failure avoidance uses one canonical routing rule across the controller's blocking path, so a failure blocks only candidates sharing the classified gateway, gateway+upstream, concrete account, or route+model domain. Repeated application preserves existing block metadata and does not spread blocking to another domain.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| FD-R01 | Compare implementation dependencies and canonical routing helpers | `cli.js` delegates its domain rule to `routing.js`; no additional registry, ranking, checkpoint, or quota store is added. `publisher.js` remains unchanged for TASK-AI-104. | `node --test tools/ai-brain/test/task-ai-103.test.js`; source diff |
| FD-R02 | Apply gateway, upstream, account, model/candidate, and launch-config harness scopes | Gateway matches gateway; upstream matches gateway+upstream; account matches the same non-wildcard account; model/candidate matches route+model; launch-config harness matches nothing. | Scope assertions in `task-ai-103.test.js` |
| FD-R03 | Apply an identical failure twice and inspect a different domain | Existing block reason/scope remain unchanged; different domain stays unblocked. | Repeated-call assertion in `task-ai-103.test.js` |
| FD-R04 | Compare CLI decisions with canonical routing decisions for every covered scope | All decisions agree, including negative cases. | `node --test tools/ai-brain/test/task-ai-103.test.js` |
| FD-R05 | Publish handoff metadata | This Work Item and one register row identify `READY_FOR_CODEX` and the required branch. | Work Item and register diff |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-103.test.js`
- `node --test "tools/ai-brain/test/*.test.js"`
- `./node_modules/.bin/prettier --write tools/ai-brain/cli.js tools/ai-brain/test/task-ai-103.test.js docs/product-spec/work-items/TASK-AI-103.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Residual Limitations

- `publisher.js` retains its separate `failureDomainFromCandidateKey` implementation pending TASK-AI-104.
