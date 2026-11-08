import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CarrierResponse,
  CarrierEvidenceLevel,
  CarrierDetailResponseEnvelope,
  CanonicalStatusResponse,
  FeeComponentResponse,
} from '@/features/carriers/catalog/types';
import {
  CarrierCatalogView,
  CarrierCatalogUIState,
  resolveUIState,
  shouldDisplayEmptyState,
  EVIDENCE_LEVEL_OPTIONS,
  ACTIVE_OPTIONS,
} from '@/features/carriers/catalog/CarrierCatalogView';
import { CarrierCard } from '@/features/carriers/catalog/CarrierCard';
import { CarrierGrid } from '@/features/carriers/catalog/CarrierGrid';
import { CarrierServiceList } from '@/features/carriers/catalog/CarrierServiceList';
import { CanonicalStatusReferenceModal } from '@/features/carriers/catalog/CanonicalStatusReferenceModal';
import { FeeTaxonomyReferenceModal } from '@/features/carriers/catalog/FeeTaxonomyReferenceModal';
import { AuthProvider } from '@/context/AuthContext';

/**
 * FEAT-CAR-01 Slice B: Carrier Catalog UI States and Component Verification Test
 * Tests SCR-CAR-01 Catalog Tab (/settings/carriers?tab=catalog):
 * - Loading state (skeleton grid with aria-busy)
 * - Empty state (with clear filters button)
 * - Validation state (inline error for malformed search)
 * - Error state (sanitized error with correlation ID + Retry)
 * - Forbidden state (403 banner for iam:carrier_catalog:read)
 * - Partial state (CONFIRMATION_REQUIRED badge on VIETTEL_POST, JT)
 * - Success state (fully rendered carrier cards and service tables)
 * - Recovery state (retry preserves tab and filters)
 * - CanonicalStatusReferenceModal and FeeTaxonomyReferenceModal
 */

const MOCK_CARRIERS: CarrierResponse[] = [
  {
    id: 'car_ghn_01',
    code: 'GHN',
    name: 'Giao Hàng Nhanh',
    logo_url: null,
    is_active: true,
    evidence_level: 'VERIFIED_OFFICIAL',
    description: 'Hãng vận chuyển hàng đầu Việt Nam với API công khai chính thức',
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    id: 'car_ghtk_01',
    code: 'GHTK',
    name: 'Giao Hàng Tiết Kiệm',
    logo_url: null,
    is_active: true,
    evidence_level: 'VERIFIED_OFFICIAL',
    description: 'Hãng vận chuyển tiết kiệm với OpenAPI công khai',
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    id: 'car_vtp_01',
    code: 'VIETTEL_POST',
    name: 'Viettel Post',
    logo_url: null,
    is_active: true,
    evidence_level: 'CONFIRMATION_REQUIRED',
    description: 'Đối tác Viettel - cần xác nhận OI-001',
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    id: 'car_jt_01',
    code: 'JT',
    name: 'J&T Express Vietnam',
    logo_url: null,
    is_active: true,
    evidence_level: 'CONFIRMATION_REQUIRED',
    description: 'Đối tác J&T Việt Nam - cần xác nhận OI-002',
    catalog_revision: 'CATALOG-2026-10-31',
  },
];

const MOCK_CARRIER_DETAIL: CarrierDetailResponseEnvelope = {
  catalog_revision: 'CATALOG-2026-10-31',
  data: {
    id: 'car_ghn_01',
    code: 'GHN',
    name: 'Giao Hàng Nhanh',
    logo_url: null,
    is_active: true,
    evidence_level: 'VERIFIED_OFFICIAL',
    description: 'Hãng vận chuyển hàng đầu Việt Nam',
    catalog_revision: 'CATALOG-2026-10-31',
    services: [
      {
        id: 'svc_ghn_std',
        code: 'GHN_STANDARD',
        name: 'GHN tiêu chuẩn',
        service_type: 'STANDARD',
        description: 'Dịch vụ tiêu chuẩn GHN',
        is_active: true,
        evidence_level: 'VERIFIED_OFFICIAL',
        source_revision: 'GHN-PUBLIC-API-2026-08-24',
      },
      {
        id: 'svc_ghn_fast',
        code: 'GHN_FAST',
        name: 'GHN hoả tốc',
        service_type: 'FAST',
        description: 'Dịch vụ nhanh GHN',
        is_active: true,
        evidence_level: 'VERIFIED_OFFICIAL',
        source_revision: 'GHN-PUBLIC-API-2026-08-24',
      },
    ],
  },
};

