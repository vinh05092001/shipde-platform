# TASK-AI-151 — Context compression evaluation for worker inputs (Headroom and LLMLingua-2)

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-151` |
| Feature ID | `N/A — offline evaluation tooling for worker context compression` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `268` |
| Dependencies | `TASK-AI-146` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/eval/compression-eval.js`; `tools/ai-brain/test/task-ai-151-compression-eval.test.js`; `tools/ai-brain/test/fixtures/compression-eval/*`; `docs/product-spec/work-items/TASK-AI-151.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-151-context-compression-eval` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Provide measured empirical data on worker context token consumption across four categories (spec docs, CI logs, JSON payloads, and code diffs) and evaluate context compression candidates (Headroom reversible CCR proxy and LLMLingua-2 prompt compressor) against lossless criteria. The evaluation tool truthfully reports `NOT_INSTALLED` when optional dependencies are absent (never faking numbers) and enforces a strict safety guard prohibiting compression on review and diagnosis paths per AGENTS.md, supporting an evidence-backed decision for AI-TOOLCHAIN-DECISIONS.md "Headroom semantic compression: DEFER".

## Source references

- `AGENTS.md` (Code review rules, No production hardcode, 9Router request policy)
- `docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` (Headroom semantic compression: DEFER)
- Business rules: `BR-COMP-01`, `BR-COMP-02`, `BR-COMP-03`, `BR-COMP-04`, `BR-COMP-05`
- Acceptance criteria: `AC-AI-151-01`, `AC-AI-151-02`, `AC-AI-151-03`, `AC-AI-151-04`, `AC-AI-151-05`, `AC-AI-151-06`, `AC-AI-151-07`

## Preconditions and dependencies

- Node.js >=20 and pnpm >=9 available.
- Worktree `p-ai-151` on branch `feat/task-ai-151-context-compression-eval` branched from `origin/main`.
- Recorded worker inputs available under `.worktrees/logs/night`.

## Author boundary

GEMINI is assigned as author for implementing the offline evaluation tool, token estimators, category detection, lossless verification, review/diagnosis safety guard, and test suite. The author is prohibited from modifying gate configurations (.gitleaks*, allowlists, baselines, validators), enabling compression on review/diagnosis paths, or fabricating compression metrics when dependencies are not installed.

## In scope

- Implement `tools/ai-brain/eval/compression-eval.js` supporting both CLI invocation and programmatic usage.
- Fast, bounded scanning of recorded worker inputs from `.worktrees/logs/night` (job-*.txt prompts, ci-*.txt logs, quota JSON, code diffs, spec docs).
- Categorization into four core groups: `spec docs`, `CI logs`, `JSON`, and `code diffs`.
- Deterministic token estimation based on LLM heuristic (~4 characters per token).
- Lossless verification engines:
  - Code diffs: 100% of diff hunk headers (`@@ ... @@`) and 100% of changed lines (`+` and `-`) must be present in compressed output.
  - JSON: compressed text must parse as valid JSON and retain all object keys.
  - Spec docs: markdown headings (`#`, `##`) must be preserved.
  - CI logs: error/failure markers must be preserved.
- Safety guard `isCompressionForbidden` ensuring compression is strictly rejected on review and diagnosis roles, tasks, and paths.
- Probing for Headroom and LLMLingua-2: reports `NOT_INSTALLED` when absent, without throwing or fabricating metrics.
- Comprehensive unit tests in `tools/ai-brain/test/task-ai-151-compression-eval.test.js` with small fixtures.
- Measurement summary and data-backed toolchain recommendation.

## Out of scope

- Production proxy deployment or background daemon process execution.
- Enabling compression on review, diagnosis, or triage workflows.
- Altering security allowlists, baselines, or gate validators.

## Business rules and edge cases

- `BR-COMP-01`: Truthful reporting — when optional compression engines (Headroom, LLMLingua-2) are absent in the local environment, the system must report `NOT_INSTALLED` and null compressed tokens. Fabricating or synthesizing numbers is strictly prohibited.
- `BR-COMP-02`: Review and diagnosis protection — compression is strictly forbidden on any review, diagnosis, or triage path (role: review, taskType: diagnosis, path contains review/diag).
- `BR-COMP-03`: Lossless diff verification — a code diff compression is valid only if 100% of diff hunk headers (`@@ ... @@`) and 100% of added/removed lines (`+` and `-`) are present in the output.
- `BR-COMP-04`: Lossless JSON verification — a JSON compression is valid only if the output parses as valid JSON and retains all object keys.
- `BR-COMP-05`: Offline execution — all evaluation logic must run completely offline without remote network calls.

