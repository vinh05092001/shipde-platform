import { MockGhnAdapter } from './mock-ghn.js';
import { MockGhtkAdapter } from './mock-ghtk.js';
import { MockViettelPostAdapter } from './mock-viettelpost.js';
import type { ICarrierMockAdapter, CarrierMockMode } from './types.js';

export class CarrierMockFactory {
  private static instances = new Map<string, ICarrierMockAdapter>();

  public static getCarrier(code: string): ICarrierMockAdapter {
    const normalized = code.toUpperCase();
    if (!this.instances.has(normalized)) {
      switch (normalized) {
        case 'GHN':
          this.instances.set(normalized, new MockGhnAdapter());
          break;
        case 'GHTK':
          this.instances.set(normalized, new MockGhtkAdapter());
          break;
        case 'VIETTEL_POST':
        case 'VTP':
          this.instances.set(normalized, new MockViettelPostAdapter());
          break;
        default:
          throw new Error(`Carrier ${code} not supported in CarrierMockFactory`);
      }
    }
    return this.instances.get(normalized)!;
  }

  public static setAllModes(mode: CarrierMockMode): void {
    for (const carrier of ['GHN', 'GHTK', 'VIETTEL_POST']) {
      this.getCarrier(carrier).setMode(mode);
    }
  }

  public static resetAll(): void {
    this.setAllModes('SUCCESS');
  }
}
