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
  DataTableFilterOption,
} from '@/components/data-table';
import { DashboardLayout, PageHeader } from '@/components/dashboard';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Package,
  Plus,
  RefreshCw,
  Sparkles,
  Truck,
  XCircle,
} from 'lucide-react';

// ============================================================================
// FIXTURE DATA (Dữ liệu mẫu thử nghiệm)
// ============================================================================
export interface FixtureShipment {
  id: string;
  trackingCode: string;
  orderNumber: string;
  recipientName: string;
  recipientPhone: string;
  carrier: 'GHN' | 'GHTK' | 'VTP';
  status: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED' | 'CLAIM_PENDING';
  codAmount: number;
  feeAmount: number;
  weightGrams: number;
  createdAt: string;
}

export const FIXTURE_SHIPMENTS: FixtureShipment[] = [
  {
    id: 'fix-ord-001',
    trackingCode: 'GHN982341201VN',
    orderNumber: 'ORD-20261031-01',
    recipientName: 'Nguyễn Văn An',
    recipientPhone: '0901***123',
    carrier: 'GHN',
    status: 'DELIVERED',
    codAmount: 350000,
    feeAmount: 22000,
    weightGrams: 500,
    createdAt: '2026-10-31 08:30:00',
  },
  {
    id: 'fix-ord-002',
    trackingCode: 'GHTK74219082VN',
    orderNumber: 'ORD-20261031-02',
    recipientName: 'Trần Thị Mai',
    recipientPhone: '0912***456',
    carrier: 'GHTK',
    status: 'IN_TRANSIT',
    codAmount: 520000,
    feeAmount: 32000,
    weightGrams: 1200,
    createdAt: '2026-10-31 09:15:00',
  },
  {
    id: 'fix-ord-003',
    trackingCode: 'VTP391204851VN',
    orderNumber: 'ORD-20261031-03',
    recipientName: 'Lê Hoàng Nam',
    recipientPhone: '0983***789',
    carrier: 'VTP',
    status: 'PENDING',
    codAmount: 180000,
    feeAmount: 18000,
    weightGrams: 300,
    createdAt: '2026-10-31 10:00:00',
  },
  {
    id: 'fix-ord-004',
    trackingCode: 'GHN512938472VN',
    orderNumber: 'ORD-20261031-04',
    recipientName: 'Phạm Minh Đức',
    recipientPhone: '0934***321',
    carrier: 'GHN',
    status: 'FAILED',
    codAmount: 490000,
    feeAmount: 25000,
    weightGrams: 800,
    createdAt: '2026-10-30 14:20:00',
  },
  {
    id: 'fix-ord-005',
    trackingCode: 'GHTK12948293VN',
    orderNumber: 'ORD-20261031-05',
    recipientName: 'Hoàng Bích Thủy',
    recipientPhone: '0977***654',
    carrier: 'GHTK',
    status: 'CLAIM_PENDING',
    codAmount: 890000,
    feeAmount: 45000,
    weightGrams: 2100,
    createdAt: '2026-10-30 16:45:00',
  },
  {
    id: 'fix-ord-006',
    trackingCode: 'GHN672391024VN',
    orderNumber: 'ORD-20261031-06',
    recipientName: 'Đặng Quốc Huy',
    recipientPhone: '0909***999',
    carrier: 'GHN',
    status: 'DELIVERED',
    codAmount: 240000,
    feeAmount: 20000,
    weightGrams: 400,
    createdAt: '2026-10-30 17:10:00',
  },
  {
    id: 'fix-ord-007',
    trackingCode: 'VTP839102948VN',
    orderNumber: 'ORD-20261031-07',
    recipientName: 'Vũ Thanh Hằng',
    recipientPhone: '0945***888',
    carrier: 'VTP',
    status: 'IN_TRANSIT',
    codAmount: 670000,
    feeAmount: 28000,
    weightGrams: 1000,
    createdAt: '2026-10-29 11:30:00',
  },
  {
    id: 'fix-ord-008',
    trackingCode: 'GHTK90283741VN',
    orderNumber: 'ORD-20261031-08',
    recipientName: 'Bùi Anh Tuấn',
    recipientPhone: '0966***777',
    carrier: 'GHTK',
    status: 'DELIVERED',
    codAmount: 410000,
    feeAmount: 24000,
    weightGrams: 600,
    createdAt: '2026-10-29 15:00:00',
  },
];

const STATUS_OPTIONS: DataTableFilterOption[] = [
  { label: 'Chờ lấy hàng', value: 'PENDING', icon: Clock, count: 1 },
  { label: 'Đang giao', value: 'IN_TRANSIT', icon: Truck, count: 2 },
  { label: 'Giao thành công', value: 'DELIVERED', icon: CheckCircle2, count: 3 },
  { label: 'Giao thất bại', value: 'FAILED', icon: XCircle, count: 1 },
  { label: 'Chờ bồi thường', value: 'CLAIM_PENDING', icon: AlertCircle, count: 1 },
];

