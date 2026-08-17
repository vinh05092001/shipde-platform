// ============================================================================
// Ship Dễ UI — Frontend Types & State Management
// ============================================================================

export type ActiveRole = 'OWNER' | 'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT' | 'ADMIN';

export type ActiveTab =
  | 'control_tower'
  | 'three_ledgers'
  | 'exceptions'
  | 'reconciliation'
  | 'returns'
  | 'claims'
  | 'source_matching'
  | 'public_tracking'
  | 'notifications'
  | 'users'
  | 'admin_settings'
  | 'mobile_preview';

export interface UIExceptionItem {
  id: string;
  tracking_code: string;
  order_code: string;
  carrier_code: 'GHN' | 'GHTK';
  recipient_name: string;
  recipient_phone: string;
  recipient_address?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  cod_amount: number;
  exception_type: 'DELIVERY_FAIL' | 'PICKUP_DELAY' | 'STUCK_IN_TRANSIT';
  status: 'OPEN' | 'ASSIGNED' | 'REATTEMPT_REQUESTED' | 'RESCUED' | 'RETURNED' | 'IN_PROGRESS';
  occurred_at: string;
  deadline_at: string;
  hours_remaining?: number;
  priority_score: number;
  carrier_reason?: string;
  reason?: string;
  attempts?: number;
  reattempt_count?: number;
  assigned_to?: string;
  locked_until?: string;
  last_modified_by?: string;
  version?: number;
}

export interface UIDiscrepancyItem {
  id: string;
  tracking_code: string;
  order_code: string;
  carrier_code?: 'GHN' | 'GHTK';
  carrier?: string;
  type: 'D1_WEIGHT' | 'D2_FREIGHT' | 'D4_DUPLICATE' | 'D5_COD_MISMATCH' | 'D6_OVERDUE_COD' | 'D7_MISSING' | string;
  declared_value?: string;
  charged_value?: string;
  contract_amount?: number;
  charged_amount?: number;
  amount?: number;
  discrepancy_amount: number;
  status: 'OPEN' | 'CONFIRMED' | 'DISPUTED' | 'WAIVED' | 'RESOLVED' | 'CARRY_FORWARD' | string;
  reason?: string;
  resolved_by?: string;
  created_by_user?: string; // Dùng để kiểm tra tách quyền tài chính BR-12
  version?: number;
}

export interface UIClaimItem {
  id: string;
  tracking_code: string;
  carrier_ticket?: string;
  claim_type: 'FEE' | 'COD' | 'LOST' | 'DAMAGED';
  requested_amount: number;
  accepted_amount: number;
  recovered_amount: number;
  status: 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'CLOSED';
  deadline_at: string;
  hours_left: number;
  evidence_count: number;
}

export interface UIReturnScanItem {
  id: string;
  tracking_code: string;
  warehouse: string;
  condition: 'intact' | 'damaged' | 'missing_item';
  scanned_at: string;
  is_offline: boolean;
  evidence_url?: string;
}

export interface UITimelineEvent {
  id: string;
  source: 'CARRIER' | 'CSKH' | 'WAREHOUSE' | 'RECON' | 'SYSTEM';
  source_label: string;
  title: string;
  description: string;
  occurred_at: string;
  actor?: string;
  type?: 'error' | 'warning' | 'info' | 'success';
}

export interface UIFilterOptions {
  searchQuery: string;
  carrier: 'ALL' | 'GHN' | 'GHTK';
  status: string;
  dateRange: 'ALL' | 'TODAY' | 'LAST_7_DAYS' | 'THIS_MONTH';
}