## UI states

N/A — internal evaluation tool and CLI; no UI components modified.

## API, event and data impact

- Exposes programmatic functions: `runCompressionEval`, `detectCategory`, `losslessCheckDiff`, `losslessCheckJson`, `losslessCheckSpecDoc`, `losslessCheckCiLogs`, `verifyLossless`, `isCompressionForbidden`, `countTokens`, `probeHeadroom`, `probeLlmLingua`, `scanInputFiles`, `formatReportMarkdown`.
- Zero database tables, migrations, or persistent schemas modified.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-151-01 | Estimate tokens | Deterministic token counting returns ~4 chars/token, 0 on empty | Automated test in `task-ai-151-compression-eval.test.js` |
| AC-AI-151-02 | Detect category | Correctly classifies diffs, JSON, CI logs, and spec docs | Automated test in `task-ai-151-compression-eval.test.js` |
| AC-AI-151-03 | Lossless diff check | Passes when hunk headers and changed lines intact; fails when dropped | Automated test in `task-ai-151-compression-eval.test.js` |
| AC-AI-151-04 | Lossless JSON check | Passes on valid JSON with keys intact; fails on parse error or missing keys | Automated test in `task-ai-151-compression-eval.test.js` |
| AC-AI-151-05 | Review guard | Returns true (forbidden) for review and diagnosis roles/paths | Automated test in `task-ai-151-compression-eval.test.js` |
| AC-AI-151-06 | Probe engines | Truthfully returns `NOT_INSTALLED` when Headroom or LLMLingua absent | Automated test in `task-ai-151-compression-eval.test.js` |
| AC-AI-151-07 | End-to-end eval | Runs evaluation on fixtures and night logs with full breakdown | CLI execution and automated test |

## Measured Results Summary (Recorded Worker Inputs)

Evaluated across recorded worker inputs in `.worktrees/logs/night`:

| Category | Files | Original Baseline Tokens | Headroom Status | LLMLingua-2 Status | Lossless Check |
|---|---|---|---|---|---|
| spec docs | 360 | 497,038 | NOT_INSTALLED | NOT_INSTALLED | NOT_INSTALLED |
| CI logs | 1,380 | 39,588,851 | NOT_INSTALLED | NOT_INSTALLED | NOT_INSTALLED |
| JSON | 236 | 1,710,537 | NOT_INSTALLED | NOT_INSTALLED | NOT_INSTALLED |
| code diffs | 103 | 2,636,181 | NOT_INSTALLED | NOT_INSTALLED | NOT_INSTALLED |
| **Total** | **2,079** | **44,432,607** | **NOT_INSTALLED** | **NOT_INSTALLED** | **NOT_INSTALLED** |

### Tool Installation Commands

#### Headroom (CCR Compression Proxy)
```bash
# Repository: https://github.com/chopratejas/headroom
npm install -g headroom
headroom proxy --port 8787
```

#### LLMLingua-2 (Microsoft Research Prompt Compressor)
```bash
# Repository: https://github.com/microsoft/LLMLingua
# Requires Python >= 3.9
pip install llmlingua
```

### Evaluation Run Command
```bash
# Run against recorded night logs:
node tools/ai-brain/eval/compression-eval.js --inputs-dir .worktrees/logs/night

# Run against offline test fixtures:
node tools/ai-brain/eval/compression-eval.js --fixtures
```

### Recommendation
Neither Headroom nor LLMLingua-2 is installed in the local environment. Per AGENTS.md rule 3, fabricating numbers is prohibited. AI-TOOLCHAIN-DECISIONS.md "Headroom semantic compression: DEFER" must **REMAIN DEFERRED** until external dependencies are installed on a dedicated evaluation host and proven lossless on code diffs and JSON payloads. Furthermore, per AGENTS.md, compression must permanently remain disabled on all review and diagnosis paths.

## Verification commands

- `node --test tools/ai-brain/test/task-ai-151-compression-eval.test.js`
- `node scripts/ai/check-no-hardcode.mjs`
- `pnpm exec prettier --check tools/ai-brain/eval/compression-eval.js tools/ai-brain/test/task-ai-151-compression-eval.test.js docs/product-spec/work-items/TASK-AI-151.md`
- `node tools/ai-brain/eval/compression-eval.js --fixtures`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | pending | READY_FOR_CODEX | Initial implementation |

## Residual limitations

None
