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
];
