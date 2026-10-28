import assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthProvider } from '@/context/AuthContext';
import SessionsPage from '@/app/sessions/page';
import {
  SessionsTab,
  createSessionHandlers,
  executeFetchSessions,
  executeRevokeSession,
  executeRevokeAll,
  formatDisplayIp,
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

    // Case 3c: In-flight ref tracking during execution
    const testRevokingRef = { current: null as string | null };
    const trackingRevoke = await executeRevokeSession({
      sessionId: mockRemoteSession1.session_id,
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      revokingId: null,
      revokingIdRef: testRevokingRef,
      revokeAllLoading: false,
      isFetching: false,
      setRevokingId: () => {},
      setActionError: () => {},
      setValidationMessage: () => {},
      setSessions: (updater: any) => {
        // While executeRevokeSession runs, revokingIdRef must be set to target sessionId
        assert.strictEqual(
          testRevokingRef.current,
          mockRemoteSession1.session_id,
          'revokingIdRef must hold active session_id during execution'
        );
      },
      onToast: () => {},
    });
    assert.strictEqual(trackingRevoke.executed, true);
    assert.strictEqual(
      testRevokingRef.current,
      null,
      'revokingIdRef must reset to null after execution'
    );

    // Case 3d: In-flight revokingIdRef locks duplicate click before next paint
    const lockedByRevokingRef = await executeRevokeSession({
      sessionId: mockRemoteSession1.session_id,
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      revokingId: null, // React state closure still null before re-render
      revokingIdRef: { current: mockRemoteSession1.session_id }, // Ref synchronously locked!
      revokeAllLoading: false,
      isFetching: false,
      setRevokingId: () => {},
      setActionError: () => {},
      setValidationMessage: () => {},
      setSessions: () => {},
    });
    assert.strictEqual(
      lockedByRevokingRef.executed,
      false,
      'Pre-paint duplicate click must be locked'
    );
    assert.strictEqual(lockedByRevokingRef.locked, true);

    // Case 3e: Live revoke is locked when isFetching or fetchState === 'loading'
    const lockedByFetching = await executeRevokeSession({
      sessionId: mockRemoteSession1.session_id,
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      revokingId: null,
      revokeAllLoading: false,
      isFetching: true,
      setRevokingId: () => {},
      setActionError: () => {},
      setValidationMessage: () => {},
      setSessions: () => {},
    });
    assert.strictEqual(lockedByFetching.executed, false);
    assert.strictEqual(lockedByFetching.locked, true);

    const lockedByLoadingState = await executeRevokeSession({
      sessionId: mockRemoteSession1.session_id,
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      revokingId: null,
      revokeAllLoading: false,
      isFetching: false,
      fetchState: 'loading',
      setRevokingId: () => {},
      setActionError: () => {},
      setValidationMessage: () => {},
      setSessions: () => {},
    });
    assert.strictEqual(lockedByLoadingState.executed, false);
    assert.strictEqual(lockedByLoadingState.locked, true);

    console.log(
      '  PASS: Single session revocation executed, updated to REVOKED, and triggered toast'
    );
    console.log(
      '  PASS: AC-SESS-04 executeRevokeSession locks duplicate clicks via revokingIdRef, isFetching, and fetchState'
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

    // Case 4c: revoked_count: 0 leaves listed devices unchanged and preserves prior EXPIRED status
    const mockExpiredSession: SessionItem = {
      ...mockRemoteSession2,
      session_id: 'expired-session-uuid-4',
      status: 'EXPIRED',
    };
    let countZeroSessions = [mockCurrentSession, mockRemoteSession1, mockExpiredSession];
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({
          revoked_count: 0,
          message: 'Không có phiên nào cần thu hồi',
        }),
        { status: 200 }
      );
    }) as any;

    const zeroRevokeAll = await executeRevokeAll({
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      includeCurrent: false,
      revokeAllLoading: false,
      revokingId: null,
      isFetching: false,
      setRevokeAllLoading: () => {},
      setActionError: () => {},
      setSessions: (updater: any) => {
        countZeroSessions = updater(countZeroSessions);
      },
      setFetchState: () => {},
      setRevokeAllOpen: () => {},
      onToast: (msg) => {
        toastMessage = msg;
      },
    });

    assert.strictEqual(zeroRevokeAll.executed, true);
    assert.strictEqual(zeroRevokeAll.revokedCount, 0);
    assert.strictEqual(toastMessage, 'Không có phiên nào cần thu hồi');
    // Verify listed devices unchanged
    assert.strictEqual(countZeroSessions[0].status, 'ACTIVE');
    assert.strictEqual(countZeroSessions[1].status, 'ACTIVE');
    assert.strictEqual(countZeroSessions[2].status, 'EXPIRED');
    console.log('  PASS: revoked_count=0 leaves listed devices and prior statuses unchanged');
  } finally {
    global.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // Static UI Render Tests (AC-SESS-03, AC-SESS-04, Error recovery, Forbidden, Validation)
  // ---------------------------------------------------------------------------
  console.log(
    '[TEST 5 / AC-SESS-04] Loading state renders skeleton with disabled buttons and locks live controls'
  );
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

  // Test 5b: Live session revoke button is strictly disabled when sessions exist during loading
  const htmlLiveLoading = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'loading',
      initialSessions: [mockCurrentSession, mockRemoteSession1],
      authToken: 'dummy-token',
    })
  );
  assert.ok(
    htmlLiveLoading.includes('data-testid="revoke-btn-remote-session-uuid-2"'),
    'Live revoke button must be rendered'
  );
  assert.match(
    htmlLiveLoading,
    /data-testid="revoke-btn-remote-session-uuid-2"[^>]*disabled/,
    'Live revoke button must have disabled attribute when initialState is loading'
  );

  // Test 5c: Live session revoke button is strictly disabled when initialIsFetching is true
  const htmlLiveFetching = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'success',
      initialSessions: [mockCurrentSession, mockRemoteSession1],
      initialIsFetching: true,
      authToken: 'dummy-token',
    })
  );
  assert.match(
    htmlLiveFetching,
    /data-testid="revoke-btn-remote-session-uuid-2"[^>]*disabled/,
    'Live revoke button must have disabled attribute when initialIsFetching is true'
  );
  assert.match(
    htmlLiveFetching,
    /data-testid="revoke-all-button"[^>]*disabled/,
    'Revoke all button must have disabled attribute when initialIsFetching is true'
  );

  console.log(
    '  PASS: AC-SESS-04 Skeleton placeholder rendered and all live controls strictly disabled during loading/fetching'
  );

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

  // ---------------------------------------------------------------------------
  // TEST 12: 401 drives login recovery; 403 drives forbidden notice (AC-SESS-06, AC-SESS-19)
  // ---------------------------------------------------------------------------
  console.log('[TEST 12] 401 drives login recovery; only 403 drives forbidden notice');
  try {
    let capturedState = '';
    let capturedActionError: string | null = null;

    // Case 12a: 401 on empty session list sets unauthenticated state
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'SESSION_INVALID',
            message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ',
            retryable: false,
            next_action: 'LOGIN',
          },
        }),
        { status: 401 }
      );
    }) as any;

    const res401Empty = await executeFetchSessions({
      baseUrl: 'http://localhost:3001',
      token: 'expired-token',
      sessions: [],
      setFetchState: (s) => {
        capturedState = s;
      },
      setSessions: () => {},
      setErrorMessage: () => {},
      setValidationMessage: () => {},
      setActionError: (err) => {
        capturedActionError = err;
      },
      setIsFetching: () => {},
    });

    assert.strictEqual(res401Empty.executed, true);
    assert.strictEqual(res401Empty.success, false);
    assert.strictEqual(res401Empty.error, 'SESSION_INVALID');
    assert.strictEqual(
      capturedState,
      'unauthenticated',
      'Empty list on 401 must transition to unauthenticated'
    );
    assert.strictEqual(capturedActionError, null);

    // Case 12b: 401 with existing rows sets actionError without mentioning 403 FORBIDDEN
    const actionErrorHolder = { current: null as string | null };
    const res401WithRows = await executeFetchSessions({
      baseUrl: 'http://localhost:3001',
      token: 'expired-token',
      sessions: [mockCurrentSession],
      setFetchState: (s) => {
        capturedState = s;
      },
      setSessions: () => {},
      setErrorMessage: () => {},
      setValidationMessage: () => {},
      setActionError: (err) => {
        actionErrorHolder.current = err;
      },
      setIsFetching: () => {},
    });

    assert.strictEqual(res401WithRows.executed, true);
    assert.strictEqual(res401WithRows.success, false);
    const capturedMsg = actionErrorHolder.current || '';
    assert.ok(capturedMsg.includes('hết hạn') || capturedMsg.includes('đăng nhập lại'));
    assert.ok(!capturedMsg.includes('403'), '401 must not display 403 FORBIDDEN notice');
    assert.ok(!capturedMsg.includes('FORBIDDEN'));

    // Case 12c: Real 403 sets forbidden state
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            message: 'Không có quyền truy cập',
          },
        }),
        { status: 403 }
      );
    }) as any;

    const res403 = await executeFetchSessions({
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      sessions: [],
      setFetchState: (s) => {
        capturedState = s;
      },
      setSessions: () => {},
      setErrorMessage: () => {},
      setValidationMessage: () => {},
      setActionError: () => {},
      setIsFetching: () => {},
    });

    assert.strictEqual(res403.executed, true);
    assert.strictEqual(res403.success, false);
    assert.strictEqual(res403.error, 'FORBIDDEN');
    assert.strictEqual(capturedState, 'forbidden');
    console.log('  PASS: 401 drives unauthenticated recovery; 403 drives forbidden state');
  } finally {
    global.fetch = originalFetch;
  }

  console.log('[TEST 13] Unauthenticated state renders login recovery prompt with login link');
  const htmlUnauthenticated = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'unauthenticated',
      authToken: 'dummy-token',
    })
  );
  assert.ok(htmlUnauthenticated.includes('role="alert"'));
  assert.ok(htmlUnauthenticated.includes('data-testid="unauthenticated-alert"'));
  assert.ok(htmlUnauthenticated.includes('data-testid="login-recovery-button"'));
  assert.ok(htmlUnauthenticated.includes('Đăng nhập lại'));
  assert.ok(htmlUnauthenticated.includes('href="/auth/login"'));
  console.log('  PASS: Unauthenticated alert and login recovery link rendered');

  // ---------------------------------------------------------------------------
  // TEST 14 / AC-SESS-04: Loader2 spinner rendering on in-flight actions
  // ---------------------------------------------------------------------------
  console.log(
    '[TEST 14 / AC-SESS-04] Loader2 spinner renders without ReferenceError on in-flight states'
  );
  // 14a: Single revoke in-flight shows Loader2 spinner and "Đang thu hồi..."
  const htmlRevoking = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'success',
      initialSessions: [mockCurrentSession, mockRemoteSession1],
      initialRevokingId: mockRemoteSession1.session_id,
      authToken: 'dummy-token',
    })
  );
  assert.ok(
    htmlRevoking.includes('Đang thu hồi...'),
    'Single revoke in-flight must render "Đang thu hồi..." label'
  );
  assert.ok(
    htmlRevoking.includes('animate-spin text-red-600'),
    'Single revoke must render Loader2 spinner with animate-spin text-red-600'
  );

  // 14b: Revoke-all in-flight shows Loader2 spinner in confirmation dialog
  const htmlRevokeAllInFlight = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'success',
      initialSessions: [mockCurrentSession, mockRemoteSession1],
      initialRevokeAllOpen: true,
      initialRevokeAllLoading: true,
      authToken: 'dummy-token',
    })
  );
  assert.ok(
    htmlRevokeAllInFlight.includes('data-testid="confirm-revoke-all-button"'),
    'Dialog confirm button must be rendered'
  );
  assert.ok(
    htmlRevokeAllInFlight.includes('animate-spin'),
    'Revoke-all in-flight must render Loader2 spinner with animate-spin'
  );

  // 14c: Retry fetch in-flight shows Loader2 spinner and "Đang thử lại..."
  const htmlRetryInFlight = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'error',
      initialSessions: [mockCurrentSession],
      initialErrorMessage: 'Lỗi tải phiên',
      initialIsFetching: true,
      authToken: 'dummy-token',
    })
  );
  assert.ok(
    htmlRetryInFlight.includes('Đang thử lại...'),
    'Retry button in-flight must render "Đang thử lại..." label'
  );
  assert.ok(
    htmlRetryInFlight.includes('animate-spin'),
    'Retry button in-flight must render Loader2 spinner with animate-spin'
  );
  console.log(
    '  PASS: AC-SESS-04 Loader2 inline spinner successfully rendered across all in-flight states'
  );

  // 15: Finding 2 / Finding 9: 64-char HMAC hash is omitted from UI display
  const hmacHex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  assert.strictEqual(
    formatDisplayIp(hmacHex),
    null,
    'formatDisplayIp must return null for 64-char HMAC hash'
  );
  assert.strictEqual(
    formatDisplayIp('192.168.1.1'),
    '192.168.1.1',
    'formatDisplayIp must preserve regular IP strings'
  );

  const sessionWithHmac: SessionItem = {
    ...mockRemoteSession1,
    ip_address: hmacHex,
  };
  const htmlWithHmac = renderWithAuth(
    React.createElement(SessionsTab, {
      initialState: 'success',
      initialSessions: [mockCurrentSession, sessionWithHmac],
      authToken: 'dummy-token',
    })
  );
  assert.ok(
    !htmlWithHmac.includes(hmacHex),
    'UI must not render raw 64-char hex HMAC string as IP'
  );
  console.log('  PASS: Finding 9 - HMAC hash is omitted from UI display to avoid confusing user');

  // 16: Finding 10: executeFetchSessions handles missing isFetching gracefully
  let setFetchCalled = false;
  await executeFetchSessions({
    baseUrl: 'http://localhost',
    token: null,
    setFetchState: () => {
      setFetchCalled = true;
    },
    setSessions: () => {},
    setErrorMessage: () => {},
    setValidationMessage: () => {},
    setActionError: () => {},
    setIsFetching: () => {},
  });
  assert.strictEqual(
    setFetchCalled,
    true,
    'executeFetchSessions works when isFetching is undefined'
  );
  console.log('  PASS: Finding 10 - executeFetchSessions handles undefined isFetching gracefully');

  // ---------------------------------------------------------------------------
  // TEST 17: Handler driver for single revoke (handleRevoke)
  // (click -> fetch called once, spinner, failure clears lock, retry works, double-click does one request)
  // ---------------------------------------------------------------------------
  console.log(
    '[TEST 17] Driver for handleRevoke: first-click dispatches, spinner, double-click locks, failure clears lock, retry works'
  );
  try {
    let revokingIdState: string | null = null;
    const revokingIdRef = { current: null as string | null };
    const revokeAllLoadingRef = { current: false };
    const isFetchingRef = { current: false };
    let targetSessions = [mockCurrentSession, mockRemoteSession1];
    let fetchCount = 0;
    let toastMsg: string | null = null;
    let actionErrMsg: string | null = null;

    let resolveFetch: ((res: Response) => void) | null = null;

    global.fetch = (() => {
      fetchCount++;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as any;

    const handlers = createSessionHandlers({
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      revokingIdRef,
      revokeAllLoadingRef,
      isFetchingRef,
      fetchState: 'success',
      setRevokingId: (id) => {
        revokingIdState = id;
      },
      setRevokeAllLoading: () => {},
      setActionError: (msg) => {
        actionErrMsg = msg;
      },
      setValidationMessage: () => {},
      setSessions: (updater: any) => {
        targetSessions = updater(targetSessions);
      },
      setFetchState: () => {},
      setRevokeAllOpen: () => {},
      onToast: (msg) => {
        toastMsg = msg;
      },
    });

    // 17a: First click dispatches fetch once and shows spinner (revokingId set synchronously)
    const pendingPromise = handlers.handleRevoke(mockRemoteSession1.session_id);

    assert.strictEqual(fetchCount, 1, 'First click must call fetch exactly once');
    assert.strictEqual(
      revokingIdRef.current,
      mockRemoteSession1.session_id,
      'revokingIdRef must be locked to sessionId immediately on click'
    );
    assert.strictEqual(
      revokingIdState,
      mockRemoteSession1.session_id,
      'setRevokingId must be called to display spinner on first click'
    );

    // 17b: Double-click while in flight is locked and does NOT dispatch a second request
    const doubleClickPromise = handlers.handleRevoke(mockRemoteSession1.session_id);
    const doubleClickResult = await doubleClickPromise;

    assert.strictEqual(fetchCount, 1, 'Double-click must not dispatch a second fetch');
    assert.strictEqual(
      doubleClickResult.executed,
      false,
      'Double-click must return executed=false'
    );
    assert.strictEqual(doubleClickResult.locked, true, 'Double-click must return locked=true');

    // Resolve the in-flight request
    resolveFetch!(
      new Response(
        JSON.stringify({
          session_id: mockRemoteSession1.session_id,
          status: 'REVOKED',
          message: 'Đã thu hồi 1 phiên làm việc',
        }),
        { status: 200 }
      )
    );

    const firstClickResult = await pendingPromise;
    assert.strictEqual(firstClickResult.executed, true);
    assert.strictEqual(firstClickResult.success, true);
    assert.strictEqual(
      revokingIdRef.current,
      null,
      'revokingIdRef must be cleared in finally after success'
    );
    assert.strictEqual(
      revokingIdState,
      null,
      'revokingId state must be reset to null after completion'
    );

    // 17c: Failure clears lock and enables retry
    global.fetch = (async () => {
      fetchCount++;
      throw new Error('Network timeout failure');
    }) as any;

    const failedAttempt = await handlers.handleRevoke(mockRemoteSession1.session_id);
    assert.strictEqual(failedAttempt.executed, true);
    assert.strictEqual(failedAttempt.success, false);
    assert.strictEqual(
      revokingIdRef.current,
      null,
      'Failure must clear revokingIdRef in finally so retry is not blocked'
    );
    assert.strictEqual(
      revokingIdState,
      null,
      'Failure must clear revokingId state so spinner is removed'
    );
    assert.ok(String(actionErrMsg).includes('Network timeout failure'), 'Action error must be set');

    // 17d: Retry after failure succeeds
    global.fetch = (async () => {
      fetchCount++;
      return new Response(
        JSON.stringify({
          session_id: mockRemoteSession1.session_id,
          status: 'REVOKED',
          message: 'Đã thu hồi 1 phiên làm việc',
        }),
        { status: 200 }
      );
    }) as any;

    const retryAttempt = await handlers.handleRevoke(mockRemoteSession1.session_id);
    assert.strictEqual(retryAttempt.executed, true, 'Retry must execute');
    assert.strictEqual(retryAttempt.success, true, 'Retry must succeed');
    assert.strictEqual(revokingIdRef.current, null, 'Lock must be clear after retry');
    console.log(
      '  PASS: handleRevoke first click dispatches fetch, shows spinner, double-click locks, failure clears lock, retry succeeds'
    );
  } finally {
    global.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // TEST 18: Handler driver for revoke all (handleRevokeAll)
  // (click -> fetch called once, spinner, failure clears lock, retry works, double-click does one request)
  // ---------------------------------------------------------------------------
  console.log(
    '[TEST 18] Driver for handleRevokeAll: first-click dispatches, spinner, double-click locks, failure clears lock, retry works'
  );
  try {
    let revokeAllLoadingState = false;
    const revokeAllLoadingRef = { current: false };
    const revokingIdRef = { current: null as string | null };
    const isFetchingRef = { current: false };
    let targetSessions = [mockCurrentSession, mockRemoteSession1, mockRemoteSession2];
    let fetchCount = 0;
    let toastMsg: string | null = null;
    let actionErrMsg: string | null = null;
    let dialogOpen = true;

    let resolveFetch: ((res: Response) => void) | null = null;

    global.fetch = (() => {
      fetchCount++;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as any;

    const handlers = createSessionHandlers({
      baseUrl: 'http://localhost:3001',
      token: 'dummy-token',
      includeCurrent: false,
      revokeAllLoadingRef,
      revokingIdRef,
      isFetchingRef,
      fetchState: 'success',
      setRevokingId: () => {},
      setRevokeAllLoading: (loading) => {
        revokeAllLoadingState = loading;
      },
      setActionError: (msg) => {
        actionErrMsg = msg;
      },
      setValidationMessage: () => {},
      setSessions: (updater: any) => {
        targetSessions = updater(targetSessions);
      },
      setFetchState: () => {},
      setRevokeAllOpen: (open) => {
        dialogOpen = open;
      },
      onToast: (msg) => {
        toastMsg = msg;
      },
    });

    // 18a: First click dispatches fetch once and shows spinner
    const pendingPromise = handlers.handleRevokeAll();

    assert.strictEqual(fetchCount, 1, 'First click on handleRevokeAll must dispatch fetch once');
    assert.strictEqual(
      revokeAllLoadingRef.current,
      true,
      'revokeAllLoadingRef must lock immediately on first click'
    );
    assert.strictEqual(
      revokeAllLoadingState,
      true,
      'revokeAllLoading state must be set to true to display spinner'
    );

    // 18b: Double-click while in flight is locked and does NOT dispatch
    const doubleClickResult = await handlers.handleRevokeAll();
    assert.strictEqual(fetchCount, 1, 'Double-click must not call fetch a second time');
    assert.strictEqual(doubleClickResult.executed, false);
    assert.strictEqual(doubleClickResult.locked, true);

    // Resolve in-flight fetch
    resolveFetch!(
      new Response(
        JSON.stringify({
          revoked_count: 2,
          message: 'Đã thu hồi 2 phiên làm việc',
        }),
        { status: 200 }
      )
    );

    const firstResult = await pendingPromise;
    assert.strictEqual(firstResult.executed, true);
    assert.strictEqual(firstResult.success, true);
    assert.strictEqual(
      revokeAllLoadingRef.current,
      false,
      'revokeAllLoadingRef must be cleared in finally'
    );
    assert.strictEqual(
      revokeAllLoadingState,
      false,
      'revokeAllLoading state must reset to false after completion'
    );

    // 18c: Failure clears lock so retry works
    global.fetch = (async () => {
      fetchCount++;
      return new Response(JSON.stringify({ error: { message: '500 Server error' } }), {
        status: 500,
      });
    }) as any;

    const failedAttempt = await handlers.handleRevokeAll();
    assert.strictEqual(failedAttempt.executed, true);
    assert.strictEqual(failedAttempt.success, false);
    assert.strictEqual(
      revokeAllLoadingRef.current,
      false,
      'Failure must clear revokeAllLoadingRef in finally'
    );
    assert.strictEqual(revokeAllLoadingState, false, 'Failure must clear revokeAllLoading state');

    // 18d: Retry succeeds
    global.fetch = (async () => {
      fetchCount++;
      return new Response(
        JSON.stringify({
          revoked_count: 2,
          message: 'Đã thu hồi 2 phiên làm việc',
        }),
        { status: 200 }
      );
    }) as any;

    const retryAttempt = await handlers.handleRevokeAll();
    assert.strictEqual(retryAttempt.executed, true, 'Retry must execute');
    assert.strictEqual(retryAttempt.success, true, 'Retry must succeed');
    assert.strictEqual(revokeAllLoadingRef.current, false, 'Lock must be released');
    console.log(
      '  PASS: handleRevokeAll first click dispatches fetch, shows spinner, double-click locks, failure clears lock, retry succeeds'
    );
  } finally {
    global.fetch = originalFetch;
  }

  console.log('================================================================');
  console.log('ALL SESSIONS TAB UI & ACTION TESTS PASSED 100%');
  console.log('================================================================');
}

void runAsyncTests();
