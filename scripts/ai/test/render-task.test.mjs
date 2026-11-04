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
| Allowed paths | \`apps/api/src/modules/orders/**\`, \`packages/contracts/**\` |
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
    const list = [
      {
        where: 'src/auth/guard.ts:20',
        wrong: 'Empty scope allowed',
        goal: 'Reject empty scope',
        verify: 'guard.spec.ts',
      },
    ];
    const formatted = formatFindings(list);
    assert.ok(formatted.includes('WHERE: src/auth/guard.ts:20'));
    assert.ok(formatted.includes('WRONG: Empty scope allowed'));
    assert.ok(formatted.includes('GOAL: Reject empty scope'));
    assert.ok(formatted.includes('VERIFY: guard.spec.ts'));
  });

  it('omits tenant/RBAC self-check in CI prompt', () => {
    const rendered = renderTask('task-fix', 'TASK-AI-165', {
      workItemContent: ciWorkItemMd,
      pr: '#505',
    });

    assert.ok(!rendered.includes('tenant scope'), 'Does not include tenant scope in self-check');
    assert.ok(!rendered.includes('RBAC'), 'Does not include RBAC in self-check');
    assert.ok(!rendered.includes('cross-tenant'), 'Does not include cross-tenant in self-check');
  });

  it('detects auth/tenant without false positive on lowercase words', () => {
    // 1. Lowercase "pass" in constitution note should not trigger touchesTenantAuth
    const workItemWithLowercasePass = `# TASK-DOC-01 — Documentation updates
