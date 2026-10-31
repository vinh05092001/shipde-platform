# apps/web — Author checklist

Mandatory before a Next.js UI change is reviewable. Root `AGENTS.md` still wins on conflict.

## Review P1 gates

- Every changed screen covers loading, empty, error, forbidden and success. Validation, partial and recovery states too when the screen spec requires them.
- Forbidden is a dedicated state, not a blank page and not a generic error.
- No fake primary action, placeholder presented as live data, or success toast without a committed outcome.
- Data comes from the API. Do not hardcode model, score, provider or tenant data.

## Next.js (condensed)

Source: PatrickJS/awesome-cursorrules `rules/nextjs-app-router-cursorrules-prompt-file.mdc` (CC0-1.0). Condensed, not copied.

- Server Components by default. Add `'use client'` only for state, events or browser APIs.
- Use the App Router file conventions: `layout.tsx` for shared chrome, `loading.tsx` for loading, `error.tsx` for errors, `page.tsx` for the route.
- TypeScript for every new file. Configuration from environment variables, never inlined secrets.
- `next/image` for images. Route handlers stay thin and call the API; they do not own tenant rules.
