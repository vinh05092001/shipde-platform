# TASK-AI-89 — Live capability lookup uses the official account registry

## Control

- Work Item ID: TASK-AI-89
- Status: READY_FOR_CODEX
- Assigned author: BOOTSTRAP_SELECTION agy-pool agy07 (google)
- Dependencies: TASK-AI-87

## Business Outcome

Live proof 10 still refused evidence-backed candidates because capability lookup only saw the --accounts input file; live runs now also consult the official account registry, while hermetic tests stay isolated.

## Acceptance Matrix

- G-R01 the live orchestrate CLI and dispatch pass, for evidence-candidate capability lookup, the union of the --accounts input and accounts.listAccounts() (registry entries win on capabilities only when the input entry declares none), deduplicated by account id.
- G-R02 hermetic runOrchestration calls that inject candidates and no registry still see no host registry (existing tests unchanged).
- G-R03 test: with an injected registry declaring xkiro capabilities and an --accounts input without xkiro, an evidence-only xkiro WORK_ITEM_PASS candidate passes the capability floor and is ranked; with the registry empty it is refused CAPABILITY_MISSING:jsonSchema.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-89.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

None recorded by the author; see review.
