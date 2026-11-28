import type {
  NotificationEventType,
  NotificationOutboxEnvelope,
  NotificationDeliveryState,
} from '@shipde/contracts';

/**
 * FEAT-COM-09 — Synthetic Fixture Producers (D1: test/integration evidence ONLY)
 * Never presented as live events.
 */
export function buildFixtureNotificationEnvelope(
  event: NotificationEventType,
  overrides: {
    merchantId: string;
    occurredAt?: string;
    sourceId?: string;
    branchId?: string | null;
    warehouseId?: string | null;
    carrierAccountId?: string | null;
    affectedUserId?: string;
    incidentId?: string;
    digestWindow?: string;
    queueRevision?: number;
    inputRevision?: number;
    importRevision?: number;
  }
): NotificationOutboxEnvelope {
  const occurredAt = overrides.occurredAt || new Date().toISOString();
  const sourceId = overrides.sourceId || `fix-${event.toLowerCase()}-001`;
  const branchId = overrides.branchId ?? null;
  const warehouseId = overrides.warehouseId ?? null;
  const carrierAccountId = overrides.carrierAccountId ?? null;

  const base = {
    schema_version: 1 as const,
    event,
    occurred_at: occurredAt,
    merchant_id: overrides.merchantId,
    fixture_evidence: true,
    source: {
      type: 'fixture',
      id: sourceId,
      branch_id: branchId,
      warehouse_id: warehouseId,
      carrier_account_id: carrierAccountId,
    },
  };

  switch (event) {
    case 'EVT-COM-09-01':
      return {
        ...base,
        source: { ...base.source, type: 'invitation' },
        payload: {
          affected_user_id: overrides.affectedUserId || '00000000-0000-4000-8000-000000000001',
          change_kind: 'invite_sent',
        },
      };
    case 'EVT-COM-09-02':
      return {
        ...base,
        source: { ...base.source, type: 'carrier_account' },
        payload: {
          carrier_account_id: carrierAccountId || '00000000-0000-4000-8000-000000000002',
          incident_id: overrides.incidentId || 'inc-cred-001',
          condition: 'expiring',
          expires_at: new Date(Date.parse(occurredAt) + 86400000).toISOString(),
        },
      };
    case 'EVT-COM-09-03':
      return {
        ...base,
        source: { ...base.source, type: 'order' },
        payload: {
          order_id: sourceId,
          input_revision: overrides.inputRevision ?? 1,
          branch_id: branchId || '00000000-0000-4000-8000-000000000003',
        },
      };
    case 'EVT-COM-09-04':
      return {
        ...base,
        source: { ...base.source, type: 'carrier_account' },
        payload: {
          carrier_account_id: carrierAccountId || '00000000-0000-4000-8000-000000000002',
          incident_id: overrides.incidentId || 'inc-outage-001',
          failure_kind: 'timeout',
        },
      };
    case 'EVT-COM-09-05':
      return {
        ...base,
        source: { ...base.source, type: 'shipment' },
        payload: {
          shipment_id: sourceId,
          create_attempt_id: 'att-001',
          branch_id: branchId || '00000000-0000-4000-8000-000000000003',
          warehouse_id: warehouseId || '00000000-0000-4000-8000-000000000004',
        },
      };
    case 'EVT-COM-09-06':
      return {
        ...base,
        source: { ...base.source, type: 'shipment' },
        payload: {
          shipment_id: sourceId,
          warehouse_id: warehouseId || '00000000-0000-4000-8000-000000000004',
          overdue_tier: 1,
        },
      };
    case 'EVT-COM-09-07':
      return {
        ...base,
        source: { ...base.source, type: 'exception' },
        payload: {
          shipment_id: sourceId,
          exception_id: 'exc-001',
          branch_id: branchId || '00000000-0000-4000-8000-000000000003',
        },
      };
    case 'EVT-COM-09-08':
      return {
        ...base,
        source: { ...base.source, type: 'return' },
        payload: {
          return_id: sourceId,
          warehouse_id: warehouseId || '00000000-0000-4000-8000-000000000004',
          condition: 'expected',
          overdue_tier: null,
          digest_window: overrides.digestWindow || '2026-11-28',
        },
      };
    case 'EVT-COM-09-09':
      return {
        ...base,
        source: { ...base.source, type: 'import' },
        payload: {
          import_id: sourceId,
          import_revision: overrides.importRevision ?? 1,
          branch_id: branchId,
        },
      };
    case 'EVT-COM-09-10':
      return {
        ...base,
        source: { ...base.source, type: 'bank_queue' },
        payload: {
          queue_count: 3,
          carrier_account_id: carrierAccountId,
          digest_window: overrides.digestWindow || '2026-11-28',
          queue_revision: overrides.queueRevision ?? 1,
        },
      };
    case 'EVT-COM-09-11':
      return {
        ...base,
        source: { ...base.source, type: 'audit_run' },
        payload: {
          audit_run_id: sourceId,
          finding_count: 2,
        },
      };
    case 'EVT-COM-09-12':
      return {
        ...base,
        source: { ...base.source, type: 'bank_batch' },
        payload: {
          batch_id: sourceId,
          difference_vnd: -15000,
          evidence_level: 'verified',
        },
      };
    case 'EVT-COM-09-13':
      return {
        ...base,
        source: { ...base.source, type: 'claim' },
        payload: {
          claim_id: sourceId,
          carrier_account_id: carrierAccountId || '00000000-0000-4000-8000-000000000002',
          reminder_tier: 1,
          deadline_at: new Date(Date.parse(occurredAt) + 43200000).toISOString(),
        },
      };
    case 'EVT-COM-09-14':
      return {
        ...base,
        source: { ...base.source, type: 'claim' },
        payload: {
          claim_id: sourceId,
          carrier_account_id: carrierAccountId || '00000000-0000-4000-8000-000000000002',
          accepted_amount_vnd: 250000,
          aging_tier: 1,
        },
      };
  }
}

