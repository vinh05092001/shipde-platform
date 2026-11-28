import { Injectable, Inject, Optional } from '@nestjs/common';
import {
  NotificationChannelEnum,
  NotificationDeliveryStateEnum,
  NotificationSeverityEnum,
  NotificationStatusEnum,
  RoleEnum,
} from '@prisma/client';
import {
  NOTIFICATION_MATRIX_RULES,
  NotificationEventType,
  NotificationOutboxEnvelope,
  SEVERITY_RANK,
  buildProviderSubmissionId,
  maskNotificationEmail,
  validateNotificationEnvelope,
} from '@shipde/contracts';
import {
  AppConfig,
  formatStructuredLog,
  normalizeCorrelationId,
  resolveNotificationDeliveryConfig,
} from '@shipde/config';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config.token';
import {
  INotificationEmailTransport,
  NOTIFICATION_EMAIL_TRANSPORT,
  NotificationEmailTransport,
} from './notification-email.transport';

function toPrismaSeverity(s: 'critical' | 'high' | 'medium'): NotificationSeverityEnum {
  if (s === 'critical') return NotificationSeverityEnum.CRITICAL;
  if (s === 'high') return NotificationSeverityEnum.HIGH;
  return NotificationSeverityEnum.MEDIUM;
}

function matchesScope(scopes: string[] | null | undefined, requiredId: string | null): boolean {
  if (!requiredId) return true;
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  return scopes.includes('*') || scopes.includes(requiredId);
}

function buildSafeNotificationSnapshot(envelope: NotificationOutboxEnvelope): {
  title: string;
  body: string;
  linkPath: string;
} {
  const rule = NOTIFICATION_MATRIX_RULES[envelope.event];
  const src = envelope.source;
  const title = rule.label;

  // Source-specific wording preserving BR-AVL-02, BR-IDEM-02, DEC-014/015 distinctions
  switch (envelope.event) {
    case 'EVT-COM-09-01':
      return {
        title: 'Cảnh báo bảo mật / thay đổi định danh',
        body: `Phát sinh thay đổi bảo mật (${String((envelope.payload as any).change_kind)}) cho tham chiếu ${src.id}.`,
        linkPath: '/settings/notifications',
      };
    case 'EVT-COM-09-03':
      return {
        title: 'Không có tuyến vận chuyển khả dụng',
        body: `Đơn hàng ${String((envelope.payload as any).order_id)} (phiên bản ${String((envelope.payload as any).input_revision)}) hiện không có hãng vận chuyển khả dụng.`,
        linkPath: `/orders/${encodeURIComponent(src.id)}`,
      };
    case 'EVT-COM-09-04':
      return {
        title: 'API hãng vận chuyển gián đoạn / quá thời gian chờ',
        body: `Hãng vận chuyển gặp sự cố ${String((envelope.payload as any).failure_kind)} (sự cố ${String((envelope.payload as any).incident_id)}).`,
        linkPath: '/settings/carriers',
      };
    case 'EVT-COM-09-05':
      return {
        title: 'Không xác định kết quả tạo vận đơn — cần đối chiếu',
        body: `Vận đơn ${String((envelope.payload as any).shipment_id)} ở trạng thái CREATE_OUTCOME_UNKNOWN. Cần đối chiếu trạng thái hãng trước khi thao tác lại.`,
        linkPath: `/shipments/${encodeURIComponent(src.id)}`,
      };
    case 'EVT-COM-09-12':
      return {
        title: 'Chênh lệch đối soát ngân hàng',
        body: `Lô đối soát ${String((envelope.payload as any).batch_id)} chênh lệch ${String((envelope.payload as any).difference_vnd)} VND (mức bằng chứng: ${String((envelope.payload as any).evidence_level)}).`,
        linkPath: `/reconciliation/${encodeURIComponent(src.id)}`,
      };
    case 'EVT-COM-09-14':
      return {
        title: 'Khiếu nại đã được hãng chấp nhận — chưa nhận tiền ngân hàng',
        body: `Khiếu nại ${String((envelope.payload as any).claim_id)} đã được hãng chấp nhận ${String((envelope.payload as any).accepted_amount_vnd)} VND nhưng chưa có chứng từ thu tiền ngân hàng.`,
        linkPath: `/claims/${encodeURIComponent(src.id)}`,
      };
    default:
      return {
        title,
        body: `Sự kiện ${envelope.event} cho ${src.type} ${src.id}.`,
        linkPath: '/settings/notifications',
      };
  }
}

