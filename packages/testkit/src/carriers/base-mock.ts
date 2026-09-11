import type {
  ICarrierMockAdapter,
  CarrierMockMode,
  CarrierQuoteParams,
  CarrierQuoteResult,
  CarrierOrderParams,
  CarrierOrderResult,
  CarrierTrackingResult,
  CarrierCancelResult,
} from './types.js';

export class CarrierMockError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'CarrierMockError';
  }
}

export abstract class BaseCarrierMockAdapter implements ICarrierMockAdapter {
  protected mode: CarrierMockMode = 'SUCCESS';

  constructor(public readonly carrierCode: string) {}

  public setMode(mode: CarrierMockMode): void {
    this.mode = mode;
  }

  public getMode(): CarrierMockMode {
    return this.mode;
  }

  protected checkMockMode(): void {
    switch (this.mode) {
      case 'VALIDATION_ERROR':
        throw new CarrierMockError(
          'CARRIER_VALIDATION_ERROR',
          `[${this.carrierCode}] Invalid address or unsupported route: destination postal code unrecognized`,
          422
        );
      case 'RATE_LIMIT':
        throw new CarrierMockError(
          'CARRIER_RATE_LIMIT',
          `[${this.carrierCode}] Rate limit exceeded. Please retry after backoff.`,
          429
        );
      case 'TIMEOUT':
        throw new CarrierMockError(
          'CARRIER_TIMEOUT',
          `[${this.carrierCode}] Carrier gateway connection timed out after 10000ms`,
          504
        );
      case 'SUCCESS':
      default:
        break;
    }
  }

  abstract calculateQuote(params: CarrierQuoteParams): Promise<CarrierQuoteResult>;
  abstract createOrder(params: CarrierOrderParams): Promise<CarrierOrderResult>;
  abstract getTracking(trackingCode: string): Promise<CarrierTrackingResult>;
  abstract cancelOrder(trackingCode: string): Promise<CarrierCancelResult>;
}
