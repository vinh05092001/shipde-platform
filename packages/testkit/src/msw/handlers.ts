import { http, HttpResponse, delay } from 'msw';
import type { CanonicalUiState, MswScenarioConfig } from './types.js';

let currentScenario: MswScenarioConfig = {
  state: 'SUCCESS',
  delayMs: 0,
  recoveryAttemptsBeforeSuccess: 1,
};

let currentAttempts = 0;

export function setMswScenario(config: Partial<MswScenarioConfig>): void {
  currentScenario = {
    ...currentScenario,
    ...config,
  };
  currentAttempts = 0;
}

export function getMswScenario(): MswScenarioConfig {
  return { ...currentScenario };
}

export function resetMswScenario(): void {
  currentScenario = {
    state: 'SUCCESS',
    delayMs: 0,
    recoveryAttemptsBeforeSuccess: 1,
  };
  currentAttempts = 0;
}

async function handleStateResponse<T extends Record<string, any> | any[]>(
  successData: T,
  emptyData: T,
  partialData?: T
) {
  if (currentScenario.delayMs && currentScenario.delayMs > 0) {
    await delay(currentScenario.delayMs);
  }

  switch (currentScenario.state) {
    case 'LOADING':
      // Indefinite or long delay
      await delay(5000);
      return HttpResponse.json(successData);

    case 'EMPTY':
      return HttpResponse.json(emptyData);

    case 'ERROR':
      return HttpResponse.json(
        {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Hệ thống gặp sự cố không mong muốn, vui lòng thử lại',
          statusCode: 500,
          timestamp: new Date().toISOString(),
        },
        { status: 500 }
      );

    case 'FORBIDDEN':
      return HttpResponse.json(
        {
          code: 'FORBIDDEN',
          message: 'Bạn không có quyền thực hiện thao tác này',
          statusCode: 403,
          timestamp: new Date().toISOString(),
        },
        { status: 403 }
      );

    case 'PARTIAL':
      return HttpResponse.json(partialData !== undefined ? partialData : successData);

    case 'RECOVERY':
      currentAttempts++;
      if (currentAttempts <= (currentScenario.recoveryAttemptsBeforeSuccess || 1)) {
        return HttpResponse.json(
          {
            code: 'CARRIER_TIMEOUT',
            message: 'Kết nối tạm thời bị gián đoạn, đang tự động khôi phục',
            statusCode: 503,
            timestamp: new Date().toISOString(),
          },
          { status: 503 }
        );
      }
      return HttpResponse.json(successData);

    case 'SUCCESS':
    default:
      return HttpResponse.json(successData);
  }
}

export const BASE_API_URL = 'https://api.shipde.local';

