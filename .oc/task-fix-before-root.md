ROLE: You are the AUTHOR for this Work Item under AGENTS.md. You do not review or declare PASS; Codex reviews independently. Never merge.
SCOPE (strict):

- Fix ONLY the P0/P1 findings listed in .oc/review.txt, at the file:line each one names. Do not refactor, rename, reformat or "improve" anything else.
- Touch only the files the findings name, plus the test file that proves each fix. Do not read the whole repo: read those files and their direct imports.
- Each fix: first a test that fails without it, then the minimal fix, then run ONLY that test file (plus pnpm lint/typecheck if app code changed).
- If a finding needs a product decision the specs do not make: write NEEDS_DECISION under Known limitations; do not invent.
- If .oc/context-pack.md exists, use it as your context instead of exploring.
- Before every commit run `pnpm security:secrets`; test fixtures must use obviously fake values (e.g. `test-not-a-key`), never key-shaped strings. Register row: delivery_order is assigned by the coordinator (see your row); never change it, and when merging main keep both rows.
- TOKEN SAVING (keep meaning): if MCP tools jcodemunch/serena are available, look up functions/symbols/references with them instead of reading whole files (measured ~4-20x fewer tokens). Pipe long passing command output through `rtk` (e.g. `rtk pnpm lint`); for a FAILING test or evidence log use raw output, never compressed.

---

# TASK-AI-169 — make run-ledger compatible with the merged work-guard (#503, main 8976cf8)

CI ai-brain-tests: 7 tests in tools/ai-brain/test/run-ledger.test.js fail with `LEDGER_CORRUPT` thrown by validateLedger (work-guard.js:549/560) on the NEXT load after RunLedger.record writes (run-ledger.js:142).

1. WHERE: tools/ai-brain/run-ledger.js ~145-200 (RunLedger.record: `it.spent = {attempts,ms,tokens}`, `s.goals[goalId] = {attempts,ms,tokens}`, `acc.tokensUnknown` only sometimes).
   WRONG: the shared ledger file is validated by work-guard.js validSpent (line 476): every spent object (items[*].spent and goal) must carry ALL of attempts, ms, tokens, tokensUnknown, unknownTokens as non-negative integers, and s.goal totals must equal the sum over items (work-guard.js ~585-597). run-ledger writes partial objects and its own totals, so the next ProgressLedger.load refuses the file.
   GOAL: one ledger, one schema (AC of TASK-AI-169 "one budget ledger"). run-ledger must write records in work-guard's schema: initialise every spent with all five counters; keep s.goal equal to the sum of items (recompute after each write, do not increment separately); keep any per-goalId breakdown under a key the validator ignores OR derive it on read. Prefer calling ProgressLedger methods (record/reserve) over hand-writing JSON. Do NOT edit work-guard.js (PASSed and merged).
   VERIFY: node --test tools/ai-brain/test/run-ledger.test.js and node --test tools/ai-brain/test/work-guard.test.js both 0 fail; add test `run-ledger output loads through ProgressLedger.load without LEDGER_CORRUPT`.
   Then: pnpm test:brain, pnpm format:check, pnpm security:secrets. Commit `[TASK-AI-169] ...`.
