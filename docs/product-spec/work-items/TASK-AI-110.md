# TASK-AI-110 — RTK is an optional output filter for low-risk isolated work

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-110` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `227` |
| Dependencies |  |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/test/task-ai-109-rtk.test.js`; `docs/product-spec/work-items/TASK-AI-110.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-110-rtk-output-filter` |
| Pull Request | `Pending` |

## Business Outcome

RTK is an optional filter for compressing worker output in low-risk, isolated work. It allows long outputs (such as logs, errors, and git diffs) to be routed through an `rtk.exe` binary for work where RTK is explicitly enabled, no high-risk domain is present, and the launch is not an investigation/repair. The launcher disables RTK for repair rounds, any run tagged with risk domains (auth, tenancy, money, carrier, security), or if the binary is missing/unavailable. The host always performs the final check and generates all evidence raw, ensuring that filter disablement is enforced for all investigation and full-log evidence rounds as required by AGENTS.md.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| RTK-R01 | RTK enabled via config, no risk domains or repair — .shipde-bin is prepended to PATH | RTK filter is available, .shipde-bin appears in the script, PATH is set | RTK-R01 test in `tools/ai-brain/test/task-ai-109-rtk.test.js` |
| RTK-R01b | RTK binary is missing — launch continues raw and logs RTK_UNAVAILABLE | RTK filter is disabled and source missing is logged | RTK-R01 test in `tools/ai-brain/test/task-ai-109-rtk.test.js` |
| RTK-R01c | By default, RTK is disabled (no config provided) | Worker launch does not reference .shipde-bin | RTK-R01 test in `tools/ai-brain/test/task-ai-109-rtk.test.js` |
| RTK-R02 | Any riskDomains in the job blocks RTK | .shipde-bin is not in PATH, filter disabled | RTK-R02 test in `tools/ai-brain/test/task-ai-109-rtk.test.js` |
| RTK-R02b | Any repair round (retainWorkerHead set) blocks RTK | .shipde-bin is not in PATH, filter disabled | RTK-R02 test in `tools/ai-brain/test/task-ai-109-rtk.test.js` |
| RTK-R03 | Worker prompt includes hint about RTK being optional for long output; host always produces raw evidence | Prompt contains hint, all verification occurs host-side | RTK-R03 test in `tools/ai-brain/test/task-ai-109-rtk.test.js` |
| RTK-R04 | All fail-before, verification, and git command strings contain no RTK | RTK cannot affect verification or evidence | RTK-R04 test in `tools/ai-brain/test/task-ai-109-rtk.test.js` |
| RTK-R05 | RTK path is detected from config source or SHIPDE_RTK_PATH; launch result records rtk decision with {provided, reason} | Path is correct; result structure reports RTK state and gating reason | RTK-R05 test in `tools/ai-brain/test/task-ai-109-rtk.test.js` |
| RTK-R05b | lowRisk:true flag allows RTK even if riskDomains param omitted | RTK is enabled for trusted, flagged jobs | RTK-R05 test in `tools/ai-brain/test/task-ai-109-rtk.test.js` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-109-rtk.test.js`
- `./node_modules/.bin/prettier --write docs/product-spec/work-items/TASK-AI-110.md`
- `git diff --check`

## Residual Limitations

- RTK is disabled for any job containing a risk domain (auth, tenancy, money, carrier, security) or any repair round, as required by AGENTS.md. If an investigation is launched without correctly specifying risk domains or repair, RTK could in principle be improperly enabled; callers must enforce these tags for absolute safety.
- If RTK binary is missing, jobs run raw.
- Final evidence and verification are always performed by the host, not affected by RTK filter.
- Some launch result fields depend on correct inputs for rtk and lowRisk flags; misconfiguration may lead to filter not being used for eligible jobs.
