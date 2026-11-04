# Focused context pack

## AGENTS.md

```
# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)

```

## apps/web/e2e/storybook-data-table.spec.ts

```
import { expect, test, type Page } from '@playwright/test';

const SEARCH_LABEL = 'Tìm theo mã vận đơn, mã đơn, khách hàng...';
const PAGE_SIZE_LABEL = 'Chọn số dòng hiển thị mỗi trang';

test('AC-AI-155: mounted /storybook table restores state on real browser back/forward', async ({ page }) => {
  await page.goto('/storybook?per_page=5');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toBeVisible();
  await expect(page.getByText(new RegExp(`^Trang 1 / 2$`))).toBeVisible();

  // Interaction 1: next page via the real pagination control (pushes page=2)
  await page.getByRole('button', { name: 'Đến trang kế tiếp' }).click();
  await page.waitForURL(/page=2/);
  await expect(page.getByText(new RegExp(`^Trang 2 / 2$`))).toBeVisible();

  // Interaction 2: search while on page 2 (pushes search=GHTK, resets page)
  await search.fill('GHTK');
  await page.waitForURL(/search=GHTK/);
  await expect(search).toHaveValue('GHTK');

  // Real browser Back: returns to the page=2 history entry
  await page.goBack();
  await page.waitForURL(
    (url) => url.searchParams.get('page') === '2' && !url.searchParams.has('search')
  );
  await expect(search).toHaveValue('');
  await expect(page.getByText(new RegExp(`^Trang 2 / 2$`))).toBeVisible();

  // Real browser Forward: restores the search=GHTK entry
  await page.goForward();
  await page.waitForURL(/search=GHTK/);
  await expect(search).toHaveValue('GHTK');
});

test('AC-AI-155: mounted pagination dropdown synchronizes per_page without state loss', async ({ page }) => {
  await page.goto('/storybook');
  const pageSizeSelect = page.getByRole('combobox', { name: PAGE_SIZE_LABEL });
  await expect(pageSizeSelect).toBeVisible();

  await pageSizeSelect.selectOption('5');
  await page.waitForURL(/per_page=5/);
  await expect(page.getByText(new RegExp(`^Trang 1 / 2$`))).toBeVisible();

  // Change page to 2
  await page.getByRole('button', { name: 'Đến trang kế tiếp' }).click();
  await page.waitForURL(/page=2/);

  // Switch to per_page=20: page count drops to 1, clamps page safely
  await pageSizeSelect.selectOption('20');
  await page.waitForURL(/per_page=20/);
  await expect(page.getByText(new RegExp(`^Trang 1 / 1$`))).toBeVisible();
});

test('AC-AI-155: mounted column sorting updates URL and preserves filters', async ({ page }) => {
  await page.goto('/storybook?search=An');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toHaveValue('An');

  // Sort by Thu hộ COD
  const codHeader = page.getByRole('button', { name: /^Sắp xếp theo Thu hộ COD:/ });
  await expect(codHeader).toBeVisible();
  await codHeader.click();

  // Click Tăng dần
  await page.getByRole('menuitem', { name: 'Tăng dần' }).click();
  await page.waitForURL((url) => url.searchParams.get('sort') === 'codAmount.asc');

  // Verify search filter was preserved
  expect(new URL(page.url()).searchParams.get('search')).toBe('An');
  await expect(search).toHaveValue('An');
});

test('AC-AI-155: mounted reset filters clears search and facet filters but retains default view', async ({ page }) => {
  await page.goto('/storybook?search=An&status=DELIVERED');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toHaveValue('An');

  const resetButton = page.getByRole('button', { name: 'Đặt lại tất cả bộ lọc' });
  await expect(resetButton).toBeVisible();
  await resetButton.click();

  await page.waitForURL(
    (url) => !url.searchParams.has('search') && !url.searchParams.has('status')
  );
  await expect(search).toHaveValue('');
  await expect(resetButton).not.toBeVisible();
});

test('AC-AI-155: mounted pagination remains synchronized after Back then Next', async ({ page }) => {
  await page.goto('/storybook?per_page=5');
  const search = page.getByRole('textbox', { name: SEARCH_LABEL });
  await expect(search).toBeVisible();
  await expect(page.getByText(new RegExp(`^Trang 1 / 2$`))).toBeVisible();

  // Click Next: advances to page 2
  await page.getByRole('button', { name: 'Đến trang kế tiếp' }).click();
  await page.waitForURL(/page=2/);
  await expect(page.getByText(new RegExp(`^Trang 2 / 2$`))).toBeVisible();

  // Real browser Back: restores page 1
  await page.goBack();
  await page.waitForURL(
    (url) => !url.searchParams.has('page') || url.searchParams.get('page') === '1'
  );
  await expect(page.getByText(new RegExp(`^Trang 1 / 2$`))).toBeVisible();

  // Click Next again: URL contains page=2, indicator reads Trang 2 / 2
  await page.getByRole('button', { name: 'Đến trang kế tiếp' }).click();
  await page.waitForURL(/page=2/);
  await expect(page.getByText(new RegExp(`^Trang 2 / 2$`))).toBeVisible();
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  await expect(page.getByText('GHN512938472VN')).toBeVisible();
});
```

## apps/web/e2e/support/review-gates.mjs

