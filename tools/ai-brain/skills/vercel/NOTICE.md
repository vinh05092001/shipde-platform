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

- `react-best-practices/SKILL.md` sha256:`71ed7794962fa6e803ee83030517b5b93a9f70fbfeb431ec4535c5480a8d8355`
- `web-interface-guidelines/command.md` sha256:`d246b026f4f29b5823a9cc857f9edf3d2507002e055e32040cadeaf3b38e0234`
- `web-interface-guidelines/LICENSE` sha256:`6cd1609c9c12233507cdd2ce0d32e9a721e3c27494951be06b90090deeeb7af2`
