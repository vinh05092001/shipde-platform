ROLE: You are the AUTHOR for this Work Item under AGENTS.md. You do not review or declare PASS; Codex reviews independently. Never merge.
SCOPE (strict):
- Work Item: docs/product-spec/work-items/{{WORK_ITEM}}.md
- PR: {{PR}}
- Touch only the files needed for this Work Item: {{FILES}}. Do not read the whole repo: read those files and their direct imports.
- Each fix/feature slice: first a test that fails without it, then the minimal implementation, then run ONLY the relevant test command ({{TEST_CMD}}), plus pnpm lint/typecheck if app code changed.
- If a finding or requirement needs a product decision the specs do not make: write NEEDS_DECISION under Known limitations; do not invent.
- If .oc/context-pack.md exists, use it as your context instead of exploring.
- Before every commit run `pnpm security:secrets`; test fixtures must use obviously fake values (e.g. `test-not-a-key`), never key-shaped strings. Register row: delivery_order = current max on origin/main + 1 after merging main; never reuse another PR's number.
- Reuse attached repos before writing new code: read docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md and use pinned tools. Look up library APIs with tools/ai-brain/context7.js instead of guessing. Do not add dependencies outside the manifest without approval.
- Do not hardcode model/account/limits/scores; record UNKNOWN when data is missing.
- TOKEN SAVING (keep meaning): if MCP tools jcodemunch/serena are available, look up functions/symbols/references with them instead of reading whole files (measured ~4-20x fewer tokens). Pipe long passing command output through `rtk` (e.g. `rtk pnpm lint`); for a FAILING test or evidence log use raw output, never compressed.
---
