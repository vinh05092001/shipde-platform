import { Injectable, Inject, HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  NotificationChannelEnum,
  NotificationDeliveryStateEnum,
  NotificationSeverityEnum,
  NotificationStatusEnum,
  OutboxStatusEnum,
  Prisma,
  RoleEnum,
} from '@prisma/client';
import {
  NOTIFICATION_EVENT,
  NOTIFICATION_MATRIX_RULES,
  NotificationEventType,
  NotificationSeverity,
  RedeliverNotificationDeliveryRequest,
  buildDeliveryRetryOutboxKey,
  buildProviderSubmissionId,
  maskNotificationEmail,
} from '@shipde/contracts';
import { AppConfig } from '@shipde/config';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config.token';
import { CanonicalApiException } from '../auth/auth.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEVERITY_PARAM_MAP: Record<string, NotificationSeverityEnum> = {
  critical: NotificationSeverityEnum.CRITICAL,
  high: NotificationSeverityEnum.HIGH,
  medium: NotificationSeverityEnum.MEDIUM,
};

const STATUS_PARAM_MAP: Record<string, NotificationStatusEnum> = {
  ACTIVE: NotificationStatusEnum.ACTIVE,
  RESOLVED: NotificationStatusEnum.RESOLVED,
};

const DELIVERY_STATE_RECOVERY_MAP: Record<string, NotificationDeliveryStateEnum> = {
  UNKNOWN: NotificationDeliveryStateEnum.UNKNOWN,
  DEAD_LETTER: NotificationDeliveryStateEnum.DEAD_LETTER,
};

interface CursorPayload {
  r: number; // severity_rank
  c: string; // created_at ISO
  i: string; // id
}

interface DeliveryCursorPayload {
  c: string; // created_at ISO
  i: string; // id
}

function encodeCursor(payload: CursorPayload | DeliveryCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeNotificationCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed?.r !== 'number' ||
      typeof parsed?.c !== 'string' ||
      Number.isNaN(Date.parse(parsed.c)) ||
      typeof parsed?.i !== 'string' ||
      !UUID_REGEX.test(parsed.i)
    ) {
      throw new Error('Malformed cursor');
    }
    return parsed as CursorPayload;
  } catch {
    throw new CanonicalApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      'Cursor phân trang không hợp lệ',
      false,
      undefined,
      [{ field: 'cursor', code: 'INVALID_CURSOR', message: 'cursor không hợp lệ' }]
    );
  }
}

function decodeDeliveryCursor(cursor: string): DeliveryCursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed?.c !== 'string' ||
      Number.isNaN(Date.parse(parsed.c)) ||
      typeof parsed?.i !== 'string' ||
      !UUID_REGEX.test(parsed.i)
    ) {
      throw new Error('Malformed cursor');
    }
    return parsed as DeliveryCursorPayload;
  } catch {
    throw new CanonicalApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      'Cursor phân trang không hợp lệ',
      false,
      undefined,
      [{ field: 'cursor', code: 'INVALID_CURSOR', message: 'cursor không hợp lệ' }]
    );
  }
}

