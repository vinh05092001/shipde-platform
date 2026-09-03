# @shipde/testkit

Shared test harness helpers, assertion utilities, deterministic fixtures, and workspace boundary validators for Ship Dễ.

## Purpose

- Provide reusable test fixtures and assertions across applications and packages.
- Verify monorepo package boundary integrity without relying on ad-hoc test scripts.

## Boundary

- Contains test-only utilities and fixtures.
- Must not be included in production build dependencies.
