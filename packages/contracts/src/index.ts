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

// --- Canonical User Status ---
export const UserStatus = {
  PENDING_VERIFICATION: 'pending_verification',
  INVITED: 'invited',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DISABLED: 'disabled',
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const CanonicalUserStatus = UserStatus;
export type CanonicalUserStatus = UserStatus;

/**
 * Shared helper to verify if a user status string represents an active account.
 * Case-insensitive comparison matching DATA-DICTIONARY ('ACTIVE') and legacy/in-flight ('active').
 * AC-USR-01-17 / DATA-DICTIONARY User.status
 */
export function isActiveStatus(status?: string | null): boolean {
  return typeof status === 'string' && status.trim().toLowerCase() === 'active';
}

// --- Verification Channels ---
export const VerificationChannel = {
  EMAIL: 'email',
  PHONE: 'phone',
} as const;

export type VerificationChannel = (typeof VerificationChannel)[keyof typeof VerificationChannel];

// --- Verification Delivery Contracts ---
export interface VerificationMessage {
  channel: 'email' | 'phone';
  recipient: string;
  purpose?: 'account_verification' | 'password_reset' | 'invitation';
  link?: string;
  token?: string;
  otp?: string;
  sentAt?: Date;
}

export interface IVerificationDeliveryAdapter {
  sendVerification(
    message: Omit<VerificationMessage, 'sentAt'>
  ): Promise<{ success: boolean; messageId: string }>;
}

// --- Login Contracts (FEAT-AUTH-03 / UC-AUTH-01) ---
export const LoginAuthStatus = {
  AUTHENTICATED: 'AUTHENTICATED',
  /** Reserved for FEAT-AUTH-05 (MFA challenge); never returned by FEAT-AUTH-03. */
  MFA_REQUIRED: 'MFA_REQUIRED',
  /** Reserved for multi-organization selection; never returned by FEAT-AUTH-03. */
  ORG_SELECTION_REQUIRED: 'ORG_SELECTION_REQUIRED',
  /** Login OTP requested and (when the account exists) delivered. */
  OTP_SENT: 'OTP_SENT',
} as const;

export type LoginAuthStatus = (typeof LoginAuthStatus)[keyof typeof LoginAuthStatus];

export interface LoginRequest {
  /** Email or Vietnamese phone number of the account. */
  identifier: string;
  password: string;
  remember_device?: boolean;
}

export interface AuthenticatedUser {
  id: string;
  merchant_id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  role: UserRole;
  status: Uppercase<UserStatus>;
  email_verified_at?: string | null;
  phone_verified_at?: string | null;
  created_at: string;
}

export interface AuthenticatedMerchant {
  id: string;
  name: string;
  business_code?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  status?: string | null;
  created_at: string;
}

export interface AuthSessionData {
  status: Exclude<LoginAuthStatus, 'OTP_SENT'>;
  access_token?: string;
  /** Access token lifetime in seconds (present when access_token is returned). */
  expires_in?: number;
  challenge_id?: string;
  user?: AuthenticatedUser;
  merchant?: AuthenticatedMerchant;
}

export interface AuthResponse {
  data: AuthSessionData;
  meta: { correlation_id: string };
}

export interface LoginOtpRequestRequest {
  identifier: string;
}

export interface LoginOtpChallengeData {
  status: 'OTP_SENT';
  /** Delivery channel resolved for the identifier. */
  channel: 'email' | 'phone';
  /** Masked recipient, e.g. m***@shipde.vn or 0901***567. */
  recipient_masked: string;
  cooldown_seconds: number;
  expires_in_seconds: number;
  message: string;
}

export interface LoginOtpChallengeResponse {
  data: LoginOtpChallengeData;
  meta: { correlation_id: string };
}

export interface LoginOtpVerifyRequest {
  identifier: string;
  otp: string;
}

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

// --- Carrier Catalog Constants & Normalization (FEAT-CAR-01) ---
export const CATALOG_REVISION = 'CATALOG-2026-10-31';

export const CARRIER_BOUNDARY_ALIASES: Record<string, CarrierCode> = {
  VTP: 'VIETTEL_POST',
  JT_EXPRESS: 'JT',
  GHN: 'GHN',
  GHTK: 'GHTK',
  VIETTEL_POST: 'VIETTEL_POST',
  JT: 'JT',
};

export function normalizeCarrierCode(raw?: string | null): CarrierCode | null {
  if (typeof raw !== 'string') return null;
  return CARRIER_BOUNDARY_ALIASES[raw] || null;
}

export const CarrierEvidenceLevel = {
  VERIFIED_OFFICIAL: 'VERIFIED_OFFICIAL',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
} as const;
export type CarrierEvidenceLevel = (typeof CarrierEvidenceLevel)[keyof typeof CarrierEvidenceLevel];

export const CommandShipmentStatus = {
  CREATING: 'CREATING',
  CREATED: 'CREATED',
  CREATE_FAILED: 'CREATE_FAILED',
  CREATE_OUTCOME_UNKNOWN: 'CREATE_OUTCOME_UNKNOWN',
} as const;
export type CommandShipmentStatus =
  (typeof CommandShipmentStatus)[keyof typeof CommandShipmentStatus];

export const StatusCategory = {
  COMMAND: 'COMMAND',
  OPERATIONAL_PRE_TRANSIT: 'OPERATIONAL_PRE_TRANSIT',
  OPERATIONAL_IN_TRANSIT: 'OPERATIONAL_IN_TRANSIT',
  OPERATIONAL_TERMINAL: 'OPERATIONAL_TERMINAL',
} as const;
export type StatusCategory = (typeof StatusCategory)[keyof typeof StatusCategory];

export const FeeComponentCategory = {
  BASE: 'BASE',
  SURCHARGE: 'SURCHARGE',
  COD: 'COD',
  INSURANCE: 'INSURANCE',
  RETURN: 'RETURN',
  VAT: 'VAT',
} as const;
export type FeeComponentCategory = (typeof FeeComponentCategory)[keyof typeof FeeComponentCategory];

export const CompatibilityDomain = {
  CARRIER_ALIAS: 'CARRIER_ALIAS',
  STATUS: 'STATUS',
  FEE: 'FEE',
} as const;
export type CompatibilityDomain = (typeof CompatibilityDomain)[keyof typeof CompatibilityDomain];

export const CompatibilityDisposition = {
  MAPPED: 'MAPPED',
  UNMAPPED: 'UNMAPPED',
} as const;
export type CompatibilityDisposition =
  (typeof CompatibilityDisposition)[keyof typeof CompatibilityDisposition];

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

// --- Operational Health Contracts (API-FOUND-HEALTH-LIVE, API-FOUND-HEALTH-READY) ---
export interface LivenessResponse {
  status: 'ok';
  service: string;
  timestamp: string;
  correlationId: string;
}

export interface ReadinessDependencyChecks {
  database: 'up' | 'down';
  redis: 'up' | 'down';
  storage: 'up' | 'down';
  [key: string]: 'up' | 'down';
}

export interface ReadinessResponse {
  status: 'ok' | 'error';
  service: string;
  timestamp: string;
  correlationId: string;
  checks: ReadinessDependencyChecks;
}

// --- Technical Outbox & Durable Dispatch (ENT-FOUND-OUTBOX) ---
export const OutboxStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
} as const;

export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

export interface OutboxMessagePayload {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string | null;
  idempotencyKey?: string | null;
  createdAt: string;
  scheduledAt: string;
  publishedAt?: string | null;
}

