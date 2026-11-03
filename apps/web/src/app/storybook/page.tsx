/**
 * Storybook / Component Showcase test preview page.
 *
 * Demonstrates:
 * - Server-driven DataTable with normal loaded, skeleton loading, empty, and error states
 * - Responsive DashboardLayout shell with collapsible desktop sidebar and mobile overlay
 * - Complete URL search params synchronization (pagination, sorting, search, faceted filters)
 * - Vietnamese localization and WCAG AA accessibility compliance
 * - Strict fixture isolation with [FIXTURE DATA] notice and fix- IDs (BR-UI-05)
 */

'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { Download, Plus, RefreshCw, Sparkles } from 'lucide-react';
import {
  DataTable,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTablePagination,
  DataTableToolbar,
  DataTableViewOptions,
  ColumnDef,
  useDataTable,
} from '../../components/data-table';
import { DashboardLayout, PageHeader } from '../../components/dashboard';
import {
  FIXTURE_SHIPMENTS,
  STATUS_OPTIONS,
  CARRIER_OPTIONS,
  SHOWCASE_NAV_SECTIONS,
  SHOWCASE_USER,
  FixtureShipment,
} from './fixtures';

function StorybookContent() {
  // State simulation for interactive showcase verification
  const [simulatedLoading, setSimulatedLoading] = useState(false);
  const [simulatedEmpty, setSimulatedEmpty] = useState(false);
  const [simulatedError, setSimulatedError] = useState(false);
  const [simulatedForbidden, setSimulatedForbidden] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Fixture shipments state allowing interactive test creations
  const [fixtureShipmentsList, setFixtureShipmentsList] =
    useState<FixtureShipment[]>(FIXTURE_SHIPMENTS);

  // Row selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Hidden columns state for column visibility toggle
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => new Set());

  // URL state synchronization via useDataTable hook
  const {
    pageIndex,
    pageSize,
    sort,
    searchValue,
    setSearch,
    filters,
    setFilter,
    resetFilters,
    setPagination,
    setSort,
    isFiltered,
    historyEpoch,
    resetEpoch,
  } = useDataTable({
    defaultPageSize: 10,
    defaultSort: { id: 'createdAt', desc: true },
    filterableColumns: [
      { id: 'status', title: 'Trạng thái', options: STATUS_OPTIONS },
      { id: 'carrier', title: 'Hãng vận chuyển', options: CARRIER_OPTIONS },
    ],
    searchableColumns: [{ id: 'search', title: 'Tìm kiếm' }],
  });

  const selectedStatus = useMemo(() => filters['status'] || [], [filters]);
  const selectedCarriers = useMemo(() => filters['carrier'] || [], [filters]);

  // Filter & Sort Logic driven by URL search params
  const filteredData = useMemo(() => {
    if (simulatedEmpty) return [];

    let list = [...fixtureShipmentsList];

    // Search filter
    if (searchValue.trim()) {
      const q = searchValue.trim().toLowerCase();
      list = list.filter(
        (item) =>
          item.trackingCode.toLowerCase().includes(q) ||
          item.orderNumber.toLowerCase().includes(q) ||
          item.recipientName.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (selectedStatus.length > 0) {
      list = list.filter((item) => selectedStatus.includes(item.status));
    }

    // Carrier filter
    if (selectedCarriers.length > 0) {
      list = list.filter((item) => selectedCarriers.includes(item.carrier));
    }

    // Sorting
    const sortCol = sort?.id || 'createdAt';
    const sortDesc = sort ? sort.desc : true;

    list.sort((a, b) => {
      const valA: any = (a as any)[sortCol];
      const valB: any = (b as any)[sortCol];

      if (typeof valA === 'string') {
        return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
      }
      return sortDesc ? valB - valA : valA - valB;
    });

    return list;
  }, [simulatedEmpty, fixtureShipmentsList, searchValue, selectedStatus, selectedCarriers, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredData.length / pageSize));

  // Clamp out-of-range deep links against available count (Finding 12 P2)
  useEffect(() => {
    if (pageIndex > pageCount && pageCount > 0) {
      setPagination(pageCount);
    }
  }, [pageIndex, pageCount, setPagination]);

  const safePageIndex = Math.max(1, Math.min(pageIndex, pageCount));

  // Pagination slice
  const paginatedData = useMemo(() => {
    const start = (safePageIndex - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, safePageIndex, pageSize]);

  // Column definitions with Vietnamese localized title (Finding 12 P2 / BR-UI-04)
  const columns: ColumnDef<FixtureShipment>[] = useMemo(
    () => [
      {
        id: 'trackingCode',
        title: 'Mã vận đơn',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Mã vận đơn"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono font-bold text-[var(--primary)]">{row.trackingCode}</span>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              {row.orderNumber}
            </span>
          </div>
        ),
      },
      {
        id: 'carrier',
        title: 'Hãng vận chuyển',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Hãng vận chuyển"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => {
          let badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
          if (row.carrier === 'GHTK') {
            badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
          } else if (row.carrier === 'VTP') {
            badgeColor = 'bg-red-50 text-red-700 border-red-200';
          }

          return (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-[4px] text-[11px] font-bold border ${badgeColor}`}
            >
              {row.carrier}
            </span>
          );
        },
      },
      {
        id: 'recipientName',
        title: 'Người nhận & SĐT',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Người nhận"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-[var(--text-primary)]">{row.recipientName}</span>
            <span className="text-[11px] text-[var(--text-dim)] font-mono">
              {row.recipientPhone}
            </span>
          </div>
        ),
      },
      {
        id: 'codAmount',
        title: 'Thu hộ COD',
        align: 'right',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Thu hộ COD"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums font-mono font-medium text-[var(--text-primary)]">
            {row.codAmount.toLocaleString('vi-VN')} đ
          </span>
        ),
      },
      {
        id: 'feeAmount',
        title: 'Cước vận chuyển',
        align: 'right',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Cước phí"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums font-mono text-[var(--text-secondary)]">
            {row.feeAmount.toLocaleString('vi-VN')} đ
          </span>
        ),
      },
      {
        id: 'status',
        title: 'Trạng thái giao hàng',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Trạng thái"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => {
          const statusMap: Record<string, { label: string; class: string }> = {
            PENDING: {
              label: 'Chờ lấy hàng',
              class: 'bg-amber-50 text-amber-700 border-amber-200',
            },
            IN_TRANSIT: {
              label: 'Đang giao',
              class: 'bg-blue-50 text-blue-700 border-blue-200',
            },
            DELIVERED: {
              label: 'Đã giao hàng',
              class: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            },
            FAILED: {
              label: 'Giao thất bại',
              class: 'bg-rose-50 text-rose-700 border-rose-200',
            },
            CLAIM_PENDING: {
              label: 'Chờ bồi thường',
              class: 'bg-purple-50 text-purple-700 border-purple-200',
            },
          };
          const info = statusMap[row.status] || {
            label: row.status,
            class: 'bg-gray-50 text-gray-700 border-gray-200',
          };

          return (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${info.class}`}
            >
              {info.label}
            </span>
          );
        },
      },
      {
        id: 'createdAt',
        title: 'Ngày tạo',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Ngày tạo"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums font-mono text-[11px] text-[var(--text-muted)]">
            {row.createdAt}
          </span>
        ),
      },
    ],
    [sort, setSort]
  );

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select-all verifies current page membership instead of raw counts (Finding 10 P2)
  const isAllCurrentPageSelected =
    paginatedData.length > 0 && paginatedData.every((item) => selectedIds.has(item.id));

  const handleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isAllCurrentPageSelected) {
        paginatedData.forEach((item) => next.delete(item.id));
      } else {
        paginatedData.forEach((item) => next.add(item.id));
      }
      return next;
    });
  };

  // Explicit fixture interactions for primary buttons (Finding 4 P2)
  const handleExportExcel = () => {
    const csvRows = [
      'Mã vận đơn,Mã đơn hàng,Người nhận,Số điện thoại,Hãng,Thu hộ COD,Cước phí,Trạng thái,Ngày tạo',
      ...filteredData.map(
        (item) =>
          `"${item.trackingCode}","${item.orderNumber}","${item.recipientName}","${item.recipientPhone}","${item.carrier}",${item.codAmount},${item.feeAmount},"${item.status}","${item.createdAt}"`
      ),
    ];
    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csvRows.join('\n'));
    if (typeof document !== 'undefined') {
      const link = document.createElement('a');
      link.setAttribute('href', csvContent);
      link.setAttribute('download', 'fixture_shipments.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setActionFeedback(
      `[FIXTURE] Đã xuất thành công ${filteredData.length} bản ghi sang file fixture_shipments.csv`
    );
  };

  const handleCreateDemoShipment = () => {
    const nextIdx = fixtureShipmentsList.length + 1;
    const newOrder: FixtureShipment = {
      id: `fix-ship-${String(nextIdx).padStart(3, '0')}`,
      trackingCode: `VN${Math.floor(100000000 + Math.random() * 900000000)}`,
      orderNumber: `ORD-DEMO-${Date.now().toString().slice(-4)}`,
      recipientName: 'Khách Thử Nghiệm',
      recipientPhone: '0987***999',
      carrier: 'GHN',
      codAmount: 250000,
      feeAmount: 22000,
      weightGrams: 500,
      status: 'PENDING',
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setFixtureShipmentsList((prev) => [newOrder, ...prev]);
    setActionFeedback(
      `[FIXTURE] Đã tạo đơn thử nghiệm mới: ${newOrder.trackingCode} (${newOrder.orderNumber})`
    );
  };

  return (
    <DashboardLayout
      shopName="Kho Tổng Ship Dễ — Hà Nội"
      currentUser={SHOWCASE_USER}
      navSections={SHOWCASE_NAV_SECTIONS}
      searchHref="/search"
      profileHref="/settings/profile"
    >
      {/* Fixture Notice Banner (BR-UI-05) */}
      <div className="p-3.5 rounded-[8px] bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-3">
        <Sparkles className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
        <div className="leading-relaxed">
          <strong className="font-semibold">[DỮ LIỆU THỬ NGHIỆM / FIXTURE DATA]</strong>: Toàn bộ
          danh sách vận đơn, khách hàng, số điện thoại và cước phí trên trang Storybook này là
          fixture mẫu phục vụ kiểm thử và xác thực linh kiện UI, không liên kết API trực tiếp hay
          gọi dữ liệu thật.
        </div>
      </div>

      {/* Action Feedback Notice */}
      {actionFeedback && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 rounded-[8px] bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2"
        >
          <span>{actionFeedback}</span>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            title="Đóng thông báo"
            className="text-emerald-700 hover:text-emerald-900 p-0.5 cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Thư viện linh kiện (Storybook / Component Showcase)"
        description="Mẫu kiểm thử tương tác và xác thực các linh kiện Data Table và Dashboard Shell với dữ liệu mẫu (Fixtures)."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              title="Xuất file Excel dữ liệu mẫu (Fixture demo)"
              className="btn-secondary !text-xs !min-h-[34px] !py-1.5 !px-3 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Xuất Excel
            </button>
            <button
              type="button"
              onClick={handleCreateDemoShipment}
              title="Tạo đơn thử nghiệm mẫu (Fixture demo)"
              className="btn-primary !text-xs !min-h-[34px] !py-1.5 !px-3 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Tạo đơn thử nghiệm
            </button>
          </div>
        }
      />

      {/* Interactive State Simulator Bar */}
      <div className="p-4 rounded-[10px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Mô phỏng các trạng thái giao diện (UI State Simulation)</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSimulatedLoading(false);
              setSimulatedError(false);
              setSimulatedEmpty(false);
              setSimulatedForbidden(false);
            }}
            className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors ${
              !simulatedLoading && !simulatedError && !simulatedEmpty && !simulatedForbidden
                ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                : 'bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            Trạng thái bình thường ({filteredData.length} dòng)
          </button>

          <button
            type="button"
            onClick={() => setSimulatedLoading((prev) => !prev)}
            className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors ${
              simulatedLoading
                ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                : 'bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            {simulatedLoading ? 'Đang bật Skeleton (Nhấn để tắt)' : 'Mô phỏng Loading Skeleton'}
          </button>

          <button
            type="button"
            onClick={() => setSimulatedEmpty((prev) => !prev)}
            className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors ${
              simulatedEmpty
                ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                : 'bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            {simulatedEmpty ? 'Đang bật Empty (Nhấn để tắt)' : 'Mô phỏng Trạng thái Trống (Empty)'}
          </button>

          <button
            type="button"
            onClick={() => setSimulatedError((prev) => !prev)}
            className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors ${
              simulatedError
                ? 'bg-[var(--status-risk-text)] text-white border-[var(--status-risk-border)]'
                : 'bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            {simulatedError
              ? 'Đang bật Error (Nhấn để tắt)'
              : 'Mô phỏng Trạng thái Lỗi (Error 500)'}
          </button>

          <button
            type="button"
            onClick={() => setSimulatedForbidden((prev) => !prev)}
            className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors ${
              simulatedForbidden
                ? 'bg-[var(--status-risk-text)] text-white border-[var(--status-risk-border)]'
                : 'bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            {simulatedForbidden ? 'Đang bật Cấm (Nhấn để tắt)' : 'Mô phỏng Bị cấm (Forbidden 403)'}
          </button>

          <Link
            href="/storybook?search=N"
            className="px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]"
          >
            Mô phỏng điều hướng ngoài: search=N
          </Link>
        </div>
      </div>

      {/* Main Data Table */}
      <DataTable
        data={paginatedData}
        columns={columns}
        sort={sort}
        keyExtractor={(item) => item.id}
        loading={simulatedLoading}
        error={
          simulatedError
            ? 'Lỗi 500: Kết nối cổng đối soát GHN/GHTK bị gián đoạn. Không thể truy xuất bảng kê cước.'
            : null
        }
        onRetry={() => setSimulatedError(false)}
        forbidden={
          simulatedForbidden
            ? 'Lỗi 403: Bạn không có quyền xem hoặc thao tác trên danh sách vận đơn này. Vui lòng liên hệ quản trị viên để được cấp quyền.'
            : null
        }
        forbiddenActionLabel="Thử lại"
        onForbiddenAction={() => setSimulatedForbidden(false)}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onSelectAll={handleSelectAll}
        visibleColumns={hiddenColumns}
        emptyTitle="Không tìm thấy vận đơn nào phù hợp"
        emptyDescription="Hãy kiểm tra lại từ khóa tìm kiếm hoặc các tiêu chí bộ lọc trạng thái và hãng vận chuyển."
        emptyActionLabel="Đặt lại bộ lọc"
        onEmptyAction={resetFilters}
        toolbar={
          <DataTableToolbar
            searchValue={searchValue}
            onSearchChange={(val) => setSearch(val)}
            searchPlaceholder="Tìm theo mã vận đơn, mã đơn, khách hàng..."
            isFiltered={isFiltered}
            onResetFilters={resetFilters}
            historyEpoch={historyEpoch}
            resetEpoch={resetEpoch}
            filtersSlot={
              <>
                <DataTableFacetedFilter
                  title="Trạng thái"
                  options={STATUS_OPTIONS}
                  selectedValues={new Set(selectedStatus)}
                  onSelect={(vals) => setFilter('status', vals)}
                  historyEpoch={historyEpoch}
                  resetEpoch={resetEpoch}
                />
                <DataTableFacetedFilter
                  title="Hãng vận chuyển"
                  options={CARRIER_OPTIONS}
                  selectedValues={new Set(selectedCarriers)}
                  onSelect={(vals) => setFilter('carrier', vals)}
                  historyEpoch={historyEpoch}
                  resetEpoch={resetEpoch}
                />
              </>
            }
            viewOptionsSlot={
              <DataTableViewOptions
                columns={columns}
                hiddenColumns={hiddenColumns}
                onToggleColumn={(id) => {
                  setHiddenColumns((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) {
                      next.delete(id);
                    } else {
                      next.add(id);
                    }
                    return next;
                  });
                }}
                onResetColumns={() => setHiddenColumns(new Set())}
              />
            }
          />
        }
        pagination={
          <DataTablePagination
            pageIndex={safePageIndex}
            pageSize={pageSize}
            pageCount={pageCount}
            totalCount={filteredData.length}
            pageSizeOptions={[5, 10, 20]}
            onPageChange={(p) => setPagination(p)}
            onPageSizeChange={(s) => setPagination(1, s)}
            selectedCount={selectedIds.size}
          />
        }
      />
    </DashboardLayout>
  );
}

export default function StorybookPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-8 text-xs text-[var(--text-muted)]">
          Đang khởi tạo linh kiện...
        </div>
      }
    >
      <StorybookContent />
    </Suspense>
  );
}