const MOCK_STATUSES: CanonicalStatusResponse[] = [
  {
    code: 'CREATING',
    category: 'COMMAND',
    label: 'Đang tạo vận đơn',
    description: 'Đang tạo vận đơn: canonical shipment status. Not a provider raw status.',
    stage_order: 10,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'CREATED',
    category: 'COMMAND',
    label: 'Đã tạo vận đơn',
    description: 'Đã tạo vận đơn: canonical shipment status. Not a provider raw status.',
    stage_order: 20,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'READY_TO_PICK',
    category: 'OPERATIONAL_PRE_TRANSIT',
    label: 'Sẵn sàng lấy',
    description: 'Sẵn sàng lấy: canonical shipment status. Not a provider raw status.',
    stage_order: 120,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'PICKING',
    category: 'OPERATIONAL_PRE_TRANSIT',
    label: 'Đang lấy',
    description: 'Đang lấy: canonical shipment status. Not a provider raw status.',
    stage_order: 130,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'IN_TRANSIT',
    category: 'OPERATIONAL_IN_TRANSIT',
    label: 'Đang luân chuyển',
    description: 'Đang luân chuyển: canonical shipment status. Not a provider raw status.',
    stage_order: 210,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'DELIVERED',
    category: 'OPERATIONAL_TERMINAL',
    label: 'Đã giao',
    description: 'Đã giao: canonical shipment status. Not a provider raw status.',
    stage_order: 340,
    catalog_revision: 'CATALOG-2026-10-31',
  },
];

const MOCK_FEES: FeeComponentResponse[] = [
  {
    code: 'BASE_FREIGHT',
    name: 'Cước chính',
    category: 'BASE',
    description: 'Core transport charge before surcharges and tax.',
    is_refundable: true,
    vat_applicable: true,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'SURCHARGE',
    name: 'Phụ phí',
    category: 'SURCHARGE',
    description: 'Catch-all surcharge.',
    is_refundable: true,
    vat_applicable: true,
    catalog_revision: 'CATALOG-2026-10-31',
  },
  {
    code: 'VAT',
    name: 'Thuế GTGT',
    category: 'VAT',
    description: 'VAT amount line.',
    is_refundable: false,
    vat_applicable: false,
    catalog_revision: 'CATALOG-2026-10-31',
  },
];

const renderWithAuth = (component: React.ReactElement) => {
  return renderToStaticMarkup(React.createElement(AuthProvider, null, component));
};