// --- Synthetic Queue Smoke Event (EVT-FOUND-QUEUE-SMOKE) ---
export const QUEUE_SMOKE_EVENT_TYPE = 'EVT-FOUND-QUEUE-SMOKE' as const;
export const SMOKE_QUEUE_NAME = 'smoke-queue' as const;

export interface QueueSmokePayload {
  smokeId: string;
  timestamp: string;
  message: string;
  metadata?: Record<string, unknown>;
}

// --- Session Management Contracts (FEAT-AUTH-06) ---
import { components } from './openapi';

export const SessionStatus = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
  INACTIVE: 'INACTIVE',
} as const;

export type SessionStatus = components['schemas']['SessionInfo']['status'];
export type SessionInfo = components['schemas']['SessionInfo'];
export type SessionListResponse = components['schemas']['ListSessionsResponse'];
export type SessionRevokeResponse = components['schemas']['RevokeSessionResponse'];
export type SessionRevokeAllResponse = components['schemas']['RevokeAllSessionsResponse'];
export type SessionHeartbeatResponse = components['schemas']['HeartbeatSessionResponse'];

// --- Multi-Factor Authentication (MFA) Contracts (FEAT-AUTH-05) ---
export const MfaStatus = {
  NOT_ENROLLED: 'NOT_ENROLLED',
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  RESET: 'RESET',
} as const;

export type MfaStatus = (typeof MfaStatus)[keyof typeof MfaStatus];

export const MfaErrorCode = {
  MFA_ENROLLMENT_REQUIRED: 'MFA_ENROLLMENT_REQUIRED',
  MFA_ALREADY_ENABLED: 'MFA_ALREADY_ENABLED',
  MFA_SETUP_EXPIRED: 'MFA_SETUP_EXPIRED',
  MFA_CHALLENGE_INVALID: 'MFA_CHALLENGE_INVALID',
  MFA_CHALLENGE_EXPIRED: 'MFA_CHALLENGE_EXPIRED',
  MFA_CODE_INVALID: 'MFA_CODE_INVALID',
  MFA_RECOVERY_CODE_INVALID: 'MFA_RECOVERY_CODE_INVALID',
  MFA_FRESH_AUTH_REQUIRED: 'MFA_FRESH_AUTH_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
} as const;

export type MfaErrorCode = (typeof MfaErrorCode)[keyof typeof MfaErrorCode];

export const MfaAuditEvent = {
  AUTH_MFA_SETUP_STARTED: 'AUTH_MFA_SETUP_STARTED',
  AUTH_MFA_SETUP_COMPLETED: 'AUTH_MFA_SETUP_COMPLETED',
  AUTH_MFA_SETUP_EXPIRED: 'AUTH_MFA_SETUP_EXPIRED',
  AUTH_MFA_CHALLENGE_SUCCEEDED: 'AUTH_MFA_CHALLENGE_SUCCEEDED',
  AUTH_MFA_CHALLENGE_FAILED: 'AUTH_MFA_CHALLENGE_FAILED',
  AUTH_MFA_RATE_LIMITED: 'AUTH_MFA_RATE_LIMITED',
  AUTH_MFA_RECOVERY_USED: 'AUTH_MFA_RECOVERY_USED',
  AUTH_MFA_RECOVERY_REGENERATED: 'AUTH_MFA_RECOVERY_REGENERATED',
  AUTH_MFA_ADMIN_RESET: 'AUTH_MFA_ADMIN_RESET',
} as const;

export type MfaAuditEvent = (typeof MfaAuditEvent)[keyof typeof MfaAuditEvent];

// --- Roles & Permissions (RBAC) Contracts (FEAT-RBAC-01) ---
export const CanonicalPermissionCode = {
  IAM_SHOP_CONFIG: 'iam:shop_config',
  IAM_SHOP_VIEW: 'iam:shop_view',
  IAM_MANAGE_USERS: 'iam:manage_users',
  IAM_CONNECT_OBSERVE_TOKEN: 'iam:connect_observe_token',
  IAM_GRANT_ACTION_PERMISSION: 'iam:grant_action_permission',
  ORDER_VIEW_CREATE: 'order:view_create',
  SHIPMENT_QUOTE_CARRIER: 'shipment:quote_carrier',
  SHIPMENT_CREATE_UPDATE: 'shipment:create_update',
  SHIPMENT_CANCEL_REDELIVER: 'shipment:cancel_redeliver',
  SHIPMENT_PRINT_HANDOVER: 'shipment:print_handover',
  SHIPMENT_TRACK_EXCEPTIONS: 'shipment:track_exceptions',
  SHIPMENT_RECEIVE_RETURN: 'shipment:receive_return',
  RECONCILIATION_VIEW_CONTRACT_RATES: 'reconciliation:view_contract_rates',
  RECONCILIATION_AUTHOR_RATE_POLICY: 'reconciliation:author_rate_policy',
  RECONCILIATION_APPROVE_RATE_POLICY: 'reconciliation:approve_rate_policy',
  RECONCILIATION_IMPORT_SETTLEMENT_BANK: 'reconciliation:import_settlement_bank',
  RECONCILIATION_RUN_REVIEW_AUDIT: 'reconciliation:run_review_audit',
  RECONCILIATION_ALLOCATE_BANK_RECEIPT: 'reconciliation:allocate_bank_receipt',
  CLAIM_VERIFY_SUBMIT: 'claim:verify_submit',
  PII_UNMASK: 'pii:unmask',
  AUDIT_VIEW: 'audit:view',
} as const;

export type CanonicalPermissionCode =
  (typeof CanonicalPermissionCode)[keyof typeof CanonicalPermissionCode];

export const RbacErrorCode = {
  SYSTEM_ROLE_IMMUTABLE: 'SYSTEM_ROLE_IMMUTABLE',
  PRIVILEGE_ESCALATION_DENIED: 'PRIVILEGE_ESCALATION_DENIED',
  ROLE_IN_USE: 'ROLE_IN_USE',
  ROLE_NAME_EXISTS: 'ROLE_NAME_EXISTS',
  ROLE_NOT_FOUND: 'ROLE_NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  FORBIDDEN: 'FORBIDDEN',
} as const;

export type RbacErrorCode = (typeof RbacErrorCode)[keyof typeof RbacErrorCode];

export const RbacAuditEvent = {
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_UPDATED: 'ROLE_UPDATED',
  ROLE_DELETED: 'ROLE_DELETED',
} as const;

export type RbacAuditEvent = (typeof RbacAuditEvent)[keyof typeof RbacAuditEvent];

export type PermissionItem = components['schemas']['PermissionItem'];
export type PermissionsResponse = components['schemas']['PermissionsResponse'];
export type RoleItem = components['schemas']['RoleItem'];
export type RolesResponse = components['schemas']['RolesResponse'];
export type RoleDetailResponse = components['schemas']['RoleDetailResponse'];
export type CreateRoleRequest = components['schemas']['CreateRoleRequest'];
export type UpdateRoleRequest = components['schemas']['UpdateRoleRequest'];
export type DeleteRoleResponse = components['schemas']['DeleteRoleResponse'];

// --- User Invitations Contracts (FEAT-USR-01) ---
export const InvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;

export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];

