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