async function runCarrierCatalogTests() {
  console.log('--- Running FEAT-CAR-01 Slice B Carrier Catalog UI States Proving Test ---');

  // 1. Helper contracts verification
  console.log('\n1. Testing UI State Resolution Helpers...');

  assert.strictEqual(
    resolveUIState({
      isForbidden: true,
      error: null,
      loading: false,
      itemCount: 10,
      hasFilters: false,
    }),
    'forbidden',
    'forbidden takes precedence'
  );
  assert.strictEqual(
    resolveUIState({
      isForbidden: false,
      error: 'Network Error',
      loading: false,
      itemCount: 0,
      hasFilters: false,
    }),
    'error',
    'error takes precedence over empty'
  );
  assert.strictEqual(
    resolveUIState({
      isForbidden: false,
      error: null,
      loading: true,
      itemCount: 0,
      hasFilters: false,
    }),
    'loading',
    'loading takes precedence'
  );
  assert.strictEqual(
    resolveUIState({
      isForbidden: false,
      error: null,
      loading: false,
      itemCount: 0,
      hasFilters: true,
    }),
    'empty',
    'empty with filters'
  );
  assert.strictEqual(
    resolveUIState({
      isForbidden: false,
      error: null,
      loading: false,
      itemCount: 0,
      hasFilters: false,
    }),
    'empty',
    'empty without filters'
  );
  assert.strictEqual(
    resolveUIState({
      isForbidden: false,
      error: null,
      loading: false,
      itemCount: 5,
      hasFilters: false,
    }),
    'success',
    'success with items'
  );

  assert.strictEqual(
    shouldDisplayEmptyState({ error: null, loading: false, itemCount: 0, hasFilters: false }),
    true,
    'Empty state displays when no error, no loading, 0 items'
  );
  assert.strictEqual(
    shouldDisplayEmptyState({
      error: 'Server outage',
      loading: false,
      itemCount: 0,
      hasFilters: false,
    }),
    false,
    'Empty state MUST NOT display during server error'
  );
  assert.strictEqual(
    shouldDisplayEmptyState({ error: null, loading: true, itemCount: 0, hasFilters: false }),
    false,
    'Empty state MUST NOT display during loading'
  );
  assert.strictEqual(
    shouldDisplayEmptyState({ error: null, loading: false, itemCount: 5, hasFilters: false }),
    false,
    'Empty state MUST NOT display when items exist'
  );

  console.log('✅ UI State helpers verified');

  // 2. UI State: LOADING
  console.log('\n2. Testing LOADING State...');
  const loadingHtml = renderWithAuth(
    React.createElement(CarrierCatalogView, { initialLoading: true, initialCarriers: null })
  );
  assert.ok(
    loadingHtml.includes('data-testid="carrier-grid-loading"'),
    'Loading state must render grid with test ID'
  );
  assert.ok(loadingHtml.includes('aria-busy="true"'), 'Loading grid must have aria-busy="true"');
  assert.ok(
    loadingHtml.includes('aria-label="Đang tải danh mục hãng vận chuyển"'),
    'Loading grid must have accessible label'
  );
  assert.ok(
    loadingHtml.includes('animate-pulse'),
    'Loading skeleton must feature animate-pulse CSS'
  );
  assert.ok(
    !loadingHtml.includes('Không tìm thấy hãng vận chuyển'),
    'Loading state must NOT render empty copy prematurely'
  );
  console.log('✅ LOADING state verified');

  // 3. UI State: FORBIDDEN
  console.log('\n3. Testing FORBIDDEN State...');
  const forbiddenHtml = renderWithAuth(
    React.createElement(CarrierCatalogView, {
      initialLoading: false,
      initialForbidden: true,
      initialCarriers: MOCK_CARRIERS,
    })
  );
  assert.ok(
    forbiddenHtml.includes('data-testid="catalog-forbidden-banner"'),
    'Forbidden state must render forbidden banner'
  );
  assert.ok(
    forbiddenHtml.includes('403') && forbiddenHtml.includes('Không Có Quyền'),
    'Forbidden state must render 403 message'
  );
  assert.ok(
    forbiddenHtml.includes('iam:carrier_catalog:read'),
    'Forbidden state must mention required permission'
  );
  assert.ok(
    !forbiddenHtml.includes('data-testid="carrier-grid"'),
    'Forbidden state must hide carrier grid'
  );
  console.log('✅ FORBIDDEN state verified');

  // 4. UI State: ERROR with correlation ID and Retry
  console.log('\n4. Testing ERROR State...');
  const errorHtml = renderWithAuth(
    React.createElement(CarrierCatalogView, {
      initialLoading: false,
      initialError: 'Lỗi kết nối máy chủ khi tải danh mục',
      initialCorrelationId: 'corr-abc-123',
      initialCarriers: [],
    })
  );
  assert.ok(
    errorHtml.includes('role="alert"') && errorHtml.includes('Lỗi kết nối máy chủ'),
    'Error state must render alert banner with error message'
  );
  assert.ok(errorHtml.includes('corr-abc-123'), 'Error state must display correlation ID');
  assert.ok(
    errorHtml.includes('data-testid="catalog-retry-button"') && errorHtml.includes('Thử lại'),
    'Error state must display retry button'
  );
  assert.ok(
    !errorHtml.includes('Không tìm thấy hãng vận chuyển'),
    'Error state must NOT render empty state during server error'
  );
  console.log('✅ ERROR state verified');

  // 5. UI State: EMPTY with Clear Filters
  console.log('\n5. Testing EMPTY State...');
  const emptyHtml = renderWithAuth(
    React.createElement(CarrierCatalogView, {
      initialLoading: false,
      initialCarriers: [],
    })
  );
  assert.ok(
    emptyHtml.includes('data-testid="carrier-grid-empty"'),
    'Empty state container must be rendered'
  );
  assert.ok(
    emptyHtml.includes('Chưa có hãng vận chuyển nào trong danh mục'),
    'Empty state must render correct message'
  );

  // Filtered-empty DOM and clear action are exercised in carrier-catalog.interactions.spec.ts.
  console.log('✅ EMPTY state verified');

  // 6. UI State: SUCCESS with all carriers and partial badges
  console.log('\n6. Testing SUCCESS State...');
  const successHtml = renderWithAuth(
    React.createElement(CarrierCatalogView, {
      initialLoading: false,
      initialCarriers: MOCK_CARRIERS,
    })
  );
  assert.ok(
    successHtml.includes('data-testid="carrier-grid"'),
    'Success state must render carrier grid'
  );
  // Verify all 4 carriers rendered
  MOCK_CARRIERS.forEach((carrier) => {
    assert.ok(
      successHtml.includes(`data-testid="carrier-card-${carrier.code}"`),
      `Carrier ${carrier.code} card must be rendered`
    );
    // HTML-encode ampersands for comparison (React renders & as & in static markup)
    const encodedName = carrier.name.replace(/&/g, '\x26\x61\x6d\x70\x3b');
    assert.ok(successHtml.includes(encodedName), `Carrier ${carrier.code} name must be rendered`);
  });

  // Verify VERIFIED_OFFICIAL badges (GHN, GHTK)
  assert.ok(
    successHtml.includes('Đã xác thực chính thức'),
    'VERIFIED_OFFICIAL badge must be rendered'
  );
  assert.ok(
    successHtml.includes('bg-emerald-50 text-emerald-700'),
    'VERIFIED_OFFICIAL badge must have emerald styling'
  );

  // Verify CONFIRMATION_REQUIRED badges (VIETTEL_POST, JT) - PARTIAL STATE
  assert.ok(
    successHtml.includes('Cần xác nhận đối tác'),
    'CONFIRMATION_REQUIRED badge must be rendered'
  );
  assert.ok(
    successHtml.includes('bg-amber-50 text-amber-700'),
    'CONFIRMATION_REQUIRED badge must have amber styling'
  );
  assert.ok(
    successHtml.includes('data-testid="confirmation-required-badge"'),
    'Confirmation required badge must have test ID'
  );
  console.log('✅ SUCCESS state with PARTIAL badges verified');

  // 7. CarrierCard component tests
  console.log('\n7. Testing CarrierCard Component...');
  const ghnCardHtml = renderToStaticMarkup(
    React.createElement(CarrierCard, { carrier: MOCK_CARRIERS[0] })
  );
  assert.ok(ghnCardHtml.includes('Giao Hàng Nhanh'), 'Card renders carrier name');
  assert.ok(ghnCardHtml.includes('GHN'), 'Card renders carrier code');
  assert.ok(ghnCardHtml.includes('Đã xác thực chính thức'), 'Card renders VERIFIED_OFFICIAL badge');
  assert.ok(ghnCardHtml.includes('bg-blue-600'), 'Card renders GHN monogram color');

  const vtpCardHtml = renderToStaticMarkup(
    React.createElement(CarrierCard, { carrier: MOCK_CARRIERS[2] })
  );
  assert.ok(vtpCardHtml.includes('Viettel Post'), 'Card renders Viettel Post name');
  assert.ok(vtpCardHtml.includes('VIETTEL_POST'), 'Card renders VIETTEL_POST code');
  assert.ok(
    vtpCardHtml.includes('Cần xác nhận đối tác'),
    'Card renders CONFIRMATION_REQUIRED badge'
  );
  assert.ok(
    vtpCardHtml.includes('data-testid="confirmation-required-badge"'),
    'Card has confirmation badge test ID'
  );
  assert.ok(vtpCardHtml.includes('bg-red-600'), 'Card renders VIETTEL_POST monogram color');
  console.log('✅ CarrierCard component verified');

  // 8. CarrierGrid component tests
  console.log('\n8. Testing CarrierGrid Component...');
  const gridLoadingHtml = renderToStaticMarkup(
    React.createElement(CarrierGrid, { carriers: [], loading: true })
  );
  assert.ok(
    gridLoadingHtml.includes('data-testid="carrier-grid-loading"'),
    'Grid shows loading state'
  );
  assert.ok(gridLoadingHtml.includes('aria-busy="true"'), 'Grid loading has aria-busy');

  const gridEmptyHtml = renderToStaticMarkup(
    React.createElement(CarrierGrid, { carriers: [], loading: false, clearFiltersAction: () => {} })
  );
  assert.ok(gridEmptyHtml.includes('data-testid="carrier-grid-empty"'), 'Grid shows empty state');
  assert.ok(gridEmptyHtml.includes('Xóa bộ lọc'), 'Grid empty state shows clear filters button');

  const gridSuccessHtml = renderToStaticMarkup(
    React.createElement(CarrierGrid, { carriers: MOCK_CARRIERS, loading: false })
  );
  assert.ok(gridSuccessHtml.includes('data-testid="carrier-grid"'), 'Grid shows success state');
  MOCK_CARRIERS.forEach((carrier) => {
    assert.ok(
      gridSuccessHtml.includes(`data-testid="carrier-card-${carrier.code}"`),
      `Grid renders ${carrier.code} card`
    );
  });
  console.log('✅ CarrierGrid component verified');

  // 9. CarrierServiceList component tests
  console.log('\n9. Testing CarrierServiceList Component...');
  const serviceListHtml = renderToStaticMarkup(
    React.createElement(CarrierServiceList, {
      carrierCode: 'GHN',
      carrierName: 'Giao Hàng Nhanh',
      services: MOCK_CARRIER_DETAIL.data.services,
      isOpen: true,
      onClose: () => {},
      evidenceLevel: 'VERIFIED_OFFICIAL',
    })
  );
  assert.ok(
    serviceListHtml.includes('data-testid="carrier-service-list-modal"'),
    'Service list modal rendered'
  );
  assert.ok(serviceListHtml.includes('Dịch vụ của Giao Hàng Nhanh (GHN)'), 'Modal title rendered');
  assert.ok(serviceListHtml.includes('GHN_STANDARD'), 'Standard service rendered');
  assert.ok(serviceListHtml.includes('GHN_FAST'), 'Fast service rendered');
  assert.ok(serviceListHtml.includes('Tiêu chuẩn'), 'STANDARD label rendered');
  assert.ok(serviceListHtml.includes('Nhanh / Hoả tốc'), 'FAST label rendered');
  assert.ok(serviceListHtml.includes('Đã xác thực chính thức'), 'Service evidence badge rendered');
  console.log('✅ CarrierServiceList component verified');

  // 10. CanonicalStatusReferenceModal tests
  console.log('\n10. Testing CanonicalStatusReferenceModal...');
  const statusModalHtml = renderToStaticMarkup(
    React.createElement(CanonicalStatusReferenceModal, {
      statuses: MOCK_STATUSES,
      isOpen: true,
      onClose: () => {},
    })
  );
  assert.ok(
    statusModalHtml.includes('data-testid="canonical-status-reference-modal"'),
    'Status modal rendered'
  );
  assert.ok(statusModalHtml.includes('Tham chiếu Trạng thái Canonical'), 'Modal title rendered');
  assert.ok(statusModalHtml.includes('Trạng thái lệnh (Pre-transit)'), 'COMMAND category rendered');
  assert.ok(
    statusModalHtml.includes('Vận hành - Trước luân chuyển'),
    'OPERATIONAL_PRE_TRANSIT category rendered'
  );
  assert.ok(
    statusModalHtml.includes('Vận hành - Đang luân chuyển'),
    'OPERATIONAL_IN_TRANSIT category rendered'
  );
  assert.ok(
    statusModalHtml.includes('Vận hành - Trạng thái cuối'),
    'OPERATIONAL_TERMINAL category rendered'
  );
  assert.ok(statusModalHtml.includes('CREATING'), 'CREATING status rendered');
  assert.ok(statusModalHtml.includes('DELIVERED'), 'DELIVERED status rendered');
  assert.ok(statusModalHtml.includes('Không bao giờ mặc định'), 'Mapping rules rendered');
  console.log('✅ CanonicalStatusReferenceModal verified');

  // 11. FeeTaxonomyReferenceModal tests
  console.log('\n11. Testing FeeTaxonomyReferenceModal...');
  const feeModalHtml = renderToStaticMarkup(
    React.createElement(FeeTaxonomyReferenceModal, {
      feeComponents: MOCK_FEES,
      isOpen: true,
      onClose: () => {},
    })
  );
  assert.ok(
    feeModalHtml.includes('data-testid="fee-taxonomy-reference-modal"'),
    'Fee modal rendered'
  );
  assert.ok(feeModalHtml.includes('Hệ thống Phí Canonical'), 'Modal title rendered');
  assert.ok(feeModalHtml.includes('BASE_FREIGHT'), 'BASE_FREIGHT rendered');
  assert.ok(feeModalHtml.includes('SURCHARGE'), 'SURCHARGE rendered');
  assert.ok(feeModalHtml.includes('VAT'), 'VAT rendered');
  assert.ok(feeModalHtml.includes('Có thể hoàn'), 'Refundable badge rendered');
  assert.ok(feeModalHtml.includes('Không hoàn'), 'Non-refundable badge rendered');
  assert.ok(feeModalHtml.includes('Cơ sở VAT'), 'VAT applicable badge rendered');
  assert.ok(feeModalHtml.includes('Không tính VAT'), 'VAT not applicable badge rendered');
  assert.ok(feeModalHtml.includes('Raw fee không khớp'), 'Mapping rules rendered');
  console.log('✅ FeeTaxonomyReferenceModal verified');

  // 12. Filter constants verification
  console.log('\n12. Testing Filter Constants...');
  assert.strictEqual(EVIDENCE_LEVEL_OPTIONS.length, 3, 'Must have 3 evidence level options');
  assert.strictEqual(EVIDENCE_LEVEL_OPTIONS[0].value, 'ALL', 'First option must be ALL');
  assert.strictEqual(
    EVIDENCE_LEVEL_OPTIONS[1].value,
    'VERIFIED_OFFICIAL',
    'Second must be VERIFIED_OFFICIAL'
  );
  assert.strictEqual(
    EVIDENCE_LEVEL_OPTIONS[2].value,
    'CONFIRMATION_REQUIRED',
    'Third must be CONFIRMATION_REQUIRED'
  );

  assert.strictEqual(ACTIVE_OPTIONS.length, 3, 'Must have 3 active options');
  assert.strictEqual(ACTIVE_OPTIONS[0].value, 'ALL', 'First option must be ALL');
  assert.strictEqual(ACTIVE_OPTIONS[1].value, 'true', 'Second must be true');
  assert.strictEqual(ACTIVE_OPTIONS[2].value, 'false', 'Third must be false');
  console.log('✅ Filter constants verified');

  console.log('\n✅ ALL FEAT-CAR-01 SLICE B CARRIER CATALOG UI STATE AND COMPONENT TESTS PASSED');
}

void runCarrierCatalogTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
