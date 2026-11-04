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

import { useState, Suspense } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import {
  DataTable,
  DataTableFacetedFilter,
  DataTablePagination,
  DataTableToolbar,
  DataTableViewOptions,
  useDataTable,
} from '../../components/data-table';
import { useShowcaseColumns } from './showcase-columns';
import { createShowcaseActions, useShowcaseRows, useShowcaseSelection } from './use-showcase-data';
import { ShowcaseBanners, ShowcaseHeaderActions, StateSimulator } from './showcase-sections';
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
  } = useDataTable({
    defaultPageSize: 10,
    defaultSort: { id: 'createdAt', desc: true },
    filterableColumns: [
      { id: 'status', title: 'Trạng thái', options: STATUS_OPTIONS },
      { id: 'carrier', title: 'Hãng vận chuyển', options: CARRIER_OPTIONS },
    ],
    searchableColumns: [{ id: 'search', title: 'Tìm kiếm' }],
  });

  const {
    selectedStatus,
    selectedCarriers,
    filteredData,
    pageCount,
    safePageIndex,
    paginatedData,
  } = useShowcaseRows({
    filters,
    simulatedEmpty,
    fixtureShipmentsList,
    searchValue,
    sort,
    pageSize,
    pageIndex,
    setPagination,
  });

  const columns = useShowcaseColumns({ sort, setSort, setHiddenColumns });

  const { selectedIds, handleToggleSelect, handleSelectAll } = useShowcaseSelection(paginatedData);

  const { handleExportExcel, handleCreateDemoShipment } = createShowcaseActions({
    filteredData,
    fixtureShipmentsList,
    setFixtureShipmentsList,
    setActionFeedback,
  });

  return (
    <DashboardLayout
      shopName="Kho Tổng Ship Dễ — Hà Nội"
      currentUser={SHOWCASE_USER}
      navSections={SHOWCASE_NAV_SECTIONS}
      searchHref="/search"
      profileHref="/settings/profile"
    >
      <ShowcaseBanners
        actionFeedback={actionFeedback}
        onDismissFeedback={() => setActionFeedback(null)}
      />

      {/* Page Header */}
      <PageHeader
        title="Thư viện linh kiện (Storybook / Component Showcase)"
        description="Mẫu kiểm thử tương tác và xác thực các linh kiện Data Table và Dashboard Shell với dữ liệu mẫu (Fixtures)."
        actions={
          <ShowcaseHeaderActions onExport={handleExportExcel} onCreate={handleCreateDemoShipment} />
        }
      />

      <StateSimulator
        loading={simulatedLoading}
        empty={simulatedEmpty}
        error={simulatedError}
        forbidden={simulatedForbidden}
        rowCount={filteredData.length}
        onResetNormal={() => {
          setSimulatedLoading(false);
          setSimulatedError(false);
          setSimulatedEmpty(false);
          setSimulatedForbidden(false);
        }}
        onToggleLoading={setSimulatedLoading}
        onToggleEmpty={setSimulatedEmpty}
        onToggleError={setSimulatedError}
        onToggleForbidden={setSimulatedForbidden}
      />

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
    <NuqsAdapter>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center p-8 text-xs text-[var(--text-muted)]">
            Đang khởi tạo linh kiện...
          </div>
        }
      >
        <StorybookContent />
      </Suspense>
    </NuqsAdapter>
  );
}