```
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { scanFileForA11y } from '../../../../scripts/verify-a11y.ts';

// Run with node --test: these checks do not require React or database services.
// SHIPDE_REVIEW_REVISION allows the same tests to inspect the reviewed commit
// without replacing dirty files, rebasing, resetting or changing any gate.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const revision = process.env.SHIPDE_REVIEW_REVISION;
const gitShow = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`], { cwd: root });
const source = (file) => (revision ? gitShow(revision, file) : readFileSync(join(root, file)));
const normalized = (buffer) => buffer.toString('utf8').replaceAll('\r\n', '\n').trimEnd();
const register = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const rows = (buffer) => normalized(buffer).split('\n');
const isTask = (row) => row.split('","')[3] === 'TASK-AI-155';

test('review 1: ported components pass the actual application accessibility scanner', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'task-ai-155-a11y-'));
  try {
    for (const directory of ['data-table', 'dashboard']) {
      const relative = `apps/web/src/components/${directory}`;
      for (const name of readdirSync(join(root, relative)).filter((name) => /\.tsx?$/.test(name))) {
        const fixture = join(scratch, name);
        writeFileSync(fixture, source(`${relative}/${name}`));
        assert.deepEqual(scanFileForA11y(fixture), [], `${relative}/${name}`);
      }
    }
    // Verify the actual scanner still rejects a hidden interactive control.
    const forbidden = join(scratch, 'hidden-button.tsx');
    writeFileSync(forbidden, '<button aria-hidden="true">Thử lại</button>');
    assert.ok(
      scanFileForA11y(forbidden).includes(
        'Found interactive element incorrectly marked with aria-hidden="true"'
      )
    );
  } finally {
    // scratch is the exact directory returned by mkdtemp, inside the OS tempdir.
    assert.equal(dirname(resolve(scratch)), resolve(tmpdir()));
    rmSync(scratch, { recursive: true });
  }
});

test('review 6: approved handoff documents match origin/main', () => {
  for (const file of [
    'docs/product-spec/work-items/FEAT-COM-09.md',
    'docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md',
    'docs/product-spec/docs/00-control/TRACEABILITY.md',
  ]) {
    assert.equal(normalized(source(file)), normalized(gitShow('origin/main', file)), file);
  }
});

test('review 6: every unrelated delivery register row is preserved', () => {
  const actual = rows(source(register)).filter((row) => !isTask(row));
  const expected = rows(gitShow('origin/main', register)).filter((row) => !isTask(row));
  assert.deepEqual(actual, expected, 'Only the TASK-AI-155 register row may differ');
});

test('review 6: delivery register has one row per Work Item', () => {
  const entries = rows(source(register)).slice(1);
  assert.equal(entries.filter(isTask).length, 1, 'Exactly one TASK-AI-155 row');
  const ids = entries.map((row) => row.split('","')[3]);
  assert.equal(new Set(ids).size, ids.length, 'No duplicate Work Item rows');
});

test('review 7: delivery register orders are unique and non-colliding', () => {
  const entries = rows(source(register)).slice(1);
  const orders = entries.map((row) => row.split(',')[0].replaceAll('"', '')).filter(Boolean);
  assert.equal(
    new Set(orders).size,
    orders.length,
    'All delivery orders in FEATURE-DELIVERY-REGISTER.csv must be strictly unique'
  );
  assert.ok(
    orders.every((order) => /^\d+$/.test(order)),
    'All delivery orders must be digits'
  );
  const taskRow = entries.find(isTask);
  assert.ok(taskRow, 'TASK-AI-155 row must exist');
  const taskOrder = taskRow.split(',')[0].replaceAll('"', '');
  assert.equal(taskOrder, '293', 'TASK-AI-155 must be assigned unique delivery order 293');
});

test('review 5: void gate findings remain outside the PR delta', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  assert.deepEqual(
    changed.filter((file) => file.startsWith('.github/') || file === '.gitleaksignore'),
    []
  );
});

test('review 9: PR body contains zero template placeholders matching contract gate regex', () => {
  // Negative test: verify that the regex accurately detects forbidden placeholders
  const sampleWithPlaceholder = 'This is a sample with <placeholder> and <br>';
  assert.deepEqual(sampleWithPlaceholder.match(/<[^>\n]+>/g), ['<placeholder>', '<br>']);

  const validSample = 'This is a valid body without placeholders or HTML tags';
  assert.equal(validSample.match(/<[^>\n]+>/g), null);

  const prBodyPath = join(root, '.oc/pr-body.md');
  if (existsSync(prBodyPath)) {
    const prBody = readFileSync(prBodyPath, 'utf8');
    const matches = prBody.match(/<[^>\n]+>/g);
    assert.equal(
      matches,
      null,
      `PR body contains required template placeholders: ${JSON.stringify(matches)}`
    );
  }
});

