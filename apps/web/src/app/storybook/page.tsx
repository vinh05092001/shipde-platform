/**
 * Storybook / Showcase Test Page for Reusable Data Table & Dashboard Shell.
 *
 * Demonstrates:
 * - DashboardLayout with DashboardSidebar & DashboardHeader
 * - PageHeader with breadcrumbs and action buttons
 * - Server-driven DataTable with URL search params (sort, filter, faceted filter, pagination)
 * - Interactive state toggles: Loading, Empty, Error, and Normal
 * - Keyboard accessibility and Vietnamese labels
 *
 * NOTE: All data on this page is mock fixture data for demonstration and testing.
 * Complies with BR-UI-01 (URL State Sync), BR-UI-02 (State Completeness),
 * BR-UI-03 (Accessibility), BR-UI-04 (Vietnamese), and BR-UI-05 (Fixture Isolation).
 */

'use client';

import React, { useState, useMemo, Suspense } from 'react';
import {
  DataTable,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTablePagination,
  DataTableToolbar,
  DataTableViewOptions,
  ColumnDef,
  useDataTable,
} from '@/components/data-table';
import { DashboardLayout, PageHeader } from '@/components/dashboard';
import { Download, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { FIXTURE_SHIPMENTS, FixtureShipment, STATUS_OPTIONS, CARRIER_OPTIONS } from './fixtures';

function StorybookContent() {
  // State simulation toggles (isolated to simulator bar)
  const [simulatedLoading, setSimulatedLoading] = useState(false);
  const [simulatedError, setSimulatedError] = useState(false);
  const [simulatedEmpty, setSimulatedEmpty] = useState(false);

  // Local column visibility & selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  // Server-driven URL synchronization via useDataTable (BR-UI-01)
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

    let list = [...FIXTURE_SHIPMENTS];

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
  }, [simulatedEmpty, searchValue, selectedStatus, selectedCarriers, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredData.length / pageSize));

  // Pagination slice
  const paginatedData = useMemo(() => {
    const start = (pageIndex - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, pageIndex, pageSize]);

  // Column definitions
  const columns: ColumnDef<FixtureShipment>[] = useMemo(
    () => [
      {
        id: 'trackingCode',
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
        header: 'Hãng vận chuyển',
        cell: ({ row }) => {
          let badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
          if (row.carrier === 'GHN') badgeColor = 'bg-orange-50 text-orange-700 border-orange-200';
          if (row.carrier === 'GHTK')
            badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';

          return (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-[4px] text-[11px] font-semibold border ${badgeColor}`}
            >
              {row.carrier}
            </span>
          );
        },
      },
      {
        id: 'recipientName',
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
        id: 'status',
        header: 'Trạng thái',
        cell: ({ row }) => {
          switch (row.status) {
            case 'DELIVERED':
              return <span className="badge-ok">Giao thành công</span>;
            case 'IN_TRANSIT':
              return <span className="badge-info">Đang giao hàng</span>;
            case 'PENDING':
              return <span className="badge-warn">Chờ lấy hàng</span>;
            case 'FAILED':
              return <span className="badge-risk">Giao thất bại</span>;
            case 'CLAIM_PENDING':
              return <span className="badge-risk">Chờ bồi thường</span>;
            default:
              return null;
          }
        },
      },
      {
        id: 'codAmount',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Thu hộ COD"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        align: 'right',
        cell: ({ row }) => (
          <span className="tabular-nums font-mono font-semibold text-[var(--text-primary)]">
            {row.codAmount.toLocaleString('vi-VN')} đ
          </span>
        ),
      },
      {
        id: 'feeAmount',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Cước phí"
            sort={sort}
            onSort={(id, desc) => setSort(id, desc)}
            onHide={(id) => setHiddenColumns((prev) => new Set(prev).add(id))}
          />
        ),
        align: 'right',
        cell: ({ row }) => (
          <span className="tabular-nums font-mono text-[var(--text-secondary)]">
            {row.feeAmount.toLocaleString('vi-VN')} đ
          </span>
        ),
      },
      {
        id: 'createdAt',
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

  const handleSelectAll = () => {
    if (selectedIds.size === paginatedData.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedData.map((d) => d.id)));
    }
  };

  return (
    <DashboardLayout
      shopName="Kho Tổng Ship Dễ — Hà Nội"
      currentUser={{
        name: 'Trần Quản Trị',
        email: 'admin@shipde.net',
        role: 'Chủ Shop / Quản trị viên',
      }}
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

      {/* Page Header */}
      <PageHeader
        title="Thư viện linh kiện (Storybook / Component Showcase)"
        description="Mẫu kiểm thử tương tác và xác thực các linh kiện Data Table và Dashboard Shell với dữ liệu mẫu (Fixtures)."
        breadcrumbs={[
          { label: 'Hệ thống', href: '/settings' },
          { label: 'Linh kiện mẫu', active: true },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary !text-xs !min-h-[34px] !py-1.5 !px-3">
              <Download className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Xuất Excel
            </button>
            <button type="button" className="btn-primary !text-xs !min-h-[34px] !py-1.5 !px-3">
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
            }}
            className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors ${
              !simulatedLoading && !simulatedError && !simulatedEmpty
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
            filtersSlot={
              <>
                <DataTableFacetedFilter
                  title="Trạng thái"
                  options={STATUS_OPTIONS}
                  selectedValues={new Set(selectedStatus)}
                  onSelect={(vals) => setFilter('status', vals)}
                />
                <DataTableFacetedFilter
                  title="Hãng vận chuyển"
                  options={CARRIER_OPTIONS}
                  selectedValues={new Set(selectedCarriers)}
                  onSelect={(vals) => setFilter('carrier', vals)}
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
            pageIndex={pageIndex}
            pageSize={pageSize}
            pageCount={pageCount}
            totalCount={filteredData.length}
            pageSizeOptions={[5, 10, 20]}
            onPageChange={(p) => setPagination(p, pageSize)}
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
