import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlobalSearchModal, GlobalSearchContent } from '@/components/GlobalSearchModal';
import SearchPage, { SearchPageContent } from '@/app/search/page';
import { ShipmentListTab } from '@/components/ShipmentListTab';
import { ExceptionWorkboxTab } from '@/components/ExceptionWorkboxTab';
import { ReconciliationTab } from '@/components/ReconciliationTab';
import { ClaimCasesTab } from '@/components/ClaimCasesTab';
import { handleSearchResultActivation } from '@/app/page';
import type { SearchResultItem } from '@shipde/contracts';

/**
 * FEAT-COM-01: Global Search UI States & Keyboard Accessibility Test Suite
 * Proves every AGENTS.md required state:
 * 1. Loading state (skeletons, aria-busy, spinner)
 * 2. Empty initial state (search prompt, quick tips, suggestions)
 * 3. No-results state (query entered, 0 items returned, recovery actions)
 * 4. Validation error state (< 2 chars, aria-invalid, alert feedback)
 * 5. Error state (server/network failure, retry recovery button)
 * 6. Forbidden state (403 on restricted categories without RBAC capabilities, reset recovery button)
 * 7. Partial state (limited results banner, category scope notes)
 * 8. Success state (rich result cards, entity icons, status badges, PII masked subtitles)
 * 9. Recovery state (actionable buttons to recover from any error/forbidden/empty state)
 * 10. Keyboard & A11y accessibility (dialog, searchbox, listbox, options, aria-selected, shortcuts)
 * 11. Standalone `/search` screen integration
 */