export const handlers = [
  // --- Orders List ---
  http.get(`${BASE_API_URL}/api/v1/orders`, async () => {
    const successOrders = [
      {
        id: 'ord_01',
        orderNumber: 'DH-2026-001',
        status: 'pending',
        recipientName: 'Nguyễn Văn An',
        recipientPhone: '0901234567',
        codAmountVnd: 350000,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'ord_02',
        orderNumber: 'DH-2026-002',
        status: 'shipped',
        recipientName: 'Trần Thị Bình',
        recipientPhone: '0987654321',
        codAmountVnd: 0,
        createdAt: new Date().toISOString(),
      },
    ];

    return handleStateResponse(successOrders, []);
  }),

  // --- Shipping Quotes ---
  http.post(`${BASE_API_URL}/api/v1/shipping/quotes`, async () => {
    const fullQuotes = [
      { carrierCode: 'GHN', serviceName: 'GHN Nhanh', feeVnd: 22000, estimatedDays: 2 },
      { carrierCode: 'GHTK', serviceName: 'GHTK Chuẩn', feeVnd: 25000, estimatedDays: 1 },
      {
        carrierCode: 'VIETTEL_POST',
        serviceName: 'VTP Tiết Kiệm',
        feeVnd: 20000,
        estimatedDays: 3,
      },
    ];

    const partialQuotes = [
      { carrierCode: 'GHN', serviceName: 'GHN Nhanh', feeVnd: 22000, estimatedDays: 2 },
      {
        carrierCode: 'VIETTEL_POST',
        serviceName: 'VTP Tiết Kiệm',
        feeVnd: 20000,
        estimatedDays: 3,
      },
    ];

    return handleStateResponse(fullQuotes, [], partialQuotes);
  }),

  // --- Tracking Detail ---
  http.get(`${BASE_API_URL}/api/v1/shipments/:id/tracking`, async ({ params }) => {
    const { id } = params;
    const successTracking = {
      trackingCode: String(id),
      carrierCode: 'GHN',
      currentStatus: 'in_transit',
      events: [
        {
          status: 'ready_to_pick',
          location: 'Kho Gửi',
          timestamp: new Date().toISOString(),
          description: 'Đã tạo đơn',
        },
        {
          status: 'in_transit',
          location: 'Kho Trung Chuyển',
          timestamp: new Date().toISOString(),
          description: 'Đang luân chuyển',
        },
      ],
    };

    const emptyTracking = {
      trackingCode: String(id),
      carrierCode: 'UNKNOWN',
      currentStatus: 'not_found',
      events: [],
    };

    return handleStateResponse(successTracking, emptyTracking);
  }),

  // --- Auth: Self-Registration (FEAT-AUTH-01) ---
  http.post(`${BASE_API_URL}/api/v1/auth/register`, async ({ request }) => {
    let body: any;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    if (body.email === 'duplicate@shipde.vn') {
      return HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Email đã được đăng ký trên hệ thống',
            retryable: false,
            fields: [{ field: 'email', code: 'DUPLICATE', message: 'Email đã được đăng ký' }],
          },
          meta: { correlation_id: 'mock-corr-dup' },
        },
        { status: 400 }
      );
    }

    if (body.email === 'ratelimit@shipde.vn') {
      return HttpResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau.',
            retryable: true,
            next_action: 'Vui lòng chờ 3600 giây trước khi thử lại',
          },
          meta: { correlation_id: 'mock-corr-limit' },
        },
        { status: 429 }
      );
    }

    const successReg = {
      data: {
        user_id: 'b0000000-0000-0000-0000-000000000099',
        merchant_id: 'a0000000-0000-0000-0000-000000000099',
        status: 'PENDING_VERIFICATION',
        email: body.email || 'mock@shipde.vn',
        phone: body.phone,
        message: 'Đăng ký thành công. Vui lòng xác thực tài khoản qua email hoặc số điện thoại.',
      },
      meta: { correlation_id: 'mock-corr-reg' },
    };

    return handleStateResponse(successReg, successReg);
  }),

  // --- Auth: Verify Email ---
  http.post(`${BASE_API_URL}/api/v1/auth/verify-email`, async ({ request }) => {
    let body: any;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    if (body.token === 'test-token-expired') {
      return HttpResponse.json(
        {
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Mã xác thực đã hết hạn',
            retryable: false,
            next_action: 'Vui lòng yêu cầu gửi lại mã xác thực mới',
          },
          meta: { correlation_id: 'mock-corr-expired' },
        },
        { status: 410 }
      );
    }

    if (body.token === 'test-token-consumed') {
      return HttpResponse.json(
        {
          error: {
            code: 'TOKEN_ALREADY_CONSUMED',
            message: 'Mã xác thực này đã được sử dụng trước đó',
            retryable: false,
            next_action: 'Vui lòng đăng nhập hoặc yêu cầu mã xác thực mới nếu chưa kích hoạt',
          },
          meta: { correlation_id: 'mock-corr-consumed' },
        },
        { status: 410 }
      );
    }

    const successVerify = {
      data: {
        user_id: 'b0000000-0000-0000-0000-000000000099',
        merchant_id: 'a0000000-0000-0000-0000-000000000099',
        status: 'ACTIVE',
        channel: 'email',
        verified: true,
      },
      meta: { correlation_id: 'mock-corr-verify' },
    };

    return handleStateResponse(successVerify, successVerify);
  }),

  // --- Auth: Verify Phone ---
  http.post(`${BASE_API_URL}/api/v1/auth/verify-phone`, async () => {
    const successVerify = {
      data: {
        user_id: 'b0000000-0000-0000-0000-000000000099',
        merchant_id: 'a0000000-0000-0000-0000-000000000099',
        status: 'ACTIVE',
        channel: 'phone',
        verified: true,
      },
      meta: { correlation_id: 'mock-corr-verify-phone' },
    };

    return handleStateResponse(successVerify, successVerify);
  }),

  // --- Auth: Resend Verification ---
  http.post(`${BASE_API_URL}/api/v1/auth/verify/resend`, async ({ request }) => {
    let body: any;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    if (body.identifier === 'ratelimit@shipde.vn') {
      return HttpResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Vui lòng chờ trước khi yêu cầu gửi lại mã',
            retryable: true,
            next_action: 'Vui lòng chờ 60 giây',
          },
          meta: { correlation_id: 'mock-corr-resend-limit' },
        },
        { status: 429 }
      );
    }

    const successResend = {
      data: {
        status: 'SENT',
        channel: body.channel || 'email',
        cooldown_seconds: 60,
      },
      meta: { correlation_id: 'mock-corr-resend' },
    };

    return handleStateResponse(successResend, successResend);
  }),
];
