# NOTICE — vendored Vercel guidance (GOAL-AUTOCLAW-REPOS-6)

Approved scope (`AI-TOOLCHAIN-DECISIONS.md`): only `react-best-practices` and
`web-design-guidelines`. Ship Dễ UX sources remain authoritative.

| File | Upstream | Pinned commit | License |
| --- | --- | --- | --- |
| `react-best-practices/SKILL.md` | `vercel-labs/agent-skills` `skills/react-best-practices/SKILL.md` | `063bee94c3f4df8453406c830b0a7df0f2860278` | MIT (declared in the file front matter and the upstream README; the upstream repository ships no LICENSE file) |
| `web-interface-guidelines/command.md` | `vercel-labs/web-interface-guidelines` `command.md` | `434b7f91364665f2f733b310ec54809bf8f37937` | MIT (`web-interface-guidelines/LICENSE`, vendored verbatim) |

The upstream `web-design-guidelines` skill only tells the agent to fetch
`command.md` from the `main` branch on every review. An unpinned fetch would
change reviewer behavior without review, so the fetched rules file is
vendored at a pinned commit instead and the fetching wrapper is not.
`react-best-practices/AGENTS.md` (112 KB, the expanded rule bodies) is not
vendored: the SKILL.md quick reference names every rule, and the full text
would dominate the prompt.

These files reach a worker only through `lockedPack(role)` in
`tools/ai-brain/skill-pack.js`, for UI roles, after `UI_AUTHORITY_HEADER` and
`LOCK_HEADER`.

## Vendored files (sha256 of the exact upstream bytes)

- `react-best-practices/SKILL.md` sha256:`3286ace648b4d740317b9c1cb7fbd38600eaacc62a8b57ea5e06fd2992b5582e`
- `web-interface-guidelines/command.md` sha256:`d9d63639b5f6a376243ffda2b930f0cc91505fd0e0b527376b466c3c6a2c9794`
- `web-interface-guidelines/LICENSE` sha256:`13071e827f4b5cfdb252ab27758488ae86dc8fa392fe36a45ea7952e05546519`
