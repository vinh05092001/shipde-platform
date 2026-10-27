import assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthProvider } from '@/context/AuthContext';
import { SessionsTab, type SessionItem } from './SessionsTab';

console.log('================================================================');
console.log('SHIP DE - SESSIONS TAB UI COMPONENT TESTS (AC-SESS-03 & 04)');
console.log('================================================================');

function renderWithAuth(element: React.ReactElement): string {
  return renderToStaticMarkup(React.createElement(AuthProvider, null, element));
}

const mockCurrentSession: SessionItem = {
  session_id: 'current-session-uuid-1',
  device_id: 'browser_desktop_01',
  device_model: 'MacBook Pro 16 (Chrome 128)',
  user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  ip_address: '113.161.45.22',
  status: 'ACTIVE',
  last_active_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  created_at: new Date().toISOString(),
  is_current: true,
};

const mockRemoteSession: SessionItem = {
  session_id: 'remote-session-uuid-2',
  device_id: 'mobile_iphone_02',
  device_model: 'iPhone 16 Pro (Safari Mobile)',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',
  ip_address: '14.162.88.99',
  status: 'ACTIVE',
  last_active_at: new Date(Date.now() - 3600 * 1000).toISOString(),
  expires_at: new Date(Date.now() + 89 * 24 * 60 * 60 * 1000).toISOString(),
  created_at: new Date(Date.now() - 86400 * 1000).toISOString(),
  is_current: false,
};

// -----------------------------------------------------------------------------
// AC-SESS-04: Loading state renders skeleton and disabled interactive controls
// -----------------------------------------------------------------------------
console.log('[TEST 1 / AC-SESS-04] Loading state renders skeleton with disabled buttons');
const htmlLoading = renderWithAuth(
  React.createElement(SessionsTab, {
    initialState: 'loading',
    initialSessions: [],
    authToken: 'dummy-token',
  })
);

assert.ok(htmlLoading.includes('role="status"'), 'Must have role=status for a11y');
assert.ok(
  htmlLoading.includes('aria-label="Đang tải danh sách thiết bị"'),
  'Must have descriptive aria-label'
);
assert.ok(htmlLoading.includes('aria-busy="true"'), 'Must indicate aria-busy=true');
assert.ok(htmlLoading.includes('animate-pulse'), 'Skeleton must have pulse animation');
assert.ok(htmlLoading.includes('disabled'), 'Buttons must be disabled in loading state');
console.log('  PASS: AC-SESS-04 Skeleton placeholder rendered and controls disabled');

// -----------------------------------------------------------------------------
// AC-SESS-03: Empty remote sessions state renders clear empty message
// -----------------------------------------------------------------------------
console.log(
  '[TEST 2 / AC-SESS-03] Empty remote state displays "Không có thiết bị đăng nhập nào khác"'
);
const htmlEmptyRemote = renderWithAuth(
  React.createElement(SessionsTab, {
    initialState: 'empty',
    initialSessions: [mockCurrentSession],
    authToken: 'dummy-token',
  })
);

assert.ok(
  htmlEmptyRemote.includes('Thiết bị này'),
  'Must show current session card with "Thiết bị này" badge'
);
assert.ok(
  htmlEmptyRemote.includes('MacBook Pro 16 (Chrome 128)'),
  'Must show current device model'
);
assert.ok(
  htmlEmptyRemote.includes('Không có thiết bị đăng nhập nào khác'),
  'Must display exact Vietnamese empty remote sessions message'
);
assert.ok(
  htmlEmptyRemote.includes('Tài khoản của bạn hiện chỉ đang hoạt động trên thiết bị này'),
  'Must display helpful description'
);
console.log('  PASS: AC-SESS-03 Empty remote sessions message correctly rendered');

// -----------------------------------------------------------------------------
// TEST 3: Active remote sessions listing
// -----------------------------------------------------------------------------
console.log('[TEST 3] Active remote sessions listing renders device cards and revoke buttons');
const htmlWithRemote = renderWithAuth(
  React.createElement(SessionsTab, {
    initialState: 'success',
    initialSessions: [mockCurrentSession, mockRemoteSession],
    authToken: 'dummy-token',
  })
);

assert.ok(
  htmlWithRemote.includes('iPhone 16 Pro (Safari Mobile)'),
  'Must render remote device model'
);
assert.ok(htmlWithRemote.includes('Đang hoạt động'), 'Must show active badge for remote device');
assert.ok(htmlWithRemote.includes('Thu hồi'), 'Must render individual Thu hồi button');
assert.ok(
  htmlWithRemote.includes('Đăng xuất thiết bị khác (1)'),
  'Must render Revoke-all button with active remote count'
);
console.log('  PASS: Active remote sessions and revoke buttons correctly rendered');

// -----------------------------------------------------------------------------
// TEST 4: Error state renders alert with retry button without blanking existing
// -----------------------------------------------------------------------------
console.log('[TEST 4] Error state renders alert banner with retry button');
const htmlError = renderWithAuth(
  React.createElement(SessionsTab, {
    initialState: 'error',
    initialSessions: [mockCurrentSession],
    initialErrorMessage: 'Lỗi kết nối máy chủ',
    authToken: 'dummy-token',
  })
);

assert.ok(htmlError.includes('role="alert"'), 'Must have role=alert');
assert.ok(htmlError.includes('Lỗi kết nối máy chủ'), 'Must show error message');
assert.ok(htmlError.includes('Thử lại'), 'Must render retry button');
assert.ok(htmlError.includes('MacBook Pro 16'), 'Existing session state must not be blanked');
console.log('  PASS: Error banner with retry capability rendered without blanking state');

// -----------------------------------------------------------------------------
// TEST 5: Forbidden state (403) renders permission denied notice
// -----------------------------------------------------------------------------
console.log('[TEST 5] Forbidden state renders permission denied notice');
const htmlForbidden = renderWithAuth(
  React.createElement(SessionsTab, {
    initialState: 'forbidden',
    authToken: 'dummy-token',
  })
);

assert.ok(htmlForbidden.includes('role="alert"'), 'Must have role=alert');
assert.ok(
  htmlForbidden.includes('Không có quyền truy cập'),
  'Must display forbidden permission denied title'
);
console.log('  PASS: Forbidden notice rendered');

// -----------------------------------------------------------------------------
// TEST 6: Validation error state renders validation alert
// -----------------------------------------------------------------------------
console.log('[TEST 6] Validation error state renders validation alert banner');
const htmlValidation = renderWithAuth(
  React.createElement(SessionsTab, {
    initialState: 'validation',
    initialSessions: [mockCurrentSession],
    initialValidationMessage: 'Định dạng mã phiên không hợp lệ (UUID required)',
    authToken: 'dummy-token',
  })
);

assert.ok(htmlValidation.includes('role="alert"'), 'Must have role=alert');
assert.ok(
  htmlValidation.includes('Định dạng mã phiên không hợp lệ'),
  'Must display validation error message'
);
console.log('  PASS: Validation error banner rendered');

console.log('================================================================');
console.log('ALL SESSIONS TAB UI COMPONENT TESTS PASSED');
console.log('================================================================');
