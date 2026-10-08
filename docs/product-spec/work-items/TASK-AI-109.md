# TASK-AI-109 — Superpowers skills run as a ShipDe-locked prompt pack

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-109` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `222` |
| Dependencies | None |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/skill-pack.js`; `tools/ai-brain/prompt-compiler.js`; `tools/ai-brain/skills/superpowers/`; `tools/ai-brain/test/task-ai-109.test.js`; `docs/product-spec/work-items/TASK-AI-109.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `.prettierignore` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-109-superpowers-locked-pack` |
| Pull Request | `Pending` |

## Business Outcome

Worker and reviewer prompts stop depending on each model's built-in habits
for planning, TDD, debugging, verification and review conduct. Six
obra/superpowers skills (MIT, pinned commit
`8ca22dba9a94f28898bbce59f2537ff4d87c747d`) are vendored verbatim and reach
prompts only through a ShipDe lock: `LOCK_HEADER` (Controller owns model
choice, publisher owns publication, repair budget is the ShipDe review
budget, existing work is never deleted, the Work Item overrides skill text)
always comes first, and every skill line that instructs model
selection/switching, push/merge/discard or workspace deletion is replaced by
a `[removed by ShipDe lock: ...]` marker. The subagent/push/merge/worktree
skills are excluded entirely — those rules belong to the Controller and the
publisher. `SHIPDE_SKILL_PACK=off` rolls the pack back without a code change.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| SP-R01 | Six skill files plus upstream LICENSE under `tools/ai-brain/skills/superpowers/` keeping upstream sub-paths, plus NOTICE.md (repo, commit, license, date); excluded skills absent | Vendored bytes equal the upstream text at the pinned commit (sha256 values recorded in NOTICE.md); `subagent-driven-development`, `dispatching-parallel-agents`, `finishing-a-development-branch`, `using-git-worktrees`, `brainstorming` absent | `node --test tools/ai-brain/test/task-ai-109.test.js` (SP-R01 suite) |
| SP-R02 | `tools/ai-brain/skill-pack.js`: role map, `skillsFor`, `LOCK_HEADER`, `lockedPack` with an explicit forbidden-pattern list | `author.*` gets writing-plans/TDD/debugging/verification; reviewer and security-review get requesting/receiving review plus verification; output starts with LOCK_HEADER; locked lines become markers | SP-R02 suite in `tools/ai-brain/test/task-ai-109.test.js` |
| SP-R03 | `compilePrompt` and `compileReviewPrompt` append `lockedPack(role)` for the item's role | Author prompts carry the author skill headings, review prompts the reviewer headings; PUBLISHER_BOUNDARY and CLEAN_TREE_RULES stay before the pack; roles without a pack are byte-identical | SP-R03 suite in `tools/ai-brain/test/task-ai-109.test.js` |
| SP-R04 | `SHIPDE_SKILL_PACK=off` | `lockedPack` returns `''` and both compiled prompts carry no pack; default is on | SP-R04 test in `tools/ai-brain/test/task-ai-109.test.js` |
| SP-R05 | Full proof in `tools/ai-brain/test/task-ai-109.test.js` | Vendored sha256 match, locked output starts with LOCK_HEADER with no forbidden body line, expected headings per lane, env-off removal, existing prompt-compiler tests untouched and green | `node --test tools/ai-brain/test/task-ai-109.test.js` plus `node --test "tools/ai-brain/test/*.test.js"` |
| SP-R06 | Handoff metadata | Work Item and delivery register identify row `222`, `READY_FOR_CODEX`, and branch `feat/task-ai-109-superpowers-locked-pack` | Work Item and register diff |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-109.test.js`
- `node --test "tools/ai-brain/test/*.test.js"`
- `./node_modules/.bin/prettier --write tools/ai-brain/skill-pack.js tools/ai-brain/prompt-compiler.js tools/ai-brain/test/task-ai-109.test.js docs/product-spec/work-items/TASK-AI-109.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv .prettierignore`
- `git diff --check`

## Residual Limitations

- The effect on run quality and token usage is not measured yet; a
  before/after benchmark follows. Known prompt cost: `+33,827` characters for
  the author lane, `+13,797` for reviewer/security-review, `+0` for roles
  without a pack.
- The forbidden-pattern list is literal (model-switch phrase, push, merge,
  discard, workspace-deletion phrase, fix-round phrase), so legitimate prose
  such as review "push back" guidance and "emergencies" is replaced by lock
  markers along with real publication instructions; strictness is preferred
  over preserving upstream prose.
- `LOCK_HEADER` itself states the "never push / never merge" prohibitions as
  ShipDe orders; the no-forbidden-line proof therefore applies to the skill
  body after the header, which is the part the lock filters.
