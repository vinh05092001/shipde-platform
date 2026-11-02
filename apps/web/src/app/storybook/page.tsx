'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  DollarSign,
  FileSpreadsheet,
  FlaskConical,
  LayoutDashboard,
  Package,
  RotateCcw,
  Settings,
  Truck,
} from 'lucide-react';
import {
  DashboardShell,
  type DashboardContextOption,
  type DashboardNavGroup,
  type DashboardShellState,
} from '@/components/dashboard-shell';
import {
  ServerDataTable,
  applyServerDataTableQuery,
  parseFilterParams,
  parsePaginationParams,
  parseSortParam,
  toUrlSearchParams,
  type DataTableColumnDef,
  type DataTableFilterField,
  type DataTableSearchParamsInput,
} from '@/components/data-table';
import { Money, StatusBadge, TrackingCode } from '@/components/ui/OperationalComponents';

/**
 * ============================================================================
 * FIXTURE DATA NOTICE (CHỈ DÙNG CHO TRANG STORYBOOK / KIỂM THỬ COMPONENT)
 * Mọi bản ghi dưới đây là dữ liệu mẫu cố định (FIXTURE), được đánh dấu rõ ràng
 * bằng `isFixture: true` và tiền tố `FIXTURE-`, tuyệt đối không phải dữ liệu
 * vận hành thực tế của khách hàng.
 * ============================================================================
 */
export const FIXTURE_DATA_NOTICE =
  'DỮ LIỆU MẪU KIỂM THỬ (FIXTURE) — Trang Storybook này sử dụng dữ liệu giả lập cố định để kiểm thử Bảng dữ liệu điều khiển qua URL (Server-Driven Data Table) và Khung bảng điều khiển (Dashboard Shell). Không phải dữ liệu vận hành thực tế.';

export interface FixtureShipmentRow extends Record<string, unknown> {
  id: string;
  isFixture: true;
  trackingCode: string;
  orderCode: string;
  recipientMasked: string;
  carrier: 'GHN' | 'GHTK' | 'VTP';
  status: 'DELIVERED' | 'IN_TRANSIT' | 'DELIVERY_FAIL' | 'RETURNING';
  codAmountVnd: number;
  shippingFeeVnd: number;
  branchName: string;
  updatedAt: string;
}

export const FIXTURE_SHIPMENT_ROWS: readonly FixtureShipmentRow[] = [
  {
    id: 'FIXTURE-SHP-001',
    isFixture: true,
    trackingCode: 'FIXTURE_GHN_1001',
    orderCode: 'FIXTURE-ORD-001',
    recipientMasked: 'Nguyễn Văn A (0901****111) [FIXTURE]',
    carrier: 'GHN',
    status: 'DELIVERED',
    codAmountVnd: 450000,
    shippingFeeVnd: 22000,
    branchName: 'Chi nhánh Quận 1 (Fixture)',
    updatedAt: '2026-10-31 09:15',
  },
  {
    id: 'FIXTURE-SHP-002',
    isFixture: true,
    trackingCode: 'FIXTURE_GHTK_1002',
    orderCode: 'FIXTURE-ORD-002',
    recipientMasked: 'Trần Thị B (0902****222) [FIXTURE]',
    carrier: 'GHTK',
    status: 'DELIVERY_FAIL',
    codAmountVnd: 780000,
    shippingFeeVnd: 28000,
    branchName: 'Chi nhánh Tân Bình (Fixture)',
    updatedAt: '2026-10-31 10:30',
  },
  {
    id: 'FIXTURE-SHP-003',
    isFixture: true,
    trackingCode: 'FIXTURE_VTP_1003',
    orderCode: 'FIXTURE-ORD-003',
    recipientMasked: 'Lê Hoàng C (0903****333) [FIXTURE]',
    carrier: 'VTP',
    status: 'IN_TRANSIT',
    codAmountVnd: 320000,
    shippingFeeVnd: 19000,
    branchName: 'Chi nhánh Quận 1 (Fixture)',
    updatedAt: '2026-10-31 11:05',
  },
  {
    id: 'FIXTURE-SHP-004',
    isFixture: true,
    trackingCode: 'FIXTURE_GHN_1004',
    orderCode: 'FIXTURE-ORD-004',
    recipientMasked: 'Phạm Minh D (0904****444) [FIXTURE]',
    carrier: 'GHN',
    status: 'RETURNING',
    codAmountVnd: 610000,
    shippingFeeVnd: 31000,
    branchName: 'Kho Cầu Giấy (Fixture)',
    updatedAt: '2026-10-31 12:40',
  },
  {
    id: 'FIXTURE-SHP-005',
    isFixture: true,
    trackingCode: 'FIXTURE_GHTK_1005',
    orderCode: 'FIXTURE-ORD-005',
    recipientMasked: 'Hoàng Thu E (0905****555) [FIXTURE]',
    carrier: 'GHTK',
    status: 'DELIVERED',
    codAmountVnd: 920000,
    shippingFeeVnd: 35000,
    branchName: 'Chi nhánh Tân Bình (Fixture)',
    updatedAt: '2026-10-31 14:20',
  },
  {
    id: 'FIXTURE-SHP-006',
    isFixture: true,
    trackingCode: 'FIXTURE_VTP_1006',
    orderCode: 'FIXTURE-ORD-006',
    recipientMasked: 'Đỗ Quang F (0906****666) [FIXTURE]',
    carrier: 'VTP',
    status: 'IN_TRANSIT',
    codAmountVnd: 150000,
    shippingFeeVnd: 18000,
    branchName: 'Kho Cầu Giấy (Fixture)',
    updatedAt: '2026-10-31 15:10',
  },
];

