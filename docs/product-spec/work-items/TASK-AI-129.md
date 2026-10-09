# TASK-AI-129 — The Controller uses the tool manifest when it prompts and gates workers

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-129` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `242` |
| Dependencies | `TASK-AI-109`, `TASK-AI-123` |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/data/tool-manifest.json`; `tools/ai-brain/tool-manifest.js`; `tools/ai-brain/prompt-compiler.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/decisions.js`; `tools/ai-brain/test/task-ai-129.test.js`; `docs/product-spec/work-items/TASK-AI-129.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-129-tool-manifest-wiring` |
| Pull Request | `Pending` |

## Business Outcome

Root cause: TASK-AI-109 shipped `tools/ai-brain/data/tool-manifest.json` and
`tools/ai-brain/tool-manifest.js`, but nothing read them. The only caller was
the manifest's own test, so worker prompts never listed the tools relevant to
the item, no gate tool ran before review, and the gate tools `gitleaks` and
`agent-scan` sat at `command: null`.

TM-R01: `prompt-compiler` now includes a short "Tools for this item" section
in the author, repair and reviewer prompts, built from
`toolsFor({role, files, riskDomains})` over the item's allowed/changed files
and spec risk domains. Each line gives the tool id, its purpose and its
command (only when a command is known); at most 8 tools; tools that do not
match the item are never listed. A missing or unreadable manifest leaves the
prompt unchanged and records a `TOOL_MANIFEST_UNAVAILABLE` warning — it never
crashes.

TM-R02: `gitleaks`, the one gate tool installed on this host, reuses the
repo's existing secret scan — the `security:secrets` package.json script —
instead of inventing a command. `agent-scan` stays `command: null` with a
note.

TM-R03: before review, orchestrate runs every `gatesFor()` tool that has a
command and applies to the changed files (or to the item's risk domains), the
same way as the format gate (TASK-AI-123): host-side against the reviewed
SHA. A failure goes to exactly one repair round carrying the tool output,
then the item is refused if the gate still fails. A gate tool with no command,
or one that is not installed or cannot run, records `TOOL_GATE_UNAVAILABLE`,
does not block, and is never counted as a pass.

TM-R04: the decision log records which tools the prompt offered
(`prompt_tools`) and which gates ran with their results (`tool_gate`, tool id
and pass/fail only) — never raw tool output; the scrubbed output travels only
in the repair finding.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| TM-R01 | Author, repair and reviewer prompts are compiled | "Tools for this item" section from `toolsFor({role, files, riskDomains})`: id + purpose + command only when known; at most 8 tools; non-matching tools never listed; a missing/unreadable manifest leaves the prompt unchanged and records a warning | Prompt tests in `tools/ai-brain/test/task-ai-129.test.js` |
| TM-R02 | The gitleaks manifest entry | `command: "security:secrets"` reusing the package.json script; `agent-scan` stays `command: null` with a note | Manifest assertions in the reviewer test |
| TM-R03 | After a worker commit, before review | Every `gatesFor()` tool with a command that applies to the changed files runs host-side against the reviewed SHA; a failure gets one repair round with the tool output, then refusal; a gate with no command/not installed records `TOOL_GATE_UNAVAILABLE`, never blocks, never counts as a pass | Gate tests in `tools/ai-brain/test/task-ai-129.test.js` |
| TM-R04 | Decision log | `prompt_tools` entries name the offered tool ids; `tool_gate` entries carry tool id and verdict only, never raw output | Decision-log assertions in the gate tests |
| TM-R05 | Test suite | Six proofs, each failing on origin/main: UI vs pure backend lines, reviewer security tools, missing-manifest warning + unchanged prompt, failing gate → repair → refusal, `TOOL_GATE_UNAVAILABLE` is not a pass, decision entries written | `node --test tools/ai-brain/test/task-ai-129.test.js` |
| TM-R06 | Handoff metadata | Work Item plus exactly one register row `"242"`, `READY_FOR_CODEX`, branch `feat/task-ai-129-tool-manifest-wiring`; register numstat `1 0` | Work Item and register diff |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-129.test.js tools/ai-brain/test/task-ai-109-tools.test.js tools/ai-brain/test/task-ai-123.test.js tools/ai-brain/test/task-ai-127.test.js tools/ai-brain/test/prompt-compiler.test.js tools/ai-brain/test/candidates.test.js` (with `NINEROUTER_API_KEY` removed; `prompt-compiler.test.js` does not exist and is skipped)
- `./node_modules/.bin/prettier --check` on every changed file (fixed with `--write` where needed)
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before (tests against the pre-fix sources, `git stash push` of the five
  source files restoring their `d82ea157` versions):
  `node --test tools/ai-brain/test/task-ai-129.test.js` → `tests 6, pass 0,
  fail 6` — every test fails: no "Tools for this item" section exists to carry
  the playwright/axe or gitleaks lines, the missing manifest produces no
  `TOOL_MANIFEST_UNAVAILABLE` warning, no tool gate runs (the failing gate
  neither repairs nor refuses and the run completes and reviews instead), no
  `TOOL_GATE_UNAVAILABLE` is recorded, and the decision log has neither
  `prompt_tools` nor `tool_gate` entries. On `origin/main`
  (`fee07f2c`) `tools/ai-brain/test/task-ai-129.test.js` is absent entirely,
  so the suite fails there too.
- Pass-after (this revision): `node --test tools/ai-brain/test/task-ai-129.test.js tools/ai-brain/test/task-ai-109-tools.test.js tools/ai-brain/test/task-ai-123.test.js tools/ai-brain/test/task-ai-127.test.js tools/ai-brain/test/candidates.test.js`
  with `NINEROUTER_API_KEY` removed → `tests 91, pass 91, fail 0`.
  `prettier --check` on the changed files and `git diff --check` are clean.

## Residual Limitations

- A manifest `command` is a package.json script name and the gate runner
  executes it as `pnpm run <command>` in the worker root. Missing-toolchain
  output (`command not found`, `Cannot find module`, ENOENT) is recorded as
  `TOOL_GATE_UNAVAILABLE`, but a script that exits non-zero for an operational
  reason — e.g. `security:secrets` exits 2 without a gitleaks binary — is
  judged a FAILED gate and can refuse the item after its one repair round.
- Gate applicability is file-pattern triggers or the item's declared risk
  domains. A change whose spec declares no matching risk domain and touches no
  file-pattern trigger runs no tool gate at all; a secret in such a change is
  caught by CI's Gitleaks gate, not by this pre-review gate.
- `agent-scan` has no command on this host, so whenever it applies it records
  `TOOL_GATE_UNAVAILABLE` and can never contribute a pass until a command and
  install evidence exist.
- The post-repair re-run executes the same command again; it does not
  re-evaluate gate applicability if the repair touched different files.
- The prompt tool list is capped at 8 in manifest order, so a matching tool
  beyond the cap is not surfaced in the prompt (it can still run as a gate).
- Tool output in the repair finding is scrubbed with the decision-log secret
  patterns (`sk-…`, `gh*_…`, `Bearer …`, `Basic …`); a secret outside those
  shapes can reach the repair prompt, which is deliberate — the repair worker
  needs the offending output to fix the finding.
