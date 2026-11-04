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

# TASK-AI-158 — root cause: Work Item scope does not list the folded ctx-tools work

1. WHERE: docs/product-spec/work-items/TASK-AI-158.md (Allowed paths / Scope / Acceptance matrix).
   WRONG: reviewers reject tools/ctx-tools/**, tools/ai-brain/toolkit.json, prompt-block.js and the AGENTS.md pointer as "outside allowed paths" (3 rounds). The human operator decided on 2026-11-03 to fold this work into TASK-AI-158 instead of opening a new Work Item ("đừng sinh task nữa").
   GOAL: the Work Item states that decision (cite it as HUMAN-DECISION 2026-11-03 "fold ctx-tools into TASK-AI-158, no new Work Item"), adds those exact paths to Allowed paths, adds acceptance rows AC-AI-158-ctx-01..03 (versioned MCP entries template; attach.py dry-run by default; smoke.py never prints credential values) pointing at tools/ctx-tools/test_smoke.py. Doc-only change; keep everything else.
   VERIFY: python docs/product-spec/scripts/validate_docs.py passes.
2. WHERE: tools/ctx-tools/smoke.py:36 sanitize_secret_payload.
   WRONG: key regex uses \b before `token`, so `access_token`, `refresh_token`, `client_secret`, `api_key` in JSON-RPC error data are printed.
   GOAL: match sensitive key names case-insensitively on `_`/`-` separated parts (token, secret, key, password, authorization, cookie, credential) and redact recursively in nested dicts/lists before any print.
   VERIFY: test in tools/ctx-tools/test_smoke.py: error data {"access_token":"smoke-test-value","nested":{"client_secret":"x"}} → output contains neither value.
   Run: python -m pytest tools/ctx-tools -q (or python tools/ctx-tools/test_smoke.py), pnpm format:check, pnpm run security:secrets.
