# NOTICE — vendored Superpowers skills (TASK-AI-109)

Source repository: `obra/superpowers` (MIT License).
Pinned upstream commit: `8ca22dba9a94f28898bbce59f2537ff4d87c747d`.
Upstream license: `MIT` (vendored verbatim as `LICENSE` in this directory).
Vendored on: `2026-10-06`.

The skill files below are vendored verbatim from the pinned commit and must
stay byte-identical. They are consumed only through the ShipDe lock in
`tools/ai-brain/skill-pack.js`, which always prepends `LOCK_HEADER` and
replaces Controller-owned lines (model choice, publication, workspace
lifetime, repair rounds) with a removal marker. The Work Item and the ShipDe
specs override any skill text on conflict.

## Vendored files (sha256 of the exact upstream bytes)

- `LICENSE` sha256:`a37e0e9697144819e1d965176ac4ae5bc3fa02d11e7812036bbcadf6dafe2400`
- `skills/writing-plans/SKILL.md` sha256:`a6c67c1900064347c2a329990dd3c555657c51c3ec53b259a08aa01a2c26139a`
- `skills/test-driven-development/SKILL.md` sha256:`64b03fce4aee5a97a93160cea8111f3ba13a17b7c001db4bd5836d67fd10705d`
- `skills/systematic-debugging/SKILL.md` sha256:`808fc5717aa88ad65efff312b11c186294d3e6ee301afb584e2f86599b137787`
- `skills/verification-before-completion/SKILL.md` sha256:`2befe7fc55bcadaa3d97dd9e8efeb633d2561c0ebe74c5a8b17c4d9e7e4520b3`
- `skills/requesting-code-review/SKILL.md` sha256:`cfcee1b06774e7c0517f1e09be1a11f2d5680257072723e709ddbcf7e08b795a`
- `skills/receiving-code-review/SKILL.md` sha256:`091df1629510af1b92fc4abd6f96732ebedb4cb2c0f3457e8f2740b0504a2438`

## Deliberately NOT vendored

The upstream skills `subagent-driven-development`,
`dispatching-parallel-agents`, `finishing-a-development-branch`,
`using-git-worktrees` and `brainstorming` hold model selection, fix-round,
push/merge/discard and workspace-deletion rules that belong to the ShipDe
Controller and publisher, so they are excluded from this prompt pack.
