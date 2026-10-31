# apps/api — Author checklist

Mandatory before a NestJS API change is reviewable. Root `AGENTS.md` still wins on conflict.

## Review P1 gates

- Scope every tenant-owned Prisma query server-side by the session `merchantId` (`merchant_id`). Never trust a client-supplied tenant or merchant id.
- An empty scope array denies. `where: { id: { in: [] } }` and any empty `IN` must return nothing, not every row.
- Every endpoint has an auth guard plus an RBAC guard (`SessionGuard` and `PermissionsGuard` / `RequirePermissions`). A public route must be an explicit exception in the Work Item.
- Audit metadata is always masked. Phone, email, bank account, token and secret fields go through the module mask helper before they are written or logged.
- Each new endpoint has a cross-tenant negative supertest: merchant A’s session cannot read or mutate merchant B’s row.
- Update `docs/product-spec/contracts/openapi.yaml` in the same change as the route.

## NestJS (condensed)

Source: PatrickJS/awesome-cursorrules `rules/typescript-nestjs-best-practices-cursorrules-promp.mdc` (CC0-1.0). Condensed, not copied.

- One module per domain: one controller for the route, `class-validator` DTOs for input, a service for business logic and persistence.
- Shared filters, guards and interceptors live in the core module; cross-module helpers live in shared.
- PascalCase classes, camelCase members, kebab-case files. Type every parameter and return. Do not use `any`.
- Short single-purpose functions. Early return over nested blocks. One level of abstraction.
- Throw `CanonicalApiException` for expected failures. Catch only to add context; otherwise let the global exception filter handle it.
- Tests follow Arrange-Act-Assert and Given-When-Then. Cover each new controller and service behavior, including the forbidden and cross-tenant cases above.

## Prisma (condensed)

- Read and write only through `PrismaService`. Put `merchant_id` in the same `where` as the entity id on every tenant-owned query, including `update` and `delete`.
- Interactive `$transaction` for multi-row writes. No unbounded `findMany`; paginate.
- Do not edit generated client output or hand-apply SQL outside `prisma/migrations`.
