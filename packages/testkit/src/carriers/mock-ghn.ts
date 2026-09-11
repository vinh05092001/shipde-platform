import { BaseCarrierMockAdapter, CarrierMockError } from './base-mock.js';
import type {
  CarrierQuoteParams,
  CarrierQuoteResult,
  CarrierOrderParams,
  CarrierOrderResult,
  CarrierTrackingResult,
  CarrierCancelResult,
} from './types.js';

export class MockGhnAdapter extends BaseCarrierMockAdapter {
  constructor() {
    super('GHN');
  }

  async calculateQuote(params: CarrierQuoteParams): Promise<CarrierQuoteResult> {
    this.checkMockMode();
    if (params.parcel.weightGrams <= 0) {
      throw new CarrierMockError('INVALID_PARCEL_WEIGHT', 'Weight must be greater than 0', 400);
    }

    // Exact integer VND calculations
    const baseFee = params.parcel.weightGrams > 2000 ? 45000 : 22000;
    const insuranceFee = params.insuranceDeclaredVnd
      ? Math.floor(params.insuranceDeclaredVnd * 0.005)
      : 0;
    const codFee = params.codAmountVnd && params.codAmountVnd > 1000000 ? 10000 : 0;

    return {
      carrierCode: this.carrierCode,
      serviceName: 'GHN Tiết Kiệm',
      feeBaseVnd: baseFee,
      feeInsuranceVnd: insuranceFee,
      feeCodVnd: codFee,
      totalFeeVnd: baseFee + insuranceFee + codFee,
      estimatedDeliveryDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    };
  }

  async createOrder(params: CarrierOrderParams): Promise<CarrierOrderResult> {
    this.checkMockMode();
    if (!params.recipient.phone || !params.recipient.address) {
      throw new CarrierMockError('INVALID_RECIPIENT', 'Recipient address and phone required', 422);
    }

    const quote = await this.calculateQuote({
      carrierCode: this.carrierCode,
      origin: params.sender,
      destination: params.recipient,
      parcel: params.parcel,
      codAmountVnd: params.codAmountVnd,
      insuranceDeclaredVnd: params.insuranceDeclaredVnd,
    });

    const trackingCode = `GHN${Math.floor(100000000 + Math.random() * 900000000)}`;

    return {
      carrierCode: this.carrierCode,
      trackingCode,
      carrierOrderId: `GHN_ORDER_${params.clientOrderCode}`,
      status: 'ready_to_pick',
      totalFeeVnd: quote.totalFeeVnd,
      expectedPickupDate: new Date(Date.now() + 86400000).toISOString(),
    };
  }

  async getTracking(trackingCode: string): Promise<CarrierTrackingResult> {
    this.checkMockMode();
    return {
      carrierCode: this.carrierCode,
      trackingCode,
      currentStatus: 'in_transit',
      events: [
        {
          status: 'ready_to_pick',
          location: 'Kho gửi GHN',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          description: 'Đã tiếp nhận đơn hàng',
        },
        {
          status: 'in_transit',
          location: 'Kho trung chuyển GHN',
          timestamp: new Date().toISOString(),
          description: 'Đang luân chuyển hàng',
        },
      ],
    };
  }

  async cancelOrder(trackingCode: string): Promise<CarrierCancelResult> {
    this.checkMockMode();
    return {
      carrierCode: this.carrierCode,
      trackingCode,
      cancelled: true,
      message: 'Hủy đơn hàng thành công trên hệ thống GHN',
    };
  }
}