export const FIXTURE_NAV_GROUPS: DashboardNavGroup[] = [
  {
    id: 'ops',
    label: 'Điều hành vận chuyển (Fixture)',
    items: [
      {
        id: 'control-tower',
        title: 'Tháp chỉ huy',
        href: '/storybook?view=control-tower',
        icon: LayoutDashboard,
      },
      {
        id: 'shipments',
        title: 'Danh sách vận đơn (Fixture)',
        href: '/storybook',
        icon: Package,
        badge: FIXTURE_SHIPMENT_ROWS.length,
        badgeTone: 'info',
        items: [
          {
            id: 'shipments-all',
            title: 'Tất cả vận đơn mẫu',
            href: '/storybook',
            badge: FIXTURE_SHIPMENT_ROWS.length,
          },
          {
            id: 'shipments-failed',
            title: 'Cần xử lý giao lại',
            href: '/storybook?status=DELIVERY_FAIL',
            badge: 1,
          },
        ],
      },
      {
        id: 'exceptions',
        title: 'Hộp việc sự cố',
        href: '/storybook?view=exceptions',
        icon: AlertTriangle,
        badge: 2,
        badgeTone: 'warn',
      },
    ],
  },
  {
    id: 'finance',
    label: 'Đối soát & Tài chính (Fixture)',
    items: [
      {
        id: 'reconciliation',
        title: 'Đối soát bảng kê COD',
        href: '/storybook?view=reconciliation',
        icon: DollarSign,
        badge: 1,
        badgeTone: 'risk',
      },
      {
        id: 'returns',
        title: 'Quét nhận hàng hoàn',
        href: '/storybook?view=returns',
        icon: RotateCcw,
      },
      {
        id: 'settings',
        title: 'Cấu hình cửa hàng',
        href: '/storybook?view=settings',
        icon: Settings,
      },
    ],
  },
];

export const FIXTURE_CONTEXT_OPTIONS: DashboardContextOption[] = [
  {
    id: 'fixture-shop-all',
    label: '[FIXTURE] Toàn bộ cửa hàng mẫu (2 chi nhánh)',
    scopeType: 'SHOP',
  },
  { id: 'fixture-branch-hcm', label: '[FIXTURE] Chi nhánh TP.HCM', scopeType: 'BRANCH' },
  { id: 'fixture-wh-hn', label: '[FIXTURE] Kho Cầu Giấy — Hà Nội', scopeType: 'WAREHOUSE' },
];

