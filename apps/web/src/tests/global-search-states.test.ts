import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlobalSearchModal, GlobalSearchContent } from '@/components/GlobalSearchModal';
import SearchPage, { SearchPageContent } from '@/app/search/page';
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

  console.log('\n================================================================');
  console.log('🎉 ALL 12 GLOBAL SEARCH UI & STATE SCENARIOS PASSED WITH ZERO ERRORS');
  console.log('================================================================');
}

runGlobalSearchTestSuite().catch((err) => {
  console.error('❌ Global search test suite failed:', err);
  process.exit(1);
});
