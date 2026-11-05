/**
 * TASK-AI-155 acceptance tests for the reusable server-driven data table (Slice A).
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
import { FIXTURE_SHIPMENTS, FixtureShipment } from './fixtures/data-table-shipments';

const columns: ColumnDef<FixtureShipment>[] = [
  {
    id: 'trackingCode',
    header: 'Mã vận đơn',
    cell: ({ row }) =>
      React.createElement<any>('span', { className: 'font-mono' }, row.trackingCode),
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
    sortHtml({ id: 'trackingCode', desc: false }).includes(
      'Sắp xếp theo Mã vận đơn: hiện tại tăng dần'
    )
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

// AC-AI-155-10: URL search params sort helpers
test('AC-AI-155-10 URL search params sort helpers', () => {
  assert.deepStrictEqual(parseSortParam('codAmount.asc'), { id: 'codAmount', desc: false });
  assert.deepStrictEqual(parseSortParam('createdAt.desc'), { id: 'createdAt', desc: true });
  assert.strictEqual(parseSortParam(null), null);
  assert.strictEqual(formatSortParam({ id: 'feeAmount', desc: false }), 'feeAmount.asc');
  assert.strictEqual(formatSortParam({ id: 'feeAmount', desc: true }), 'feeAmount.desc');
});
