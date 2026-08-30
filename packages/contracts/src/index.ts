/**
 * @shipde/contracts
 * Core domain contracts, enumerations, and canonical error definitions.
 */

export enum CanonicalRole {
  OWNER = 'OWNER',
  OPS_CSKH = 'OPS_CSKH',
  WAREHOUSE = 'WAREHOUSE',
  ACCOUNTANT = 'ACCOUNTANT',
  BACKOFFICE = 'BACKOFFICE',
}

export enum CanonicalCarrierCode {
  GHN = 'GHN',
  GHTK = 'GHTK',
  VIETTEL_POST = 'VIETTEL_POST',
  JT = 'JT',
}

export enum CanonicalShipmentStatus {
  DRAFT = 'draft',
  PICKING = 'picking',
  IN_TRANSIT = 'in_transit',
  OUT_FOR_DELIVERY = 'out_for_delivery',
  DELIVERED = 'delivered',
  RETURNING = 'returning',
  RETURNED = 'returned',
  CANCELLED = 'cancelled',
  LOST = 'lost',
  DAMAGED = 'damaged',
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