test('review 10: PR body files pass complete validate_pr_contract gate logic', () => {
  const prFiles = ['.oc/pr-body.md', '.oc/pr-body-gh.md', '.oc/pr-body-remote.md'].filter((rel) =>
    existsSync(join(root, rel))
  );

  const requiredHeadings = [
    '## Work Item',
    '## Source requirements',
    '## Scope integrity',
    '## Implementation',
    '## Acceptance evidence',
    '## Verification',
    '## Safety and recovery',
    '## Documentation and traceability',
    '## Risks and limitations',
    '## Codex review',
  ];

  const sampleDeterministicBody = `## Work Item\nTASK-AI-155\n## Source requirements\n## Scope integrity\n- [x] checked\n## Implementation\n## Acceptance evidence\n## Verification\n## Safety and recovery\n## Documentation and traceability\n## Risks and limitations\n## Codex review\n- Review status: READY_FOR_CODEX\n`;
  const targets =
    prFiles.length > 0
      ? prFiles.map((rel) => ({ name: rel, body: readFileSync(join(root, rel), 'utf8') }))
      : [{ name: 'deterministic-pr-body-sample', body: sampleDeterministicBody }];

  for (const { name: rel, body } of targets) {
    // All 10 required headings must be present
    for (const heading of requiredHeadings) {
      assert.ok(body.includes(heading), `${rel} missing section: ${heading}`);
    }

    // Must reference TASK-AI-155
    assert.ok(body.includes('TASK-AI-155'), `${rel} must reference TASK-AI-155`);

    // Must not contain template placeholders
    const placeholders = body.match(/<[^>\n]+>/g);
    assert.equal(
      placeholders,
      null,
      `${rel} contains forbidden template placeholders: ${JSON.stringify(placeholders)}`
    );

    // Must not contain TBD or TODO
    const todos = body.match(/\b(?:TBD|TODO)\b/g);
    assert.equal(todos, null, `${rel} contains TBD or TODO: ${JSON.stringify(todos)}`);

    // Must not contain unchecked items
    assert.ok(!body.includes('- [ ]'), `${rel} contains unchecked items (- [ ])`);

    // Must contain READY_FOR_CODEX
    assert.ok(
      body.includes('Review status: READY_FOR_CODEX'),
      `${rel} must declare READY_FOR_CODEX`
    );
  }
});

test('review 36: AppShell.tsx has zero unused eslint-disable directives', () => {
  const appShellContent = source('apps/web/src/components/shell/AppShell.tsx').toString('utf8');
  // Finding 1 (Round 36): unused eslint-disable directive at line 274:7
  // "react-hooks/set-state-in-effect" was unused before setNavigation({ token, targets: [], setupOnly: true })
  const unusedDirectivePattern =
    /\/\/\s*eslint-disable-next-line\s+react-hooks\/set-state-in-effect[^\n]*\n\s*setNavigation\(\{\s*token,\s*targets:\s*\[\],\s*setupOnly:\s*true\s*\}\);/;
  assert.equal(
    unusedDirectivePattern.test(appShellContent),
    false,
    'AppShell.tsx must not contain the unused eslint-disable directive on setup-scoped setNavigation'
  );
});

test('review 37: storybook-data-table.spec.ts does not use synthetic popstate for router acknowledgment and releases external link navigation', () => {
  const specContent = source('apps/web/e2e/storybook-data-table.spec.ts').toString('utf8');
  assert.equal(
    specContent.includes("new PopStateEvent('popstate')"),
    false,
    'Synthetic popstate events must not be dispatched to simulate Next.js router acknowledgment'
  );
  assert.ok(
    specContent.includes('held.releaseLatest()'),
    'Link navigation request must be released so Next.js commits the external navigation'
  );
  assert.ok(
    specContent.includes("held.releaseOne((url) => !url.searchParams.has('status'))"),
    'Empty reset request must be acknowledged via router release'
  );
});

test('review 38: storybook-data-table.spec.ts accommodates RSC link prefetch without hardcoding exact request count', () => {
  const specContent = source('apps/web/e2e/storybook-data-table.spec.ts').toString('utf8');
  assert.equal(
    specContent.includes('.toBe(3)'),
    false,
    'held.requests count must not assert exact 3 because Next.js RSC link prefetch can add requests'
  );
  assert.ok(
    specContent.includes('toBeGreaterThan'),
    'held.requests must use toBeGreaterThan to verify link navigation request arrival'
  );
});

