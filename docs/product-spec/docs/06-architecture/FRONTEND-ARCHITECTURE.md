# Frontend Architecture

## Stack

- Next.js App Router and TypeScript.
- Shared design-system package.
- TanStack Query for server state.
- React Hook Form plus shared Zod schemas for forms.
- TanStack Table for operational data grids.
- Role/scope-aware route and action guards.
- Playwright for E2E and component/unit tooling selected in the implementation ADR.

## Structure

\`\`\`text
apps/web/
  app/
  features/
    auth/
    organization/
    carriers/
    orders/
    quotes/
    shipments/
    tracking/
    exceptions/
    returns/
    reconciliation/
    claims/
    reports/
    admin/
  components/
  lib/
  styles/
\`\`\`

Feature folders own page composition, hooks and view models. Shared business types come from generated OpenAPI/shared contracts, not handwritten duplicates.

## State rules

- Server state lives in query cache; avoid duplicating in global client stores.
- Draft form state is local/persisted explicitly.
- Permission and active tenant context are centrally available.
- A command disables duplicate submit and displays durable command state.
- OUTCOME_UNKNOWN is a first-class blocking state with reconciliation progress.

## API client

- Generated typed client from OpenAPI where practical.
- Adds auth, tenant context, correlation and idempotency headers.
- Maps canonical errors to field/global UI content.
- Does not silently retry unsafe mutations.

## Quality gates

- No page with mock-only data in production build.
- Every primary button is covered by a test or intentionally disabled with explanation.
- All screens implement loading, empty, error, forbidden and success behavior.
- Accessibility lint plus keyboard testing for primary journeys.
- Visual consistency uses tokens/components; no ad-hoc per-page palette.