const CARRIER_OPTIONS: DataTableFilterOption[] = [
  { label: 'Giao Hàng Nhanh (GHN)', value: 'GHN', count: 3 },
  { label: 'Giao Hàng Tiết Kiệm (GHTK)', value: 'GHTK', count: 3 },
  { label: 'Viettel Post (VTP)', value: 'VTP', count: 2 },
];

function StorybookContent() {
  // State simulation toggles
  const [simulatedLoading, setSimulatedLoading] = useState(false);
  const [simulatedError, setSimulatedError] = useState(false);
  const [simulatedEmpty, setSimulatedEmpty] = useState(false);

  // Table state
  const [searchValue, setSearchValue] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string[]>([]);
  const [selectedCarriers, setSelectedCarriers] = useState<string[]>([]);
  const [sortColumn, setSortColumn] = useState<string>('createdAt');
  const [sortDesc, setSortDesc] = useState<boolean>(true);
  const [pageIndex, setPageIndex] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  // Filter & Sort Logic
  const filteredData = useMemo(() => {
    if (simulatedEmpty) return [];

    let list = [...FIXTURE_SHIPMENTS];

    // Search filter
    if (searchValue.trim()) {
      const q = searchValue.toLowerCase();
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
    list.sort((a, b) => {
      let valA: any = (a as any)[sortColumn];
      let valB: any = (b as any)[sortColumn];

      if (typeof valA === 'string') {
        return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
      }
      return sortDesc ? valB - valA : valA - valB;
    });

    return list;
  }, [simulatedEmpty, searchValue, selectedStatus, selectedCarriers, sortColumn, sortDesc]);

  // Pagination slice
  const paginatedData = useMemo(() => {
    const start = (pageIndex - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, pageIndex, pageSize]);

  const pageCount = Math.ceil(filteredData.length / pageSize);

  // Column definitions
  const columns: ColumnDef<FixtureShipment>[] = useMemo(
    () => [
      {
        id: 'trackingCode',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Mã vận đơn"
            sort={sortColumn === 'trackingCode' ? { id: 'trackingCode', desc: sortDesc } : null}
            onSort={(id, desc) => {
              setSortColumn(id);
              setSortDesc(desc !== undefined ? desc : !sortDesc);
            }}
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
            sort={sortColumn === 'recipientName' ? { id: 'recipientName', desc: sortDesc } : null}
            onSort={(id, desc) => {
              setSortColumn(id);
              setSortDesc(desc !== undefined ? desc : !sortDesc);
            }}
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
            sort={sortColumn === 'codAmount' ? { id: 'codAmount', desc: sortDesc } : null}
            onSort={(id, desc) => {
              setSortColumn(id);
              setSortDesc(desc !== undefined ? desc : !sortDesc);
            }}
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
            sort={sortColumn === 'feeAmount' ? { id: 'feeAmount', desc: sortDesc } : null}
            onSort={(id, desc) => {
              setSortColumn(id);
              setSortDesc(desc !== undefined ? desc : !sortDesc);
            }}
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
            sort={sortColumn === 'createdAt' ? { id: 'createdAt', desc: sortDesc } : null}
            onSort={(id, desc) => {
              setSortColumn(id);
              setSortDesc(desc !== undefined ? desc : !sortDesc);
            }}
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
    [sortColumn, sortDesc]
  );

  const handleToggleSelect = (id: string, shiftKey?: boolean) => {
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

  const isFiltered = Boolean(
    searchValue || selectedStatus.length > 0 || selectedCarriers.length > 0
  );

  const handleResetFilters = () => {
    setSearchValue('');
    setSelectedStatus([]);
    setSelectedCarriers([]);
    setPageIndex(1);
  };

  return (
    <DashboardLayout
      shopName="Kho Tổng Ship Dễ — Hà Nội"
      currentUser={{
        name: 'Trần Quản Trị',
        email: 'admin@shipde.net',
        role: 'Chủ Shop / Quản trị viên',
      }}
    >
      {/* Fixture Notice Banner */}
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
        onEmptyAction={handleResetFilters}
        toolbar={
          <DataTableToolbar
            searchValue={searchValue}
            onSearchChange={(val) => {
              setSearchValue(val);
              setPageIndex(1);
            }}
            searchPlaceholder="Tìm theo mã vận đơn, mã đơn, khách hàng..."
            isFiltered={isFiltered}
            onResetFilters={handleResetFilters}
            filtersSlot={
              <>
                <DataTableFacetedFilter
                  title="Trạng thái"
                  options={STATUS_OPTIONS}
                  selectedValues={new Set(selectedStatus)}
                  onSelect={(vals) => {
                    setSelectedStatus(vals);
                    setPageIndex(1);
                  }}
                />
                <DataTableFacetedFilter
                  title="Hãng vận chuyển"
                  options={CARRIER_OPTIONS}
                  selectedValues={new Set(selectedCarriers)}
                  onSelect={(vals) => {
                    setSelectedCarriers(vals);
                    setPageIndex(1);
                  }}
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
            onPageChange={(p) => setPageIndex(p)}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPageIndex(1);
            }}
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