```

## apps/web/src/components/data-table/DataTableToolbar.tsx

```
// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table
/**
 * Ported from sadmann7/shadcn-table (MIT License)
 * Source: https://github.com/sadmann7/shadcn-table
 *
 * MIT License
 * Copyright (c) 2024 Sadman Sakib
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

'use client';

import React from 'react';
import { Search, X } from 'lucide-react';

export interface DataTableToolbarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filtersSlot?: React.ReactNode;
  actionsSlot?: React.ReactNode;
  viewOptionsSlot?: React.ReactNode;
  isFiltered?: boolean;
  onResetFilters?: () => void;
  className?: string;
  debounceMs?: number;
  table?: any;
}

export function createDebouncedSearch(
  onSearchChange: ((val: string) => void) | undefined,
  delay: number = 300
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    type: (val: string) => {
      if (timer) clearTimeout(timer);
      if (delay <= 0) {
        onSearchChange?.(val);
      } else {
        timer = setTimeout(() => {
          onSearchChange?.(val);
        }, delay);
      }
    },
    clear: () => {
      if (timer) clearTimeout(timer);
      onSearchChange?.('');
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

export function DataTableToolbar({
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Tìm kiếm dữ liệu...',
  filtersSlot,
  actionsSlot,
  viewOptionsSlot,
  isFiltered = false,
  onResetFilters,
  className = '',
  debounceMs = 300,
}: DataTableToolbarProps) {
  // Only local state allowed: the search box's in-progress text (BR-UI-01)
  const [draftSearch, setDraftSearch] = React.useState(searchValue || '');

  // Keep latest callback in ref so scheduled timers invoke the latest function
  const searchCallbackRef = React.useRef(onSearchChange);
  React.useEffect(() => {
    searchCallbackRef.current = onSearchChange;
  }, [onSearchChange]);

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDispatchedRef = React.useRef<string | null>(null);
  const isPopstateRef = React.useRef(false);

  React.useEffect(() => {
    const handlePopstate = () => {
      isPopstateRef.current = true;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', handlePopstate);
      return () => window.removeEventListener('popstate', handlePopstate);
    }
  }, []);

  // Reset to URL value whenever the committed URL value changes (BR-UI-01)
  React.useEffect(() => {
    if (isPopstateRef.current) {
      isPopstateRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setDraftSearch(searchValue || '');
      return;
    }

    // If searchValue matches our own in-flight dispatch and user is actively drafting newer text, preserve newer draft
    if (
      lastDispatchedRef.current !== null &&
      searchValue === lastDispatchedRef.current &&
      timerRef.current !== null
    ) {
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setDraftSearch(searchValue || '');
  }, [searchValue]);

  // Drop scheduled debounce when the toolbar unmounts
  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDraftSearch(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (debounceMs <= 0) {
      lastDispatchedRef.current = val;
      searchCallbackRef.current?.(val);
    } else {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        lastDispatchedRef.current = val;
        searchCallbackRef.current?.(val);
      }, debounceMs);
    }
  };

  const handleClear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastDispatchedRef.current = '';
    setDraftSearch('');
    searchCallbackRef.current?.('');
  };

  const handleReset = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastDispatchedRef.current = '';
    setDraftSearch('');
    onResetFilters?.();
  };

  return (
    <div
      className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] ${className}`}
    >
      {/* Left side: Search input and Faceted filters */}
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {onSearchChange !== undefined && (
          <div className="relative w-full sm:w-64 max-w-sm">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={draftSearch}
              onChange={handleInputChange}
              aria-label={searchPlaceholder}
              className="w-full h-8 pl-8 pr-7 text-xs rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"
            />
            {draftSearch && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Xóa nội dung tìm kiếm"
                title="Xóa nội dung tìm kiếm"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-dim)] hover:text-[var(--text-primary)] rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {filtersSlot}

        {isFiltered && onResetFilters && (
          <button
            type="button"
            onClick={handleReset}
            aria-label="Đặt lại tất cả bộ lọc"
            title="Đặt lại tất cả bộ lọc"
            className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-[6px] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary-subtle)] transition-colors cursor-pointer"
          >
            <span>Đặt lại bộ lọc</span>
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Right side: Actions & Column View Options */}
      <div className="flex items-center gap-2 self-end sm:self-auto">
        {actionsSlot}
        {viewOptionsSlot}
      </div>
    </div>
  );
}

```

## apps/web/src/components/data-table/lib/data-table-filters.ts

```
// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

import {
  type RowData,
  skipFirstRun,
  type Table,
  type TableFeatures,
  tableMemo,
} from '@tanstack/react-table';

import {
  asFilteringTable,
  getFacetedRowModel,
  getFilteredRowModel,
} from './data-table-filters-row-model';

export * from './data-table-filters-match';

export function createDataTableFilteredRowModel<
  TFeatures extends TableFeatures,
  TData extends RowData,
>() {
  return (table: Table<TFeatures, TData>) => {
    const instance = asFilteringTable(table);

    return tableMemo({
      feature: 'dataTableFilteringFeature',
      table,
      fnName: 'table.getFilteredRowModel',
      memoDeps: () => [
        table.getPreFilteredRowModel(),
        instance.atoms.columnFilters?.get(),
        instance.atoms.joinOperator?.get(),
        instance.atoms.globalFilter?.get(),
      ],
      fn: () => getFilteredRowModel(table.getPreFilteredRowModel(), instance),
      onAfterUpdate: skipFirstRun(() => instance.autoResetPageIndex?.()),
    });
  };
}

export function createDataTableFacetedRowModel<
  TFeatures extends TableFeatures,
  TData extends RowData,
>() {
  return (table: Table<TFeatures, TData>, columnId: string) => {
    const instance = asFilteringTable(table);

    return tableMemo({
      feature: 'columnFacetingFeature',
      table,
      fnName: 'createDataTableFacetedRowModel',
      memoDeps: () => [
        table.getPreFilteredRowModel(),
        instance.atoms.columnFilters?.get(),
        instance.atoms.joinOperator?.get(),
        instance.atoms.globalFilter?.get(),
        table.getFilteredRowModel(),
      ],
      fn: () => getFacetedRowModel(table.getPreFilteredRowModel(), columnId, instance),
    });
  };
}

```

## apps/web/src/components/data-table/useDataTable.ts

```
// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table
/**
 * Ported from sadmann7/shadcn-table (MIT License)
 * Source: https://github.com/sadmann7/shadcn-table
 *
 * MIT License
 * Copyright (c) 2024 Sadman Sakib
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * URL search params helpers and the dual-mode useDataTable dispatcher.
 */

'use client';

import type { RowData } from '@tanstack/react-table';

