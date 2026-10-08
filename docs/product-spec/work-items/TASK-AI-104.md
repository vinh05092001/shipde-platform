# TASK-AI-104 — Publishing refuses mismatched approvals, unregistered work and worker roots

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-104` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `218` |
| Dependencies | `TASK-AI-102`; `TASK-AI-103` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/publisher.js`; `tools/ai-brain/test/task-ai-104.test.js`; `docs/product-spec/work-items/TASK-AI-104.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-104-publish-gates` |
| Pull Request | `Pending` |

## Business Outcome

The operator-side publisher authorizes publication only when human approval names the reviewer recorded in the validated review manifest, the manifest binds the exact published commit, and the reviewed commit's delivery register contains the Work Item. Worker-root calls remain refused, and reviewer failure-domain checks share the routing implementation rather than maintaining a divergent copy.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| PG-R01 | Approval record reviewer differs from `manifest.reviewerCandidateKey` | Refuse with `PUBLISH_REFUSED: APPROVAL_REVIEWER_MISMATCH` before any push | `node --test tools/ai-brain/test/task-ai-104.test.js` |
| PG-R02 | Manifest reviewed commit differs from published SHA | Refuse with one clean message `PUBLISH_REFUSED: SHA_MISMATCH (MANIFEST_SHA_MISMATCH)` (single prefix; see Residual Limitations) | Temp-repository SHA mismatch assertion |
| PG-R03 | Work Item missing from the register in the reviewed commit; row present in reviewed commit but removed from the mutable checkout | Missing row refuses with `PUBLISH_REFUSED: WORK_ITEM_NOT_REGISTERED`; reviewed-commit row allows the explicit simulated publish | Temp git repository assertions; implementation reads via `git show <sha>:<path>` |
| PG-R04 | Publisher cwd is inside the worker root | Refuse before publication | Worker-root assertion |
| PG-R05 | Publisher failure-domain helper is compared with routing's canonical helper | The publisher imports the canonical function and preserves existing domain results | Function identity and domain assertions |
| PG-R06 | New regression suite runs | PG-R01 through PG-R05 are covered with node:test and local temp repositories; no network or GitHub calls | `node --test tools/ai-brain/test/task-ai-104.test.js` |
| PG-R07 | Handoff metadata is published | Work Item and delivery register identify row `218`, `READY_FOR_CODEX`, and branch `feat/task-ai-104-publish-gates` | Work Item and register diff |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-104.test.js`
- `node --test "tools/ai-brain/test/*.test.js"`
- `./node_modules/.bin/prettier --write tools/ai-brain/publisher.js tools/ai-brain/test/task-ai-104.test.js docs/product-spec/work-items/TASK-AI-104.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Residual Limitations

- `testMode` remains an explicit no-publish simulation, and its two legacy seams are named rather than implicit. Reviewer identity: `tools/ai-brain/test/task-ai-77.test.js` (M-R06) publishes with a historical flat `APPROVED` registry that carries no reviewer field, so only that flat form tolerates a missing reviewer in simulation — structured approval records with missing reviewer identity are refused in every mode. Registration: fixtures that carry no delivery register at the reviewed commit (`tools/ai-brain/test/task-ai-64.test.js`, `task-ai-77.test.js`, `isolation.test.js`) keep the simulated no-register seam — a repository that does carry the register is held to its rows in every mode, and live publication always requires the reviewed-commit row before cloning or pushing.
- The `MANIFEST_SHA_MISMATCH` refusal is rendered as one clean message, `PUBLISH_REFUSED: SHA_MISMATCH (MANIFEST_SHA_MISMATCH): …`, with a single `PUBLISH_REFUSED:` prefix. The legacy `SHA_MISMATCH` token leads so the untouched `tools/ai-brain/test/task-ai-77.test.js:459,468` regexes keep matching; the manifest gate code rides beside it.
- Publisher failure-domain results for wildcard upstreams and wildcard or empty gateways now resolve through routing's canonical function instead of the removed publisher-local copy. For example, `gateway-a::*` resolves to `gateway-a/*`, and `*::ocz` / `::ocz` resolve to the canonical gateway/upstream domain (currently `9router/ocz`) instead of the removed publisher-local `gateway-a` / `ocz` forms. Those cases are pinned in `tools/ai-brain/test/task-ai-104.test.js` (PG-R05).