## Control
| Field | Value |
| Work Item ID | TASK-DOC-01 |
| Allowed paths | docs/** |
## Business outcome
Docs update.
## In scope
Update architecture documentation.
## Constitution check
- [x] Tenant scope and RBAC: all unit tests pass locally without change.
`;
    const metaPass = extractWorkItemMeta(workItemWithLowercasePass);
    const scopePass = evaluateWorkItemScope(metaPass);
    assert.equal(scopePass.touchesTenantAuth, false, 'Lowercase "pass" in note must not trigger touchesTenantAuth');

    // 2. Uppercase "PASS" denotes check verdict and triggers touchesTenantAuth
    const workItemWithUpperPass = `# TASK-DOC-02 — Explicit auth check
## Constitution check
- [x] Tenant scope and RBAC: PASS
`;
    const metaUpper = extractWorkItemMeta(workItemWithUpperPass);
    const scopeUpper = evaluateWorkItemScope(metaUpper);
    assert.equal(scopeUpper.touchesTenantAuth, true, 'Uppercase PASS in note triggers touchesTenantAuth');

    // 3. Word "author" in scope must not trigger touchesTenantAuth
    const workItemWithAuthor = `# TASK-DOC-03 — Author header tool
## In scope
Render author header and template placeholders.
`;
    const metaAuthor = extractWorkItemMeta(workItemWithAuthor);
    const scopeAuthor = evaluateWorkItemScope(metaAuthor);
    assert.equal(scopeAuthor.touchesTenantAuth, false, '"author" in scope must not trigger touchesTenantAuth');
  });

  it('treats negated .github as not permitted', () => {
    // 1. Negated .github in inScope
    const workItemNegatedScope = `# TASK-CFG-01 — Config cleanup
## Control
| Field | Value |
| Work Item ID | TASK-CFG-01 |
| Allowed paths | scripts/** |
## In scope
Refactor scripts; do not touch .github/ workflows.
`;
    const metaScope = extractWorkItemMeta(workItemNegatedScope);
    const scopeScope = evaluateWorkItemScope(metaScope);
    assert.equal(scopeScope.permitsGithub, false, 'Negated .github in inScope is not permitted');
    assert.ok(scopeScope.githubScopeRule.includes('.github/'), 'Scope rule must forbid .github/');

    // 2. Negated .github in allowedPaths
    const workItemNegatedAllowed = `# TASK-CFG-02 — Path restriction
## Control
| Field | Value |
| Work Item ID | TASK-CFG-02 |
| Allowed paths | scripts/**, !.github/** |
`;
    const metaAllowed = extractWorkItemMeta(workItemNegatedAllowed);
    const scopeAllowed = evaluateWorkItemScope(metaAllowed);
    assert.equal(scopeAllowed.permitsGithub, false, 'Negated .github in allowedPaths is not permitted');
    assert.ok(scopeAllowed.githubScopeRule.includes('.github/'), 'Scope rule must forbid .github/');
  });

  it('renders all 4 fields with UNKNOWN for missing fields when finding is raw string', () => {
    // Raw string with partial fields
    const partialRaw = 'WHERE: scripts/ai/select-reviewer.mjs:94\nWRONG: Upstream comparison skipped';
    const formattedPartial = formatFindings(partialRaw);
    assert.ok(formattedPartial.includes('WHERE: scripts/ai/select-reviewer.mjs:94'));
    assert.ok(formattedPartial.includes('WRONG: Upstream comparison skipped'));
    assert.ok(formattedPartial.includes('GOAL: UNKNOWN'));
    assert.ok(formattedPartial.includes('VERIFY: UNKNOWN'));

    // Bare text string without labels
    const bareRaw = 'Shop ID read from body instead of authenticated token';
    const formattedBare = formatFindings(bareRaw);
    assert.ok(formattedBare.includes('WHERE: UNKNOWN'));
    assert.ok(formattedBare.includes('WRONG: Shop ID read from body instead of authenticated token'));
    assert.ok(formattedBare.includes('GOAL: UNKNOWN'));
    assert.ok(formattedBare.includes('VERIFY: UNKNOWN'));
  });

  it('preserves both CRLF findings', () => {
    const raw = 'WHERE: a:1\r\nWRONG: bug 1\r\nGOAL: fix 1\r\nVERIFY: test 1\r\n\r\nWHERE: b:2\r\nWRONG: bug 2\r\nGOAL: fix 2\r\nVERIFY: test 2';
    assert.equal((formatFindings(raw).match(/^WHERE:/gm) || []).length, 2);
  });

  it('treats "!.github/**" including inside backticks as forbidden, not permitted', () => {
    const workItemWithBacktickNegated = `# TASK-CFG-03 — Backtick negated github
## Control
| Field | Value |
| Work Item ID | TASK-CFG-03 |
| Allowed paths | \`scripts/**\`, \`!.github/**\` |
`;
    const metaBacktick = extractWorkItemMeta(workItemWithBacktickNegated);
    const scopeBacktick = evaluateWorkItemScope(metaBacktick);
    assert.equal(scopeBacktick.permitsGithub, false, 'Backtick-wrapped !.github/** must be forbidden');
    assert.ok(scopeBacktick.githubScopeRule.includes('.github/'), 'Must forbid .github/');

    const workItemWithQuoteNegated = `# TASK-CFG-04 — Quote negated github
## Control
| Field | Value |
| Work Item ID | TASK-CFG-04 |
| Allowed paths | '!.github/**' |
`;
    const metaQuote = extractWorkItemMeta(workItemWithQuoteNegated);
    const scopeQuote = evaluateWorkItemScope(metaQuote);
    assert.equal(scopeQuote.permitsGithub, false, 'Quote-wrapped !.github/** must be forbidden');
    assert.ok(scopeQuote.githubScopeRule.includes('.github/'), 'Must forbid .github/');
  });

  it('ensures "preserved" does not turn off tenant auth check', () => {
    const workItemPreserved = `# TASK-AUTH-01 — Preserved tenant boundary
## Control
| Field | Value |
| Work Item ID | TASK-AUTH-01 |
| Allowed paths | apps/api/** |
## Constitution check
- [x] Tenant scope and RBAC: existing tenant isolation preserved across all endpoints.
`;
    const meta = extractWorkItemMeta(workItemPreserved);
    const scope = evaluateWorkItemScope(meta);
    assert.equal(scope.touchesTenantAuth, true, '"preserved" must not disable tenant auth check');
    assert.ok(scope.tenantRbacRequirement.includes('cross-tenant access must be denied'));
  });

  it('treats negated .github with space "! .github/**" as forbidden', () => {
    const workItemWithSpaceNegated = `# TASK-CFG-05 — Space negated github
## Control
| Field | Value |
| Work Item ID | TASK-CFG-05 |
| Allowed paths | scripts/**, ! .github/** |
`;
    const meta = extractWorkItemMeta(workItemWithSpaceNegated);
    const scope = evaluateWorkItemScope(meta);
    assert.equal(scope.permitsGithub, false, '"! .github/**" with space must be forbidden');
    assert.ok(scope.githubScopeRule.includes('.github/'), 'Must forbid .github/');

    const workItemWithBacktickSpace = `# TASK-CFG-06 — Backtick space negated github
## Control
| Field | Value |
| Work Item ID | TASK-CFG-06 |
| Allowed paths | \`scripts/**\`, \`! .github/**\` |
`;
    const metaBacktick = extractWorkItemMeta(workItemWithBacktickSpace);
    const scopeBacktick = evaluateWorkItemScope(metaBacktick);
    assert.equal(scopeBacktick.permitsGithub, false, 'Backtick `! .github/**` with space must be forbidden');
    assert.ok(scopeBacktick.githubScopeRule.includes('.github/'), 'Must forbid .github/');
  });

  it('records UNKNOWN for empty WHERE and does not swallow WRONG', () => {
    const raw = 'WHERE:\nWRONG: Shop ID read from body instead of token\nGOAL: Fix\nVERIFY: Test';
    const formatted = formatFindings(raw);
    assert.ok(formatted.includes('WHERE: UNKNOWN'), 'Empty WHERE must record UNKNOWN');
    assert.ok(formatted.includes('WRONG: Shop ID read from body instead of token'), 'Must not swallow WRONG');
    assert.ok(formatted.includes('GOAL: Fix'), 'Must preserve GOAL');
    assert.ok(formatted.includes('VERIFY: Test'), 'Must preserve VERIFY');

    const rawWithSpace = 'WHERE: \nWRONG: Invalid scope\nGOAL: UNKNOWN\nVERIFY: UNKNOWN';
    const formattedSpace = formatFindings(rawWithSpace);
    assert.ok(formattedSpace.includes('WHERE: UNKNOWN'));
    assert.ok(formattedSpace.includes('WRONG: Invalid scope'));
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