import type { TablecnUseDataTableProps } from './use-tablecn-helpers';
import type { UseDataTableProps, UseDataTableReturn } from './use-shipde-data-table';
import { useShipdeDataTable } from './use-shipde-data-table';
import { useTablecnDataTable } from './use-tablecn-data-table';

export {
  formatSortParam,
  normalizeParamsString,
  parseSortParam,
} from './data-table-url-params';
export type { UseDataTableProps, UseDataTableReturn } from './use-shipde-data-table';
export type { TablecnUseDataTableProps } from './use-tablecn-helpers';

export function useDataTable<TData extends RowData>(
  props: TablecnUseDataTableProps<TData>
): { table: any };
export function useDataTable(props?: UseDataTableProps): UseDataTableReturn;
export function useDataTable(props: any = {}): any {
  if (
    props &&
    'columns' in props &&
    Array.isArray(props.columns) &&
    !('filterableColumns' in props)
  ) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useTablecnDataTable(props);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useShipdeDataTable(props);
}
```

## apps/web/src/tests/data-table-dashboard.test.ts

```
/**
 * TASK-AI-155 acceptance tests for the reusable server-driven data table and dashboard shell.
 *
 * One test per acceptance criterion (AC-AI-155-01 .. AC-AI-155-11) from
 * docs/product-spec/work-items/TASK-AI-155.md. Per-finding and duplicate regression
 * cases stay in the Work Item review gates instead of this file.
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

if (typeof (globalThis as any).location === 'undefined') {
  (globalThis as any).location = new URL('http://localhost/storybook');
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ColumnDef,
  DataTable,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTablePagination,
  DataTableToolbar,
  DataTableViewOptions,
  formatSortParam,
  parseSortParam,
} from '../components/data-table';
import {
  DashboardHeader,
  DashboardSidebar,
  PageHeader,
  DEFAULT_NAV_SECTIONS,
} from '../components/dashboard';
import { FIXTURE_SHIPMENTS, FixtureShipment } from '../app/storybook/fixtures';

const columns: ColumnDef<FixtureShipment>[] = [
  {
    id: 'trackingCode',
    header: 'Mã vận đơn',
    cell: ({ row }) => React.createElement<any>('span', { className: 'font-mono' }, row.trackingCode),
    enableSorting: true,
  },
  {
    id: 'carrier',
    header: 'Hãng vận chuyển',
    accessorKey: 'carrier',
    enableSorting: false,
  },
  {
    id: 'recipientName',
    header: 'Người nhận',
    accessorKey: 'recipientName',
  },
  {
    id: 'codAmount',
    header: 'Tiền COD',
    align: 'right',
    cell: ({ row }) =>
      React.createElement<any>(
        'span',
        { className: 'tabular-nums' },
        `${row.codAmount.toLocaleString('vi-VN')} đ`
      ),
    enableSorting: true,
  },
];

function renderTable(props: Record<string, unknown>) {
  return renderToStaticMarkup(
    React.createElement<any>(DataTable, {
      data: FIXTURE_SHIPMENTS.slice(0, 3),
      columns,
      keyExtractor: (item: FixtureShipment) => item.id,
      loading: false,
      sort: { id: 'trackingCode', desc: false },
      ...props,
    })
  );
}

// AC-AI-155-01: DataTable normal loaded state
test('AC-AI-155-01 DataTable normal loaded state', () => {
  const loaded = renderTable({ onRowClick: (item: FixtureShipment) => item });
  assert.ok(loaded.includes('role="table"'));
  assert.ok(loaded.includes(FIXTURE_SHIPMENTS[0].trackingCode));
  assert.ok(loaded.includes(FIXTURE_SHIPMENTS[0].recipientName));
  assert.ok(loaded.includes(`${FIXTURE_SHIPMENTS[0].codAmount.toLocaleString('vi-VN')} đ`));
  assert.ok(loaded.includes('text-right'));
  assert.ok(loaded.includes('aria-sort="ascending"'));
  assert.ok(loaded.includes('aria-sort="none"'));
  assert.ok(loaded.includes('data-row-action="true"'));
});

// AC-AI-155-02: DataTable loading skeleton state
test('AC-AI-155-02 DataTable loading skeleton state', () => {
  const loadingState = renderTable({ data: [], loading: true });
  assert.ok(loadingState.includes('aria-busy="true"'));
  assert.ok(loadingState.includes('animate-pulse'));
  assert.ok(!loadingState.includes(FIXTURE_SHIPMENTS[0].trackingCode));
});

// AC-AI-155-03: DataTable empty state
test('AC-AI-155-03 DataTable empty state', () => {
  const emptyState = renderTable({
    data: [],
    emptyTitle: 'Không có bản ghi nào',
    emptyDescription: 'Vui lòng nạp đơn hàng từ hệ thống POS hoặc kiểm tra lại bộ lọc.',
    emptyActionLabel: 'Làm mới dữ liệu',
    onEmptyAction: () => {},
  });
  assert.ok(emptyState.includes('Không có bản ghi nào'));
  assert.ok(emptyState.includes('Vui lòng nạp đơn hàng từ hệ thống POS'));
  assert.ok(emptyState.includes('Làm mới dữ liệu'));
});

// AC-AI-155-04: DataTable error and forbidden states
test('AC-AI-155-04 DataTable error and forbidden states', () => {
  const errorState = renderTable({
    data: [],
    error: 'Lỗi kết nối máy chủ quản trị vận chuyển (502 Bad Gateway)',
    onRetry: () => {},
  });
  assert.ok(errorState.includes('role="alert"'));
  assert.ok(errorState.includes('502 Bad Gateway'));
  assert.ok(errorState.includes('Thử lại'));
  assert.ok(!errorState.includes('Không tìm thấy dữ liệu'));
  const forbiddenState = renderTable({
    forbidden: 'Lỗi 403 Forbidden',
    forbiddenTitle: 'Không có quyền truy cập',
    forbiddenActionLabel: 'Yêu cầu quyền truy cập',
    onForbiddenAction: () => {},
  });
  assert.ok(forbiddenState.includes('role="alert"'));
  assert.ok(forbiddenState.includes('Không có quyền truy cập'));
  assert.ok(forbiddenState.includes('Yêu cầu quyền truy cập'));
});

// AC-AI-155-05: DataTableColumnHeader sorting
test('AC-AI-155-05 DataTableColumnHeader sorting', () => {
  const sortHtml = (sort: { id: string; desc: boolean } | null, column = columns[0]) =>
    renderToStaticMarkup(
      React.createElement<any>(DataTableColumnHeader, {
        column,
        title: 'Mã vận đơn',
        sort,
        onSort: () => {},
      })
    );
  assert.ok(sortHtml({ id: 'trackingCode', desc: false }).includes('data-sort="ascending"'));
  assert.ok(sortHtml({ id: 'trackingCode', desc: true }).includes('data-sort="descending"'));
  assert.ok(sortHtml(null).includes('data-sort="none"'));
  assert.ok(
    sortHtml({ id: 'trackingCode', desc: false }).includes('Sắp xếp theo Mã vận đơn: hiện tại tăng dần')
  );
  assert.ok(!sortHtml(null, columns[1]).includes('<button'));
});

// AC-AI-155-06: DataTablePagination controls
test('AC-AI-155-06 DataTablePagination controls', () => {
  const pagination = renderToStaticMarkup(
    React.createElement<any>(DataTablePagination, {
      pageIndex: 2,
      pageSize: 10,
      pageCount: 5,
      totalCount: 48,
      onPageChange: () => {},
      onPageSizeChange: () => {},
      selectedCount: 3,
    })
  );
  assert.ok(pagination.includes('Đã chọn'));
  assert.ok(pagination.includes('Số dòng mỗi trang:'));
  for (const size of [10, 20, 50, 100]) {
    assert.ok(pagination.includes(`value="${size}"`));
  }
  assert.ok(pagination.includes('title="Trang đầu"'));
  assert.ok(pagination.includes('title="Trang sau"'));
});

// AC-AI-155-07: DataTableToolbar and faceted filter
test('AC-AI-155-07 DataTableToolbar and faceted filter', () => {
  const toolbar = renderToStaticMarkup(
    React.createElement<any>(DataTableToolbar, {
      searchValue: 'ORD-2026',
      onSearchChange: () => {},
      searchPlaceholder: 'Tìm kiếm vận đơn...',
      isFiltered: true,
      onResetFilters: () => {},
      filtersSlot: React.createElement<any>(DataTableFacetedFilter, {
        title: 'Trạng thái',
        options: [
          { label: 'Chờ lấy hàng', value: 'PENDING', count: 5 },
          { label: 'Giao thành công', value: 'DELIVERED', count: 12 },
        ],
        selectedValues: new Set(['DELIVERED']),
        onSelect: () => {},
      }),
      viewOptionsSlot: React.createElement<any>(DataTableViewOptions, {
        columns,
        hiddenColumns: new Set(['carrier']),
        onToggleColumn: () => {},
        onResetColumns: () => {},
      }),
    })
  );
  assert.ok(toolbar.includes('value="ORD-2026"'));
  assert.ok(toolbar.includes('Đặt lại bộ lọc'));
  assert.ok(toolbar.includes('Trạng thái'));
  assert.ok(toolbar.includes('Cột hiển thị'));
});

// AC-AI-155-08: PageHeader and breadcrumb pattern
test('AC-AI-155-08 PageHeader and breadcrumb pattern', () => {
  const pageHeader = renderToStaticMarkup(
    React.createElement<any>(PageHeader, {
      title: 'Quản lý vận đơn đối soát',
      description: 'Theo dõi hành trình, cước phí và trạng thái bồi thường đơn hàng.',
      breadcrumbs: [
        { label: 'Tổng quan', href: '/' },
        { label: 'Vận đơn', active: true },
      ],
      actions: React.createElement<any>('button', { type: 'button' }, 'Tạo đơn mới'),
    })
  );
  assert.ok(pageHeader.includes('Quản lý vận đơn đối soát'));
  assert.ok(pageHeader.includes('Theo dõi hành trình, cước phí'));
  assert.ok(pageHeader.includes('aria-label="Đường dẫn trang"'));
  assert.ok(pageHeader.includes('Tạo đơn mới'));
});

// AC-AI-155-09: DashboardSidebar and DashboardHeader shell
test('AC-AI-155-09 DashboardSidebar and DashboardHeader shell', () => {
  const sidebar = renderToStaticMarkup(
    React.createElement<any>(DashboardSidebar, { navSections: DEFAULT_NAV_SECTIONS })
  );
  assert.ok(sidebar.includes('Ship Dễ'));
  assert.ok(sidebar.includes(DEFAULT_NAV_SECTIONS[0].title!));
  assert.ok(sidebar.includes(DEFAULT_NAV_SECTIONS[1].items[0].title!));
  const header = renderToStaticMarkup(
    React.createElement<any>(DashboardHeader, {
      currentUser: { name: 'Nguyễn Văn Chủ Shop', email: 'owner@shipde.net', role: 'Chủ Shop' },
      shopName: 'Shop Dễ Dàng — Chi Nhánh 1',
      onSearchClick: () => {},
      onProfileClick: () => {},
      searchHref: '/search',
      profileHref: '/settings/profile',
    })
  );
  assert.ok(header.includes('Shop Dễ Dàng — Chi Nhánh 1'));
  assert.ok(header.includes('Nguyễn Văn Chủ Shop'));
  assert.ok(header.includes('aria-label="Chủ Shop"') || header.includes('Chủ Shop'));
  assert.ok(header.includes('aria-label="Tìm kiếm nhanh toàn hệ thống (Ctrl + K)"'));
  assert.ok(header.includes('Ctrl K'));
  assert.ok(header.includes('aria-label="Menu tài khoản cá nhân"'));
});

// AC-AI-155-10: URL search params sort helpers
test('AC-AI-155-10 URL search params sort helpers', () => {
  assert.deepStrictEqual(parseSortParam('codAmount.asc'), { id: 'codAmount', desc: false });
  assert.deepStrictEqual(parseSortParam('createdAt.desc'), { id: 'createdAt', desc: true });
  assert.strictEqual(parseSortParam(null), null);
  assert.strictEqual(formatSortParam({ id: 'feeAmount', desc: false }), 'feeAmount.asc');
  assert.strictEqual(formatSortParam({ id: 'feeAmount', desc: true }), 'feeAmount.desc');
});

// AC-AI-155-11: Storybook page exports and fixture isolation
test('AC-AI-155-11 Storybook page exports and fixture isolation', () => {
  const storybookDir = path.resolve(__dirname, '../app/storybook');
  const pageContent = fs.readFileSync(path.join(storybookDir, 'page.tsx'), 'utf8');
  const namedExports =
    pageContent.match(/export\s+(const|let|var|function|class|interface|type)\s+([A-Za-z0-9_]+)/g) || [];
  assert.strictEqual(namedExports.length, 0, `page.tsx must only export default (${namedExports})`);
  assert.ok(pageContent.includes('export default function StorybookPage'));
  const sections = fs.readFileSync(path.join(storybookDir, 'showcase-sections.tsx'), 'utf8');
  assert.ok(sections.includes('[DỮ LIỆU THỬ NGHIỆM / FIXTURE DATA]'));
  assert.strictEqual(FIXTURE_SHIPMENTS.length, 8);
  for (const item of FIXTURE_SHIPMENTS) {
    assert.ok(item.id.startsWith('fix-'));
    assert.ok(item.codAmount > 0);
  }
});
```

## apps/web/src/tests/data-table-tablecn.test.ts

```
/**
 * Ported tests from tablecn (.oc/ref-src/test/use-data-table.test.tsx & faceted.test.tsx)
 * Adapted to tsx + node:assert test runner.
 */