export const FIXTURE_FILTER_FIELDS: DataTableFilterField<FixtureShipmentRow>[] = [
  {
    id: 'q',
    label: 'Tìm mã vận đơn, mã đơn hoặc người nhận',
    placeholder: 'Nhập mã FIXTURE_GHN, FIXTURE-ORD...',
  },
  {
    id: 'carrier',
    label: 'Hãng vận chuyển',
    options: [
      { label: 'GHN Express', value: 'GHN', count: 2, icon: Truck },
      { label: 'Giao Hàng Tiết Kiệm', value: 'GHTK', count: 2, icon: Truck },
      { label: 'Viettel Post', value: 'VTP', count: 2, icon: Truck },
    ],
  },
  {
    id: 'status',
    label: 'Trạng thái vận đơn',
    options: [
      { label: 'Giao thành công', value: 'DELIVERED', count: 2 },
      { label: 'Đang trung chuyển', value: 'IN_TRANSIT', count: 2 },
      { label: 'Giao thất bại', value: 'DELIVERY_FAIL', count: 1 },
      { label: 'Đang chuyển hoàn', value: 'RETURNING', count: 1 },
    ],
  },
];

export const FIXTURE_COLUMNS: DataTableColumnDef<FixtureShipmentRow>[] = [
  {
    id: 'trackingCode',
    header: 'Mã vận đơn (Fixture)',
    accessorKey: 'trackingCode',
    enableSorting: true,
    enableHiding: false,
    cell: (row) => <TrackingCode code={row.trackingCode} />,
  },
  {
    id: 'orderCode',
    header: 'Mã đơn hàng',
    accessorKey: 'orderCode',
    enableSorting: true,
    enableHiding: true,
    cell: (row) => (
      <span className="font-mono text-xs font-semibold text-[#0c1421]">{row.orderCode}</span>
    ),
  },
  {
    id: 'recipientMasked',
    header: 'Người nhận (Đã che PII)',
    accessorKey: 'recipientMasked',
    enableSorting: true,
    enableHiding: true,
  },
  {
    id: 'carrier',
    header: 'Hãng VC',
    accessorKey: 'carrier',
    enableSorting: true,
    enableHiding: true,
    cell: (row) => <span className="badge-info font-mono">{row.carrier}</span>,
  },
  {
    id: 'status',
    header: 'Trạng thái',
    accessorKey: 'status',
    enableSorting: true,
    enableHiding: true,
    cell: (row) => <StatusBadge status={row.status} />,
  },
  {
    id: 'codAmountVnd',
    header: 'Tiền thu hộ COD',
    accessorKey: 'codAmountVnd',
    align: 'right',
    enableSorting: true,
    enableHiding: true,
    cell: (row) => <Money amount={row.codAmountVnd} state="estimated" />,
  },
  {
    id: 'shippingFeeVnd',
    header: 'Phí vận chuyển',
    accessorKey: 'shippingFeeVnd',
    align: 'right',
    enableSorting: true,
    enableHiding: true,
    cell: (row) => <Money amount={row.shippingFeeVnd} state="confirmed" />,
  },
];

export interface StorybookShowcaseProps {
  initialState?: DashboardShellState;
  initialSearchParams?: DataTableSearchParamsInput;
  onUrlChange?: (nextUrl: string, nextParams: URLSearchParams) => void;
}

const STORYBOOK_STATES: { id: DashboardShellState; label: string }[] = [
  { id: 'success', label: 'Đầy đủ (Success)' },
  { id: 'loading', label: 'Đang tải (Loading)' },
  { id: 'empty', label: 'Trống (Empty)' },
  { id: 'error', label: 'Lỗi mạng/Server (Error)' },
  { id: 'forbidden', label: 'Từ chối 403 (Forbidden)' },
  { id: 'validation', label: 'Lỗi tham số (Validation)' },
  { id: 'partial', label: 'Một phần (Partial)' },
];

