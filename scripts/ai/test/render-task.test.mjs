import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractWorkItemMeta,
  evaluateWorkItemScope,
  formatFindings,
  renderTask,
  loadTemplate,
} from '../render-task.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('render-task', () => {
  const ciWorkItemMd = `# TASK-AI-165 — Faster PR CI and merge queue

## Control

| Field | Value |
|---|---|
| Work Item ID | \`TASK-AI-165\` |
| Feature ID | N/A — CI workflow optimization |
| Status | \`IN_PROGRESS\` |
| Delivery order | \`292\` |
| Assigned author | GEMINI |
| Allowed paths | \`.github/workflows/ci.yml\`, \`turbo.json\`, \`package.json\` |
| Reviewer | Codex |
| Pull Request | \`#505\` |

## Business outcome

Enable Turborepo and GitHub merge queue for fast concurrent PR checks.

## In scope

Configure .github/workflows/ci.yml to cache turbo artifacts and enable merge_group triggers.

## Out of scope

Product application code, database schemas, tenant authentication.

## Constitution check

- [x] Tenant scope and RBAC: test not applicable; no product routes or queries.
- [x] Audit and sensitive data: no secrets handled in CI triggers.
`;

  const featureWorkItemMd = `# FEAT-ORD-01 — Order Creation and Multi-tenant Dispatch

## Control

| Field | Value |
|---|---|
| Work Item ID | \`FEAT-ORD-01\` |
| Feature ID | \`FEAT-ORD-01\` |
| Status | \`IN_PROGRESS\` |
| Delivery order | \`300\` |
| Assigned author | GEMINI |
| Allowed paths | \`apps/api/src/modules/orders/**\`, \`packages/contracts/**\`, \`!.github/**\` |
| Reviewer | Codex |
| Pull Request | \`#510\` |

## Business outcome

Allow shops to create and validate multi-tenant delivery orders.

## In scope

Order creation REST endpoints, tenant-scoped database queries, authorization checks.

## Out of scope

CI workflows, gate configurations, .github/.

## Constitution check

- [x] Tenant scope and RBAC: enforced and tested; cross-tenant write operations must be rejected with 403 Forbidden.
- [x] Audit and sensitive data: PII masked in activity timeline.
`;

  it('renders CI Work Item: permits .github and omits tenant/RBAC testing requirements', () => {
    const meta = extractWorkItemMeta(ciWorkItemMd);
    assert.equal(meta.workItemId, 'TASK-AI-165');
    assert.equal(meta.pullRequest, '#505');

    const scope = evaluateWorkItemScope(meta);
    assert.equal(scope.permitsGithub, true, 'CI work item should permit .github');
    assert.equal(scope.touchesTenantAuth, false, 'CI work item does not touch tenant/auth');
    assert.ok(!scope.githubScopeRule.includes('.github/'), 'Scope rule should not forbid .github/');
    assert.equal(scope.tenantRbacRequirement, '', 'Tenant requirement should be omitted');

    const rendered = renderTask('task-fix', 'TASK-AI-165', {
      workItemContent: ciWorkItemMd,
      pr: '#505',
      testCmd: 'pnpm test',
    });

    assert.ok(rendered.includes('TASK-AI-165'), 'Includes Work Item ID');
    assert.ok(rendered.includes('PR #505'), 'Includes PR number');
    assert.ok(!rendered.includes('semgrep rules or .github/.'), 'Does not forbid .github/');
    assert.ok(!rendered.includes('cross-tenant access must be denied'), 'Does not require cross-tenant test');
    assert.ok(!rendered.includes('tenant scope'), 'Does not include tenant scope in self-check');
  });

  it('renders Feature Work Item: forbids .github and requires tenant/RBAC tests', () => {
    const meta = extractWorkItemMeta(featureWorkItemMd);
    assert.equal(meta.workItemId, 'FEAT-ORD-01');

    const scope = evaluateWorkItemScope(meta);
    assert.equal(scope.permitsGithub, false, 'Feature work item should not permit .github');
    assert.equal(scope.touchesTenantAuth, true, 'Feature work item touches tenant/auth');
    assert.ok(scope.githubScopeRule.includes('.github/'), 'Scope rule must forbid .github/');
    assert.ok(scope.tenantRbacRequirement.includes('cross-tenant access must be denied'), 'Tenant requirement present');

    const findings = [
      {
        where: 'apps/api/src/modules/orders/orders.controller.ts:45 (createOrder)',
        wrong: 'Shop ID read from body instead of authenticated session tenant',
        goal: 'Read shop ID strictly from req.user.tenantId',
        verify: 'test("cross-tenant order creation returns 403")',
      },
    ];

    const rendered = renderTask('task-fix', 'FEAT-ORD-01', {
      workItemContent: featureWorkItemMd,
      findings,
      pr: '#510',
      testCmd: 'pnpm test',
    });

    assert.ok(rendered.includes('FEAT-ORD-01'), 'Includes Work Item ID');
    assert.ok(rendered.includes('semgrep rules or .github/.'), 'Forbids .github/');
    assert.ok(rendered.includes('cross-tenant access must be denied'), 'Includes tenant/RBAC requirement');
    assert.ok(rendered.includes('WHERE: apps/api/src/modules/orders/orders.controller.ts:45 (createOrder)'), 'Includes finding WHERE');
    assert.ok(rendered.includes('WRONG: Shop ID read from body instead of authenticated session tenant'), 'Includes finding WRONG');
    assert.ok(rendered.includes('GOAL: Read shop ID strictly from req.user.tenantId'), 'Includes finding GOAL');
    assert.ok(rendered.includes('VERIFY: test("cross-tenant order creation returns 403")'), 'Includes finding VERIFY');
  });

  it('formats findings with WHERE/WRONG/GOAL/VERIFY', () => {
    const structured = [
      {
        where: 'src/auth/guard.ts:20',
        wrong: 'Empty scope allowed',
        goal: 'Reject empty scope',
        verify: 'guard.spec.ts',
      },
    ];
    const formatted = formatFindings(structured);
    assert.ok(formatted.includes('WHERE: src/auth/guard.ts:20'));
    assert.ok(formatted.includes('WRONG: Empty scope allowed'));
    assert.ok(formatted.includes('GOAL: Reject empty scope'));
    assert.ok(formatted.includes('VERIFY: guard.spec.ts'));

    const raw = 'WHERE: a:1\r\nWRONG: bug 1\r\nGOAL: fix 1\r\nVERIFY: test 1\r\n\r\nWHERE: b:2\r\nWRONG: bug 2\r\nGOAL: fix 2\r\nVERIFY: test 2';
    const formattedRaw = formatFindings(raw);
    assert.equal((formattedRaw.match(/^WHERE:/gm) || []).length, 2);
    assert.ok(formattedRaw.includes('WHERE: a:1'));
    assert.ok(formattedRaw.includes('WHERE: b:2'));
  });

  it('ensures pr-body template and PR body have no unchecked mandatory checklist items', () => {
    const template = loadTemplate('pr-body');
    assert.ok(!template.includes('- [ ]'), 'pr-body.md template must not contain unchecked checklist items');

    const rendered = renderTask('pr-body', 'TASK-AI-170');
    assert.ok(!rendered.includes('- [ ]'), 'rendered pr-body must not contain unchecked checklist items');

    const prBodyPath = path.join(REPO_ROOT, '.oc', 'pr-body.md');
    if (fs.existsSync(prBodyPath)) {
      const prBodyContent = fs.readFileSync(prBodyPath, 'utf8');
      assert.ok(!prBodyContent.includes('- [ ]'), '.oc/pr-body.md must not contain unchecked checklist items');
    }
  });
});