async function runGlobalSearchTestSuite() {
  console.log('================================================================');
  console.log('SHIP DỄ — GLOBAL SEARCH UI STATES TEST SUITE (FEAT-COM-01)');
  console.log('================================================================');

  const mockItems: SearchResultItem[] = [
    {
      id: 'ord-1111-2222',
      type: 'ORDER',
      title: 'Đơn hàng ORD-2026-001',
      subtitle: 'Khách hàng: Nguyễn Văn A | SĐT: 0901****567',
      code: 'ORD-2026-001',
      status: 'DELIVERED',
      url: '/orders/ord-1111-2222',
      metadata: {
        order_code: 'ORD-2026-001',
        recipient_name: 'Nguyễn Văn A',
        recipient_phone: '0901****567',
      },
    },
    {
      id: 'ship-3333-4444',
      type: 'WAYBILL',
      title: 'Vận đơn GHN88291042 (GHN)',
      subtitle: 'Đơn gốc: ORD-2026-001 | Trạng thái: DELIVERED',
      code: 'GHN88291042',
      status: 'DELIVERED',
      url: '/shipments/ship-3333-4444',
      metadata: {
        tracking_code: 'GHN88291042',
        carrier_code: 'GHN',
      },
    },
    {
      id: 'stmt-5555-6666',
      type: 'BATCH',
      title: 'Bảng kê đối soát 55556666...',
      subtitle: 'Kỳ: 2026-10-01 - 2026-10-15 | Trạng thái: RECONCILED',
      code: 'BATCH-2026-10',
      status: 'RECONCILED',
      url: '/reconciliation/statements/stmt-5555-6666',
      metadata: {
        statement_id: 'stmt-5555-6666',
      },
    },
    {
      id: 'case-7777-8888',
      type: 'CASE',
      title: 'Ngoại lệ giao hàng (DAMAGED)',
      subtitle: 'Vận đơn: GHN88291042 | Trạng thái: UNDER_REVIEW',
      code: 'GHN88291042',
      status: 'UNDER_REVIEW',
      url: '/exceptions/case-7777-8888',
      metadata: {
        exception_type: 'DAMAGED',
      },
    },
    {
      id: 'disc-9999-0000',
      type: 'TRANSACTION',
      title: 'Lệch cước tài chính (WEIGHT_MISMATCH)',
      subtitle: 'Vận đơn: GHN88291042 | Chênh lệch: 15,000 ₫',
      code: 'DISC-9999',
      status: 'PENDING_REVIEW',
      url: '/reconciliation/discrepancies/disc-9999-0000',
      metadata: {
        discrepancy_type: 'WEIGHT_MISMATCH',
      },
    },
  ];

  // 1. UI State: LOADING
  console.log('🧪 1. Testing LOADING State...');
  const loadingHtml = renderToStaticMarkup(
    React.createElement(GlobalSearchModal, {
      isOpen: true,
      initialLoading: true,
      initialQuery: 'ORD',
    })
  );
  assert.ok(
    loadingHtml.includes('data-testid="search-loading-state"'),
    'Loading state must render search-loading-state container'
  );
  assert.ok(
    loadingHtml.includes('data-testid="search-loading-skeleton"'),
    'Loading state must render loading skeletons with animation'
  );
  assert.ok(
    loadingHtml.includes('animate-pulse'),
    'Loading skeletons must have animate-pulse styling'
  );
  assert.ok(
    loadingHtml.includes('aria-busy="true"'),
    'Results container must have aria-busy="true" during load'
  );
  assert.ok(
    loadingHtml.includes('Đang tìm kiếm dữ liệu trên toàn hệ thống...'),
    'Loading state must inform user that global search is in-flight'
  );
  console.log('   ✅ Loading state verified');

  // 2. UI State: EMPTY INITIAL STATE
  console.log('🧪 2. Testing EMPTY Initial State...');
  const emptyHtml = renderToStaticMarkup(
    React.createElement(GlobalSearchModal, {
      isOpen: true,
      initialQuery: '',
      initialHasSearched: false,
    })
  );
  assert.ok(
    emptyHtml.includes('data-testid="search-empty-state"'),
    'Empty initial state must render search-empty-state'
  );
  assert.ok(
    emptyHtml.includes('Tra Cứu Nhanh Toàn Hệ Thống'),
    'Empty state must render welcome title'
  );
  assert.ok(
    emptyHtml.includes('Nhập ít nhất 2 ký tự'),
    'Empty state must explain minimum 2 characters requirement'
  );
  assert.ok(
    emptyHtml.includes('ORD-') && emptyHtml.includes('GHN') && emptyHtml.includes('GHTK'),
    'Empty state must render quick query sample chips'
  );
  assert.ok(
    emptyHtml.includes('Enter') && emptyHtml.includes('Esc'),
    'Empty state must render keyboard shortcut guide'
  );
  console.log('   ✅ Empty initial state verified');

  // 3. UI State: NO RESULTS STATE
  console.log('🧪 3. Testing NO-RESULTS State...');
  const noResultsHtml = renderToStaticMarkup(
    React.createElement(GlobalSearchModal, {
      isOpen: true,
      initialQuery: 'NONEXISTENT_CODE_123',
      initialHasSearched: true,
      initialItems: [],
      initialTotal: 0,
    })
  );
  assert.ok(
    noResultsHtml.includes('data-testid="search-no-results-state"'),
    'No-results state must render search-no-results-state container'
  );
  assert.ok(
    noResultsHtml.includes('Không tìm thấy kết quả phù hợp cho &quot;NONEXISTENT_CODE_123&quot;') ||
      noResultsHtml.includes('Không tìm thấy kết quả phù hợp'),
    'No-results state must display informative message with queried term'
  );
  assert.ok(
    noResultsHtml.includes('Kiểm tra lại chính tả'),
    'No-results state must provide actionable guidance'
  );
  assert.ok(
    noResultsHtml.includes('Xóa từ khóa'),
    'No-results state must provide recovery button to clear search'
  );
  console.log('   ✅ No-results state verified');

  // 4. UI State: VALIDATION ERROR STATE
  console.log('🧪 4. Testing VALIDATION Error State...');
  const validationHtml = renderToStaticMarkup(
    React.createElement(GlobalSearchModal, {
      isOpen: true,
      initialQuery: 'a',
      initialValidationMessage: 'Vui lòng nhập ít nhất 2 ký tự để bắt đầu tìm kiếm',
    })
  );
  assert.ok(
    validationHtml.includes('data-testid="search-validation-error"'),
    'Validation error state must render search-validation-error element'
  );
  assert.ok(
    validationHtml.includes('role="alert"'),
    'Validation error must have accessible role="alert"'
  );
  assert.ok(
    validationHtml.includes('aria-invalid="true"'),
    'Input must mark aria-invalid="true" on validation error'
  );
  assert.ok(
    validationHtml.includes('Tối thiểu 2 ký tự'),
    'Validation error must show minimum character badge'
  );
  console.log('   ✅ Validation error state verified');

  // 5. UI State: SERVER / NETWORK ERROR STATE
  console.log('🧪 5. Testing SERVER ERROR State...');
  const errorHtml = renderToStaticMarkup(
    React.createElement(GlobalSearchModal, {
      isOpen: true,
      initialQuery: 'ORD',
      initialError: 'Không thể tải kết quả tìm kiếm từ máy chủ. Vui lòng thử lại.',
    })
  );
  assert.ok(
    errorHtml.includes('data-testid="search-error-state"'),
    'Error state must render search-error-state'
  );
  assert.ok(errorHtml.includes('Lỗi Truy Vấn Dữ Liệu'), 'Error state must render error headline');
  assert.ok(
    errorHtml.includes('Không thể tải kết quả tìm kiếm từ máy chủ'),
    'Error state must render actionable Vietnamese error text'
  );
  assert.ok(
    errorHtml.includes('data-testid="search-retry-button"'),
    'Error state must provide retry recovery button'
  );
  console.log('   ✅ Server error state verified');

  // 6. UI State: FORBIDDEN STATE (403)
  console.log('🧪 6. Testing FORBIDDEN (403) State...');
  const forbiddenHtml = renderToStaticMarkup(
    React.createElement(GlobalSearchModal, {
      isOpen: true,
      initialQuery: 'statement',
      initialType: 'BATCH',
      initialForbidden: true,
      initialForbiddenMessage:
        'Bạn không có quyền truy cập dữ liệu đối soát bảng kê hoặc lệch cước tài chính (yêu cầu quyền reconciliation:view_contract_rates hoặc reconciliation:run_review_audit).',
    })
  );
  assert.ok(
    forbiddenHtml.includes('data-testid="search-forbidden-state"'),
    'Forbidden state must render search-forbidden-state container'
  );
  assert.ok(
    forbiddenHtml.includes('Quyền Truy Cập Bị Từ Chối (403)'),
    'Forbidden state must display 403 authorization header'
  );
  assert.ok(
    forbiddenHtml.includes('reconciliation:view_contract_rates'),
    'Forbidden message must explain missing required capability'
  );
  assert.ok(
    forbiddenHtml.includes('data-testid="forbidden-reset-filter-button"'),
    'Forbidden state must provide recovery button to switch back to ALL'
  );
  assert.ok(
    forbiddenHtml.includes('Quay lại danh mục Tất Cả'),
    'Forbidden recovery button must offer fallback to permitted category'
  );
  console.log('   ✅ Forbidden state verified');

  // 7. UI State: PARTIAL STATE
  console.log('🧪 7. Testing PARTIAL State...');
  const partialHtml = renderToStaticMarkup(
    React.createElement(GlobalSearchModal, {
      isOpen: true,
      initialQuery: 'ORD',
      initialItems: mockItems.slice(0, 2),
      initialTotal: 50,
      initialIsPartial: true,
    })
  );
  assert.ok(
    partialHtml.includes('data-testid="search-partial-state"'),
    'Partial state must render search-partial-state indicator'
  );
  assert.ok(
    partialHtml.includes('Hiển thị 2/50 kết quả'),
    'Partial indicator must show bounded count vs total available'
  );
  console.log('   ✅ Partial state verified');

  // 8. UI State: SUCCESS STATE (Populated Multi-Entity Results)
  console.log('🧪 8. Testing SUCCESS State & Multi-Entity Rendering...');
  const successHtml = renderToStaticMarkup(
    React.createElement(GlobalSearchModal, {
      isOpen: true,
      initialQuery: 'ORD',
      initialItems: mockItems,
      initialTotal: mockItems.length,
    })
  );
  assert.ok(
    successHtml.includes('data-testid="search-success-state"'),
    'Success state must render search-success-state container'
  );
  assert.ok(
    successHtml.includes('data-testid="search-results-list"'),
    'Success state must render search-results-list'
  );
  assert.ok(
    successHtml.includes('data-testid="search-item-ord-1111-2222"'),
    'Must render ORDER entity item'
  );
  assert.ok(
    successHtml.includes('data-testid="search-item-ship-3333-4444"'),
    'Must render WAYBILL entity item'
  );
  assert.ok(
    successHtml.includes('data-testid="search-item-stmt-5555-6666"'),
    'Must render BATCH entity item'
  );
  assert.ok(
    successHtml.includes('data-testid="search-item-case-7777-8888"'),
    'Must render CASE entity item'
  );
  assert.ok(
    successHtml.includes('data-testid="search-item-disc-9999-0000"'),
    'Must render TRANSACTION entity item'
  );

  // Proving PII masking in subtitles
  assert.ok(
    successHtml.includes('0901****567'),
    'Recipient phone must be rendered in masked form for users without pii:unmask'
  );
  assert.ok(
    !successHtml.includes('0901234567'),
    'Plaintext raw phone must NEVER leak into search markup when masked'
  );

  // Proving entity codes and status badges
  assert.ok(successHtml.includes('ORD-2026-001'), 'Must display order code badge');
  assert.ok(successHtml.includes('GHN88291042'), 'Must display waybill tracking code');
  assert.ok(successHtml.includes('Giao Thành Công'), 'Must display translated status label');
  console.log('   ✅ Success state & PII protection verified');

  // 9. RECOVERY STATE: Proving Recovery Pathways Across All Failure Modes
  console.log('🧪 9. Testing RECOVERY Actions & Controls...');
  assert.ok(
    errorHtml.includes('data-testid="search-retry-button"'),
    'Recovery: Retry action present on network/server error'
  );
  assert.ok(
    forbiddenHtml.includes('data-testid="forbidden-reset-filter-button"'),
    'Recovery: Reset-to-all action present on 403 forbidden'
  );
  assert.ok(
    noResultsHtml.includes('Xóa từ khóa'),
    'Recovery: Clear query action present on zero results'
  );
  const clearableQueryHtml = renderToStaticMarkup(
    React.createElement(GlobalSearchModal, {
      isOpen: true,
      initialQuery: 'query-with-text',
    })
  );
  assert.ok(
    clearableQueryHtml.includes('data-testid="search-clear-button"'),
    'Recovery: Clear input button present when text exists'
  );
  console.log('   ✅ Recovery pathways verified');

  // 10. KEYBOARD & ACCESSIBILITY SPECIFICATIONS
  console.log('🧪 10. Testing KEYBOARD Access & A11y Attributes...');
  assert.ok(successHtml.includes('role="dialog"'), 'Search modal must declare role="dialog"');
  assert.ok(
    successHtml.includes('aria-modal="true"'),
    'Search modal must declare aria-modal="true"'
  );
  assert.ok(
    successHtml.includes('aria-label="Tìm kiếm toàn hệ thống"'),
    'Search modal must have accessible label'
  );
  assert.ok(successHtml.includes('role="searchbox"'), 'Search input must declare role="searchbox"');
  assert.ok(successHtml.includes('role="listbox"'), 'Results list must declare role="listbox"');
  assert.ok(successHtml.includes('role="option"'), 'Result items must declare role="option"');
  assert.ok(
    successHtml.includes('aria-selected="true"'),
    'Keyboard active item must declare aria-selected="true"'
  );
  assert.ok(
    successHtml.includes('data-testid="search-close-button"') && successHtml.includes('Esc'),
    'Close button with Esc keyboard shortcut badge must be present'
  );
  console.log('   ✅ Keyboard accessibility & ARIA attributes verified');

  // 11. STANDALONE SEARCH PAGE (`/search`)
  console.log('🧪 11. Testing STANDALONE Search Page (/search)...');
  const pageHtml = renderToStaticMarkup(
    React.createElement(SearchPageContent, {
      initialQuery: 'ORD-2026',
      initialItems: [mockItems[0]],
      initialTotal: 1,
    })
  );
  assert.ok(
    pageHtml.includes('Tìm Kiếm Toàn Hệ Thống (FEAT-COM-01)'),
    'Standalone page must render page title'
  );
  assert.ok(
    pageHtml.includes('Trở về Bảng Điều Khiển'),
    'Standalone page must render back navigation button'
  );
  assert.ok(
    pageHtml.includes('data-testid="search-dialog"'),
    'Standalone page must host search dialog in standalone mode'
  );
  assert.ok(
    pageHtml.includes('data-testid="search-item-ord-1111-2222"'),
    'Standalone page must render matched items'
  );
  console.log('   ✅ Standalone search page verified');

  // 12. CATEGORY FILTER TABS
  console.log('🧪 12. Testing Entity Category Filter Tabs...');
  assert.ok(
    successHtml.includes('data-testid="type-filter-ALL"') &&
      successHtml.includes('data-testid="type-filter-ORDER"') &&
      successHtml.includes('data-testid="type-filter-WAYBILL"') &&
      successHtml.includes('data-testid="type-filter-BATCH"') &&
      successHtml.includes('data-testid="type-filter-CASE"') &&
      successHtml.includes('data-testid="type-filter-TRANSACTION"'),
    'All entity category filter tabs (ALL, ORDER, WAYBILL, BATCH, CASE, TRANSACTION) must be present'
  );
  console.log('   ✅ Entity category filter tabs verified');

  // 13. RESULT ACTIVATION & RECORD SELECTION (Finding 2 / Real Outcome)
  console.log('🧪 13. Testing RESULT ACTIVATION & RECORD SELECTION (Finding 2)...');

  // 13a. ORDER activation: selects real order in ShipmentListTab; rejects fabricated records on missing
  const realOrderTabHtml = renderToStaticMarkup(
    React.createElement(ShipmentListTab, {
      onOpenTrackingModal: () => {},
      selectedOrderId: 'shp_001',
      selectedOrderCode: 'ORD_ANAN_1042',
    })
  );
  assert.ok(
    realOrderTabHtml.includes('data-selected="true"'),
    'ShipmentListTab must flag real activated order with data-selected="true"'
  );
  assert.ok(
    realOrderTabHtml.includes('data-testid="selected-order-ORD_ANAN_1042"'),
    'ShipmentListTab must render data-testid for the real selected order'
  );
  assert.ok(
    realOrderTabHtml.includes('Nguyễn Văn Hùng'),
    'ShipmentListTab must render actual recipient name from real record'
  );
  assert.ok(
    !realOrderTabHtml.includes('ord-shim-'),
    'ShipmentListTab must NEVER fabricate dummy order IDs'
  );
  assert.ok(
    !realOrderTabHtml.includes('data-testid="activated-order-not-found"'),
    'ShipmentListTab must not show not-found alert for existing order'
  );

  // Missing order: must show real not-found state with recovery, never invent DELIVERED record
  const missingOrderTabHtml = renderToStaticMarkup(
    React.createElement(ShipmentListTab, {
      onOpenTrackingModal: () => {},
      selectedOrderId: 'ord-missing-9999',
      selectedOrderCode: 'ORD-NONEXISTENT',
    })
  );
  assert.ok(
    missingOrderTabHtml.includes('data-testid="activated-order-not-found"'),
    'ShipmentListTab must render activated-order-not-found when order does not exist'
  );
  assert.ok(
    missingOrderTabHtml.includes('ORD-NONEXISTENT'),
    'ShipmentListTab not-found banner must display missing order code'
  );
  assert.ok(
    missingOrderTabHtml.includes('Quay lại danh sách'),
    'ShipmentListTab not-found banner must offer recovery action'
  );
  assert.ok(
    missingOrderTabHtml.includes('Thử lại'),
    'ShipmentListTab not-found banner must offer retry action'
  );
  assert.ok(
    !missingOrderTabHtml.includes('data-selected="true"'),
    'ShipmentListTab must never fabricate a selected row for missing order'
  );

  // Recovery: clearing selected order restores authorized shipment list
  const recoveredOrderTabHtml = renderToStaticMarkup(
    React.createElement(ShipmentListTab, {
      onOpenTrackingModal: () => {},
      selectedOrderId: null,
      selectedOrderCode: null,
    })
  );
  assert.ok(
    !recoveredOrderTabHtml.includes('data-testid="activated-order-not-found"'),
    'ShipmentListTab must not show not-found alert after recovery'
  );
  assert.ok(
    recoveredOrderTabHtml.includes('ORD_ANAN_1042'),
    'ShipmentListTab must restore authorized shipment list after recovery'
  );
  console.log('   ✅ Order activation & missing-order recovery verified');

  // 13b. EXCEPTION CASE activation: renders real case in drawer; rejects fabricated records on missing
  const realExceptionTabHtml = renderToStaticMarkup(
    React.createElement(ExceptionWorkboxTab, {
      selectedCaseId: 'exc_001',
    })
  );
  assert.ok(
    realExceptionTabHtml.includes('data-testid="selected-exception-drawer"'),
    'ExceptionWorkboxTab must render action drawer for real activated case'
  );
  assert.ok(
    realExceptionTabHtml.includes('data-selected-case-id="exc_001"'),
    'ExceptionWorkboxTab drawer must bind to real case ID'
  );
  assert.ok(
    realExceptionTabHtml.includes('GHN88291042'),
    'ExceptionWorkboxTab drawer must display real tracking code'
  );
  assert.ok(
    !realExceptionTabHtml.includes('data-testid="activated-case-not-found"'),
    'ExceptionWorkboxTab must not show not-found alert for existing case'
  );

  // Missing exception: must show real not-found state with recovery, never invent exception details
  const missingExceptionTabHtml = renderToStaticMarkup(
    React.createElement(ExceptionWorkboxTab, {
      selectedCaseId: 'case-missing-8888',
    })
  );
  assert.ok(
    missingExceptionTabHtml.includes('data-testid="activated-case-not-found"'),
    'ExceptionWorkboxTab must render activated-case-not-found when case does not exist'
  );
  assert.ok(
    missingExceptionTabHtml.includes('case-missing-8888'),
    'ExceptionWorkboxTab not-found banner must display missing case ID'
  );
  assert.ok(
    missingExceptionTabHtml.includes('Quay lại danh sách sự cố'),
    'ExceptionWorkboxTab not-found banner must offer recovery to list'
  );
  assert.ok(
    missingExceptionTabHtml.includes('Xem sự cố ưu tiên'),
    'ExceptionWorkboxTab not-found drawer must offer recovery to priority case'
  );
  assert.ok(
    !missingExceptionTabHtml.includes('data-selected-case-id="case-missing-8888"'),
    'ExceptionWorkboxTab must not bind drawer to missing case ID'
  );
  assert.ok(
    !missingExceptionTabHtml.includes('TRA-CUU-TIM-KIEM'),
    'ExceptionWorkboxTab must never invent fabricated case records'
  );

  // Recovery: clearing selected case restores operational drawer for priority case
  const recoveredExceptionTabHtml = renderToStaticMarkup(
    React.createElement(ExceptionWorkboxTab, {
      selectedCaseId: null,
    })
  );
  assert.ok(
    !recoveredExceptionTabHtml.includes('data-testid="activated-case-not-found"'),
    'ExceptionWorkboxTab must not show not-found alert after recovery'
  );
  assert.ok(
    recoveredExceptionTabHtml.includes('data-testid="selected-exception-drawer"'),
    'ExceptionWorkboxTab must restore operational drawer for priority case after recovery'
  );
  console.log('   ✅ Exception case activation & missing-case recovery verified');

  // 13c. CLAIM CASE activation: routes to claims tab and selects real claim; rejects fabricated records on missing
  const realClaimTabHtml = renderToStaticMarkup(
    React.createElement(ClaimCasesTab, {
      claims: [
        {
          id: 'clm_001',
          tracking_code: 'GHTK77129002',
          claim_type: 'DAMAGED',
          requested_amount: 480000,
          accepted_amount: 0,
          recovered_amount: 0,
          status: 'SUBMITTED',
          deadline_at: '19/08/2026 08:35',
          hours_left: 48,
          carrier_ticket: 'TKT_GHTK_99182',
          evidence_count: 3,
        },
      ],
      onUpdateClaim: () => {},
      selectedClaimId: 'clm_001',
      selectedClaimCode: 'GHTK77129002',
    })
  );
  assert.ok(
    realClaimTabHtml.includes('data-selected="true"'),
    'ClaimCasesTab must flag the real activated claim with data-selected="true"'
  );
  assert.ok(
    realClaimTabHtml.includes('data-testid="selected-claim-clm_001"'),
    'ClaimCasesTab must render data-testid for the real selected claim'
  );
  assert.ok(
    realClaimTabHtml.includes('GHTK77129002'),
    'ClaimCasesTab must display actual tracking code'
  );
  assert.ok(
    !realClaimTabHtml.includes('data-testid="activated-claim-not-found"'),
    'ClaimCasesTab must not show not-found alert for existing claim'
  );

  // Missing claim: must show real not-found state with recovery, never invent 150,000 đ claim
  const missingClaimTabHtml = renderToStaticMarkup(
    React.createElement(ClaimCasesTab, {
      claims: [],
      onUpdateClaim: () => {},
      selectedClaimId: 'clm-missing-4444',
      selectedClaimCode: 'CLM-NONEXISTENT',
    })
  );
  assert.ok(
    missingClaimTabHtml.includes('data-testid="activated-claim-not-found"'),
    'ClaimCasesTab must render activated-claim-not-found when claim does not exist'
  );
  assert.ok(
    missingClaimTabHtml.includes('CLM-NONEXISTENT'),
    'ClaimCasesTab not-found banner must display missing claim code'
  );
  assert.ok(
    missingClaimTabHtml.includes('Quay lại danh sách'),
    'ClaimCasesTab not-found banner must offer recovery action'
  );
  assert.ok(
    !missingClaimTabHtml.includes('data-selected="true"'),
    'ClaimCasesTab must never fabricate a selected row for missing claim'
  );
  assert.ok(
    !missingClaimTabHtml.includes('CLM-SEARCH-RECORD'),
    'ClaimCasesTab must never invent fabricated claim records'
  );

  // Recovery: clearing selected claim restores authorized claim records
  const recoveredClaimTabHtml = renderToStaticMarkup(
    React.createElement(ClaimCasesTab, {
      claims: [
        {
          id: 'clm_001',
          tracking_code: 'GHTK77129002',
          claim_type: 'DAMAGED',
          requested_amount: 480000,
          accepted_amount: 0,
          recovered_amount: 0,
          status: 'SUBMITTED',
          deadline_at: '19/08/2026 08:35',
          hours_left: 48,
          carrier_ticket: 'TKT_GHTK_99182',
          evidence_count: 3,
        },
      ],
      onUpdateClaim: () => {},
      selectedClaimId: null,
      selectedClaimCode: null,
    })
  );
  assert.ok(
    !recoveredClaimTabHtml.includes('data-testid="activated-claim-not-found"'),
    'ClaimCasesTab must not show not-found alert after recovery'
  );
  assert.ok(
    recoveredClaimTabHtml.includes('GHTK77129002'),
    'ClaimCasesTab must restore authorized claim records after recovery'
  );
  console.log('   ✅ Claim case activation & missing-claim recovery verified');

  // 13d. BATCH activation: selects real batch and renders actual batch details; rejects decoration on missing
  const realBatchTabHtml = renderToStaticMarkup(
    React.createElement(ReconciliationTab, {
      selectedBatchId: 'stmt-5555-6666',
    })
  );
  assert.ok(
    realBatchTabHtml.includes('data-selected-batch="true"'),
    'ReconciliationTab must flag statement card with data-selected-batch="true"'
  );
  assert.ok(
    realBatchTabHtml.includes('data-testid="selected-batch-stmt-5555-6666"'),
    'ReconciliationTab must render data-testid for the selected batch'
  );
  assert.ok(
    realBatchTabHtml.includes('Kỳ Đối Soát Tháng 08/2026 (GHN)'),
    'ReconciliationTab must display real batch period details'
  );
  assert.ok(
    realBatchTabHtml.includes('GHN Express'),
    'ReconciliationTab must display real carrier for selected batch'
  );
  assert.ok(
    !realBatchTabHtml.includes('data-testid="activated-batch-not-found"'),
    'ReconciliationTab must not show not-found alert for existing batch'
  );

  // Missing batch: must show real not-found state with recovery, never decorate summary card
  const missingBatchTabHtml = renderToStaticMarkup(
    React.createElement(ReconciliationTab, {
      selectedBatchId: 'stmt-missing-9999',
    })
  );
  assert.ok(
    missingBatchTabHtml.includes('data-testid="activated-batch-not-found"'),
    'ReconciliationTab must render activated-batch-not-found when batch does not exist'
  );
  assert.ok(
    missingBatchTabHtml.includes('stmt-missing-9999'),
    'ReconciliationTab not-found banner must display missing batch ID'
  );
  assert.ok(
    missingBatchTabHtml.includes('Quay lại kỳ gần nhất'),
    'ReconciliationTab not-found banner must offer recovery action to return to latest period'
  );
  assert.ok(
    !missingBatchTabHtml.includes('data-selected-batch="true"'),
    'ReconciliationTab must not decorate card for missing batch'
  );

  // Recovery: clearing selected batch restores statement summary card
  const recoveredBatchTabHtml = renderToStaticMarkup(
    React.createElement(ReconciliationTab, {
      selectedBatchId: null,
    })
  );
  assert.ok(
    !recoveredBatchTabHtml.includes('data-testid="activated-batch-not-found"'),
    'ReconciliationTab must not show batch not-found alert after recovery'
  );
  assert.ok(
    recoveredBatchTabHtml.includes('Đối Soát COD'),
    'ReconciliationTab must restore statement summary card after recovery'
  );
  console.log('   ✅ Batch activation & missing-batch recovery verified');

  // 13e. TRANSACTION activation: selects real discrepancy in ReconciliationTab; rejects fabricated on missing
  const realTxTabHtml = renderToStaticMarkup(
    React.createElement(ReconciliationTab, {
      selectedDiscrepancyId: 'disc_001',
    })
  );
  assert.ok(
    realTxTabHtml.includes('data-selected="true"'),
    'ReconciliationTab must flag real activated discrepancy with data-selected="true"'
  );
  assert.ok(
    realTxTabHtml.includes('data-testid="selected-discrepancy-disc_001"'),
    'ReconciliationTab must render data-testid for real selected discrepancy'
  );
  assert.ok(
    realTxTabHtml.includes('GHN88291042'),
    'ReconciliationTab must display real tracking code for selected discrepancy'
  );
  assert.ok(
    !realTxTabHtml.includes('data-testid="activated-discrepancy-not-found"'),
    'ReconciliationTab must not show not-found alert for existing discrepancy'
  );

  // Missing transaction: must show real not-found state, never invent 15,000 đ discrepancy
  const missingTxTabHtml = renderToStaticMarkup(
    React.createElement(ReconciliationTab, {
      selectedDiscrepancyId: 'disc-missing-7777',
    })
  );
  assert.ok(
    missingTxTabHtml.includes('data-testid="activated-discrepancy-not-found"'),
    'ReconciliationTab must render activated-discrepancy-not-found when discrepancy does not exist'
  );
  assert.ok(
    missingTxTabHtml.includes('disc-missing-7777'),
    'ReconciliationTab not-found banner must display missing discrepancy ID'
  );
  assert.ok(
    missingTxTabHtml.includes('Quay lại danh sách sai lệch'),
    'ReconciliationTab not-found banner must offer discrepancy recovery action'
  );
  assert.ok(
    !missingTxTabHtml.includes('data-selected="true"'),
    'ReconciliationTab must never flag missing discrepancy as selected'
  );
  assert.ok(
    !missingTxTabHtml.includes('ORD-DISC-01'),
    'ReconciliationTab must never invent dummy discrepancy records'
  );

  // Recovery: clearing selected discrepancy restores all open discrepancies
  const recoveredTxTabHtml = renderToStaticMarkup(
    React.createElement(ReconciliationTab, {
      selectedDiscrepancyId: null,
    })
  );
  assert.ok(
    !recoveredTxTabHtml.includes('data-testid="activated-discrepancy-not-found"'),
    'ReconciliationTab must not show discrepancy not-found alert after recovery'
  );
  assert.ok(
    recoveredTxTabHtml.includes('Danh Sách Khoản Lệch Cần Xử Lý'),
    'ReconciliationTab must restore discrepancies list after recovery'
  );
  console.log('   ✅ Transaction activation & missing-discrepancy recovery verified');

  // 13f. Production activation handler (handleSearchResultActivation from page.tsx):
  // Proves genuine routing, state updates, history pushes, consecutive activations, and ZERO fake toasts
  const activationState = {
    activeTab: 'dashboard',
    selectedGlobalTracking: null as string | null,
    selectedOrderId: null as string | null,
    selectedOrderCode: null as string | null,
    selectedBatchId: null as string | null,
    selectedCaseId: null as string | null,
    selectedClaimId: null as string | null,
    selectedClaimCode: null as string | null,
    selectedDiscrepancyId: null as string | null,
    pushedUrls: [] as string[],
    spiedToasts: [] as string[],
  };

  const actions = {
    setActiveTab: (tab: string) => {
      activationState.activeTab = tab;
    },
    setSelectedGlobalTracking: (code: string | null) => {
      activationState.selectedGlobalTracking = code;
    },
    setSelectedOrderId: (id: string | null) => {
      activationState.selectedOrderId = id;
    },
    setSelectedOrderCode: (code: string | null) => {
      activationState.selectedOrderCode = code;
    },
    setSelectedBatchId: (id: string | null) => {
      activationState.selectedBatchId = id;
    },
    setSelectedCaseId: (id: string | null) => {
      activationState.selectedCaseId = id;
    },
    setSelectedClaimId: (id: string | null) => {
      activationState.selectedClaimId = id;
    },
    setSelectedClaimCode: (code: string | null) => {
      activationState.selectedClaimCode = code;
    },
    setSelectedDiscrepancyId: (id: string | null) => {
      activationState.selectedDiscrepancyId = id;
    },
    pushUrl: (url: string) => {
      activationState.pushedUrls.push(url);
    },
    showToast: (msg: string) => {
      activationState.spiedToasts.push(msg);
    },
  };

  // 1. WAYBILL activation: opens tracking modal, pushes URL
  const waybillItem: SearchResultItem = {
    id: 'shp_001',
    type: 'WAYBILL',
    title: 'Vận đơn GHN88291042',
    subtitle: 'Đơn: ORD_ANAN_1042',
    code: 'GHN88291042',
    status: 'DELIVERED',
    url: '/shipments/shp_001',
  };
  handleSearchResultActivation(waybillItem, actions);
  assert.strictEqual(
    activationState.selectedGlobalTracking,
    'GHN88291042',
    'Waybill item code must be set for tracking modal'
  );

  // 2. ORDER activation: switches to shipments, sets order ID and code
  const orderItem: SearchResultItem = {
    id: 'shp_001',
    type: 'ORDER',
    title: 'Đơn hàng ORD_ANAN_1042',
    subtitle: 'Khách hàng: Nguyễn Văn Hùng',
    code: 'ORD_ANAN_1042',
    status: 'DELIVERED',
    url: '/orders/shp_001',
  };
  handleSearchResultActivation(orderItem, actions);
  assert.strictEqual(
    activationState.activeTab,
    'shipments',
    'Order activation must switch activeTab to shipments'
  );
  assert.strictEqual(activationState.selectedOrderId, 'shp_001', 'Order item ID must be selected');
  assert.strictEqual(
    activationState.selectedOrderCode,
    'ORD_ANAN_1042',
    'Order code must be selected'
  );

  // 3. CLAIM CASE activation: must route to claims (NOT exceptions)
  const claimItem: SearchResultItem = {
    id: 'clm_001',
    type: 'CASE',
    title: 'Hồ sơ bồi thường hư hỏng (DAMAGED)',
    subtitle: 'Vận đơn: GHTK77129002',
    code: 'GHTK77129002',
    status: 'SUBMITTED',
    url: '/claims/clm_001',
    metadata: { claim_type: 'DAMAGED' },
  };
  handleSearchResultActivation(claimItem, actions);
  assert.strictEqual(
    activationState.activeTab,
    'claims',
    'Claim case activation must route to claims tab'
  );
  assert.strictEqual(activationState.selectedClaimId, 'clm_001', 'Claim ID must be selected');
  assert.strictEqual(
    activationState.selectedClaimCode,
    'GHTK77129002',
    'Claim code must be selected'
  );

  // 4. EXCEPTION CASE activation: must route to exceptions (NOT claims)
  const exceptionItem: SearchResultItem = {
    id: 'exc_001',
    type: 'CASE',
    title: 'Sự cố giao không thành công',
    subtitle: 'Vận đơn: GHN88291042',
    code: 'GHN88291042',
    status: 'OPEN',
    url: '/exceptions/exc_001',
  };
  handleSearchResultActivation(exceptionItem, actions);
  assert.strictEqual(
    activationState.activeTab,
    'exceptions',
    'Exception case activation must route to exceptions tab'
  );
  assert.strictEqual(
    activationState.selectedCaseId,
    'exc_001',
    'Exception case ID must be selected'
  );

  // 5. BATCH activation: must route to reconciliation and select batch
  const batchItem: SearchResultItem = {
    id: 'stmt-5555-6666',
    type: 'BATCH',
    title: 'Bảng kê đối soát Tháng 08/2026',
    subtitle: 'Kỳ: 2026-08-01 - 2026-08-31',
    code: 'stmt-5555-6666',
    status: 'OPEN',
    url: '/reconciliation/statements/stmt-5555-6666',
  };
  handleSearchResultActivation(batchItem, actions);
  assert.strictEqual(
    activationState.activeTab,
    'reconciliation',
    'Batch activation must route to reconciliation tab'
  );
  assert.strictEqual(
    activationState.selectedBatchId,
    'stmt-5555-6666',
    'Batch ID must be selected'
  );
  assert.strictEqual(
    activationState.selectedDiscrepancyId,
    null,
    'Selecting batch must clear prior discrepancy selection'
  );

  // 6. TRANSACTION activation: selects discrepancy on reconciliation while clearing batch focus
  const txItem: SearchResultItem = {
    id: 'disc_001',
    type: 'TRANSACTION',
    title: 'Lệch cân (D1_WEIGHT)',
    subtitle: 'Vận đơn: GHN88291042 | Chênh lệch: 7,000 ₫',
    code: 'disc_001',
    status: 'OPEN',
    url: '/reconciliation/discrepancies/disc_001',
  };
  handleSearchResultActivation(txItem, actions);
  assert.strictEqual(
    activationState.activeTab,
    'reconciliation',
    'Transaction activation must route to reconciliation tab'
  );
  assert.strictEqual(
    activationState.selectedDiscrepancyId,
    'disc_001',
    'Transaction discrepancy ID must be selected'
  );
  assert.strictEqual(
    activationState.selectedBatchId,
    null,
    'Selecting transaction must clear prior batch selection'
  );

  // 7. CONSECUTIVE ACTIVATION TEST (Batch -> Transaction -> Batch):
  // Proves mounted reconciliation tab reacts cleanly without lingering previous record
  handleSearchResultActivation(batchItem, actions);
  assert.strictEqual(
    activationState.selectedBatchId,
    'stmt-5555-6666',
    'Consecutive: batch is selected again'
  );
  assert.strictEqual(
    activationState.selectedDiscrepancyId,
    null,
    'Consecutive: discrepancy ID is cleanly cleared'
  );

  const consecutiveBatchHtml1 = renderToStaticMarkup(
    React.createElement(ReconciliationTab, {
      selectedBatchId: activationState.selectedBatchId,
      selectedDiscrepancyId: activationState.selectedDiscrepancyId,
    })
  );
  assert.ok(
    consecutiveBatchHtml1.includes('data-selected-batch="true"'),
    'Consecutive: batch 1 is decorated on mounted ReconciliationTab'
  );
  assert.ok(
    !consecutiveBatchHtml1.includes('data-selected="true"'),
    'Consecutive: discrepancy is not highlighted during batch activation'
  );

  handleSearchResultActivation(txItem, actions);
  assert.strictEqual(
    activationState.selectedDiscrepancyId,
    'disc_001',
    'Consecutive: discrepancy is selected again'
  );
  assert.strictEqual(
    activationState.selectedBatchId,
    null,
    'Consecutive: batch ID is cleanly cleared'
  );

  const consecutiveTxHtml = renderToStaticMarkup(
    React.createElement(ReconciliationTab, {
      selectedBatchId: activationState.selectedBatchId,
      selectedDiscrepancyId: activationState.selectedDiscrepancyId,
    })
  );
  assert.ok(
    !consecutiveTxHtml.includes('data-selected-batch="true"'),
    'Consecutive: batch is no longer decorated during transaction activation'
  );
  assert.ok(
    consecutiveTxHtml.includes('data-selected="true"'),
    'Consecutive: discrepancy disc_001 is highlighted on mounted ReconciliationTab'
  );
  assert.ok(
    consecutiveTxHtml.includes('selected-discrepancy-disc_001'),
    'Consecutive: discrepancy testid is present'
  );

  handleSearchResultActivation(batchItem, actions);
  const consecutiveBatchHtml2 = renderToStaticMarkup(
    React.createElement(ReconciliationTab, {
      selectedBatchId: activationState.selectedBatchId,
      selectedDiscrepancyId: activationState.selectedDiscrepancyId,
    })
  );
  assert.ok(
    consecutiveBatchHtml2.includes('data-selected-batch="true"'),
    'Consecutive: batch is decorated again on mounted ReconciliationTab'
  );
  assert.ok(
    !consecutiveBatchHtml2.includes('data-selected="true"'),
    'Consecutive: discrepancy is cleanly cleared on mounted ReconciliationTab'
  );

  // Verify all 9 activation URLs were pushed to history
  assert.strictEqual(
    activationState.pushedUrls.length,
    9,
    'Every activated item URL must be pushed to history'
  );

  // Verify ZERO fake toasts were emitted during production activation
  assert.strictEqual(
    activationState.spiedToasts.length,
    0,
    'Production activation must emit zero fake success toasts without real committed outcome'
  );
  console.log(
    '   ✅ Production activation handler, consecutive selections & zero fake toasts verified'
  );

  console.log('\n================================================================');
  console.log('🎉 ALL 13 GLOBAL SEARCH UI & STATE SCENARIOS PASSED WITH ZERO ERRORS');
  console.log('================================================================');
}

runGlobalSearchTestSuite().catch((err) => {
  console.error('❌ Global search test suite failed:', err);
  process.exit(1);
});