export interface ProcessNotificationResult {
  status: 'PROCESSED' | 'RESOLVED' | 'DEAD_LETTER_INVALID_CONTRACT';
  recipientCount: number;
  resolvedCount: number;
  error?: string;
}

@Injectable()
export class NotificationProcessor {
  private readonly emailTransport: INotificationEmailTransport;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional()
    @Inject(NOTIFICATION_EMAIL_TRANSPORT)
    injectedTransport?: INotificationEmailTransport
  ) {
    this.emailTransport = injectedTransport || new NotificationEmailTransport(this.config);
  }

  /**
   * Processes one NOTIFICATION_EVENT envelope from the outbox/queue (D1–D6).
   * Idempotent under at-least-once delivery; invalid payloads fail closed to dead-letter.
   */
  async processEnvelope(
    rawEnvelope: unknown,
    correlationIdRaw: string,
    now: Date = new Date()
  ): Promise<ProcessNotificationResult> {
    const correlationId = normalizeCorrelationId(correlationIdRaw);
    const validation = validateNotificationEnvelope(rawEnvelope);
    if (!validation.valid || !validation.groupKey) {
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'worker',
          correlationId,
          message: `Invalid NOTIFICATION_EVENT payload rejected to dead-letter: ${validation.error}`,
          metadata: { error: validation.error },
        })
      );
      return {
        status: 'DEAD_LETTER_INVALID_CONTRACT',
        recipientCount: 0,
        resolvedCount: 0,
        error: validation.error,
      };
    }

    const envelope = rawEnvelope as NotificationOutboxEnvelope;
    const rule = NOTIFICATION_MATRIX_RULES[envelope.event];

    // D6: Resolution targeting — marks matching ACTIVE notices RESOLVED idempotently
    if (envelope.is_resolution === true) {
      const resolvedAt = new Date(envelope.occurred_at);
      const res = await this.prisma.notification.updateMany({
        where: {
          merchant_id: envelope.merchant_id,
          event_type: envelope.event,
          group_key: validation.groupKey,
          status: NotificationStatusEnum.ACTIVE,
        },
        data: {
          status: NotificationStatusEnum.RESOLVED,
          resolved_at: resolvedAt,
        },
      });
      return {
        status: 'RESOLVED',
        recipientCount: 0,
        resolvedCount: res.count,
      };
    }

    // D4: Expand eligible recipients once at dispatch time
    const recipients = await this.resolveEligibleRecipients(envelope);
    if (recipients.length === 0) {
      return { status: 'PROCESSED', recipientCount: 0, resolvedCount: 0 };
    }

    const deliveryCfg = resolveNotificationDeliveryConfig(this.config);
    const retentionUntil = new Date(
      now.getTime() + deliveryCfg.retentionDays * 24 * 60 * 60 * 1000
    );
    const snapshot = buildSafeNotificationSnapshot(envelope);
    const severityEnum = toPrismaSeverity(rule.severity);
    const severityRank = SEVERITY_RANK[rule.severity];

    for (const user of recipients) {
      const prefs = (user.notification_preferences as any) || {};
      const channelsPref = prefs.channels || {};
      const subsPref = prefs.subscriptions || {};
      const isProtected = Boolean(rule.protectedSubscriptionKey);

      // Non-protected events honor persisted subscription preference
      if (!isProtected && rule.subscriptionKey && subsPref[rule.subscriptionKey] === false) {
        continue;
      }

      // D3: Protected events ALWAYS deliver in-app regardless of channels.in_app=false
      const shouldDeliverInApp =
        isProtected || (rule.defaultChannels.includes('in_app') && channelsPref.in_app !== false);

      if (!shouldDeliverInApp && !rule.defaultChannels.includes('email')) {
        continue;
      }

      const notification = await this.prisma.notification.upsert({
        where: {
          merchant_id_event_type_group_key_recipient_user_id: {
            merchant_id: envelope.merchant_id,
            event_type: envelope.event,
            group_key: validation.groupKey,
            recipient_user_id: user.id,
          },
        },
        create: {
          merchant_id: envelope.merchant_id,
          recipient_user_id: user.id,
          event_type: envelope.event,
          severity: severityEnum,
          severity_rank: severityRank,
          title: snapshot.title,
          body: snapshot.body,
          source_type: envelope.source.type,
          source_id: envelope.source.id,
          source_branch_id: envelope.source.branch_id,
          source_warehouse_id: envelope.source.warehouse_id,
          source_carrier_account_id: envelope.source.carrier_account_id,
          group_key: validation.groupKey,
          digest_count: 1,
          link_path: snapshot.linkPath,
          status: NotificationStatusEnum.ACTIVE,
          retention_until: retentionUntil,
        },
        update: rule.digest
          ? {
              digest_count: { increment: 1 },
              body: snapshot.body,
            }
          : {},
      });

      // 1. In-app channel delivery row
      if (shouldDeliverInApp) {
        await this.prisma.notificationChannelDelivery.upsert({
          where: {
            notification_id_channel: {
              notification_id: notification.id,
              channel: NotificationChannelEnum.IN_APP,
            },
          },
          create: {
            notification_id: notification.id,
            channel: NotificationChannelEnum.IN_APP,
            state: NotificationDeliveryStateEnum.SENT,
            attempts: 1,
            sent_at: now,
            correlation_id: correlationId,
          },
          update: {},
        });

        if (isProtected) {
          await this.recordAudit(envelope.merchant_id, {
            action: 'NOTIFICATION_PROTECTED_DISPATCHED',
            entityId: notification.id,
            newValue: {
              event_type: envelope.event,
              channel: 'in_app',
              outcome: 'SENT',
              recipient_user_id: user.id,
              correlation_id: correlationId,
            },
            reason: 'Protected notification in-app dispatch',
          });
        }
      }

      // 2. Email channel delivery (when required by matrix or enabled for email-capable events)
      const shouldAttemptEmail =
        rule.defaultChannels.includes('email') && (isProtected || channelsPref.email !== false);

      if (shouldAttemptEmail) {
        await this.dispatchEmailForNotification({
          merchantId: envelope.merchant_id,
          notificationId: notification.id,
          eventType: envelope.event,
          isProtected,
          recipientUserId: user.id,
          recipientEmail: user.email,
          recipientEmailVerifiedAt: user.email_verified_at,
          subject: snapshot.title,
          body: snapshot.body,
          correlationId,
          now,
        });
      }
    }

    return {
      status: 'PROCESSED',
      recipientCount: recipients.length,
      resolvedCount: 0,
    };
  }

  private async resolveEligibleRecipients(envelope: NotificationOutboxEnvelope) {
    const rule = NOTIFICATION_MATRIX_RULES[envelope.event];
    const users = await this.prisma.user.findMany({
      where: {
        merchant_id: envelope.merchant_id,
        role: { not: RoleEnum.PLATFORM_ADMIN },
      },
      select: {
        id: true,
        role: true,
        status: true,
        email: true,
        email_verified_at: true,
        custom_role_id: true,
        store_scopes: true,
        warehouse_scopes: true,
        carrier_account_scopes: true,
        notification_preferences: true,
        timezone: true,
      },
    });

    // Load custom role permissions for users that have a custom_role_id
    const customRoleIds = Array.from(
      new Set(users.map((u) => u.custom_role_id).filter((id): id is string => Boolean(id)))
    );
    const rolePermMap = new Map<string, Set<string>>();
    if (customRoleIds.length > 0 && rule.customRolePermission) {
      const perms = await this.prisma.rolePermission.findMany({
        where: {
          role_id: { in: customRoleIds },
          permission: { code: rule.customRolePermission },
        },
        select: { role_id: true, permission: { select: { code: true } } },
      });
      for (const p of perms) {
        const set = rolePermMap.get(p.role_id) || new Set<string>();
        set.add(p.permission.code);
        rolePermMap.set(p.role_id, set);
      }
    }

    const affectedUserId =
      envelope.event === 'EVT-COM-09-01'
        ? String((envelope.payload as any).affected_user_id || '')
        : null;

    return users.filter((u) => {
      if (u.role === RoleEnum.PLATFORM_ADMIN) return false;
      const statusLower = String(u.status || '').toLowerCase();
      if (statusLower === 'disabled' || statusLower === 'suspended') return false;

      // EVT-COM-09-01: affected user is always addressed regardless of role
      if (rule.includeAffectedUser && affectedUserId && u.id === affectedUserId) {
        return true;
      }

      const roleMatched =
        rule.eligibleBaseRoles.includes(u.role as any) ||
        Boolean(
          rule.customRolePermission &&
          u.custom_role_id &&
          rolePermMap.get(u.custom_role_id)?.has(rule.customRolePermission)
        );
      if (!roleMatched) return false;

      // Check every required scope dimension (D4)
      for (const dim of rule.scopeDimensions) {
        if (dim === 'branch_id' && !matchesScope(u.store_scopes, envelope.source.branch_id)) {
          return false;
        }
        if (
          dim === 'warehouse_id' &&
          !matchesScope(u.warehouse_scopes, envelope.source.warehouse_id)
        ) {
          return false;
        }
        if (
          dim === 'carrier_account_id' &&
          !matchesScope(u.carrier_account_scopes, envelope.source.carrier_account_id)
        ) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * D3/D5 email delivery state machine:
   * - Missing/unverified email -> SKIPPED_NO_VERIFIED_EMAIL
   * - Stores provider_submission_id BEFORE provider call
   * - Timeout or missing message id -> UNKNOWN (NEVER auto-retried)
   * - Only FAILED retries automatically up to configured maxAttempts -> DEAD_LETTER
   */
  async dispatchEmailForNotification(params: {
    merchantId: string;
    notificationId: string;
    eventType: NotificationEventType;
    isProtected: boolean;
    recipientUserId: string;
    recipientEmail: string | null;
    recipientEmailVerifiedAt: Date | null;
    subject: string;
    body: string;
    correlationId: string;
    now: Date;
  }): Promise<NotificationDeliveryStateEnum> {
    const deliveryCfg = resolveNotificationDeliveryConfig(this.config);

    // Check existing row to prevent duplicate send on replay or UNKNOWN rows
    let delivery = await this.prisma.notificationChannelDelivery.findUnique({
      where: {
        notification_id_channel: {
          notification_id: params.notificationId,
          channel: NotificationChannelEnum.EMAIL,
        },
      },
    });

    if (
      delivery &&
      (delivery.state === NotificationDeliveryStateEnum.SENT ||
        delivery.state === NotificationDeliveryStateEnum.UNKNOWN ||
        delivery.state === NotificationDeliveryStateEnum.DEAD_LETTER ||
        delivery.state === NotificationDeliveryStateEnum.IN_FLIGHT)
    ) {
      return delivery.state;
    }

    // D3: Missing or unverified email -> truthful SKIPPED_NO_VERIFIED_EMAIL
    if (!params.recipientEmail || !params.recipientEmailVerifiedAt) {
      const skipped = await this.prisma.notificationChannelDelivery.upsert({
        where: {
          notification_id_channel: {
            notification_id: params.notificationId,
            channel: NotificationChannelEnum.EMAIL,
          },
        },
        create: {
          notification_id: params.notificationId,
          channel: NotificationChannelEnum.EMAIL,
          state: NotificationDeliveryStateEnum.SKIPPED_NO_VERIFIED_EMAIL,
          attempts: 0,
          last_error_code: 'NO_VERIFIED_EMAIL',
          correlation_id: params.correlationId,
        },
        update: {
          state: NotificationDeliveryStateEnum.SKIPPED_NO_VERIFIED_EMAIL,
          last_error_code: 'NO_VERIFIED_EMAIL',
          correlation_id: params.correlationId,
        },
      });
      if (params.isProtected) {
        await this.recordAudit(params.merchantId, {
          action: 'NOTIFICATION_PROTECTED_DISPATCHED',
          entityId: params.notificationId,
          newValue: {
            event_type: params.eventType,
            channel: 'email',
            outcome: skipped.state,
            recipient_email_masked: maskNotificationEmail(params.recipientEmail),
            correlation_id: params.correlationId,
          },
          reason: 'Protected email skipped: no verified email',
        });
      }
      return skipped.state;
    }

    // Ensure row exists in PENDING
    if (!delivery) {
      delivery = await this.prisma.notificationChannelDelivery.create({
        data: {
          notification_id: params.notificationId,
          channel: NotificationChannelEnum.EMAIL,
          state: NotificationDeliveryStateEnum.PENDING,
          attempts: 0,
          correlation_id: params.correlationId,
        },
      });
    }

    let current = delivery;
    // Bounded automatic retry loop for FAILED only (never UNKNOWN!)
    while (current.attempts < deliveryCfg.emailMaxAttempts) {
      const nextAttempt = current.attempts === 0 ? 1 : current.attempts + 1;
      const submissionId =
        current.state === NotificationDeliveryStateEnum.PENDING &&
        current.provider_submission_id &&
        current.attempts > 0
          ? current.provider_submission_id
          : buildProviderSubmissionId(params.notificationId, nextAttempt);
      const attemptCount =
        current.state === NotificationDeliveryStateEnum.PENDING &&
        current.provider_submission_id &&
        current.attempts > 0
          ? current.attempts
          : nextAttempt;

      // D5: Persist provider_submission_id BEFORE provider call
      current = await this.prisma.notificationChannelDelivery.update({
        where: { id: current.id },
        data: {
          state: NotificationDeliveryStateEnum.IN_FLIGHT,
          attempts: attemptCount,
          provider_submission_id: submissionId,
          correlation_id: params.correlationId,
        },
      });

      const res = await this.emailTransport.send({
        to: params.recipientEmail,
        subject: params.subject,
        body: params.body,
        submissionId,
        correlationId: params.correlationId,
      });

      if (res.outcome === 'NOT_CONFIGURED') {
        current = await this.prisma.notificationChannelDelivery.update({
          where: { id: current.id },
          data: {
            state: NotificationDeliveryStateEnum.NOT_CONFIGURED,
            last_error_code: res.errorCode || 'EMAIL_PROVIDER_NOT_CONFIGURED',
          },
        });
        break;
      }

      if (res.outcome === 'SENT' && res.providerMessageId) {
        current = await this.prisma.notificationChannelDelivery.update({
          where: { id: current.id },
          data: {
            state: NotificationDeliveryStateEnum.SENT,
            provider_message_id: res.providerMessageId,
            sent_at: params.now,
            last_error_code: null,
          },
        });
        break;
      }

      // D5: Timeout or response without message id -> UNKNOWN (NEVER FAILED, NEVER auto-retried)
      if (res.outcome === 'UNKNOWN' || (res.outcome === 'SENT' && !res.providerMessageId)) {
        current = await this.prisma.notificationChannelDelivery.update({
          where: { id: current.id },
          data: {
            state: NotificationDeliveryStateEnum.UNKNOWN,
            last_error_code: res.errorCode || 'MISSING_PROVIDER_MESSAGE_ID',
          },
        });
        break;
      }

      // FAILED: retry if under configured maxAttempts, else escalate to DEAD_LETTER
      const exhausted = attemptCount >= deliveryCfg.emailMaxAttempts;
      current = await this.prisma.notificationChannelDelivery.update({
        where: { id: current.id },
        data: {
          state: exhausted
            ? NotificationDeliveryStateEnum.DEAD_LETTER
            : NotificationDeliveryStateEnum.FAILED,
          last_error_code: res.errorCode || 'EMAIL_DELIVERY_FAILED',
        },
      });

      if (exhausted) {
        await this.recordAudit(params.merchantId, {
          action: 'NOTIFICATION_EMAIL_DEAD_LETTERED',
          entityId: params.notificationId,
          newValue: {
            delivery_id: current.id,
            channel: 'email',
            attempts: attemptCount,
            last_error_code: current.last_error_code,
            recipient_email_masked: maskNotificationEmail(params.recipientEmail),
            correlation_id: params.correlationId,
          },
          reason: 'Email delivery exhausted configured attempts and moved to DEAD_LETTER',
        });
        break;
      }
    }

    if (params.isProtected) {
      await this.recordAudit(params.merchantId, {
        action: 'NOTIFICATION_PROTECTED_DISPATCHED',
        entityId: params.notificationId,
        newValue: {
          event_type: params.eventType,
          channel: 'email',
          outcome: current.state,
          recipient_email_masked: maskNotificationEmail(params.recipientEmail),
          correlation_id: params.correlationId,
        },
        reason: 'Protected email delivery outcome recorded',
      });
    }

    return current.state;
  }

  /**
   * D6 Retention cleanup: batched per single tenant (strict tenant isolation),
   * deletes expired notifications + channel deliveries while preserving immutable AuditLog.
   */
  async purgeExpiredForTenant(
    merchantId: string,
    asOf: Date,
    correlationId: string
  ): Promise<{ deletedCount: number }> {
    const res = await this.prisma.notification.deleteMany({
      where: {
        merchant_id: merchantId,
        retention_until: { lte: asOf },
      },
    });
    if (res.count > 0) {
      await this.recordAudit(merchantId, {
        action: 'NOTIFICATION_RETENTION_PURGED',
        entityId: merchantId,
        newValue: {
          deleted_count: res.count,
          as_of: asOf.toISOString(),
          correlation_id: normalizeCorrelationId(correlationId),
        },
        reason: 'Tenant-scoped notification retention cleanup',
      });
    }
    return { deletedCount: res.count };
  }

  private async recordAudit(
    merchantId: string,
    entry: {
      action: string;
      entityId: string;
      newValue: Record<string, unknown>;
      reason: string;
    }
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        merchant_id: merchantId,
        user_id: null,
        actor: 'system',
        action: entry.action,
        entity_type: 'Notification',
        entity_id: entry.entityId,
        new_value: entry.newValue as any,
        reason: entry.reason,
      },
    });
  }
}
