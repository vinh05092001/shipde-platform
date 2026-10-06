# NOTICE — vendored Impeccable skills (TASK-AI-109 lane D)

Source repository: `pbakaus/impeccable` (Apache-2.0 License).
Pinned upstream commit: `4e8504f10106a1cd7a99e37a401aa368d1d55576`.
Upstream license: `Apache-2.0` (vendored verbatim as `LICENSE` in this directory).
Vendored on: `2026-10-06`.

The skill files below are vendored verbatim from the pinned commit and must
stay byte-identical. They are consumed only through the ShipDe lock in
`tools/ai-brain/skill-pack.js`, which always prepends `UI_AUTHORITY_HEADER`
(the approved screen specification, `DESIGN.md` when approved, and
`docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` are the authority;
Impeccable only helps implement them) and `LOCK_HEADER`, and replaces
Controller-owned lines (model choice, publication, workspace lifetime, repair
rounds) with a removal marker. The Work Item and the ShipDe specs override any
skill text on conflict.

## Vendored files (sha256 of the exact upstream bytes)

- `LICENSE` sha256:`02bb8c3b4e70190e3986c0404ad2fd8d639b4f534252d82379cc1b502b6d1812`
- `.agent/skills/impeccable/SKILL.md` sha256:`04a36abd431f18e133897f7d84ba5736f735d5aed573cb27b218f42e0abfe333`
- `.agent/skills/impeccable/reference/audit.md` sha256:`d9963fd73bf6129fe0c8ec25c5148f50617ec85683b8eeae7e411c9a42e2db33`
- `.agent/skills/impeccable/reference/critique.md` sha256:`9eb03b319ce7a2b281bc85ed1b0a437eb05ab2f765fc267354f9f9e6cbfadc25`
- `.agent/skills/impeccable/reference/craft.md` sha256:`9205e222bc6565b37fb504ceec93233c2d2a456802b69d16e6b1c44723907c4c`
- `.agent/skills/impeccable/reference/craft-floor.md` sha256:`96e2e6bd4fcf9a2c6da65fb029f96d9176308fae2efd9d8653d3b8d838960e07`
- `.agent/skills/impeccable/reference/component-review.md` sha256:`acb4250c33edccb84bd47ab06c3d9ecceb35d063cd3cf839b63f2124b75dd99e`
- `.agent/skills/impeccable/reference/clarify.md` sha256:`6c382f8283756e8a693d832b750f7e4cbff1ca5bdcc3825b2b4ef4da9f21876a`

## Deliberately NOT vendored

The upstream launcher scripts under `.agent/skills/impeccable/scripts/` and
the extra `reference/*.md` command pages are excluded: only the role texts
listed above are part of this prompt pack, and any tool execution belongs to
the Work Item (lines invoking `npx impeccable` or a live browser stay in the
pack but are tagged as install-and-Work-Item-gated by the ShipDe lock).
