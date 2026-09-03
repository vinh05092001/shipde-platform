/**
 * @shipde/contracts
 * Core domain contracts, enumerations, and canonical error definitions for Ship Dễ.
 */

// --- Canonical Roles ---
export const UserRole = {
  OWNER: 'OWNER',
  OPS_CSKH: 'OPS_CSKH',
  WAREHOUSE: 'WAREHOUSE',
  ACCOUNTANT: 'ACCOUNTANT',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export type Role = UserRole;
export const Role = UserRole;

export const CanonicalRole = UserRole;
export type CanonicalRole = UserRole;

// --- Prototype Navigation Personas ---
export const PrototypePersona = {
  ...UserRole,
  BACKOFFICE: 'BACKOFFICE',
} as const;

export type PrototypePersona = (typeof PrototypePersona)[keyof typeof PrototypePersona];

// --- Carrier Codes ---
export const CarrierCode = {
  GHN: 'GHN',
  GHTK: 'GHTK',
  VIETTEL_POST: 'VIETTEL_POST',
  JT: 'JT',
} as const;

export type CarrierCode = (typeof CarrierCode)[keyof typeof CarrierCode];
export const CanonicalCarrierCode = CarrierCode;
export type CanonicalCarrierCode = CarrierCode;

// --- Carrier Capability Tier ---
export const CarrierCapabilityTier = {
  L0_OBSERVE: 'L0',
  L1_ASSIST: 'L1',
  L2_EXECUTE: 'L2',
} as const;

export type CarrierCapabilityTier =
  (typeof CarrierCapabilityTier)[keyof typeof CarrierCapabilityTier];

// --- Shipment Status ---
export const ShipmentStatus = {
  DRAFT: 'draft',
  PICKING: 'picking',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  RETURNING: 'returning',
  RETURNED: 'returned',
  CANCELLED: 'cancelled',
  LOST: 'lost',
  DAMAGED: 'damaged',
} as const;

export type ShipmentStatus = (typeof ShipmentStatus)[keyof typeof ShipmentStatus];
export const CanonicalShipmentStatus = ShipmentStatus;
export type CanonicalShipmentStatus = ShipmentStatus;

// --- Exception Types & Statuses ---
export const ExceptionType = {
  PICKUP_DELAY: 'pickup_delay',
  STUCK_IN_TRANSIT: 'stuck_in_transit',
  DELIVERY_FAIL: 'delivery_fail',
  STATUS_MISMATCH: 'status_mismatch',
} as const;

export type ExceptionType = (typeof ExceptionType)[keyof typeof ExceptionType];

export const ExceptionCaseStatus = {
  OPEN: 'open',
  ASSIGNED: 'assigned',
  CONTACTING: 'contacting',
  WAITING_CUSTOMER: 'waiting_customer',
  REATTEMPT_REQUESTED: 'reattempt_requested',
  WAITING_REATTEMPT: 'waiting_reattempt',
  RESCUED: 'rescued',
  RETURNING: 'returning',
  RETURNED: 'returned',
  UNRESOLVED: 'unresolved',
} as const;

export type ExceptionCaseStatus = (typeof ExceptionCaseStatus)[keyof typeof ExceptionCaseStatus];

// --- Discrepancy Types & Resolutions ---
export const DiscrepancyType = {
  D1_WEIGHT: 'D1_WEIGHT',
  D2_FREIGHT: 'D2_FREIGHT',
  D3_SURCHARGE: 'D3_SURCHARGE',
  D4_DUPLICATE_DEDUCTION: 'D4_DUPLICATE',
  D5_COD_MISMATCH: 'D5_COD_MISMATCH',
  D6_OVERDUE_COD: 'D6_OVERDUE_COD',
  D7_MISSING_STATEMENT_ROW: 'D7_MISSING',
} as const;

export type DiscrepancyType = (typeof DiscrepancyType)[keyof typeof DiscrepancyType];

export const DiscrepancyResolution = {
  OPEN: 'open',
  CONFIRMED: 'confirm',
  DISPUTE: 'dispute',
  WAIVE: 'waive',
  CARRY_FORWARD: 'carry_forward',
  RESOLVED: 'resolved',
} as const;

export type DiscrepancyResolution =
  (typeof DiscrepancyResolution)[keyof typeof DiscrepancyResolution];

// --- Matching Status ---
export const MatchingStatus = {
  MATCHED_EXACT: 'matched_exact',
  MATCHED_FUZZY: 'matched_fuzzy',
  UNMATCHED: 'unmatched',
  AMBIGUOUS: 'ambiguous',
} as const;

export type MatchingStatus = (typeof MatchingStatus)[keyof typeof MatchingStatus];
