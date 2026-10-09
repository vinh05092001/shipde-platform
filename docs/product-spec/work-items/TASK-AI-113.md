# TASK-AI-113 — Isolated launches pass long prompts through a file

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-113` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `225` |
| Dependencies | `TASK-AI-109` |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/test/task-ai-113.test.js`; `docs/product-spec/work-items/TASK-AI-113.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-113-prompt-file` |
| Pull Request | `Pending` |

## Business Outcome

Live gate 5 (main `b190f94`, 2026-10-06 20:54) failed every isolated
opencode-direct launch with `Program 'opencode.exe' failed to run: The
filename or extension is too long` at `run-target.ps1:15`. TASK-AI-109 added
about 34k characters of locked skill pack to the author prompt, and the
launcher still passed every argument on the Windows command line, which is
capped at ~32,767 characters.

For the opencode-direct adapter the launcher now writes the full prompt (the
last positional argument produced by `harness.js opencodeDirect.launch`) to
`<workerRoot>/.shipde/prompt-<nonce>.md` (UTF-8, no BOM) and replaces that
argument with the short instruction
`Read the file .shipde/prompt-<nonce>.md in the current directory. It is your
complete task; follow it exactly.`. The file lives inside the worker root and
is already covered by the `.shipde/` git exclude. No argument in the launch-args
JSON or the generated `run-target.ps1` exceeds 4,000 characters. Other adapters
are unchanged.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| PF-R01 | opencode-direct launch with a long prompt | Exactly one `prompt-<nonce>.md` is written; the last launch arg is the short read-file instruction; no arg exceeds 4,000 chars | PF-R01 test in `tools/ai-brain/test/task-ai-113.test.js` |
| PF-R02 | 40,000-character prompt | launch-args JSON and generated `run-target.ps1` contain no single arg/line longer than 4,000 characters; the raw prompt is not embedded in the script | PF-R02 test in `tools/ai-brain/test/task-ai-113.test.js` |
| PF-R03 | Prompt file content and ordering | Prompt file is byte-equal to the original prompt, no UTF-8 BOM, written before `run-target.ps1` is spawned | PF-R03 test in `tools/ai-brain/test/task-ai-113.test.js` |
| PF-R04 | Non-opencode-direct adapter | No prompt file is written; the prompt stays an unchanged argument | PF-R04 test in `tools/ai-brain/test/task-ai-113.test.js` |
| PF-R05 | Test style and regressions | Tests use `node:test` with stubbed `spawnSync`, temp worker root and a fake verdict file; existing launcher tests are green | `node --test tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-96.test.js tools/ai-brain/test/task-ai-98.test.js` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-96.test.js tools/ai-brain/test/task-ai-98.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/isolation-launcher.js tools/ai-brain/test/task-ai-113.test.js docs/product-spec/work-items/TASK-AI-113.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before (`b190f94` + new tests): PF-R01, PF-R02 and PF-R03 fail — no
  `prompt-<nonce>.md` is written and the 40,000-character prompt remains on the
  command line.
- Pass-after: all four tests pass; TASK-AI-96 and TASK-AI-98 stay green.

## Residual Limitations

- The fix applies only to the opencode-direct adapter, whose last positional
  argument is the prompt. Other adapters that may eventually carry an oversized
  argument are unchanged by design (PF-R04).
- The 4,000-character bound is asserted for arguments and generated-script
  lines, not for the total command line; the observed failure was a single
  oversized argument, which the file indirection removes.