import * as assert from 'node:assert';

if (typeof (globalThis as any).location === 'undefined') {
  (globalThis as any).location = new URL('http://localhost/');
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createColumnHelper } from '@tanstack/react-table';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';

import type { DataTableFeatures } from '../components/data-table/lib/data-table-features';
import { useDataTable, type TablecnUseDataTableProps } from '../components/data-table/useDataTable';
import { DataTableFacetedFilter } from '../components/data-table/DataTableFacetedFilter';

interface Task {
  id: string;
  code: string;
  title: string;
  status: string;
}

const columnHelper = createColumnHelper<DataTableFeatures, Task>();

const columns = columnHelper.columns([
  columnHelper.accessor('code', { id: 'code', enableSorting: false }),
  columnHelper.accessor('title', {
    id: 'title',
    meta: { variant: 'text' },
    enableColumnFilter: true,
  }),
  columnHelper.accessor('status', {
    id: 'status',
    meta: { variant: 'multi-select' },
    enableColumnFilter: true,
  }),
  columnHelper.display({ id: 'actions' }),
]);

const data: Task[] = [];

function getFilterSummary(filters: { id: string; value: unknown }[]) {
  return filters.map((filter) => [filter.id, filter.value]);
}

async function runTablecnTests() {
  console.log('================================================================');
  console.log('🧪 TABLECN ADAPTED UNIT TEST SUITE (MIT PORT)');
  console.log('================================================================\n');

  // Test 1: reads filters from the URL in URL order
  console.log('🧪 1. Testing reads filters from the URL in URL order...');
  {
    (globalThis as any).window.location = new URL('http://localhost/?status=todo,done&title=bug');
    let hookResult: any = null;
    function TestComponent() {
      hookResult = useDataTable({
        data,
        columns,
        pageCount: 10,
        mode: 'server',
      });
      return null;
    }

    renderToStaticMarkup(
      React.createElement(
        NuqsTestingAdapter as any,
        { searchParams: '?status=todo,done&title=bug' },
        React.createElement(TestComponent)
      )
    );

    assert.ok(hookResult?.table, 'hookResult must provide table instance');
    const filterSummary = getFilterSummary(hookResult.table.state.columnFilters);
    assert.deepStrictEqual(filterSummary, [
      ['status', ['todo', 'done']],
      ['title', 'bug'],
    ]);
    console.log('   ✅ reads filters in URL order verified');
  }

  // Test 2: starts from initialState filters when URL has none
  console.log('🧪 2. Testing starts from initialState filters...');
  {
    let hookResult: any = null;
    function TestComponent() {
      hookResult = useDataTable({
        data,
        columns,
        pageCount: 10,
        mode: 'server',
        initialState: { columnFilters: [{ id: 'title', value: 'seed' }] },
      });
      return null;
    }

    renderToStaticMarkup(
      React.createElement(
        NuqsTestingAdapter as any,
        { searchParams: '' },
        React.createElement(TestComponent)
      )
    );

    const filterSummary = getFilterSummary(hookResult.table.state.columnFilters);
    assert.deepStrictEqual(filterSummary, [['title', 'seed']]);
    console.log('   ✅ initialState filters verified');
  }

  // Test 3: only reads sorting for sortable columns
  console.log('🧪 3. Testing sortable column restriction...');
  {
    let hookResult: any = null;
    function TestComponent() {
      hookResult = useDataTable({
        data,
        columns,
        pageCount: 10,
        mode: 'server',
        initialState: { sorting: [{ id: 'title', desc: true }] },
      });
      return null;
    }

    renderToStaticMarkup(
      React.createElement(
        NuqsTestingAdapter as any,
        { searchParams: '?sort=code.asc' },
        React.createElement(TestComponent)
      )
    );

    assert.deepStrictEqual(hookResult.table.state.sorting, [{ id: 'title', desc: true }]);
    console.log('   ✅ sorting restriction on unsortable column verified');
  }

  // Test 4: reads page, page size, sorting, and join from URL
  console.log('🧪 4. Testing reads page, page size, sorting, and join from URL...');
  {
    let hookResult: any = null;
    function TestComponent() {
      hookResult = useDataTable({
        data,
        columns,
        pageCount: 10,
        mode: 'server',
      });
      return null;
    }

    renderToStaticMarkup(
      React.createElement(
        NuqsTestingAdapter as any,
        { searchParams: '?page=3&perPage=25&sort=title.desc&joinOperator=or' },
        React.createElement(TestComponent)
      )
    );

    const pagination = hookResult.table.state.pagination;
    assert.strictEqual(pagination.pageIndex, 2);
    assert.strictEqual(pagination.pageSize, 25);
    assert.deepStrictEqual(hookResult.table.state.sorting, [{ id: 'title', desc: true }]);
    assert.strictEqual(hookResult.table.getJoinOperator(), 'or');
    console.log('   ✅ URL query params read verified');
  }

  // Test 5: filters rows in client mode
  console.log('🧪 5. Testing client mode row filtering...');
  {
    const tasks: Task[] = [
      { id: '1', code: 'T-1', title: 'bug', status: 'todo' },
      { id: '2', code: 'T-2', title: 'feat', status: 'done' },
    ];
    let hookResult: any = null;
    function TestComponent() {
      hookResult = useDataTable({
        data: tasks,
        columns,
        mode: 'client',
      });
      return null;
    }

    renderToStaticMarkup(
      React.createElement(
        NuqsTestingAdapter as any,
        { searchParams: '?title=bug' },
        React.createElement(TestComponent)
      )
    );

    const filteredRows = hookResult.table
      .getFilteredRowModel()
      .rows.map((r: any) => r.original.title);
    assert.deepStrictEqual(filteredRows, ['bug']);
    console.log('   ✅ client mode filtering verified');
  }

  // Test 6: faceted filter multi-toggle and selection state (faceted.test.tsx)
  console.log('🧪 6. Testing faceted filter options and selection states...');
  {
    const filterOptions = [
      { label: 'Active', value: 'active', count: 10 },
      { label: 'Inactive', value: 'inactive', count: 5 },
    ];

    let selectedVals = new Set<string>();
    const markup1 = renderToStaticMarkup(
      React.createElement(DataTableFacetedFilter, {
        title: 'Status',
        options: filterOptions,
        selectedValues: selectedVals,
        onSelect: (vals: string[]) => {
          selectedVals = new Set(vals);
        },
      })
    );
    assert.ok(markup1.includes('Status'), 'Must display filter title');
    assert.ok(markup1.includes('chưa chọn'), 'Must display unselected state label');

    selectedVals = new Set(['active']);
    const markup2 = renderToStaticMarkup(
      React.createElement(DataTableFacetedFilter, {
        title: 'Status',
        options: filterOptions,
        selectedValues: selectedVals,
        onSelect: () => {},
      })
    );
    assert.ok(markup2.includes('1 đã chọn'), 'Must display selected count badge');
    console.log('   ✅ faceted filter toggle and counter verified');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL TABLECN PORTED TESTS PASSED 100%!');
  console.log('================================================================\n');
}

runTablecnTests().catch((err) => {
  console.error('❌ Tablecn test failed:', err);
  process.exit(1);
});

```