export const InvitationErrorCode = {
  INVITATION_NOT_FOUND: 'INVITATION_NOT_FOUND',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  INVITATION_ALREADY_USED: 'INVITATION_ALREADY_USED',
  INVITATION_ALREADY_PENDING: 'INVITATION_ALREADY_PENDING',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  PRIVILEGE_CEILING_EXCEEDED: 'PRIVILEGE_CEILING_EXCEEDED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type InvitationErrorCode = (typeof InvitationErrorCode)[keyof typeof InvitationErrorCode];

export const InvitationAuditEvent = {
  INVITATION_SENT: 'INVITATION_SENT',
  INVITATION_RESENT: 'INVITATION_RESENT',
  INVITATION_CANCELLED: 'INVITATION_CANCELLED',
  INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
} as const;

export type InvitationAuditEvent = (typeof InvitationAuditEvent)[keyof typeof InvitationAuditEvent];

export type InvitationItem = components['schemas']['InvitationItem'];
export type SendInvitationRequest = components['schemas']['SendInvitationRequest'];
export type SendInvitationResponse = components['schemas']['SendInvitationResponse'];
export type ListInvitationsResponse = components['schemas']['ListInvitationsResponse'];
export type ResendInvitationResponse = components['schemas']['ResendInvitationResponse'];
export type CancelInvitationResponse = components['schemas']['CancelInvitationResponse'];
export type VerifyInvitationResponse = components['schemas']['VerifyInvitationResponse'];
export type AcceptInvitationRequest = components['schemas']['AcceptInvitationRequest'];
export type AcceptInvitationResponse = components['schemas']['AcceptInvitationResponse'];
export type CheckScopeRequest = components['schemas']['CheckScopeRequest'];
export type CheckScopeResponse = components['schemas']['CheckScopeResponse'];
// --- Scope Assignment Contracts (FEAT-RBAC-02) ---
export type UserListItem = components['schemas']['UserListItem'];
export type UserListResponse = components['schemas']['UserListResponse'];
export type UserScopesResponse = components['schemas']['UserScopesResponse'];
export type UpdateUserScopesRequest = components['schemas']['UpdateUserScopesRequest'];

// --- Shop Profile Contracts (FEAT-ORG-01) ---
export const ShopAuditEvent = {
  SHOP_PROFILE_UPDATED: 'SHOP_PROFILE_UPDATED',
} as const;

export type ShopAuditEvent = (typeof ShopAuditEvent)[keyof typeof ShopAuditEvent];

export type ShopProfile = components['schemas']['ShopProfile'];
export type UpdateShopProfileInput = components['schemas']['UpdateShopProfileInput'];
export type ShopProfileResponse = components['schemas']['ShopProfileResponse'];
export type ListShopsResponse = components['schemas']['ListShopsResponse'];

// --- Warehouse Contracts (FEAT-WH-01) ---
export const WarehouseAuditEvent = {
  WAREHOUSE_CREATED: 'WAREHOUSE_CREATED',
  WAREHOUSE_UPDATED: 'WAREHOUSE_UPDATED',
  WAREHOUSE_DEACTIVATED: 'WAREHOUSE_DEACTIVATED',
  WAREHOUSE_SET_DEFAULT: 'WAREHOUSE_SET_DEFAULT',
} as const;

export type WarehouseAuditEvent = (typeof WarehouseAuditEvent)[keyof typeof WarehouseAuditEvent];

export const WarehouseErrorCode = {
  WAREHOUSE_NOT_FOUND: 'WAREHOUSE_NOT_FOUND',
  WAREHOUSE_CODE_EXISTS: 'WAREHOUSE_CODE_EXISTS',
  WAREHOUSE_SCOPE_UNAUTHORIZED: 'WAREHOUSE_SCOPE_UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;
export type WarehouseErrorCode = (typeof WarehouseErrorCode)[keyof typeof WarehouseErrorCode];

export type Warehouse = components['schemas']['Warehouse'];
export type CreateWarehouseInput = components['schemas']['CreateWarehouseInput'];
export type UpdateWarehouseInput = components['schemas']['UpdateWarehouseInput'];
export type WarehouseResponse = components['schemas']['WarehouseResponse'];
export type ListWarehousesResponse = components['schemas']['ListWarehousesResponse'];

export const WAREHOUSE_CODE_REGEX = /^[A-Za-z0-9_-]{2,64}$/;
export const WAREHOUSE_PHONE_REGEX = /^(0|\+84)[35789][0-9]{8}$/;
export const WAREHOUSE_CUTOFF_TIME_REGEX = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const ALLOWED_WAREHOUSE_PAPER_SIZES = ['A6', 'A5', 'A4', 'K80'] as const;
export const ALLOWED_WAREHOUSE_DPIS = [203, 300] as const;

export function isValidWarehouseCode(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  return WAREHOUSE_CODE_REGEX.test(code.trim());
}

export function isValidWarehousePhone(phone: unknown): boolean {
  if (typeof phone !== 'string') return false;
  const cleanPhone = phone.trim().replace(/[\s.-]/g, '');
  return WAREHOUSE_PHONE_REGEX.test(cleanPhone);
}

export function isValidCutoffTime(time: unknown): boolean {
  if (!time || typeof time !== 'string') return false;
  return WAREHOUSE_CUTOFF_TIME_REGEX.test(time.trim());
}

export interface WarehouseFormState {
  name: string;
  code: string;
  status: 'active' | 'inactive';
  is_default: boolean;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  address_line: string;
  ward: string;
  district: string;
  city: string;
  postal_code: string;
  use_different_return_address: boolean;
  return_contact_name: string;
  return_contact_phone: string;
  return_address_line: string;
  return_ward: string;
  return_district: string;
  return_city: string;
  cutoff_time: string;
  schedule_notes: string;
  printer_paper_size: 'A6' | 'A5' | 'A4' | 'K80';
  printer_dpi: 203 | 300;
  printer_name: string;
  printer_auto_print: boolean;
}

export function validateWarehouseForm(form: WarehouseFormState): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!form.name || form.name.trim().length < 2) {
    errors.name = 'Tên kho hàng là bắt buộc và phải có ít nhất 2 ký tự';
  } else if (form.name.trim().length > 255) {
    errors.name = 'Tên kho hàng không được vượt quá 255 ký tự';
  }

  if (form.code && form.code.trim().length > 0) {
    if (!isValidWarehouseCode(form.code)) {
      errors.code = 'Mã kho hàng phải từ 2 đến 64 ký tự (chữ cái, số, "-" hoặc "_")';
    }
  }

  if (!form.contact_name || form.contact_name.trim().length < 2) {
    errors.contact_name = 'Tên người liên hệ kho là bắt buộc và phải từ 2 đến 255 ký tự';
  } else if (form.contact_name.trim().length > 255) {
    errors.contact_name = 'Tên người liên hệ kho không được vượt quá 255 ký tự';
  }

  if (!form.contact_phone || !isValidWarehousePhone(form.contact_phone)) {
    errors.contact_phone = 'Số điện thoại không hợp lệ theo định dạng Việt Nam';
  }

  if (form.contact_email && form.contact_email.trim().length > 0) {
    const trimmed = form.contact_email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 255) {
      errors.contact_email = 'Email liên hệ không đúng định dạng';
    }
  }

  if (!form.address_line || form.address_line.trim().length < 3) {
    errors.address_line = 'Địa chỉ lấy hàng phải từ 3 đến 500 ký tự';
  } else if (form.address_line.trim().length > 500) {
    errors.address_line = 'Địa chỉ lấy hàng không được vượt quá 500 ký tự';
  }

  if (!form.district || form.district.trim().length === 0) {
    errors.district = 'Quận/Huyện lấy hàng không được để trống';
  }

  if (!form.city || form.city.trim().length === 0) {
    errors.city = 'Tỉnh/Thành phố lấy hàng không được để trống';
  }

  if (form.use_different_return_address) {
    if (!form.return_contact_name || form.return_contact_name.trim().length < 2) {
      errors.return_contact_name = 'Tên người nhận hoàn là bắt buộc';
    } else if (form.return_contact_name.trim().length > 255) {
      errors.return_contact_name = 'Tên người nhận hoàn không được vượt quá 255 ký tự';
    }

    if (!form.return_contact_phone || !isValidWarehousePhone(form.return_contact_phone)) {
      errors.return_contact_phone = 'Số điện thoại nhận hoàn không hợp lệ theo định dạng Việt Nam';
    }

    if (!form.return_address_line || form.return_address_line.trim().length < 3) {
      errors.return_address_line = 'Địa chỉ nhận hoàn là bắt buộc';
    } else if (form.return_address_line.trim().length > 500) {
      errors.return_address_line = 'Địa chỉ nhận hoàn không được vượt quá 500 ký tự';
    }

    if (!form.return_district || form.return_district.trim().length === 0) {
      errors.return_district = 'Quận/Huyện nhận hoàn không được để trống';
    }

    if (!form.return_city || form.return_city.trim().length === 0) {
      errors.return_city = 'Tỉnh/Thành phố nhận hoàn không được để trống';
    }
  }

  if (form.cutoff_time && form.cutoff_time.trim().length > 0) {
    if (!isValidCutoffTime(form.cutoff_time)) {
      errors.cutoff_time = 'Giờ cắt ca lấy hàng phải có định dạng HH:mm (ví dụ: 16:00)';
    }
  }

  if (form.printer_paper_size && !ALLOWED_WAREHOUSE_PAPER_SIZES.includes(form.printer_paper_size)) {
    errors.printer_paper_size = `Khổ giấy in không hợp lệ. Cho phép: ${ALLOWED_WAREHOUSE_PAPER_SIZES.join(', ')}`;
  }

  if (form.printer_dpi && !ALLOWED_WAREHOUSE_DPIS.includes(form.printer_dpi)) {
    errors.printer_dpi = `Độ phân giải máy in không hợp lệ. Cho phép: ${ALLOWED_WAREHOUSE_DPIS.join(', ')}`;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

// --- Canonical Timezones (FEAT-ORG-01) ---
export interface SupportedTimeZoneOption {
  value: string;
  label: string;
}

export const SUPPORTED_TIMEZONES: readonly SupportedTimeZoneOption[] = [
  { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh (UTC+7)' },
  { value: 'UTC', label: 'UTC (UTC+0)' },
] as const;

export const SUPPORTED_TIMEZONE_VALUES: readonly string[] = SUPPORTED_TIMEZONES.map(
  (tz) => tz.value
);

export function isValidTimeZone(tz: unknown): boolean {
  if (!tz || typeof tz !== 'string') return false;
  const trimmed = tz.trim();
  if (!SUPPORTED_TIMEZONE_VALUES.includes(trimmed)) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}
// --- Personal Profile (FEAT-PRO-01) Types ---
export type UserProfile = components['schemas']['UserProfile'];
export type NotificationPreferences = components['schemas']['NotificationPreferences'];
export type UserPreferences = components['schemas']['UserPreferences'];
export type GetMeResponse = components['schemas']['GetMeResponse'];
export type UpdateMeRequest = components['schemas']['UpdateMeRequest'];
export type UpdateMeResponse = components['schemas']['UpdateMeResponse'];
export type GetPreferencesResponse = components['schemas']['GetPreferencesResponse'];
export type UpdatePreferencesRequest = components['schemas']['UpdatePreferencesRequest'];
export type UpdatePreferencesResponse = components['schemas']['UpdatePreferencesResponse'];

// --- User Lifecycle Contracts (FEAT-USR-02) ---
export const UserLifecycleAuditEvent = {
  USER_UPDATED: 'USER_UPDATED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
} as const;
export type UserLifecycleAuditEvent =
  (typeof UserLifecycleAuditEvent)[keyof typeof UserLifecycleAuditEvent];

export const UserErrorCode = {
  CANNOT_REMOVE_LAST_OWNER: 'CANNOT_REMOVE_LAST_OWNER',
  SELF_SUSPENSION_PROHIBITED: 'SELF_SUSPENSION_PROHIBITED',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  PRIVILEGE_CEILING_EXCEEDED: 'PRIVILEGE_CEILING_EXCEEDED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;
export type UserErrorCode = (typeof UserErrorCode)[keyof typeof UserErrorCode];

export type ListUsersResponse = components['schemas']['ListUsersResponse'];
export type UserDetail = components['schemas']['UserDetail'];
export type UserDetailResponse = components['schemas']['UserDetailResponse'];
export type UpdateUserRequest = components['schemas']['UpdateUserRequest'];
export type SuspendUserRequest = components['schemas']['SuspendUserRequest'];
export type SuspendUserResponse = components['schemas']['SuspendUserResponse'];
export type ActivateUserRequest = components['schemas']['ActivateUserRequest'];
export type ActivateUserResponse = components['schemas']['ActivateUserResponse'];
export type DeactivateUserRequest = components['schemas']['DeactivateUserRequest'];
export type DeactivateUserResponse = components['schemas']['DeactivateUserResponse'];

// --- Guided Onboarding Contracts (FEAT-ONB-01) ---
export const OnboardingStepId = {
  SHOP_PROFILE: 'SHOP_PROFILE',
  WAREHOUSE: 'WAREHOUSE',
  INVITE_USERS: 'INVITE_USERS',
  CARRIER_ACCOUNT: 'CARRIER_ACCOUNT',
  OPERATING_DEFAULTS: 'OPERATING_DEFAULTS',
  TEST_ORDER: 'TEST_ORDER',
} as const;

export type OnboardingStepId = (typeof OnboardingStepId)[keyof typeof OnboardingStepId];

export const OnboardingStepStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  SKIPPED: 'SKIPPED',
  BLOCKED: 'BLOCKED',
} as const;

export type OnboardingStepStatus = (typeof OnboardingStepStatus)[keyof typeof OnboardingStepStatus];

export const OnboardingOverallStatus = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  DISMISSED: 'DISMISSED',
} as const;

export type OnboardingOverallStatus =
  (typeof OnboardingOverallStatus)[keyof typeof OnboardingOverallStatus];

export const OnboardingAuditEvent = {
  ONBOARDING_INITIALIZED: 'ONBOARDING_INITIALIZED',
  ONBOARDING_STEP_COMPLETED: 'ONBOARDING_STEP_COMPLETED',
  ONBOARDING_STEP_SKIPPED: 'ONBOARDING_STEP_SKIPPED',
  ONBOARDING_RESET: 'ONBOARDING_RESET',
  ONBOARDING_DISMISSED: 'ONBOARDING_DISMISSED',
} as const;

export type OnboardingAuditEvent = (typeof OnboardingAuditEvent)[keyof typeof OnboardingAuditEvent];

export const OnboardingErrorCode = {
  ONBOARDING_NOT_FOUND: 'ONBOARDING_NOT_FOUND',
  STEP_NOT_FOUND: 'STEP_NOT_FOUND',
  STEP_BLOCKED: 'STEP_BLOCKED',
  CANNOT_SKIP_REQUIRED_STEP: 'CANNOT_SKIP_REQUIRED_STEP',
  ONBOARDING_INCOMPLETE: 'ONBOARDING_INCOMPLETE',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type OnboardingErrorCode = (typeof OnboardingErrorCode)[keyof typeof OnboardingErrorCode];

export interface OnboardingStepDto {
  id: OnboardingStepId;
  order: number;
  title: string;
  description: string;
  required: boolean;
  status: OnboardingStepStatus;
  is_blocking: boolean;
  blocking_reasons: string[];
  completed_at: string | null;
  updated_at?: string;
  data?: Record<string, any> | null;
}

export interface OnboardingStateResponseDto {
  merchant_id: string;
  status: OnboardingOverallStatus;
  current_step: OnboardingStepId;
  progress_percentage: number;
  completed_count: number;
  total_required_steps: number;
  completed_required_steps: number;
  steps: OnboardingStepDto[];
  completed_at: string | null;
  updated_at: string;
  can_edit?: boolean;
}

export interface CompleteStepDto {
  data?: Record<string, any>;
}

// --- Branch Contracts (FEAT-ORG-02) ---
export const BranchAuditEvent = {
  BRANCH_CREATED: 'BRANCH_CREATED',
  BRANCH_UPDATED: 'BRANCH_UPDATED',
  BRANCH_ACTIVATED: 'BRANCH_ACTIVATED',
  BRANCH_DEACTIVATED: 'BRANCH_DEACTIVATED',
  BRANCH_DELETED: 'BRANCH_DELETED',
} as const;
export type BranchAuditEvent = (typeof BranchAuditEvent)[keyof typeof BranchAuditEvent];

export const BranchErrorCode = {
  BRANCH_NOT_FOUND: 'BRANCH_NOT_FOUND',
  BRANCH_CODE_EXISTS: 'BRANCH_CODE_EXISTS',
  CANNOT_DEACTIVATE_DEFAULT_BRANCH: 'CANNOT_DEACTIVATE_DEFAULT_BRANCH',
  CANNOT_DELETE_DEFAULT_BRANCH: 'CANNOT_DELETE_DEFAULT_BRANCH',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;
export type BranchErrorCode = (typeof BranchErrorCode)[keyof typeof BranchErrorCode];

export type Branch = components['schemas']['Branch'];
export type CreateBranchInput = components['schemas']['CreateBranchInput'];
export type UpdateBranchInput = components['schemas']['UpdateBranchInput'];
export type BranchResponse = components['schemas']['BranchResponse'];
export type ListBranchesResponse = components['schemas']['ListBranchesResponse'];
export type DeleteBranchResponse = components['schemas']['DeleteBranchResponse'];

export const BRANCH_CODE_REGEX = /^[A-Za-z0-9_-]{2,64}$/;
export const VIETNAMESE_PHONE_REGEX = /^(0|\+84)[35789][0-9]{8}$/;

export function isValidBranchCode(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  return BRANCH_CODE_REGEX.test(code.trim());
}

export function isValidBranchPhone(phone: unknown): boolean {
  if (typeof phone !== 'string') return false;
  const cleanPhone = phone.trim().replace(/[\s.-]/g, '');
  return cleanPhone.length === 0 || VIETNAMESE_PHONE_REGEX.test(cleanPhone);
}

export interface BranchFormState {
  name: string;
  code: string;
  address: string;
  phone: string;
  is_default: boolean;
  status: 'ACTIVE' | 'INACTIVE';
}

export function validateBranchForm(form: BranchFormState): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!form.name || form.name.trim().length < 2) {
    errors.name = 'Tên chi nhánh là bắt buộc và phải có ít nhất 2 ký tự';
  } else if (form.name.trim().length > 255) {
    errors.name = 'Tên chi nhánh không được vượt quá 255 ký tự';
  }

  if (!form.code || !isValidBranchCode(form.code)) {
    errors.code = 'Mã chi nhánh là bắt buộc, từ 2 đến 64 ký tự (chữ, số, "-" hoặc "_")';
  }

  if (form.address && form.address.trim().length > 1000) {
    errors.address = 'Địa chỉ chi nhánh không được vượt quá 1000 ký tự';
  }

  if (form.phone && form.phone.trim()) {
    const cleanPhone = form.phone.trim().replace(/[\s.-]/g, '');
    if (!VIETNAMESE_PHONE_REGEX.test(cleanPhone)) {
      errors.phone = 'Số điện thoại không hợp lệ theo định dạng Việt Nam';
    }
  }

  if (form.status && form.status !== 'ACTIVE' && form.status !== 'INACTIVE') {
    errors.status = 'Trạng thái chi nhánh chỉ có thể là ACTIVE hoặc INACTIVE';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

// --- Global Search Contracts (FEAT-COM-01) ---
export const SearchEntityType = {
  ALL: 'ALL',
  ORDER: 'ORDER',
  WAYBILL: 'WAYBILL',
  BATCH: 'BATCH',
  CASE: 'CASE',
  TRANSACTION: 'TRANSACTION',
} as const;
export type SearchEntityType = (typeof SearchEntityType)[keyof typeof SearchEntityType];

export const SearchAuditEvent = {
  GLOBAL_SEARCH_QUERY: 'GLOBAL_SEARCH_QUERY',
} as const;
export type SearchAuditEvent = (typeof SearchAuditEvent)[keyof typeof SearchAuditEvent];

export const SearchErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  FORBIDDEN: 'FORBIDDEN',
} as const;
export type SearchErrorCode = (typeof SearchErrorCode)[keyof typeof SearchErrorCode];

export type SearchResultItem = components['schemas']['SearchResultItem'];
export type SearchResponseData = components['schemas']['SearchResponseData'];
export type SearchResponse = components['schemas']['SearchResponse'];

// --- Notification Center Contracts (FEAT-COM-09) ---
/**
 * FEAT-COM-09 — Notification Center, 14 Event Contracts & Recovery DTOs (D1–D6)
 */

export const NOTIFICATION_EVENT = 'NOTIFICATION_EVENT' as const;
export const NOTIFICATION_QUEUE_NAME = 'shipde-notification-queue' as const;

export const NotificationEventType = {
  EVT_COM_09_01: 'EVT-COM-09-01', // Invite/identity/security change (LIVE producer in S01)
  EVT_COM_09_02: 'EVT-COM-09-02', // Carrier token invalid/expiring
  EVT_COM_09_03: 'EVT-COM-09-03', // Serviceability all unavailable
  EVT_COM_09_04: 'EVT-COM-09-04', // Carrier API outage/timeout
  EVT_COM_09_05: 'EVT-COM-09-05', // Create outcome unknown
  EVT_COM_09_06: 'EVT-COM-09-06', // Pickup overdue
  EVT_COM_09_07: 'EVT-COM-09-07', // Delivery exception
  EVT_COM_09_08: 'EVT-COM-09-08', // Return expected/overdue
  EVT_COM_09_09: 'EVT-COM-09-09', // Import blocked
  EVT_COM_09_10: 'EVT-COM-09-10', // Manual match required
  EVT_COM_09_11: 'EVT-COM-09-11', // Audit finding created
  EVT_COM_09_12: 'EVT-COM-09-12', // Bank short/over
  EVT_COM_09_13: 'EVT-COM-09-13', // Claim deadline approaching
  EVT_COM_09_14: 'EVT-COM-09-14', // Claim accepted but unpaid
} as const;

export type NotificationEventType =
  (typeof NotificationEventType)[keyof typeof NotificationEventType];

export const ALL_NOTIFICATION_EVENT_TYPES: readonly NotificationEventType[] =
  Object.values(NotificationEventType);

export const NotificationSeverity = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
} as const;
export type NotificationSeverity = (typeof NotificationSeverity)[keyof typeof NotificationSeverity];

export const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
};

