/**
 * FEAT-COM-06 — Attachment action capability registry.
 *
 * Single source of truth mapping every attachment API action to the registry
 * capabilities (RBAC-APPROVAL-MATRIX) that satisfy it, plus the per-entity-type
 * requirement applied on top of the any-of base capability. `AttachmentsService`
 * enforces these server-side for every action; unit tests exercise the whole
 * matrix deterministically.
 *
 * Source: docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md
 *   - shipment:receive_return (return evidence)
 *   - claim:verify_submit (claim evidence)
 *   - reconciliation:import_settlement_bank (statements)
 *   - reconciliation:run_review_audit (discrepancy evidence)
 *   - order:view_create / iam:shop_config (general/shop attachments)
 */

export const ATTACHMENT_ACTIONS = [
  'LIST',
  'GET',
  'DOWNLOAD',
  'UPLOAD',
  'DELETE',
  'BULK_DELETE',
  'QUARANTINE',
  'RETENTION_PURGE',
  'RECONCILE',
] as const;

export type AttachmentAction = (typeof ATTACHMENT_ACTIONS)[number];

/**
 * Base any-of capability set per action. Read and evidence-mutation actions are
 * satisfied by any domain capability that legitimately owns attachments;
 * maintenance actions (quarantine, retention purge, reconciliation) require
 * tenant configuration rights (iam:shop_config) — mirroring the endpoint-level
 * @RequirePermissions guards.
 */
export const ATTACHMENT_ACTION_CAPABILITIES: Record<AttachmentAction, readonly string[]> = {
  LIST: [
    'iam:shop_config',
    'order:view_create',
    'shipment:receive_return',
    'claim:verify_submit',
    'reconciliation:import_settlement_bank',
    'reconciliation:run_review_audit',
    'shipment:create_update',
    'shipment:track_exceptions',
    'iam:shop_view',
  ],
  GET: [
    'iam:shop_config',
    'order:view_create',
    'shipment:receive_return',
    'claim:verify_submit',
    'reconciliation:import_settlement_bank',
    'reconciliation:run_review_audit',
    'shipment:create_update',
    'shipment:track_exceptions',
    'iam:shop_view',
  ],
  DOWNLOAD: [
    'iam:shop_config',
    'order:view_create',
    'shipment:receive_return',
    'claim:verify_submit',
    'reconciliation:import_settlement_bank',
    'reconciliation:run_review_audit',
    'shipment:create_update',
    'shipment:track_exceptions',
    'iam:shop_view',
  ],
  UPLOAD: [
    'iam:shop_config',
    'order:view_create',
    'shipment:receive_return',
    'claim:verify_submit',
    'reconciliation:import_settlement_bank',
    'reconciliation:run_review_audit',
    'shipment:create_update',
    'shipment:track_exceptions',
  ],
  DELETE: [
    'iam:shop_config',
    'order:view_create',
    'shipment:receive_return',
    'claim:verify_submit',
    'reconciliation:import_settlement_bank',
    'reconciliation:run_review_audit',
    'shipment:create_update',
    'shipment:track_exceptions',
  ],
  BULK_DELETE: [
    'iam:shop_config',
    'order:view_create',
    'shipment:receive_return',
    'claim:verify_submit',
    'reconciliation:import_settlement_bank',
    'reconciliation:run_review_audit',
    'shipment:create_update',
    'shipment:track_exceptions',
  ],
  QUARANTINE: ['iam:shop_config'],
  RETENTION_PURGE: ['iam:shop_config'],
  RECONCILE: ['iam:shop_config'],
};

/**
 * Per-entity-type capability requirement (any-of) applied when the actor does
 * not hold the tenant-wide configuration capability (iam:shop_config).
 * GENERAL/STATEMENT-less rows fall through to the base action capability only.
 */
export const ATTACHMENT_ENTITY_REQUIREMENTS: Record<string, readonly string[]> = {
  RETURN: ['shipment:receive_return'],
  CLAIM: ['claim:verify_submit'],
  STATEMENT: ['reconciliation:import_settlement_bank'],
  DISCREPANCY: ['reconciliation:run_review_audit'],
  ORDER: ['order:view_create'],
  SHIPMENT: ['shipment:create_update', 'shipment:track_exceptions', 'order:view_create'],
};

/**
 * Endpoint -> action registry mapping (route table for /api/v1/attachments).
 * Maintenance endpoints additionally carry @RequirePermissions('iam:shop_config')
 * at the controller level; the service enforces the same mapping again
 * server-side so authorization never depends on the controller layer alone.
 */
export const ATTACHMENT_ENDPOINT_REGISTRY: ReadonlyArray<{
  method: string;
  path: string;
  action: AttachmentAction;
}> = [
  { method: 'GET', path: '/api/v1/attachments', action: 'LIST' },
  { method: 'GET', path: '/api/v1/attachments/:id', action: 'GET' },
  { method: 'GET', path: '/api/v1/attachments/:id/download', action: 'DOWNLOAD' },
  { method: 'POST', path: '/api/v1/attachments/upload', action: 'UPLOAD' },
  { method: 'DELETE', path: '/api/v1/attachments/:id', action: 'DELETE' },
  { method: 'POST', path: '/api/v1/attachments/bulk-delete', action: 'BULK_DELETE' },
  { method: 'POST', path: '/api/v1/attachments/:id/quarantine', action: 'QUARANTINE' },
  { method: 'POST', path: '/api/v1/attachments/retention-purge', action: 'RETENTION_PURGE' },
  { method: 'POST', path: '/api/v1/attachments/reconcile-pending', action: 'RECONCILE' },
];
