# @shipde/contracts

Shared TypeScript interfaces, domain schemas, canonical error catalogs, and API contract specifications for Ship Dễ.

## Purpose

- Define shared data contracts, canonical status enumerations, and error shapes across applications (`apps/web`, future `apps/api`, and `apps/worker`).

## Boundary

- Must contain pure type definitions, enum values, and validation contracts.
- Must not contain provider-specific adapter implementations, database query logic, or client-side UI components.
