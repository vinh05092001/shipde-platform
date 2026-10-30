/**
 * @shipde/contracts
 * Core domain contracts, enumerations, and canonical error definitions for Ship Dễ.
 */

export * from './lists.js';

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
import { components } from './openapi.js';

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

// --- Generated OpenAPI Schema Types ---
export type * from './openapi.js';
