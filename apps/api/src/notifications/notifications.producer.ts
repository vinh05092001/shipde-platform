import { Injectable } from '@nestjs/common';
import { Prisma, OutboxStatusEnum } from '@prisma/client';
import {
  NOTIFICATION_EVENT,
  NotificationEventType,
  NotificationOutboxEnvelope,
  SecurityChangeKind,
  buildNotificationOutboxKey,
  validateNotificationEnvelope,
} from '@shipde/contracts';
import { normalizeCorrelationId } from '@shipde/config';

/**
 * FEAT-COM-09 D1 — Bounded S01 Live Producer for EVT-COM-09-01
 * Emits atomic NOTIFICATION_EVENT outbox rows inside the caller's DB transaction.
 */
@Injectable()
export class NotificationsProducer {
  async emitSecurityChangeWithinTx(
    tx: Prisma.TransactionClient,
    params: {
      merchantId: string;
      affectedUserId: string;
      changeKind: SecurityChangeKind;
      sourceType: string;
      sourceId: string;
      correlationId: string;
      occurredAt?: Date;
    }
  ): Promise<void> {
    const occurredAt = (params.occurredAt || new Date()).toISOString();
    const envelope: NotificationOutboxEnvelope = {
      schema_version: 1,
      event: NotificationEventType.EVT_COM_09_01,
      occurred_at: occurredAt,
      merchant_id: params.merchantId,
      is_resolution: false,
      source: {
        type: params.sourceType,
        id: params.sourceId,
        branch_id: null,
        warehouse_id: null,
        carrier_account_id: null,
      },
      payload: {
        affected_user_id: params.affectedUserId,
        change_kind: params.changeKind,
      },
    };

    const validation = validateNotificationEnvelope(envelope);
    if (!validation.valid || !validation.sourceFingerprint) {
      throw new Error(`Invalid EVT-COM-09-01 envelope: ${validation.error}`);
    }

    const idempotencyKey = buildNotificationOutboxKey({
      merchantId: params.merchantId,
      eventType: NotificationEventType.EVT_COM_09_01,
      sourceFingerprint: validation.sourceFingerprint,
    });

    await tx.outboxEvent.upsert({
      where: { idempotency_key: idempotencyKey },
      create: {
        event_type: NOTIFICATION_EVENT,
        payload: envelope as unknown as Prisma.InputJsonValue,
        correlation_id: normalizeCorrelationId(params.correlationId),
        idempotency_key: idempotencyKey,
        status: OutboxStatusEnum.PENDING,
      },
      update: {},
    });
  }
}
