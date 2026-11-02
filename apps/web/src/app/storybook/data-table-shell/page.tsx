'use client';

/**
 * MIT License
 *
 * Storybook / UI Verification Showcase Page for TASK-AI-155:
 * - Reusable Server-Driven Data Table (adapted from sadmann7/shadcn-table, MIT)
 * - Reusable Dashboard Shell (adapted from Kiranism/next-shadcn-dashboard-starter, MIT, no Clerk)
 *
 * IMPORTANT: All records rendered on this page are deterministic FIXTURE data
 * imported from `@/components/data-table/fixtures` and explicitly marked with
 * `[DỮ LIỆU MẪU / FIXTURE]`.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FlaskConical,
  Plus,
  RotateCcw,
  Truck,
} from 'lucide-react';
import {
  applyServerDrivenTableOperations,
  parseTableSearchParams,
  ServerDataTable,
  SHIPMENT_TABLE_FILTER_FIELDS,
  SHIPMENT_TABLE_FIXTURE_ROWS,
  useDataTable,
  type ServerDataTableColumnDef,
  type ShipmentTableFixtureRow,
} from '@/components/data-table';
import {
  DashboardShell,
  DEFAULT_SHIPDE_NAV_GROUPS,
  PageContainer,
  PageHeader,
  type DashboardUserProfile,
  type TenantContextOption,
} from '@/components/dashboard-shell';

export type ShowcaseUiStateMode =
  | 'success'
  | 'loading'
  | 'empty'
  | 'no-results'
  | 'error'
  | 'forbidden'
  | 'validation-error'
  | 'partial';

const FIXTURE_TENANTS: TenantContextOption[] = [
  {
    tenantId: 'FIX-TENANT-01',
    shopId: 'FIX-SHOP-HCM-01',
    shopName: 'GUMAC Thời Trang Nữ [FIXTURE]',
    warehouseLabel: 'Kho Trung Tâm Q.12 - TP.HCM [FIXTURE]',
    planTier: 'ENTERPRISE',
  },
  {
    tenantId: 'FIX-TENANT-01',
    shopId: 'FIX-SHOP-HN-02',
    shopName: 'GUMAC Chi Nhánh Miền Bắc [FIXTURE]',
    warehouseLabel: 'Kho Long Biên - Hà Nội [FIXTURE]',
    planTier: 'ENTERPRISE',
  },
];

const FIXTURE_USER: DashboardUserProfile = {
  id: 'FIX-USER-OPS-01',
  fullName: 'Nguyễn Minh Quân [FIXTURE]',
  email: 'quan.nguyen.fixture@shipde.vn',
  roleLabel: 'Điều phối vận hành (Ops Lead)',
  avatarInitials: 'MQ',
};

const STATUS_DISPLAY_MAP: Record<
  ShipmentTableFixtureRow['status'],
  { label: string; badgeClass: string }
> = {
  READY_TO_PICK: {
    label: 'Chờ lấy hàng',
    badgeClass: 'badge-info',
  },
  IN_TRANSIT: {
    label: 'Đang trung chuyển',
    badgeClass: 'badge-info',
  },
  OUT_FOR_DELIVERY: {
    label: 'Đang giao hàng',
    badgeClass: 'badge-info',
  },
  DELIVERY_FAILED: {
    label: 'Giao thất bại',
    badgeClass: 'badge-risk',
  },
  DELIVERED: {
    label: 'Giao thành công',
    badgeClass: 'badge-ok',
  },
  RETURNING: {
    label: 'Đang hoàn hàng',
    badgeClass: 'badge-warn',
  },
};

const RECONCILIATION_DISPLAY_MAP: Record<
  ShipmentTableFixtureRow['reconciliationState'],
  { label: string; badgeClass: string }
> = {
  UNVERIFIED: {
    label: 'Chưa đối soát',
    badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
  },
  SUSPECTED_VARIANCE: {
    label: 'Nghi ngờ lệch phí',
    badgeClass: 'badge-warn',
  },
  CARRIER_ACCEPTED: {
    label: 'Hãng đã xác nhận',
    badgeClass: 'badge-info',
  },
  BANK_RECEIVED: {
    label: 'Đã nhận tiền NH',
    badgeClass: 'badge-ok',
  },
};

export interface DataTableShellShowcaseProps {
  initialSearchParams?: string | Record<string, string | string[] | undefined>;
  initialMode?: ShowcaseUiStateMode;
}

export function DataTableShellShowcase({
  initialSearchParams = '',
  initialMode = 'success',
}: DataTableShellShowcaseProps) {
  const [uiMode, setUiMode] = useState<ShowcaseUiStateMode>(initialMode);
  const [activeTenant, setActiveTenant] = useState<TenantContextOption>(FIXTURE_TENANTS[0]);
  const [queryString, setQueryString] = useState<string>(() => {
    if (typeof initialSearchParams === 'string') {
      return initialSearchParams;
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(initialSearchParams)) {
      if (Array.isArray(v)) {
        params.set(k, v.join(','));
      } else if (typeof v === 'string') {
        params.set(k, v);
      }
    }
    return params.toString();
  });
  const [selectedNotice, setSelectedNotice] = useState<string | null>(null);

  const columns = useMemo<ServerDataTableColumnDef<ShipmentTableFixtureRow>[]>(
    () => [
      {
        id: 'trackingCode',
        header: 'Mã vận đơn',
        accessorKey: 'trackingCode',
        enableSorting: true,
        enableHiding: false,
        tabularNums: true,
        minWidth: '170px',
        cell: (row) => (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                {row.trackingCode}
              </span>
              <span className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] font-semibold text-amber-900">
                FIXTURE
              </span>
            </div>
            <div className="font-mono text-[11px] text-slate-500 tabular-nums">
              Đơn: {row.orderCode}
            </div>
          </div>
        ),
      },
      {
        id: 'carrierId',
        header: 'Hãng vận chuyển',
        accessorKey: 'carrierName',
        enableSorting: true,
        minWidth: '150px',
        cell: (row) => (
          <div className="flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="text-xs font-medium text-slate-800">{row.carrierName}</span>
          </div>
        ),
      },
      {
        id: 'recipientName',
        header: 'Người nhận & Tuyến',
        accessorKey: 'recipientName',
        enableSorting: true,
        minWidth: '190px',
        cell: (row) => (
          <div className="space-y-0.5">
            <div className="text-xs font-semibold text-slate-900">{row.recipientName}</div>
            <div className="text-[11px] text-slate-500">{row.destinationProvince}</div>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Trạng thái vận hành',
        accessorKey: 'status',
        enableSorting: true,
        minWidth: '165px',
        cell: (row) => {
          const badge = STATUS_DISPLAY_MAP[row.status];
          return (
            <div className="space-y-1">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.badgeClass}`}
              >
                {badge.label}
              </span>
              {row.slaWarning && (
                <div className="flex items-center gap-1 text-[11px] font-medium text-rose-600">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{row.slaWarning}</span>
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: 'reconciliationState',
        header: 'Đối soát & Tiền',
        accessorKey: 'reconciliationState',
        enableSorting: true,
        minWidth: '155px',
        cell: (row) => {
          const recon = RECONCILIATION_DISPLAY_MAP[row.reconciliationState];
          return (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${recon.badgeClass}`}
            >
              {recon.label}
            </span>
          );
        },
      },
      {
        id: 'codAmountVnd',
        header: 'Tiền thu hộ (COD)',
        accessorKey: 'codAmountVnd',
        enableSorting: true,
        align: 'right',
        tabularNums: true,
        minWidth: '135px',
        cell: (row) => (
          <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
            {row.codAmountVnd.toLocaleString('vi-VN')} đ
          </span>
        ),
      },
      {
        id: 'shippingFeeVnd',
        header: 'Phí vận chuyển',
        accessorKey: 'shippingFeeVnd',
        enableSorting: true,
        align: 'right',
        tabularNums: true,
        minWidth: '125px',
        cell: (row) => (
          <span className="font-mono text-xs text-slate-700 tabular-nums">
            {row.shippingFeeVnd.toLocaleString('vi-VN')} đ
          </span>
        ),
      },
    ],
    []
  );

  const effectiveSearchParams = useMemo(() => {
    if (uiMode === 'no-results') {
      return 'search=KHONG_TON_TAI_MA_VAN_DON_FIXTURE_999999';
    }
    if (uiMode === 'validation-error') {
      return 'page=-3&per_page=777&sort=invalidColumn.sideways';
    }
    return queryString;
  }, [uiMode, queryString]);

  const parsedUrlState = useMemo(
    () =>
      parseTableSearchParams(effectiveSearchParams, {
        filterFields: SHIPMENT_TABLE_FILTER_FIELDS,
        allowedSortIds: columns.map((c) => c.id),
        defaultPage: 1,
        defaultPerPage: 10,
      }),
    [effectiveSearchParams, columns]
  );

  const sourceDataset = useMemo(
    () => (uiMode === 'empty' ? [] : SHIPMENT_TABLE_FIXTURE_ROWS),
    [uiMode]
  );

  const serverResult = useMemo(
    () =>
      applyServerDrivenTableOperations(
        sourceDataset,
        parsedUrlState,
        columns,
        SHIPMENT_TABLE_FILTER_FIELDS
      ),
    [sourceDataset, parsedUrlState, columns]
  );

  const table = useDataTable({
    data: serverResult.rows,
    columns,
    pageCount: serverResult.pageCount,
    totalCount: serverResult.totalCount,
    filterFields: SHIPMENT_TABLE_FILTER_FIELDS,
    searchParams: effectiveSearchParams,
    pathname: '/storybook/data-table-shell',
    onUrlChange: (nextUrl) => {
      const qIndex = nextUrl.indexOf('?');
      const nextQuery = qIndex >= 0 ? nextUrl.slice(qIndex + 1) : '';
      setQueryString(nextQuery);
      if (uiMode === 'no-results' || uiMode === 'validation-error') {
        setUiMode('success');
      }
    },
  });

  const fixtureTopBanner = (
    <div
      role="note"
      aria-label="Thông báo môi trường dữ liệu mẫu Storybook"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950 sm:px-6"
    >
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <span>
          <strong>[DỮ LIỆU MẪU / FIXTURE — TRANG KIỂM THỬ STORYBOOK]</strong> Màn hình này chỉ dùng
          dữ liệu giả lập cố định (`SHIPMENT_TABLE_FIXTURE_ROWS`) để kiểm chứng thành phần
          `ServerDataTable` & `DashboardShell` (TASK-AI-155). Không kết nối hay ghi đè dữ liệu vận
          hành thật.
        </span>
      </div>
      <span className="rounded bg-amber-200/80 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-950 tabular-nums">
        12 bản ghi FIXTURE
      </span>
    </div>
  );

  return (
    <DashboardShell
      navGroups={DEFAULT_SHIPDE_NAV_GROUPS}
      activePath="/shipments"
      breadcrumbs={[
        { label: 'Ship Dễ Ops', href: '/' },
        { label: 'Storybook & Kiểm thử UI', href: '/storybook/data-table-shell' },
        { label: 'Bảng dữ liệu & Khung điều phối (TASK-AI-155)' },
      ]}
      tenants={FIXTURE_TENANTS}
      activeTenant={activeTenant}
      onSelectTenant={(tenant) => setActiveTenant(tenant)}
      user={FIXTURE_USER}
      topBanner={fixtureTopBanner}
      onOpenQuickSearch={() =>
        setSelectedNotice('Đã kích hoạt phím tắt Tìm kiếm nhanh (⌘K / Ctrl+K) trên mẫu kiểm thử.')
      }
    >
      <PageContainer>
        <PageHeader
          title="Bảng vận đơn điều phối từ URL & Khung Dashboard"
          description="Mẫu kiểm thử tích hợp sadmann7/shadcn-table (MIT) và Kiranism/next-shadcn-dashboard-starter (MIT, không dùng Clerk) theo chuẩn thiết kế Ship Dễ."
          badge={
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
              <span>DỮ LIỆU MẪU / FIXTURE</span>
            </span>
          }
          metadata={
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
              URL Search Params hiện tại:{' '}
              <code className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-800">
                ?{effectiveSearchParams || 'page=1&per_page=10'}
              </code>
            </span>
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => {
                  setQueryString('');
                  setUiMode('success');
                  setSelectedNotice(null);
                }}
                className="btn-secondary inline-flex items-center gap-1.5 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Khôi phục mặc định</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedNotice(
                    'Thao tác mẫu [Tạo vận đơn mới] được kích hoạt trong môi trường Storybook Fixture.'
                  )
                }
                className="btn-primary inline-flex items-center gap-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tạo vận đơn mẫu</span>
              </button>
            </>
          }
        />

        {/* Interactive UI State Switcher for deterministic inspection */}
        <section
          aria-label="Bộ chuyển đổi trạng thái giao diện kiểm thử"
          className="modern-card rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Chế độ kiểm thử trạng thái UI (State Coverage Matrix)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Chuyển đổi trực tiếp giữa các trạng thái Loading, Empty, Lọc không kết quả, Lỗi tham
                số URL, Lỗi 403, Lỗi máy chủ và Cảnh báo dữ liệu một phần:
              </p>
            </div>

            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Chọn trạng thái hiển thị"
            >
              {(
                [
                  { id: 'success', label: '1. Thành công (Có dữ liệu mẫu)' },
                  { id: 'loading', label: '2. Đang tải (Skeleton)' },
                  { id: 'empty', label: '3. Trống (Empty)' },
                  { id: 'no-results', label: '4. Lọc không khớp' },
                  { id: 'validation-error', label: '5. Lỗi tham số URL' },
                  { id: 'partial', label: '6. Dữ liệu một phần' },
                  { id: 'error', label: '7. Lỗi 502 (Retry)' },
                  { id: 'forbidden', label: '8. Cấm truy cập (403)' },
                ] as const
              ).map((modeOption) => (
                <button
                  key={modeOption.id}
                  type="button"
                  aria-pressed={uiMode === modeOption.id}
                  onClick={() => setUiMode(modeOption.id)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 ${
                    uiMode === modeOption.id
                      ? 'bg-orange-600 text-white font-semibold shadow-xs'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {modeOption.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {selectedNotice && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900"
          >
            <span className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              <span>{selectedNotice}</span>
            </span>
            <button
              type="button"
              onClick={() => setSelectedNotice(null)}
              className="font-semibold underline hover:text-emerald-700"
            >
              Đóng
            </button>
          </div>
        )}

        <ServerDataTable
          table={table}
          filterFields={SHIPMENT_TABLE_FILTER_FIELDS}
          facetCounts={serverResult.facetCounts}
          caption="Bảng dữ liệu mẫu vận đơn Ship Dễ (Fixture)"
          enableRowSelection={true}
          onRowClick={(row) =>
            setSelectedNotice(
              `Đã chọn xem chi tiết vận đơn mẫu ${row.trackingCode} (${row.recipientName}).`
            )
          }
          toolbarActions={
            <button
              type="button"
              onClick={() => setSelectedNotice('Đã xuất danh sách vận đơn mẫu (Fixture CSV).')}
              className="btn-secondary inline-flex h-9 items-center gap-1.5 px-3 text-xs"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Xuất tệp mẫu</span>
            </button>
          }
          bulkActionsBar={(selectedRows, clearSelection) => (
            <>
              <button
                type="button"
                onClick={() => {
                  setSelectedNotice(
                    `Đã tạo lệnh in nhãn mẫu cho ${selectedRows.length} vận đơn FIXTURE.`
                  );
                  clearSelection();
                }}
                className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-700"
              >
                In vận đơn hàng loạt ({selectedRows.length})
              </button>
            </>
          )}
          isLoading={uiMode === 'loading'}
          isForbidden={uiMode === 'forbidden'}
          forbiddenMessage="Vai trò [Nhân viên kho ca phụ - FIXTURE] không có quyền xem dữ liệu đối soát COD của cửa hàng này."
          onSwitchTenantOrRequestAccess={() => setUiMode('success')}
          error={
            uiMode === 'error'
              ? {
                  title: 'Không thể đồng bộ danh sách vận đơn từ máy chủ',
                  message:
                    'Kết nối tới cổng dữ liệu vận đơn bị gián đoạn tạm thời (timeout 10.000ms). Dữ liệu của bạn vẫn an toàn.',
                  code: 'UPSTREAM_GATEWAY_TIMEOUT_504',
                }
              : null
          }
          onRetry={() => setUiMode('success')}
          partialWarning={
            uiMode === 'partial'
              ? {
                  message: 'Đang hiển thị dữ liệu một phần (Partial State):',
                  detail:
                    'Bản tin webhook từ hãng J&T Express đang trễ 6 phút; các hãng GHN, GHTK, Viettel Post đã cập nhật thời gian thực.',
                }
              : null
          }
          emptyTitle="Chưa có vận đơn nào trong kho mẫu"
          emptyDescription="Kho vận hành đang chọn hiện chưa phát sinh vận đơn nào. Bạn có thể tạo vận đơn mẫu hoặc khôi phục bộ dữ liệu Fixture."
          emptyActionLabel="Nạp lại 12 vận đơn mẫu (Fixture)"
          onEmptyAction={() => setUiMode('success')}
        />
      </PageContainer>
    </DashboardShell>
  );
}

export default function StorybookDataTableShellPage() {
  return <DataTableShellShowcase />;
}