export const NotificationStatus = {
  ACTIVE: 'ACTIVE',
  RESOLVED: 'RESOLVED',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

export const NotificationChannel = {
  IN_APP: 'in_app',
  EMAIL: 'email',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationDeliveryState = {
  PENDING: 'PENDING',
  IN_FLIGHT: 'IN_FLIGHT',
  SENT: 'SENT',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
  SKIPPED_NO_VERIFIED_EMAIL: 'SKIPPED_NO_VERIFIED_EMAIL',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  DEAD_LETTER: 'DEAD_LETTER',
} as const;
export type NotificationDeliveryState =
  (typeof NotificationDeliveryState)[keyof typeof NotificationDeliveryState];

export const PROTECTED_SUBSCRIPTION_KEYS = [
  'security_alerts',
  'create_unknown',
  'claim_deadline_warning',
] as const;
export type ProtectedSubscriptionKey = (typeof PROTECTED_SUBSCRIPTION_KEYS)[number];

export type NotificationPreferenceSubscriptionKey =
  | 'security_alerts'
  | 'create_unknown'
  | 'claim_deadline_warning'
  | 'delivery_fail'
  | 'rate_discrepancy'
  | 'cod_overdue'
  | 'abnormal_return';

export interface NotificationMatrixRule {
  eventType: NotificationEventType;
  label: string;
  severity: NotificationSeverity;
  defaultChannels: readonly NotificationChannel[];
  digest: boolean;
  protectedSubscriptionKey?: ProtectedSubscriptionKey;
  subscriptionKey?: NotificationPreferenceSubscriptionKey;
  eligibleBaseRoles: readonly ('OWNER' | 'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT')[];
  customRolePermission?: string;
  includeAffectedUser?: boolean;
  scopeDimensions: readonly ('branch_id' | 'warehouse_id' | 'carrier_account_id')[];
  liveProducerInS01: boolean;
}

export const NOTIFICATION_MATRIX_RULES: Record<NotificationEventType, NotificationMatrixRule> = {
  'EVT-COM-09-01': {
    eventType: 'EVT-COM-09-01',
    label: 'Thay đổi lời mời / định danh / bảo mật',
    severity: 'high',
    defaultChannels: ['in_app', 'email'],
    digest: false,
    protectedSubscriptionKey: 'security_alerts',
    subscriptionKey: 'security_alerts',
    eligibleBaseRoles: ['OWNER'],
    includeAffectedUser: true,
    scopeDimensions: [],
    liveProducerInS01: true,
  },
  'EVT-COM-09-02': {
    eventType: 'EVT-COM-09-02',
    label: 'Token hãng vận chuyển không hợp lệ / sắp hết hạn',
    severity: 'high',
    defaultChannels: ['in_app', 'email'],
    digest: false,
    subscriptionKey: 'security_alerts',
    eligibleBaseRoles: ['OWNER'],
    customRolePermission: 'carrier.credentials.manage',
    scopeDimensions: ['carrier_account_id'],
    liveProducerInS01: false,
  },
  'EVT-COM-09-03': {
    eventType: 'EVT-COM-09-03',
    label: 'Không có dịch vụ vận chuyển khả dụng',
    severity: 'medium',
    defaultChannels: ['in_app'],
    digest: false,
    subscriptionKey: 'delivery_fail',
    eligibleBaseRoles: ['OPS_CSKH'],
    customRolePermission: 'order.manage',
    scopeDimensions: ['branch_id'],
    liveProducerInS01: false,
  },
  'EVT-COM-09-04': {
    eventType: 'EVT-COM-09-04',
    label: 'API hãng vận chuyển gián đoạn / quá thời gian chờ',
    severity: 'medium',
    defaultChannels: ['in_app'],
    digest: false,
    subscriptionKey: 'delivery_fail',
    eligibleBaseRoles: ['OPS_CSKH'],
    customRolePermission: 'carrier.health.view',
    scopeDimensions: ['carrier_account_id'],
    liveProducerInS01: false,
  },
  'EVT-COM-09-05': {
    eventType: 'EVT-COM-09-05',
    label: 'Không xác định kết quả tạo vận đơn',
    severity: 'critical',
    defaultChannels: ['in_app', 'email'],
    digest: false,
    protectedSubscriptionKey: 'create_unknown',
    subscriptionKey: 'create_unknown',
    eligibleBaseRoles: ['OPS_CSKH', 'OWNER'],
    customRolePermission: 'shipment.manage',
    scopeDimensions: ['branch_id', 'warehouse_id'],
    liveProducerInS01: false,
  },
  'EVT-COM-09-06': {
    eventType: 'EVT-COM-09-06',
    label: 'Quá hạn lấy hàng',
    severity: 'high',
    defaultChannels: ['in_app'],
    digest: false,
    subscriptionKey: 'delivery_fail',
    eligibleBaseRoles: ['OPS_CSKH', 'WAREHOUSE'],
    customRolePermission: 'pickup.manage',
    scopeDimensions: ['warehouse_id'],
    liveProducerInS01: false,
  },
  'EVT-COM-09-07': {
    eventType: 'EVT-COM-09-07',
    label: 'Ngoại lệ giao hàng',
    severity: 'high',
    defaultChannels: ['in_app'],
    digest: false,
    subscriptionKey: 'delivery_fail',
    eligibleBaseRoles: ['OPS_CSKH'],
    customRolePermission: 'exception.manage',
    scopeDimensions: ['branch_id'],
    liveProducerInS01: false,
  },
  'EVT-COM-09-08': {
    eventType: 'EVT-COM-09-08',
    label: 'Hàng hoàn dự kiến / quá hạn',
    severity: 'medium',
    defaultChannels: ['in_app'],
    digest: true,
    subscriptionKey: 'abnormal_return',
    eligibleBaseRoles: ['WAREHOUSE', 'OPS_CSKH'],
    customRolePermission: 'return.manage',
    scopeDimensions: ['warehouse_id'],
    liveProducerInS01: false,
  },
  'EVT-COM-09-09': {
    eventType: 'EVT-COM-09-09',
    label: 'Bản nhập dữ liệu bị chặn',
    severity: 'high',
    defaultChannels: ['in_app'],
    digest: false,
    subscriptionKey: 'rate_discrepancy',
    eligibleBaseRoles: ['ACCOUNTANT', 'OPS_CSKH'],
    customRolePermission: 'import.review',
    scopeDimensions: ['branch_id'],
    liveProducerInS01: false,
  },
  'EVT-COM-09-10': {
    eventType: 'EVT-COM-09-10',
    label: 'Cần đối khớp thủ công giao dịch ngân hàng',
    severity: 'medium',
    defaultChannels: ['in_app'],
    digest: true,
    subscriptionKey: 'cod_overdue',
    eligibleBaseRoles: ['ACCOUNTANT', 'OPS_CSKH'],
    customRolePermission: 'bank.allocate',
    scopeDimensions: ['carrier_account_id'],
    liveProducerInS01: false,
  },
  'EVT-COM-09-11': {
    eventType: 'EVT-COM-09-11',
    label: 'Phát sinh phát hiện kiểm toán cước',
    severity: 'medium',
    defaultChannels: ['in_app'],
    digest: false,
    subscriptionKey: 'rate_discrepancy',
    eligibleBaseRoles: ['ACCOUNTANT'],
    customRolePermission: 'audit.review',
    scopeDimensions: [],
    liveProducerInS01: false,
  },
  'EVT-COM-09-12': {
    eventType: 'EVT-COM-09-12',
    label: 'Chênh lệch tiền ngân hàng (thiếu / thừa)',
    severity: 'high',
    defaultChannels: ['in_app', 'email'],
    digest: false,
    subscriptionKey: 'cod_overdue',
    eligibleBaseRoles: ['ACCOUNTANT', 'OWNER'],
    customRolePermission: 'bank.allocate',
    scopeDimensions: [],
    liveProducerInS01: false,
  },
  'EVT-COM-09-13': {
    eventType: 'EVT-COM-09-13',
    label: 'Sắp hết hạn khiếu nại',
    severity: 'critical',
    defaultChannels: ['in_app', 'email'],
    digest: false,
    protectedSubscriptionKey: 'claim_deadline_warning',
    subscriptionKey: 'claim_deadline_warning',
    eligibleBaseRoles: ['ACCOUNTANT', 'OWNER'],
    customRolePermission: 'claim.manage',
    scopeDimensions: ['carrier_account_id'],
    liveProducerInS01: false,
  },
  'EVT-COM-09-14': {
    eventType: 'EVT-COM-09-14',
    label: 'Khiếu nại đã được hãng chấp nhận nhưng chưa nhận tiền',
    severity: 'high',
    defaultChannels: ['in_app'],
    digest: false,
    subscriptionKey: 'cod_overdue',
    eligibleBaseRoles: ['ACCOUNTANT'],
    customRolePermission: 'claim.manage',
    scopeDimensions: ['carrier_account_id'],
    liveProducerInS01: false,
  },
};

export interface NotificationEventSource {
  type: string;
  id: string;
  branch_id: string | null;
  warehouse_id: string | null;
  carrier_account_id: string | null;
}

export interface NotificationOutboxEnvelope<TPayload = Record<string, unknown>> {
  schema_version: 1;
  event: NotificationEventType;
  occurred_at: string;
  merchant_id: string;
  is_resolution?: boolean;
  target_group_key?: string;
  resolution_id?: string;
  source: NotificationEventSource;
  payload: TPayload;
  /** True only for test/integration fixture producers (D1). */
  fixture_evidence?: boolean;
}

export type SecurityChangeKind =
  | 'invite_sent'
  | 'invite_accepted'
  | 'password_reset'
  | 'mfa_changed'
  | 'session_revoked'
  | 'role_changed';

const SECURITY_CHANGE_KINDS = new Set<string>([
  'invite_sent',
  'invite_accepted',
  'password_reset',
  'mfa_changed',
  'session_revoked',
  'role_changed',
]);

const EVIDENCE_LEVELS = new Set<string>([
  'suspected',
  'verified',
  'carrier_accepted',
  'bank_received',
]);

const DATE_WINDOW_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isNullableString(v: unknown): v is string | null {
  return v === null || isNonEmptyString(v);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function isSignedNonZeroInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v !== 0;
}

function hasExactKeys(obj: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

export interface NotificationValidationResult {
  valid: boolean;
  error?: string;
  sourceFingerprint?: string;
  groupKey?: string;
  digestWindow?: string | null;
  queueRevision?: number | null;
}

/**
 * Strictly validates a NOTIFICATION_EVENT envelope & event-specific payload per D6.
 * Rejects missing required fields, unknown fields, or wrong types (to dead-letter).
 */
export function validateNotificationEnvelope(raw: unknown): NotificationValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Envelope must be a JSON object' };
  }
  const env = raw as Record<string, unknown>;
  if (env.schema_version !== 1) {
    return { valid: false, error: 'schema_version must be 1' };
  }
  if (!isNonEmptyString(env.event) || !(env.event in NOTIFICATION_MATRIX_RULES)) {
    return { valid: false, error: `Unknown event type: ${String(env.event)}` };
  }
  const eventType = env.event as NotificationEventType;
  if (!isNonEmptyString(env.occurred_at) || Number.isNaN(Date.parse(env.occurred_at))) {
    return { valid: false, error: 'occurred_at must be a valid ISO-8601 timestamp' };
  }
  if (!isNonEmptyString(env.merchant_id)) {
    return { valid: false, error: 'merchant_id is required' };
  }
  const isResolution = env.is_resolution === true;
  if (env.is_resolution !== undefined && typeof env.is_resolution !== 'boolean') {
    return { valid: false, error: 'is_resolution must be boolean when provided' };
  }
  if (!env.source || typeof env.source !== 'object' || Array.isArray(env.source)) {
    return { valid: false, error: 'source object is required' };
  }
  const src = env.source as Record<string, unknown>;
  if (
    !hasExactKeys(src, ['type', 'id', 'branch_id', 'warehouse_id', 'carrier_account_id']) ||
    !isNonEmptyString(src.type) ||
    !isNonEmptyString(src.id) ||
    !isNullableString(src.branch_id ?? null) ||
    !isNullableString(src.warehouse_id ?? null) ||
    !isNullableString(src.carrier_account_id ?? null)
  ) {
    return { valid: false, error: 'Invalid source object fields' };
  }

  if (isResolution) {
    if (!isNonEmptyString(env.target_group_key) || !isNonEmptyString(env.resolution_id)) {
      return {
        valid: false,
        error: 'Resolution envelope requires target_group_key and resolution_id',
      };
    }
    return {
      valid: true,
      sourceFingerprint: env.target_group_key,
      groupKey: env.target_group_key,
    };
  }

  if (!env.payload || typeof env.payload !== 'object' || Array.isArray(env.payload)) {
    return { valid: false, error: 'payload must be an object' };
  }
  const p = env.payload as Record<string, unknown>;

  let sourceFingerprint = '';
  let digestWindow: string | null = null;
  let queueRevision: number | null = null;

  switch (eventType) {
    case 'EVT-COM-09-01':
      if (
        !hasExactKeys(p, ['affected_user_id', 'change_kind']) ||
        !isNonEmptyString(p.affected_user_id) ||
        !isNonEmptyString(p.change_kind) ||
        !SECURITY_CHANGE_KINDS.has(p.change_kind)
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-01 payload' };
      }
      sourceFingerprint = `${p.affected_user_id}:${p.change_kind}:${src.id}`;
      break;

    case 'EVT-COM-09-02':
      if (
        !hasExactKeys(p, ['carrier_account_id', 'incident_id', 'condition', 'expires_at']) ||
        !isNonEmptyString(p.carrier_account_id) ||
        !isNonEmptyString(p.incident_id) ||
        (p.condition !== 'invalid' && p.condition !== 'expiring') ||
        !isNullableString(p.expires_at)
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-02 payload' };
      }
      sourceFingerprint = `${p.carrier_account_id}:${p.condition}:${p.incident_id}`;
      break;

    case 'EVT-COM-09-03':
      if (
        !hasExactKeys(p, ['order_id', 'input_revision', 'branch_id']) ||
        !isNonEmptyString(p.order_id) ||
        !isPositiveInt(p.input_revision) ||
        !isNonEmptyString(p.branch_id)
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-03 payload' };
      }
      sourceFingerprint = `${p.order_id}:${p.input_revision}`;
      break;

    case 'EVT-COM-09-04':
      if (
        !hasExactKeys(p, ['carrier_account_id', 'incident_id', 'failure_kind']) ||
        !isNonEmptyString(p.carrier_account_id) ||
        !isNonEmptyString(p.incident_id) ||
        (p.failure_kind !== 'outage' && p.failure_kind !== 'timeout')
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-04 payload' };
      }
      sourceFingerprint = `${p.incident_id}`;
      break;

    case 'EVT-COM-09-05':
      if (
        !hasExactKeys(p, ['shipment_id', 'create_attempt_id', 'branch_id', 'warehouse_id']) ||
        !isNonEmptyString(p.shipment_id) ||
        !isNonEmptyString(p.create_attempt_id) ||
        !isNonEmptyString(p.branch_id) ||
        !isNonEmptyString(p.warehouse_id)
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-05 payload' };
      }
      sourceFingerprint = `${p.shipment_id}:${p.create_attempt_id}`;
      break;

    case 'EVT-COM-09-06':
      if (
        !hasExactKeys(p, ['shipment_id', 'warehouse_id', 'overdue_tier']) ||
        !isNonEmptyString(p.shipment_id) ||
        !isNonEmptyString(p.warehouse_id) ||
        !isPositiveInt(p.overdue_tier)
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-06 payload' };
      }
      sourceFingerprint = `${p.shipment_id}:${p.overdue_tier}`;
      break;

    case 'EVT-COM-09-07':
      if (
        !hasExactKeys(p, ['shipment_id', 'exception_id', 'branch_id']) ||
        !isNonEmptyString(p.shipment_id) ||
        !isNonEmptyString(p.exception_id) ||
        !isNonEmptyString(p.branch_id)
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-07 payload' };
      }
      sourceFingerprint = `${p.shipment_id}:${p.exception_id}`;
      break;

    case 'EVT-COM-09-08':
      if (
        !hasExactKeys(p, [
          'return_id',
          'warehouse_id',
          'condition',
          'overdue_tier',
          'digest_window',
        ]) ||
        !isNonEmptyString(p.return_id) ||
        !isNonEmptyString(p.warehouse_id) ||
        (p.condition !== 'expected' && p.condition !== 'overdue') ||
        !(p.overdue_tier === null || isPositiveInt(p.overdue_tier)) ||
        !(
          p.digest_window === null ||
          (isNonEmptyString(p.digest_window) && DATE_WINDOW_PATTERN.test(p.digest_window))
        )
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-08 payload' };
      }
      sourceFingerprint = `${p.return_id}:${p.condition}:${p.overdue_tier ?? 'none'}`;
      digestWindow = p.digest_window as string | null;
      break;

    case 'EVT-COM-09-09':
      if (
        !hasExactKeys(p, ['import_id', 'import_revision', 'branch_id']) ||
        !isNonEmptyString(p.import_id) ||
        !isPositiveInt(p.import_revision) ||
        !isNullableString(p.branch_id)
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-09 payload' };
      }
      sourceFingerprint = `${p.import_id}:${p.import_revision}`;
      break;

    case 'EVT-COM-09-10':
      if (
        !hasExactKeys(p, [
          'queue_count',
          'carrier_account_id',
          'digest_window',
          'queue_revision',
        ]) ||
        !isNonNegativeInt(p.queue_count) ||
        !isNullableString(p.carrier_account_id) ||
        !isNonEmptyString(p.digest_window) ||
        !DATE_WINDOW_PATTERN.test(p.digest_window) ||
        !isPositiveInt(p.queue_revision)
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-10 payload' };
      }
      sourceFingerprint = `${p.carrier_account_id || 'all'}`;
      digestWindow = p.digest_window;
      queueRevision = p.queue_revision;
      break;

    case 'EVT-COM-09-11':
      if (
        !hasExactKeys(p, ['audit_run_id', 'finding_count']) ||
        !isNonEmptyString(p.audit_run_id) ||
        !isPositiveInt(p.finding_count)
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-11 payload' };
      }
      sourceFingerprint = `${p.audit_run_id}`;
      break;

    case 'EVT-COM-09-12':
      if (
        !hasExactKeys(p, ['batch_id', 'difference_vnd', 'evidence_level']) ||
        !isNonEmptyString(p.batch_id) ||
        !isSignedNonZeroInt(p.difference_vnd) ||
        !isNonEmptyString(p.evidence_level) ||
        !EVIDENCE_LEVELS.has(p.evidence_level)
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-12 payload' };
      }
      sourceFingerprint = `${p.batch_id}:${p.evidence_level}`;
      break;

    case 'EVT-COM-09-13':
      if (
        !hasExactKeys(p, ['claim_id', 'carrier_account_id', 'reminder_tier', 'deadline_at']) ||
        !isNonEmptyString(p.claim_id) ||
        !isNonEmptyString(p.carrier_account_id) ||
        !isPositiveInt(p.reminder_tier) ||
        !isNonEmptyString(p.deadline_at) ||
        Number.isNaN(Date.parse(p.deadline_at))
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-13 payload' };
      }
      sourceFingerprint = `${p.claim_id}:${p.reminder_tier}`;
      break;

    case 'EVT-COM-09-14':
      if (
        !hasExactKeys(p, ['claim_id', 'carrier_account_id', 'accepted_amount_vnd', 'aging_tier']) ||
        !isNonEmptyString(p.claim_id) ||
        !isNonEmptyString(p.carrier_account_id) ||
        !isNonNegativeInt(p.accepted_amount_vnd) ||
        !isPositiveInt(p.aging_tier)
      ) {
        return { valid: false, error: 'Invalid EVT-COM-09-14 payload' };
      }
      sourceFingerprint = `${p.claim_id}:${p.aging_tier}`;
      break;
  }

  const groupKey = digestWindow ? `${sourceFingerprint}:${digestWindow}` : sourceFingerprint;
  return {
    valid: true,
    sourceFingerprint,
    groupKey,
    digestWindow,
    queueRevision,
  };
}

/**
 * D6 transport outbox key for active notification events (separate from group_key).
 */
export function buildNotificationOutboxKey(params: {
  merchantId: string;
  eventType: NotificationEventType;
  sourceFingerprint: string;
  digestWindow?: string | null;
  queueRevision?: number | null;
}): string {
  const base = `com09:outbox:${params.merchantId}:${params.eventType}:notify:${params.sourceFingerprint}`;
  if (params.digestWindow) {
    return `${base}:${params.digestWindow}:${params.queueRevision ?? 1}`;
  }
  return base;
}

/**
 * D6 transport outbox key for resolution events (never collides with active outbox keys).
 */
export function buildNotificationResolutionOutboxKey(params: {
  merchantId: string;
  eventType: NotificationEventType;
  targetGroupKey: string;
  resolutionId: string;
}): string {
  return `com09:outbox:${params.merchantId}:${params.eventType}:resolve:${params.targetGroupKey}:${params.resolutionId}`;
}

export function buildProviderSubmissionId(notificationId: string, attempt: number): string {
  return `com09-email:${notificationId}:${attempt}`;
}

export function maskNotificationEmail(email?: string | null): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 0) return '***';
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export interface NotificationItemDto {
  id: string;
  event_type: NotificationEventType;
  event_label: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  source_type: string;
  source_id: string;
  group_key: string;
  digest_count: number;
  link_path: string;
  status: NotificationStatus;
  read_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface NotificationDeliveryRecoveryItemDto {
  id: string;
  notification_id: string;
  event_type: string;
  severity: NotificationSeverity;
  title: string;
  recipient_email_masked: string | null;
  channel: NotificationChannel;
  state: NotificationDeliveryState;
  attempts: number;
  provider_submission_id: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface RedeliverNotificationDeliveryRequest {
  expected_attempt: number;
  expected_provider_submission_id: string;
  idempotency_key: string;
  resolution: 'MARK_SENT' | 'RELEASE_FOR_RETRY';
  provider_message_id: string | null;
}

// --- Generated OpenAPI Schema Types ---
export type * from './openapi';
