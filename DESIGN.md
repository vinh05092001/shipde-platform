# Ship Dễ — `DESIGN.md`

> **Authority:** Subordinate to `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` and screen specifications under `docs/product-spec/docs/`. Locks the visual and interaction contract so B2B logistics operational UI stays task-first and free of generic AI-slop patterns.

## 1. Brand identity & core tokens (`apps/web/src/app/globals.css`)

- **Theme:** High-density B2B logistics operations — **Energy Orange + Warm Neutral Canvas + Ink Navy**, optimized for fast scanning and keyboard-first workflows.
- **Single brand accent:** `--primary: #c23807` (`hover: #a8300a`, `subtle: #fff5f0`, `border: #fdddd0`). Reserve for primary CTA, focus ring, and active state.
- **Warm neutral surfaces & hairlines:** `--bg-app: #fdfcfb`, `--bg-card: #ffffff`, `--bg-subtle: #f6f5f3`, `--border-subtle: #eae7e4`, `--border-strong: #d5d1cb`.
- **Ink Navy typography:** `--text-primary: #0c1421`, `--text-secondary: #3b4352`, `--text-muted: #697386` (minimum WCAG 2.1 AA contrast).
- **Semantic status colors (3 hues + neutral):** Green (`#15803d`), Amber (`#b45309`), Red (`#b91c1c`) — always paired with explicit Vietnamese label or icon, never color alone.
- **Typography & numeric precision:**
  - Clean Vietnamese diacritics (`--font-sans`, minimum `14px` body, touch target `>= 40px`).
  - **Mandatory `tabular-nums`** for all VND (`BigInt`), freight fee, weight, and rate columns; **`JetBrains Mono`** (`--font-mono`) for waybill numbers, reconciliation IDs, and API error codes.

## 2. Anti-AI-Slop operational UI rules

1. **Start from a real end-to-end operational task** (e.g., _xử lý lô vận đơn lỗi_, _đối soát lệch COD_, _tạo khiếu nại có bằng chứng_) using domain-accurate Vietnamese copy — never generic SaaS boilerplate.
2. **Every element must serve an action or clarify state.** Prohibited decorative noise unless explicitly specified:
   - No purple/indigo gradients, glowing blobs, or decorative glassmorphism.
   - No nested cards-inside-cards (separate regions with `1px` hairlines, 8px spacing rhythm, typography hierarchy, and data-dense tables).
   - No emoji as navigation/bullet icons, no filler greetings (_"Chào mừng quay lại"_), no decorative micro-labels.
3. **Complete UI states per screen spec:** Every screen/table must handle `loading` (skeleton), `empty` (clear next action), `error` (what happened, whether data changed, next step), `data`, and `forbidden` / `partial` when specified.
4. **Destructive or external carrier actions:** Always require a confirmation dialog stating exact scope (carrier, account, order, impact) and never emit a fake success toast before a real committed outcome.

## 3. UI verification before merge

1. **5-line Design Plan before JSX:** State the primary task, table/filter layout, reused `globals.css` tokens, and required UI states.
2. **Visual & automated checks:**
   - Optional polish pass with `Impeccable` (distill excess borders/badges, verify contrast).
   - Mandatory automated gates: `pnpm --filter @shipde/web test:a11y` (`axe-core` WCAG 2.1 A/AA) and `Lighthouse CI`.
   - Real **Playwright screenshots** on desktop and mobile with long Vietnamese strings, empty state, and error state, plus keyboard navigation / visible focus check.
3. **Evaluate UX by task completion:** Measure steps, completion reliability, and error recovery — not visual polish alone.
