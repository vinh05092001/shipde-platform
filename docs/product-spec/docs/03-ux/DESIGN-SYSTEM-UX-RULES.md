# Design System and UX Rules

## Product UX principles

1. One data entry should feed all downstream stages.
2. Fixing address/parcel data preserves the rest of the order.
3. The primary next action is obvious; destructive/external actions are confirmed.
4. Financial conclusions show evidence and calculation.
5. Provider errors use actionable language, never generic failure alone.
6. Automation is visible, explainable and overridable under permission.
7. Dense operational screens prioritize tables, filters and keyboard efficiency over decorative cards.

## Visual foundation

- Use a restrained modern SaaS palette with one primary brand color, neutral surfaces and semantic status colors.
- Minimum WCAG AA contrast for text and controls.
- 8px spacing system; consistent 4/8/12/16/24/32 increments.
- Typography hierarchy: page title, section title, label, body, helper, metadata.
- Tables use sticky headers, compact/comfortable density and horizontal overflow handling.

## Canonical components

- App shell, side navigation, top context selector.
- Data table, saved view, filter bar and bulk action bar.
- Form field wrappers and schema error summary.
- Stepper/checklist.
- Status badge and evidence badge.
- Money comparison cells.
- Timeline/event ledger.
- File uploader/import issue viewer.
- Confirmation dialog with effect summary.
- Workbox item/assignment control.
- Toast plus persistent notification center.
- Skeleton, empty, forbidden, not-found and incident state.

## Content rules

- Say what happened, why, whether data was changed and what to do next.
- Distinguish: carrier rejected, carrier unavailable, credentials invalid and provider could not be reached.
- Never claim money received without bank evidence.
- Never label a suspicion as confirmed carrier error.
- Show exact scope of destructive actions: carrier, account, order and effect.

## Responsive

- Desktop is primary for order/finance operations.
- Tablet supports warehouse and operational queues.
- Mobile/PWA prioritizes scan, tracking, exception acknowledgement and recipient views.
- Dense comparison/audit tables may use a summary card plus drill-down on narrow screens; data is not removed.

## Accessibility

- Keyboard order and visible focus.
- Labels independent of placeholders.
- Status conveyed by text/icon, not color alone.
- Dialog focus trap and return.
- Live announcements for async command completion.
- Accessible table headers and error summaries.