function toLowerSeverity(s: NotificationSeverityEnum): NotificationSeverity {
  return s.toLowerCase() as NotificationSeverity;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  private getListLimits(): { defaultLimit: number; maxLimit: number } {
    return {
      defaultLimit: this.config.NOTIFICATION_LIST_DEFAULT_LIMIT ?? 20,
      maxLimit: this.config.NOTIFICATION_LIST_MAX_LIMIT ?? 100,
    };
  }

  private parseLimit(raw: string | number | undefined): number {
    const { defaultLimit, maxLimit } = this.getListLimits();
    if (raw === undefined || raw === null || raw === '') return defaultLimit;
    const str = typeof raw === 'number' ? String(raw) : String(raw).trim();
    if (!/^\d+$/.test(str)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Tham số limit phải là số nguyên dương',
        false,
        undefined,
        [{ field: 'limit', code: 'INVALID_INTEGER', message: 'limit phải là số nguyên dương' }]
      );
    }
    const n = Number(str);
    if (!Number.isSafeInteger(n) || n < 1 || n > maxLimit) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `Tham số limit phải nằm trong khoảng 1..${maxLimit}`,
        false,
        undefined,
        [{ field: 'limit', code: 'OUT_OF_RANGE', message: `limit phải từ 1 đến ${maxLimit}` }]
      );
    }
    return n;
  }

  /**
   * D4: Recipient endpoints re-evaluate live server-side user/role/merchant state on every request
   * (never relying solely on stale JWT role claims) and explicitly reject PLATFORM_ADMIN.
   */
  private async assertRecipientSession(actor: {
    userId: string;
    merchantId: string | null;
    role: string;
  }): Promise<{ userId: string; merchantId: string; role: RoleEnum }> {
    if (!actor.userId) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'SESSION_INVALID',
        'Phiên đăng nhập không hợp lệ'
      );
    }
    const dbUser = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, role: true, merchant_id: true, status: true },
    });
    if (!dbUser) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'SESSION_INVALID',
        'Người dùng không tồn tại hoặc phiên đăng nhập không hợp lệ'
      );
    }
    const statusLower = String(dbUser.status || '').toLowerCase();
    if (statusLower === 'disabled' || statusLower === 'suspended') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Tài khoản đã bị vô hiệu hóa'
      );
    }
    if (
      dbUser.role === RoleEnum.PLATFORM_ADMIN ||
      !dbUser.merchant_id ||
      !actor.merchantId ||
      dbUser.merchant_id !== actor.merchantId
    ) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Tài khoản này không có quyền truy cập hộp thư thông báo cửa hàng'
      );
    }
    return { userId: dbUser.id, merchantId: dbUser.merchant_id, role: dbUser.role };
  }

  /**
   * D5: Recovery endpoints re-evaluate live tenant-scoped server role on every request;
   * strictly fail-closed to RoleEnum.OWNER (no string-claim SHIPDE_OPERATOR bypass while absent from RoleEnum).
   */
  private async assertRecoveryOperator(actor: {
    userId: string;
    merchantId: string | null;
    role: string;
  }): Promise<{ userId: string; merchantId: string }> {
    const resolved = await this.assertRecipientSession(actor);
    if (resolved.role !== RoleEnum.OWNER) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Chỉ chủ cửa hàng thuộc phạm vi hiện hành mới có quyền khôi phục gửi email thông báo'
      );
    }
    return { userId: resolved.userId, merchantId: resolved.merchantId };
  }

  async listNotifications(
    actor: { userId: string; merchantId: string | null; role: string },
    query: {
      cursor?: string;
      limit?: string | number;
      unread_only?: string | boolean;
      severity?: string;
      status?: string;
    },
    correlationId: string
  ) {
    const { userId, merchantId } = await this.assertRecipientSession(actor);
    const limit = this.parseLimit(query.limit);

    let unreadOnly = false;
    if (query.unread_only !== undefined && query.unread_only !== '') {
      if (query.unread_only === true || query.unread_only === 'true') {
        unreadOnly = true;
      } else if (query.unread_only === false || query.unread_only === 'false') {
        unreadOnly = false;
      } else {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'unread_only phải là true hoặc false',
          false,
          undefined,
          [{ field: 'unread_only', code: 'INVALID_BOOLEAN', message: 'unread_only không hợp lệ' }]
        );
      }
    }

    let severityFilter: NotificationSeverityEnum | undefined;
    if (query.severity !== undefined && query.severity !== '') {
      const mapped = SEVERITY_PARAM_MAP[String(query.severity).toLowerCase()];
      if (!mapped) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'severity phải là critical, high hoặc medium',
          false,
          undefined,
          [{ field: 'severity', code: 'INVALID_ENUM', message: 'severity không hợp lệ' }]
        );
      }
      severityFilter = mapped;
    }

    let statusFilter: NotificationStatusEnum | undefined;
    if (query.status !== undefined && query.status !== '') {
      const mapped = STATUS_PARAM_MAP[String(query.status).toUpperCase()];
      if (!mapped) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'status phải là ACTIVE hoặc RESOLVED',
          false,
          undefined,
          [{ field: 'status', code: 'INVALID_ENUM', message: 'status không hợp lệ' }]
        );
      }
      statusFilter = mapped;
    }

    const where: Prisma.NotificationWhereInput = {
      merchant_id: merchantId,
      recipient_user_id: userId,
      ...(unreadOnly ? { read_at: null } : {}),
      ...(severityFilter ? { severity: severityFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    };

    if (query.cursor) {
      const c = decodeNotificationCursor(query.cursor);
      const cursorDate = new Date(c.c);
      where.AND = [
        {
          OR: [
            { severity_rank: { lt: c.r } },
            { severity_rank: c.r, created_at: { lt: cursorDate } },
            { severity_rank: c.r, created_at: cursorDate, id: { lt: c.i } },
          ],
        },
      ];
    }

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ severity_rank: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            r: last.severity_rank,
            c: last.created_at.toISOString(),
            i: last.id,
          })
        : null;

    return {
      data: {
        items: pageRows.map((row) => {
          const rule = NOTIFICATION_MATRIX_RULES[row.event_type as NotificationEventType];
          return {
            id: row.id,
            event_type: row.event_type,
            event_label: rule ? rule.label : row.event_type,
            severity: toLowerSeverity(row.severity),
            title: row.title,
            body: row.body,
            source_type: row.source_type,
            source_id: row.source_id,
            group_key: row.group_key,
            digest_count: row.digest_count,
            link_path: row.link_path,
            status: row.status,
            read_at: row.read_at ? row.read_at.toISOString() : null,
            resolved_at: row.resolved_at ? row.resolved_at.toISOString() : null,
            created_at: row.created_at.toISOString(),
          };
        }),
        next_cursor: nextCursor,
      },
      meta: { correlation_id: correlationId },
    };
  }

  async getUnreadCount(
    actor: { userId: string; merchantId: string | null; role: string },
    correlationId: string
  ) {
    const { userId, merchantId } = await this.assertRecipientSession(actor);
    const unreadCount = await this.prisma.notification.count({
      where: {
        merchant_id: merchantId,
        recipient_user_id: userId,
        read_at: null,
      },
    });
    return {
      data: { unread_count: unreadCount },
      meta: { correlation_id: correlationId },
    };
  }

  async markRead(
    actor: { userId: string; merchantId: string | null; role: string },
    notificationId: string,
    correlationId: string
  ) {
    const { userId, merchantId } = await this.assertRecipientSession(actor);
    if (!UUID_REGEX.test(notificationId)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'ID thông báo không hợp lệ',
        false,
        undefined,
        [{ field: 'id', code: 'INVALID_UUID', message: 'id phải là UUID hợp lệ' }]
      );
    }

    const existing = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        merchant_id: merchantId,
        recipient_user_id: userId,
      },
    });

    // D6: identical 404 NOT_FOUND for absent, other-tenant, other-recipient or deleted rows
    if (!existing) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'Không tìm thấy thông báo'
      );
    }

    const now = new Date();
    // Atomic idempotent read transition (read never implies domain resolution)
    if (!existing.read_at) {
      await this.prisma.notification.updateMany({
        where: {
          id: notificationId,
          merchant_id: merchantId,
          recipient_user_id: userId,
          read_at: null,
        },
        data: { read_at: now },
      });
    }

    const fresh = await this.prisma.notification.findFirstOrThrow({
      where: {
        id: notificationId,
        merchant_id: merchantId,
        recipient_user_id: userId,
      },
    });

    return {
      data: {
        id: fresh.id,
        status: fresh.status,
        read_at: fresh.read_at ? fresh.read_at.toISOString() : now.toISOString(),
      },
      meta: { correlation_id: correlationId },
    };
  }

  async markAllRead(
    actor: { userId: string; merchantId: string | null; role: string },
    correlationId: string
  ) {
    const { userId, merchantId } = await this.assertRecipientSession(actor);
    const now = new Date();
    const res = await this.prisma.notification.updateMany({
      where: {
        merchant_id: merchantId,
        recipient_user_id: userId,
        read_at: null,
      },
      data: { read_at: now },
    });

    return {
      data: {
        updated_count: res.count,
        read_at: now.toISOString(),
      },
      meta: { correlation_id: correlationId },
    };
  }

  async listAdminRecoverableDeliveries(
    actor: { userId: string; merchantId: string | null; role: string },
    query: {
      state?: string;
      channel?: string;
      cursor?: string;
      limit?: string | number;
    },
    correlationId: string
  ) {
    const { merchantId } = await this.assertRecoveryOperator(actor);
    const limit = this.parseLimit(query.limit);

    let states: NotificationDeliveryStateEnum[] = [
      NotificationDeliveryStateEnum.UNKNOWN,
      NotificationDeliveryStateEnum.DEAD_LETTER,
    ];
    if (query.state !== undefined && query.state !== '') {
      const mapped = DELIVERY_STATE_RECOVERY_MAP[String(query.state).toUpperCase()];
      if (!mapped) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'state chỉ chấp nhận UNKNOWN hoặc DEAD_LETTER',
          false,
          undefined,
          [{ field: 'state', code: 'INVALID_ENUM', message: 'state không hợp lệ' }]
        );
      }
      states = [mapped];
    }

    const channelParam = (query.channel || 'email').toLowerCase();
    if (channelParam !== 'email') {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'channel chỉ hỗ trợ email cho danh sách khôi phục',
        false,
        undefined,
        [{ field: 'channel', code: 'INVALID_ENUM', message: 'channel phải là email' }]
      );
    }

    const where: Prisma.NotificationChannelDeliveryWhereInput = {
      channel: NotificationChannelEnum.EMAIL,
      state: { in: states },
      notification: { merchant_id: merchantId },
    };

    if (query.cursor) {
      const c = decodeDeliveryCursor(query.cursor);
      const cursorDate = new Date(c.c);
      where.AND = [
        {
          OR: [{ created_at: { lt: cursorDate } }, { created_at: cursorDate, id: { lt: c.i } }],
        },
      ];
    }

    const rows = await this.prisma.notificationChannelDelivery.findMany({
      where,
      include: {
        notification: {
          include: {
            recipient: { select: { email: true } },
          },
        },
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ c: last.created_at.toISOString(), i: last.id }) : null;

    return {
      data: {
        items: pageRows.map((row) => ({
          id: row.id,
          notification_id: row.notification_id,
          event_type: row.notification.event_type,
          severity: toLowerSeverity(row.notification.severity),
          title: row.notification.title,
          recipient_email_masked: maskNotificationEmail(row.notification.recipient?.email),
          channel: 'email' as const,
          state: row.state,
          attempts: row.attempts,
          provider_submission_id: row.provider_submission_id,
          provider_message_id: row.provider_message_id,
          last_error_code: row.last_error_code,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        })),
        next_cursor: nextCursor,
      },
      meta: { correlation_id: correlationId },
    };
  }

  async redeliverNotificationDelivery(
    actor: { userId: string; merchantId: string | null; role: string },
    deliveryId: string,
    body: RedeliverNotificationDeliveryRequest,
    clientIp: string,
    correlationId: string
  ) {
    const { userId, merchantId } = await this.assertRecoveryOperator(actor);

    if (!UUID_REGEX.test(deliveryId)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'delivery_id không hợp lệ',
        false,
        undefined,
        [{ field: 'delivery_id', code: 'INVALID_UUID', message: 'delivery_id phải là UUID' }]
      );
    }

    if (
      !body ||
      typeof body !== 'object' ||
      typeof body.expected_attempt !== 'number' ||
      !Number.isSafeInteger(body.expected_attempt) ||
      body.expected_attempt < 0 ||
      typeof body.expected_provider_submission_id !== 'string' ||
      body.expected_provider_submission_id.trim().length === 0 ||
      typeof body.idempotency_key !== 'string' ||
      body.idempotency_key.trim().length === 0 ||
      body.idempotency_key.trim().length > 128 ||
      (body.resolution !== 'MARK_SENT' && body.resolution !== 'RELEASE_FOR_RETRY') ||
      (body.provider_message_id !== null &&
        body.provider_message_id !== undefined &&
        typeof body.provider_message_id !== 'string')
    ) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Thiếu hoặc sai kiểu dữ liệu cho lệnh khôi phục gửi email thông báo'
      );
    }

    const idemKey = body.idempotency_key.trim();
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          expected_attempt: body.expected_attempt,
          expected_provider_submission_id: body.expected_provider_submission_id,
          resolution: body.resolution,
          provider_message_id: body.provider_message_id ?? null,
        })
      )
      .digest('hex');

    const reconcileExistingIdempotency = async () => {
      const raced = await this.prisma.notificationRedeliverIdempotency.findUnique({
        where: {
          merchant_id_delivery_id_idempotency_key: {
            merchant_id: merchantId,
            delivery_id: deliveryId,
            idempotency_key: idemKey,
          },
        },
      });
      if (!raced) return null;
      if (raced.request_fingerprint !== requestFingerprint) {
        throw new CanonicalApiException(
          HttpStatus.CONFLICT,
          'IDEMPOTENCY_CONFLICT',
          'idempotency_key đã được dùng với tham số khác'
        );
      }
      return {
        data: raced.response_snapshot,
        meta: { correlation_id: correlationId, idempotent_replay: true },
      };
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Check durable request idempotency first
        const existingIdem = await tx.notificationRedeliverIdempotency.findUnique({
          where: {
            merchant_id_delivery_id_idempotency_key: {
              merchant_id: merchantId,
              delivery_id: deliveryId,
              idempotency_key: idemKey,
            },
          },
        });

        if (existingIdem) {
          if (existingIdem.request_fingerprint !== requestFingerprint) {
            throw new CanonicalApiException(
              HttpStatus.CONFLICT,
              'IDEMPOTENCY_CONFLICT',
              'idempotency_key đã được dùng với tham số khác'
            );
          }
          return {
            data: existingIdem.response_snapshot,
            meta: { correlation_id: correlationId, idempotent_replay: true },
          };
        }

        // 2. Load delivery scoped to caller's merchant
        const delivery = await tx.notificationChannelDelivery.findFirst({
          where: {
            id: deliveryId,
            channel: NotificationChannelEnum.EMAIL,
            notification: { merchant_id: merchantId },
          },
          include: { notification: true },
        });

        if (!delivery) {
          throw new CanonicalApiException(
            HttpStatus.NOT_FOUND,
            'NOT_FOUND',
            'Không tìm thấy bản ghi gửi email thông báo'
          );
        }

        // 3. Repeating same resolution when already in resulting state returns current row (D5)
        if (
          (body.resolution === 'MARK_SENT' &&
            delivery.state === NotificationDeliveryStateEnum.SENT) ||
          (body.resolution === 'RELEASE_FOR_RETRY' &&
            (delivery.state === NotificationDeliveryStateEnum.PENDING ||
              delivery.state === NotificationDeliveryStateEnum.IN_FLIGHT))
        ) {
          const snapshot = {
            id: delivery.id,
            notification_id: delivery.notification_id,
            state: delivery.state,
            attempts: delivery.attempts,
            provider_submission_id: delivery.provider_submission_id,
            provider_message_id: delivery.provider_message_id,
          };
          await tx.notificationRedeliverIdempotency.create({
            data: {
              merchant_id: merchantId,
              delivery_id: delivery.id,
              idempotency_key: idemKey,
              request_fingerprint: requestFingerprint,
              response_snapshot: snapshot,
            },
          });
          return { data: snapshot, meta: { correlation_id: correlationId } };
        }

        // 4. Only UNKNOWN or DEAD_LETTER rows may be transitioned
        if (
          delivery.state !== NotificationDeliveryStateEnum.UNKNOWN &&
          delivery.state !== NotificationDeliveryStateEnum.DEAD_LETTER
        ) {
          throw new CanonicalApiException(
            HttpStatus.CONFLICT,
            'STALE_DELIVERY_PRECONDITION',
            'Bản ghi không ở trạng thái UNKNOWN hoặc DEAD_LETTER',
            false,
            undefined,
            undefined,
            undefined,
            {
              current_state: delivery.state,
              current_attempts: delivery.attempts,
              current_provider_submission_id: delivery.provider_submission_id,
            }
          );
        }

        // 5. Enforce optimistic preconditions (expected_attempt & expected_provider_submission_id)
        if (
          delivery.attempts !== body.expected_attempt ||
          delivery.provider_submission_id !== body.expected_provider_submission_id
        ) {
          throw new CanonicalApiException(
            HttpStatus.CONFLICT,
            'STALE_DELIVERY_PRECONDITION',
            'STALE_DELIVERY_PRECONDITION: delivery attempt or submission ID does not match current state',
            false,
            undefined,
            undefined,
            undefined,
            {
              current_state: delivery.state,
              current_attempts: delivery.attempts,
              current_provider_submission_id: delivery.provider_submission_id,
            }
          );
        }

        const now = new Date();
        let nextState: NotificationDeliveryStateEnum;
        let nextAttempts = delivery.attempts;
        let nextSubmissionId = delivery.provider_submission_id;
        let nextProviderMsgId = delivery.provider_message_id;

        if (body.resolution === 'MARK_SENT') {
          nextState = NotificationDeliveryStateEnum.SENT;
          if (body.provider_message_id) {
            nextProviderMsgId = body.provider_message_id;
          }
        } else {
          nextState = NotificationDeliveryStateEnum.PENDING;
          nextAttempts = delivery.attempts + 1;
          nextSubmissionId = buildProviderSubmissionId(delivery.notification_id, nextAttempts);
          nextProviderMsgId = null;
        }

        const updatedCount = await tx.notificationChannelDelivery.updateMany({
          where: {
            id: delivery.id,
            state: delivery.state,
            attempts: body.expected_attempt,
            provider_submission_id: body.expected_provider_submission_id,
          },
          data: {
            state: nextState,
            attempts: nextAttempts,
            provider_submission_id: nextSubmissionId,
            provider_message_id: nextProviderMsgId,
            sent_at: body.resolution === 'MARK_SENT' ? now : null,
            last_error_code: null,
            correlation_id: correlationId,
          },
        });

        if (updatedCount.count === 0) {
          throw new CanonicalApiException(
            HttpStatus.CONFLICT,
            'STALE_DELIVERY_PRECONDITION',
            'STALE_DELIVERY_PRECONDITION: delivery state changed concurrently'
          );
        }

        // D5: Atomically enqueue durable outbox event on RELEASE_FOR_RETRY so worker executes the reserved submission ID
        if (body.resolution === 'RELEASE_FOR_RETRY' && nextSubmissionId) {
          const retryOutboxKey = buildDeliveryRetryOutboxKey({
            merchantId,
            deliveryId: delivery.id,
            attempt: nextAttempts,
          });
          await tx.outboxEvent.upsert({
            where: { idempotency_key: retryOutboxKey },
            create: {
              event_type: NOTIFICATION_EVENT,
              payload: {
                schema_version: 1,
                kind: 'DELIVERY_RETRY',
                merchant_id: merchantId,
                notification_id: delivery.notification_id,
                delivery_id: delivery.id,
                expected_attempt: nextAttempts,
                provider_submission_id: nextSubmissionId,
                occurred_at: now.toISOString(),
              },
              correlation_id: correlationId,
              idempotency_key: retryOutboxKey,
              status: OutboxStatusEnum.PENDING,
            },
            update: {},
          });
        }

        const snapshot = {
          id: delivery.id,
          notification_id: delivery.notification_id,
          state: nextState,
          attempts: nextAttempts,
          provider_submission_id: nextSubmissionId,
          provider_message_id: nextProviderMsgId,
        };

        await tx.notificationRedeliverIdempotency.create({
          data: {
            merchant_id: merchantId,
            delivery_id: delivery.id,
            idempotency_key: idemKey,
            request_fingerprint: requestFingerprint,
            response_snapshot: snapshot,
          },
        });

        await tx.auditLog.create({
          data: {
            merchant_id: merchantId,
            user_id: userId,
            actor: userId,
            action:
              body.resolution === 'MARK_SENT'
                ? 'NOTIFICATION_DELIVERY_MARKED_SENT'
                : 'NOTIFICATION_DELIVERY_RELEASED_FOR_RETRY',
            entity_type: 'NotificationChannelDelivery',
            entity_id: delivery.id,
            old_value: {
              state: delivery.state,
              attempts: delivery.attempts,
              provider_submission_id: delivery.provider_submission_id,
            },
            new_value: snapshot,
            ip_address: clientIp,
            reason: `Manual recovery resolution (${body.resolution}) correlation=${correlationId}`,
          },
        });

        return {
          data: snapshot,
          meta: { correlation_id: correlationId },
        };
      });
    } catch (err: any) {
      // D5: Reconcile concurrent identical redelivery after losing CAS or unique idempotency race
      if (
        err?.code === 'P2002' ||
        (err instanceof CanonicalApiException &&
          (err.getResponse() as any)?.error?.code === 'STALE_DELIVERY_PRECONDITION')
      ) {
        const reconciled = await reconcileExistingIdempotency();
        if (reconciled) return reconciled;
      }
      throw err;
    }
  }
}
