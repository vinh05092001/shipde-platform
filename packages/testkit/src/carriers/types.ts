/**
 * @shipde/testkit - Carrier Mock Types
 * Deterministic carrier mock interfaces conforming to target specifications.
 */

export type CarrierMockMode = 'SUCCESS' | 'VALIDATION_ERROR' | 'RATE_LIMIT' | 'TIMEOUT';

export interface CarrierAddress {
  name: string;
  phone: string;
  address: string;
  ward: string;
  district: string;
  province: string;
  postalCode?: string;
}

export interface CarrierParcel {
  weightGrams: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

export interface CarrierQuoteParams {
  carrierCode: string;
  origin: CarrierAddress;
  destination: CarrierAddress;
  parcel: CarrierParcel;
  codAmountVnd?: number;
  insuranceDeclaredVnd?: number;
}

export interface CarrierQuoteResult {
  carrierCode: string;
  serviceName: string;
  feeBaseVnd: number;
  feeInsuranceVnd: number;
  feeCodVnd: number;
  totalFeeVnd: number;
  estimatedDeliveryDate: string;
}

export interface CarrierOrderParams {
  carrierCode: string;
  clientOrderCode: string;
  sender: CarrierAddress;
  recipient: CarrierAddress;
  parcel: CarrierParcel;
  codAmountVnd?: number;
  insuranceDeclaredVnd?: number;
  note?: string;
}

export interface CarrierOrderResult {
  carrierCode: string;
  trackingCode: string;
  carrierOrderId: string;
  status: string;
  totalFeeVnd: number;
  expectedPickupDate: string;
}

export interface CarrierTrackingEvent {
  status: string;
  location: string;
  timestamp: string;
  description: string;
}

export interface CarrierTrackingResult {
  carrierCode: string;
  trackingCode: string;
  currentStatus: string;
  events: CarrierTrackingEvent[];
}

export interface CarrierCancelResult {
  carrierCode: string;
  trackingCode: string;
  cancelled: boolean;
  message: string;
}

export interface ICarrierMockAdapter {
  readonly carrierCode: string;
  setMode(mode: CarrierMockMode): void;
  getMode(): CarrierMockMode;
  calculateQuote(params: CarrierQuoteParams): Promise<CarrierQuoteResult>;
  createOrder(params: CarrierOrderParams): Promise<CarrierOrderResult>;
  getTracking(trackingCode: string): Promise<CarrierTrackingResult>;
  cancelOrder(trackingCode: string): Promise<CarrierCancelResult>;
}
