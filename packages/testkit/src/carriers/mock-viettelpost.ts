import { BaseCarrierMockAdapter, CarrierMockError } from './base-mock.js';
import type {
  CarrierQuoteParams,
  CarrierQuoteResult,
  CarrierOrderParams,
  CarrierOrderResult,
  CarrierTrackingResult,
  CarrierCancelResult,
} from './types.js';

export class MockViettelPostAdapter extends BaseCarrierMockAdapter {
  constructor() {
    super('VIETTEL_POST');
  }

  async calculateQuote(params: CarrierQuoteParams): Promise<CarrierQuoteResult> {
    this.checkMockMode();
    if (params.parcel.weightGrams <= 0) {
      throw new CarrierMockError('INVALID_PARCEL_WEIGHT', 'Weight must be greater than 0', 400);
    }

    const baseFee = params.parcel.weightGrams > 2000 ? 40000 : 20000;
    const insuranceFee = params.insuranceDeclaredVnd
      ? Math.floor(params.insuranceDeclaredVnd * 0.005)
      : 0;
    const codFee = params.codAmountVnd && params.codAmountVnd > 500000 ? 5000 : 0;

    return {
      carrierCode: this.carrierCode,
      serviceName: 'ViettelPost Tiêu Chuẩn',
      feeBaseVnd: baseFee,
      feeInsuranceVnd: insuranceFee,
      feeCodVnd: codFee,
      totalFeeVnd: baseFee + insuranceFee + codFee,
      estimatedDeliveryDate: new Date(Date.now() + 3 * 86400000).toISOString(),
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

    const trackingCode = `VT${Math.floor(100000000 + Math.random() * 900000000)}`;

    return {
      carrierCode: this.carrierCode,
      trackingCode,
      carrierOrderId: `VTP_${params.clientOrderCode}`,
      status: 'created',
      totalFeeVnd: quote.totalFeeVnd,
      expectedPickupDate: new Date(Date.now() + 86400000).toISOString(),
    };
  }

  async getTracking(trackingCode: string): Promise<CarrierTrackingResult> {
    this.checkMockMode();
    return {
      carrierCode: this.carrierCode,
      trackingCode,
      currentStatus: 'delivering',
      events: [
        {
          status: 'delivering',
          location: 'Bưu cục ViettelPost',
          timestamp: new Date().toISOString(),
          description: 'Bưu tá đang phát hàng tới người nhận',
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
      message: 'Hủy vận đơn thành công tại ViettelPost',
    };
  }
}