export type ControlledEmailMode =
  'SENT' | 'FAILED' | 'TIMEOUT_UNKNOWN' | 'NO_MESSAGE_ID_UNKNOWN' | 'NOT_CONFIGURED';

export interface ControlledEmailSendInput {
  to: string;
  subject: string;
  body: string;
  submissionId: string;
  correlationId: string;
}

export interface ControlledEmailSendResult {
  outcome: Extract<NotificationDeliveryState, 'SENT' | 'FAILED' | 'UNKNOWN' | 'NOT_CONFIGURED'>;
  providerMessageId?: string | null;
  errorCode?: string | null;
  fixtureEvidence: true;
}

/**
 * Deterministic fake email transport for test-only fixture evidence (D5).
 */
export class ControlledNotificationEmailTransport {
  public mode: ControlledEmailMode = 'SENT';
  public readonly calls: ControlledEmailSendInput[] = [];

  async send(input: ControlledEmailSendInput): Promise<ControlledEmailSendResult> {
    this.calls.push(input);
    switch (this.mode) {
      case 'NOT_CONFIGURED':
        return {
          outcome: 'NOT_CONFIGURED',
          errorCode: 'PROVIDER_NOT_CONFIGURED',
          fixtureEvidence: true,
        };
      case 'FAILED':
        return { outcome: 'FAILED', errorCode: 'PROVIDER_REJECTED_422', fixtureEvidence: true };
      case 'TIMEOUT_UNKNOWN':
        return { outcome: 'UNKNOWN', errorCode: 'PROVIDER_TIMEOUT', fixtureEvidence: true };
      case 'NO_MESSAGE_ID_UNKNOWN':
        return {
          outcome: 'UNKNOWN',
          providerMessageId: null,
          errorCode: 'MISSING_PROVIDER_MESSAGE_ID',
          fixtureEvidence: true,
        };
      case 'SENT':
      default:
        return {
          outcome: 'SENT',
          providerMessageId: `fix-msg-${this.calls.length}`,
          fixtureEvidence: true,
        };
    }
  }
}