export function StorybookShowcaseContent({
  initialState,
  initialSearchParams,
  onUrlChange,
}: StorybookShowcaseProps) {
  const paramsObj = React.useMemo(
    () => toUrlSearchParams(initialSearchParams),
    [initialSearchParams]
  );

  const stateFromUrl = (paramsObj.get('state') as DashboardShellState | null) || null;
  const [overrideState, setOverrideState] = React.useState<DashboardShellState | null>(null);
  const activeState: DashboardShellState =
    overrideState ?? initialState ?? stateFromUrl ?? 'success';
  const [selectedContextId, setSelectedContextId] = React.useState<string>(
    FIXTURE_CONTEXT_OPTIONS[0].id
  );
  const [queryParamsString, setQueryParamsString] = React.useState<string>(() =>
    paramsObj.toString()
  );

  const currentSearchParams = React.useMemo(
    () => new URLSearchParams(queryParamsString),
    [queryParamsString]
  );

  const pagination = parsePaginationParams(currentSearchParams, 10);
  const sortResult = parseSortParam(
    currentSearchParams.get('sort'),
    FIXTURE_COLUMNS.map((c) => c.id),
    { id: 'trackingCode', desc: false }
  );
  const filterResult = parseFilterParams(currentSearchParams, FIXTURE_FILTER_FIELDS);

  const evaluated = React.useMemo(
    () =>
      applyServerDataTableQuery(
        activeState === 'empty' ? [] : FIXTURE_SHIPMENT_ROWS,
        {
          page: pagination.page,
          perPage: pagination.perPage,
          sort: sortResult.sort,
          textFilters: filterResult.textFilters,
          facetedFilters: filterResult.facetedFilters,
        },
        {
          searchKeys: ['trackingCode', 'orderCode', 'recipientMasked', 'branchName'],
        }
      ),
    [
      activeState,
      pagination.page,
      pagination.perPage,
      sortResult.sort,
      filterResult.textFilters,
      filterResult.facetedFilters,
    ]
  );

  const handleTableUrlChange = (nextUrl: string, nextParams: URLSearchParams) => {
    setQueryParamsString(nextParams.toString());
    onUrlChange?.(nextUrl, nextParams);
  };

  return (
    <DashboardShell
      navGroups={FIXTURE_NAV_GROUPS}
      activeHref="/storybook"
      breadcrumbs={[
        { title: 'Ship Dễ Console', href: '/' },
        { title: 'Storybook & Kiểm thử UI (Fixture)' },
      ]}
      pageTitle="Bảng Vận Đơn Điều Khiển Qua URL & Khung Dashboard (Storybook Fixture)"
      pageDescription="Trang kiểm thử độc lập cho ServerDataTable (sadmann7/shadcn-table, MIT) và DashboardShell (Kiranism/next-shadcn-dashboard-starter, MIT, không dùng Clerk) với dữ liệu mẫu được đánh dấu rõ ràng."
      pageBadge="FIXTURE ONLY"
      pageBadgeTone="warn"
      contextOptions={FIXTURE_CONTEXT_OPTIONS}
      selectedContextId={selectedContextId}
      onContextChange={setSelectedContextId}
      user={{
        name: 'Kỹ Sư Kiểm Thử UI (Fixture)',
        email: 'storybook-fixture@shipde.vn',
        roleLabel: 'OWNER',
      }}
      pageActions={
        <button
          type="button"
          onClick={() => {
            setOverrideState('success');
            setQueryParamsString('');
          }}
          data-testid="storybook-reset-all"
          className="btn-secondary text-xs"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Khôi phục trạng thái mẫu</span>
        </button>
      }
    >
      {/* Prominent Fixture Banner — Never present fixture data as live operational data */}
      <div
        role="region"
        aria-label="Cảnh báo dữ liệu mẫu kiểm thử"
        data-testid="storybook-fixture-banner"
        className="p-4 rounded-xl bg-[#fff5f0] border border-[#fdddd0] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#c23807] text-white flex items-center justify-center shrink-0">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <div className="text-xs font-extrabold uppercase tracking-wider text-[#c23807]">
              Chế độ Storybook / Dữ liệu mẫu kiểm thử (Fixture Data)
            </div>
            <p className="text-xs text-[#3b4352]">{FIXTURE_DATA_NOTICE}</p>
          </div>
        </div>
        <span className="badge-warn shrink-0 self-start sm:self-center">
          6 bản ghi FIXTURE cố định
        </span>
      </div>

      {/* Interactive UI State Switcher for Storybook Verification */}
      <div
        role="region"
        aria-label="Bộ chuyển đổi trạng thái kiểm thử giao diện"
        data-testid="storybook-state-switcher"
        className="modern-card p-3 flex flex-wrap items-center justify-between gap-2"
      >
        <span className="text-xs font-bold text-[#3b4352] px-1">
          Trạng thái kiểm thử bảng dữ liệu:
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {STORYBOOK_STATES.map((st) => {
            const isCurrent = activeState === st.id;
            return (
              <button
                key={st.id}
                type="button"
                aria-pressed={isCurrent}
                onClick={() => setOverrideState(st.id)}
                data-testid={`storybook-state-btn-${st.id}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  isCurrent
                    ? 'bg-[#c23807] text-white'
                    : 'bg-[#f6f5f3] text-[#3b4352] hover:bg-[#eae7e4]'
                }`}
              >
                {st.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Server-Driven Data Table Bound to URL Search Params */}
      <ServerDataTable<FixtureShipmentRow>
        data={evaluated.rows}
        columns={FIXTURE_COLUMNS}
        pageCount={evaluated.pageCount}
        totalRows={evaluated.totalRows}
        filterFields={FIXTURE_FILTER_FIELDS}
        defaultPerPage={10}
        defaultSort={{ id: 'trackingCode', desc: false }}
        getRowId={(row) => row.id}
        loading={activeState === 'loading'}
        error={
          activeState === 'error'
            ? 'Không thể kết nối dịch vụ truy vấn vận đơn (HTTP 503). Vui lòng thử lại sau ít giây.'
            : null
        }
        forbidden={activeState === 'forbidden'}
        forbiddenMessage="Bạn không có quyền `shipments:view_branch_records` cho chi nhánh này (HTTP 403)."
        validationMessage={
          activeState === 'validation'
            ? 'Tham số sắp xếp hoặc phân trang trên URL không hợp lệ (ví dụ: sort=unknown_col.asc).'
            : null
        }
        isPartial={activeState === 'partial'}
        partialMessage="Chỉ hiển thị 6 bản ghi mẫu từ bộ nhớ đệm Fixture do dịch vụ phụ đang bảo trì."
        emptyTitle="Không có vận đơn mẫu nào khớp điều kiện"
        emptyDescription="Thử xóa bộ lọc tìm kiếm hoặc khôi phục tập dữ liệu mẫu (Fixture)."
        emptyActionLabel="Khôi phục dữ liệu mẫu"
        onEmptyAction={() => {
          setOverrideState('success');
          setQueryParamsString('');
        }}
        onRetry={() => setOverrideState('success')}
        onForbiddenRecovery={() => setOverrideState('success')}
        initialSearchParams={currentSearchParams}
        pathname="/storybook"
        onUrlChange={handleTableUrlChange}
        bulkActions={(selectedRows, clearSelection) => (
          <button
            type="button"
            onClick={clearSelection}
            data-testid="storybook-bulk-export-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#c23807] text-white text-xs font-semibold cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Xuất {selectedRows.length} dòng mẫu (Fixture)</span>
          </button>
        )}
      />
    </DashboardShell>
  );
}

function StorybookPageInner(props: StorybookShowcaseProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  return (
    <StorybookShowcaseContent
      {...props}
      initialSearchParams={
        props.initialSearchParams !== undefined
          ? props.initialSearchParams
          : searchParams
            ? searchParams.toString()
            : ''
      }
      onUrlChange={
        props.onUrlChange ||
        ((nextUrl) => {
          router.push(nextUrl, { scroll: false });
        })
      }
    />
  );
}

export default function StorybookPage(props: StorybookShowcaseProps = {}) {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-busy="true"
          className="min-h-screen bg-[#fdfcfb] flex items-center justify-center p-8 text-xs text-[#3b4352]"
        >
          Đang khởi tạo trang Storybook kiểm thử giao diện...
        </div>
      }
    >
      <StorybookPageInner {...props} />
    </Suspense>
  );
}
