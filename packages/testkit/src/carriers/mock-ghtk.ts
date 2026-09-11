import { BaseCarrierMockAdapter, CarrierMockError } from './base-mock.js';
import type {
  CarrierQuoteParams,
  CarrierQuoteResult,
  CarrierOrderParams,
  CarrierOrderResult,
  CarrierTrackingResult,
  CarrierCancelResult,
} from './types.js';

export class MockGhtkAdapter extends BaseCarrierMockAdapter {
  constructor() {
    super('GHTK');
  }

  async calculateQuote(params: CarrierQuoteParams): Promise<CarrierQuoteResult> {
    this.checkMockMode();
    if (params.parcel.weightGrams <= 0) {
      throw new CarrierMockError('INVALID_PARCEL_WEIGHT', 'Weight must be greater than 0', 400);
    }

    const baseFee = params.parcel.weightGrams > 3000 ? 50000 : 25000;
    const insuranceFee = params.insuranceDeclaredVnd
      ? Math.floor(params.insuranceDeclaredVnd * 0.005)
      : 0;
    const codFee = 0; // GHTK miễn phí thu hộ thông thường

    return {
      carrierCode: this.carrierCode,
      serviceName: 'GHTK Nhanh',
      feeBaseVnd: baseFee,
      feeInsuranceVnd: insuranceFee,
      feeCodVnd: codFee,
      totalFeeVnd: baseFee + insuranceFee + codFee,
      estimatedDeliveryDate: new Date(Date.now() + 86400000).toISOString(),
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

    const trackingCode = `S${Math.floor(10000000 + Math.random() * 90000000)}.VN`;

    return {
      carrierCode: this.carrierCode,
      trackingCode,
      carrierOrderId: `GHTK_${params.clientOrderCode}`,
      status: 'picking',
      totalFeeVnd: quote.totalFeeVnd,
      expectedPickupDate: new Date(Date.now() + 43200000).toISOString(),
    };
  }

  async getTracking(trackingCode: string): Promise<CarrierTrackingResult> {
    this.checkMockMode();
    return {
      carrierCode: this.carrierCode,
      trackingCode,
      currentStatus: 'picking',
      events: [
        {
          status: 'picking',
          location: 'Hub GHTK',
          timestamp: new Date().toISOString(),
          description: 'Shipper đang đến lấy hàng',
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
      message: 'Đã hủy đơn hàng trên hệ thống GHTK',
    };
  }
}
