import assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthProvider } from '@/context/AuthContext';
import SessionsPage from '@/app/sessions/page';
import {
  SessionsTab,
  executeFetchSessions,
  executeRevokeSession,
  executeRevokeAll,
  type SessionItem,
} from './SessionsTab';

console.log('================================================================');
console.log('SHIP DE - SESSIONS TAB UI & ACTION TESTS (FEAT-AUTH-06 / Finding 9)');
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

const mockRemoteSession1: SessionItem = {
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

const mockRemoteSession2: SessionItem = {
  session_id: 'remote-session-uuid-3',
  device_id: 'tablet_ipad_03',
  device_model: 'iPad Air 5',
  user_agent: 'Mozilla/5.0 (iPad; CPU OS 17_5)',
  ip_address: '27.72.100.15',
  status: 'ACTIVE',
  last_active_at: new Date(Date.now() - 7200 * 1000).toISOString(),
  expires_at: new Date(Date.now() + 88 * 24 * 60 * 60 * 1000).toISOString(),
  created_at: new Date(Date.now() - 172800 * 1000).toISOString(),
  is_current: false,
};

async function runAsyncTests() {
  // ---------------------------------------------------------------------------
  // TEST 1: SessionsPage mounts SessionsTab from apps/web/src/app/sessions/page.tsx
  // ---------------------------------------------------------------------------
  console.log('[TEST 1] SessionsPage mounts SessionsTab from apps/web/src/app/sessions/page.tsx');
  const pageHtml = renderWithAuth(React.createElement(SessionsPage));
  assert.ok(
    pageHtml.includes('data-testid="sessions-page-wrapper"'),
    'SessionsPage wrapper must be present'
  );
  assert.ok(
    pageHtml.includes('data-testid="sessions-manager"'),
    'SessionsTab must be mounted inside SessionsPage'
  );
  assert.ok(
    pageHtml.includes('Quản Lý Phiên Đăng Nhập &amp; Thiết Bị') ||
      pageHtml.includes('Quản Lý Phiên Đăng Nhập & Thiết Bị'),
    'SessionsTab header must render inside SessionsPage'
  );
  console.log('  PASS: SessionsTab successfully mounted from apps/web/src/app/sessions/page.tsx');

  // ---------------------------------------------------------------------------
  // TEST 2: Duplicate-click locking on in-flight GET (executeFetchSessions)
  // ---------------------------------------------------------------------------
  console.log('[TEST 2] Duplicate-click locking on in-flight GET');
  let fetchDispatchedCount = 0;
  const originalFetch = global.fetch;

  try {
    global.fetch = (async () => {
      fetchDispatchedCount++;
      return new Response(JSON.stringify({ data: [mockCurrentSession] }), { status: 200 });
    }) as any;

    let currentState = 'loading';
    const lockResult = await executeFetchSessions({
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      sessions: [mockCurrentSession],
      isFetching: true, // Already in flight!
      setFetchState: (s) => {
        currentState = s;
      },
      setSessions: () => {},
      setErrorMessage: () => {},
      setValidationMessage: () => {},
      setActionError: () => {},
      setIsFetching: () => {},
    });

    assert.strictEqual(lockResult.executed, false, 'In-flight fetch must not dispatch');
    assert.strictEqual(lockResult.locked, true, 'Result must indicate locked=true');
    assert.strictEqual(fetchDispatchedCount, 0, 'No fetch calls made while in flight');
    assert.strictEqual(currentState, 'loading', 'State must not change');
    console.log('  PASS: In-flight GET locks duplicate clicks');

    // Case 2b: In-flight ref tracking during execution
    const testFetchingRef = { current: false };
    const successResult = await executeFetchSessions({
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      sessions: [],
      isFetching: false,
      isFetchingRef: testFetchingRef,
      setFetchState: (s) => {
        currentState = s;
      },
      setSessions: (sess) => {
        assert.strictEqual(sess.length, 1);
        // During setSessions execution, in-flight ref is still locked
        assert.strictEqual(
          testFetchingRef.current,
          true,
          'isFetchingRef must be locked during fetch lifecycle'
        );
      },
      setErrorMessage: () => {},
      setValidationMessage: () => {},
      setActionError: () => {},
      setIsFetching: () => {},
    });

    assert.strictEqual(successResult.executed, true);
    assert.strictEqual(successResult.success, true);
    assert.strictEqual(fetchDispatchedCount, 1);
    assert.strictEqual(currentState, 'success');
    assert.strictEqual(
      testFetchingRef.current,
      false,
      'isFetchingRef must reset to false after completion'
    );
    console.log(
      '  PASS: Unlocked GET dispatches fetch, locks in-flight ref, and transitions to success'
    );

    // Case 2c: In-flight ref prevents concurrent second dispatch
    const lockedByRef = await executeFetchSessions({
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      sessions: [mockCurrentSession],
      isFetching: false,
      isFetchingRef: { current: true },
      setFetchState: () => {},
      setSessions: () => {},
      setErrorMessage: () => {},
      setValidationMessage: () => {},
      setActionError: () => {},
      setIsFetching: () => {},
    });
    assert.strictEqual(lockedByRef.executed, false);
    assert.strictEqual(lockedByRef.locked, true);
    console.log('  PASS: isFetchingRef locks concurrent dispatches');
  } finally {
    global.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Real revocation execution, toast confirmation, and duplicate-click locking
  // ---------------------------------------------------------------------------
  console.log('[TEST 3] Real revocation execution, toast message, and duplicate-click locking');
  try {
    let toastMessage: string | null = null;
    let targetSessions = [mockCurrentSession, mockRemoteSession1];

    // Case 3a: In-flight locking prevents duplicate revocation click
    const lockedRevoke = await executeRevokeSession({
      sessionId: mockRemoteSession1.session_id,
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      revokingId: mockRemoteSession1.session_id, // in-flight!
      revokeAllLoading: false,
      isFetching: false,
      setRevokingId: () => {},
      setActionError: () => {},
      setValidationMessage: () => {},
      setSessions: () => {},
      onToast: (msg) => {
        toastMessage = msg;
      },
    });
    assert.strictEqual(lockedRevoke.executed, false);
    assert.strictEqual(lockedRevoke.locked, true);
    assert.strictEqual(toastMessage, null, 'No toast on duplicate click');

    // Case 3b: Real successful revocation
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({
          session_id: mockRemoteSession1.session_id,
          status: 'REVOKED',
          message: 'Đã thu hồi 1 phiên làm việc',
        }),
        { status: 200 }
      );
    }) as any;

    const successRevoke = await executeRevokeSession({
      sessionId: mockRemoteSession1.session_id,
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      revokingId: null,
      revokeAllLoading: false,
      isFetching: false,
      setRevokingId: () => {},
      setActionError: () => {},
      setValidationMessage: () => {},
      setSessions: (updater: any) => {
        targetSessions = updater(targetSessions);
      },
      onToast: (msg) => {
        toastMessage = msg;
      },
    });

    assert.strictEqual(successRevoke.executed, true);
    assert.strictEqual(successRevoke.success, true);
    assert.strictEqual(successRevoke.message, 'Đã thu hồi 1 phiên làm việc');
    assert.strictEqual(toastMessage, 'Đã thu hồi 1 phiên làm việc');

    const updatedRemote = targetSessions.find(
      (s) => s.session_id === mockRemoteSession1.session_id
    );
    assert.strictEqual(
      updatedRemote?.status,
      'REVOKED',
      'Session status must transition to REVOKED'
    );
    console.log(
      '  PASS: Single session revocation executed, updated to REVOKED, and triggered toast'
    );
  } finally {
    global.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Real revoke-all execution, exact revoked_count, and duplicate-click locking
  // ---------------------------------------------------------------------------
  console.log(
    '[TEST 4] Real revoke-all execution, exact revoked_count, and duplicate-click locking'
  );
  try {
    let toastMessage: string | null = null;
    let targetSessions = [mockCurrentSession, mockRemoteSession1, mockRemoteSession2];

    // Case 4a: In-flight locking prevents duplicate click
    const lockedRevokeAll = await executeRevokeAll({
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      includeCurrent: false,
      revokeAllLoading: true, // in flight!
      revokingId: null,
      isFetching: false,
      setRevokeAllLoading: () => {},
      setActionError: () => {},
      setSessions: () => {},
      setFetchState: () => {},
      setRevokeAllOpen: () => {},
      onToast: (msg) => {
        toastMessage = msg;
      },
    });
    assert.strictEqual(lockedRevokeAll.executed, false);
    assert.strictEqual(lockedRevokeAll.locked, true);
    assert.strictEqual(toastMessage, null);

    // Case 4b: Real successful revoke-all
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({
          revoked_count: 2,
          message: 'Đã thu hồi 2 phiên làm việc',
        }),
        { status: 200 }
      );
    }) as any;

    let dialogOpen = true;
    const successRevokeAll = await executeRevokeAll({
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      includeCurrent: false,
      revokeAllLoading: false,
      revokingId: null,
      isFetching: false,
      setRevokeAllLoading: () => {},
      setActionError: () => {},
      setSessions: (updater: any) => {
        targetSessions = updater(targetSessions);
      },
      setFetchState: () => {},
      setRevokeAllOpen: (open) => {
        dialogOpen = open;
      },
      onToast: (msg) => {
        toastMessage = msg;
      },
    });

    assert.strictEqual(successRevokeAll.executed, true);
    assert.strictEqual(successRevokeAll.success, true);
    assert.strictEqual(successRevokeAll.revokedCount, 2, 'Exact revoked_count must match 2');
    assert.strictEqual(toastMessage, 'Đã thu hồi 2 phiên làm việc');
    assert.strictEqual(dialogOpen, false, 'Confirmation dialog must close on success');

    const remote1 = targetSessions.find((s) => s.session_id === mockRemoteSession1.session_id);
    const remote2 = targetSessions.find((s) => s.session_id === mockRemoteSession2.session_id);
    const current = targetSessions.find((s) => s.session_id === mockCurrentSession.session_id);
    assert.strictEqual(remote1?.status, 'REVOKED');
    assert.strictEqual(remote2?.status, 'REVOKED');
    assert.strictEqual(
      current?.status,
      'ACTIVE',
      'Current session must remain ACTIVE when include_current=false'
    );
    console.log(
      '  PASS: Revoke-all executed, remote sessions updated, and toast asserted with revoked count'
    );
  } finally {
    global.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // Static UI Render Tests (AC-SESS-03, AC-SESS-04, Error recovery, Forbidden, Validation)
  // ---------------------------------------------------------------------------
  console.log('[TEST 5 / AC-SESS-04] Loading state renders skeleton with disabled buttons');
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
    'Must have aria-label'
  );
  assert.ok(htmlLoading.includes('aria-busy="true"'), 'Must indicate aria-busy=true');
  assert.ok(htmlLoading.includes('animate-pulse'), 'Skeleton must have pulse animation');
  assert.ok(htmlLoading.includes('disabled'), 'Buttons must be disabled in loading state');
  console.log('  PASS: AC-SESS-04 Skeleton placeholder rendered and controls disabled');

  console.log('[TEST 6 / AC-SESS-03] Empty remote state displays Vietnamese empty message');
  const htmlEmptyRemote = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'empty',
      initialSessions: [mockCurrentSession],
      authToken: 'dummy-token',
    })
  );
  assert.ok(htmlEmptyRemote.includes('Thiết bị này'), 'Must show current session card');
  assert.ok(htmlEmptyRemote.includes('MacBook Pro 16 (Chrome 128)'), 'Must show device model');
  assert.ok(
    htmlEmptyRemote.includes('Không có thiết bị đăng nhập nào khác'),
    'Must display exact Vietnamese empty remote sessions message'
  );
  console.log('  PASS: AC-SESS-03 Empty remote sessions message correctly rendered');

  console.log('[TEST 7] Active remote sessions listing renders device cards and revoke buttons');
  const htmlWithRemote = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'success',
      initialSessions: [mockCurrentSession, mockRemoteSession1],
      authToken: 'dummy-token',
    })
  );
  assert.ok(htmlWithRemote.includes('iPhone 16 Pro (Safari Mobile)'));
  assert.ok(htmlWithRemote.includes('Đang hoạt động'));
  assert.ok(htmlWithRemote.includes('Thu hồi'));
  assert.ok(htmlWithRemote.includes('Đăng xuất thiết bị khác (1)'));
  console.log('  PASS: Active remote sessions and revoke buttons correctly rendered');

  console.log(
    '[TEST 8] Error state renders alert banner with retry button without blanking existing'
  );
  const htmlError = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'error',
      initialSessions: [mockCurrentSession],
      initialErrorMessage: 'Lỗi kết nối máy chủ',
      authToken: 'dummy-token',
    })
  );
  assert.ok(htmlError.includes('role="alert"'));
  assert.ok(htmlError.includes('Lỗi kết nối máy chủ'));
  assert.ok(htmlError.includes('Thử lại'));
  assert.ok(htmlError.includes('MacBook Pro 16'), 'Existing session state must not be blanked');
  console.log('  PASS: Error banner rendered without blanking existing state');

  console.log('[TEST 9] Forbidden state renders permission denied notice');
  const htmlForbidden = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'forbidden',
      authToken: 'dummy-token',
    })
  );
  assert.ok(htmlForbidden.includes('role="alert"'));
  assert.ok(htmlForbidden.includes('Không có quyền truy cập'));
  console.log('  PASS: Forbidden notice rendered');

  console.log('[TEST 10] Validation error state renders validation alert banner');
  const htmlValidation = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'validation',
      initialSessions: [mockCurrentSession],
      initialValidationMessage: 'Định dạng mã phiên không hợp lệ (UUID required)',
      authToken: 'dummy-token',
    })
  );
  assert.ok(htmlValidation.includes('role="alert"'));
  assert.ok(htmlValidation.includes('Định dạng mã phiên không hợp lệ'));
  console.log('  PASS: Validation error banner rendered');

  console.log('[TEST 11] Default mount without initial props renders loading skeleton cleanly');
  const htmlDefaultMount = renderWithAuth(
    React.createElement(SessionsTab, {
      authToken: 'dummy-token',
    })
  );
  assert.ok(htmlDefaultMount.includes('data-testid="sessions-manager"'));
  assert.ok(htmlDefaultMount.includes('data-testid="sessions-loading-skeleton"'));
  assert.ok(htmlDefaultMount.includes('aria-busy="true"'));
  console.log('  PASS: Default mount renders loading skeleton cleanly');

  console.log('================================================================');
  console.log('ALL SESSIONS TAB UI & ACTION TESTS PASSED 100%');
  console.log('================================================================');
}

void runAsyncTests();
