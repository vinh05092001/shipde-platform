import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CanonicalApiException } from '../auth/auth.service';
import { UpdateMeDto, UpdatePreferencesDto, NotificationPreferencesDto } from './me.dto';

const VIETNAMESE_PHONE_REGEX = /^(0|\+84)[3|5|7|8|9][0-9]{8}$/;
const SUPPORTED_LANGUAGES = new Set(['vi', 'en']);

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  channels: {
    email: true,
    in_app: true,
    push: false,
  },
  digest_window_minutes: 15,
  subscriptions: {
    delivery_fail: true,
    rate_discrepancy: true,
    cod_overdue: true,
    claim_deadline_warning: true,
    abnormal_return: true,
    security_alerts: true,
    create_unknown: true,
  },
};

export function isValidIanaTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class MeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * GET /api/v1/me
   * Retrieve authenticated user profile, merchant metadata, and personal preferences (AC-PRO-01-01)
   */
  async getMe(userId: string, correlationId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!user) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'SESSION_INVALID',
        'Người dùng không tồn tại hoặc phiên đăng nhập không hợp lệ'
      );
    }

    const notificationPreferences =
      (user.notification_preferences as any) || DEFAULT_NOTIFICATION_PREFERENCES;

    return {
      data: {
        id: user.id,
        merchant_id: user.merchant_id,
        email: user.email,
        phone: user.phone,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        avatar_url: user.avatar_url,
        language: user.language || 'vi',
        timezone: user.timezone || 'Asia/Ho_Chi_Minh',
        default_warehouse_id: user.default_warehouse_id,
        store_scopes: user.store_scopes || [],
        warehouse_scopes: user.warehouse_scopes || [],
        custom_role_id: user.custom_role_id,
        notification_preferences: notificationPreferences,
        merchant: user.merchant
          ? {
              id: user.merchant.id,
              name: user.merchant.name,
            }
          : null,
        created_at: user.created_at.toISOString(),
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * PATCH /api/v1/me
   * Update personal profile with privilege escalation prevention & audit log (AC-PRO-01-02 to AC-PRO-01-08)
   */
  async updateMe(userId: string, dto: UpdateMeDto, clientIp: string, correlationId: string) {
    // BR-PRO-02: Privilege escalation prevention (AC-PRO-01-05)
    const forbiddenFields = [
      'role',
      'custom_role_id',
      'merchant_id',
      'store_scopes',
      'warehouse_scopes',
      'status',
    ];
    for (const field of forbiddenFields) {
      if ((dto as any)[field] !== undefined) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'PRIVILEGE_ESCALATION_DENIED',
          'Không được phép thay đổi vai trò hoặc phạm vi quản trị qua thông tin cá nhân'
        );
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!user) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'SESSION_INVALID',
        'Người dùng không tồn tại hoặc phiên đăng nhập không hợp lệ'
      );
    }

    // Validation
    const updates: any = {};

    // 1. Full name
    if (dto.full_name !== undefined) {
      const trimmedName = dto.full_name.trim();
      if (!trimmedName || trimmedName.length > 255) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_INPUT',
          'Họ và tên không được để trống và tối đa 255 ký tự'
        );
      }
      updates.full_name = trimmedName;
    }

    // 2. Phone
    if (dto.phone !== undefined) {
      if (dto.phone === null || dto.phone === '') {
        updates.phone = null;
      } else {
        const trimmedPhone = dto.phone.trim();
        if (!VIETNAMESE_PHONE_REGEX.test(trimmedPhone)) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'INVALID_INPUT',
            'Số điện thoại không đúng định dạng Việt Nam'
          );
        }
        // Check uniqueness across other users
        const existing = await this.prisma.user.findFirst({
          where: {
            phone: trimmedPhone,
            id: { not: userId },
          },
        });
        if (existing) {
          throw new CanonicalApiException(
            HttpStatus.CONFLICT,
            'PHONE_ALREADY_EXISTS',
            'Số điện thoại này đã được sử dụng bởi tài khoản khác'
          );
        }
        updates.phone = trimmedPhone;
      }
    }

    // 3. Avatar URL
    if (dto.avatar_url !== undefined) {
      if (dto.avatar_url === null || dto.avatar_url === '') {
        updates.avatar_url = null;
      } else {
        const trimmedUrl = dto.avatar_url.trim();
        if (trimmedUrl.length > 512) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'INVALID_INPUT',
            'Đường dẫn ảnh đại diện tối đa 512 ký tự'
          );
        }
        updates.avatar_url = trimmedUrl;
      }
    }

    // 4. Language
    if (dto.language !== undefined) {
      if (!SUPPORTED_LANGUAGES.has(dto.language)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_INPUT',
          'Ngôn ngữ không được hỗ trợ. Vui lòng chọn vi hoặc en'
        );
      }
      updates.language = dto.language;
    }

    // 5. Timezone
    if (dto.timezone !== undefined) {
      if (!isValidIanaTimezone(dto.timezone)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_INPUT',
          'Múi giờ không hợp lệ theo chuẩn IANA'
        );
      }
      updates.timezone = dto.timezone;
    }

    // 6. Default warehouse (BR-PRO-06, AC-PRO-01-08)
    if (dto.default_warehouse_id !== undefined) {
      if (dto.default_warehouse_id === null || dto.default_warehouse_id === '') {
        updates.default_warehouse_id = null;
      } else {
        const scopes = user.warehouse_scopes || [];
        const hasWildcard = scopes.includes('*');
        if (!hasWildcard && !scopes.includes(dto.default_warehouse_id)) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'WAREHOUSE_SCOPE_UNAUTHORIZED',
            'Kho mặc định không thuộc phạm vi kho được phân quyền của bạn'
          );
        }
        updates.default_warehouse_id = dto.default_warehouse_id;
      }
    }

    // 7. Notification preferences (BR-PRO-03, AC-PRO-01-07)
    if (dto.notification_preferences !== undefined) {
      const mergedPrefs = this.mergeAndValidateNotificationPreferences(
        user.notification_preferences,
        dto.notification_preferences
      );
      updates.notification_preferences = mergedPrefs;
    }

    // Execute update in transaction with immutable audit log
    const oldSnapshot = {
      full_name: user.full_name,
      phone: user.phone,
      avatar_url: user.avatar_url,
      language: user.language,
      timezone: user.timezone,
      default_warehouse_id: user.default_warehouse_id,
      notification_preferences: user.notification_preferences,
    };

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: updates,
        include: {
          merchant: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      const newSnapshot = {
        full_name: updated.full_name,
        phone: updated.phone,
        avatar_url: updated.avatar_url,
        language: updated.language,
        timezone: updated.timezone,
        default_warehouse_id: updated.default_warehouse_id,
        notification_preferences: updated.notification_preferences,
      };

      await tx.auditLog.create({
        data: {
          merchant_id: updated.merchant_id,
          user_id: updated.id,
          actor: updated.full_name || updated.email || updated.id,
          action: 'PROFILE_UPDATED',
          entity_type: 'User',
          entity_id: updated.id,
          old_value: oldSnapshot,
          new_value: newSnapshot,
          ip_address: clientIp,
          reason: 'Cập nhật thông tin cá nhân',
        },
      });

      return updated;
    });

    return {
      data: {
        id: updatedUser.id,
        merchant_id: updatedUser.merchant_id,
        email: updatedUser.email,
        phone: updatedUser.phone,
        full_name: updatedUser.full_name,
        role: updatedUser.role,
        status: updatedUser.status,
        avatar_url: updatedUser.avatar_url,
        language: updatedUser.language || 'vi',
        timezone: updatedUser.timezone || 'Asia/Ho_Chi_Minh',
        default_warehouse_id: updatedUser.default_warehouse_id,
        store_scopes: updatedUser.store_scopes || [],
        warehouse_scopes: updatedUser.warehouse_scopes || [],
        custom_role_id: updatedUser.custom_role_id,
        notification_preferences:
          updatedUser.notification_preferences || DEFAULT_NOTIFICATION_PREFERENCES,
        merchant: updatedUser.merchant
          ? {
              id: updatedUser.merchant.id,
              name: updatedUser.merchant.name,
            }
          : null,
        created_at: updatedUser.created_at.toISOString(),
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * GET /api/v1/me/preferences
   * Retrieve personal preferences (AC-PRO-01-06)
   */
  async getMyPreferences(userId: string, correlationId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'SESSION_INVALID',
        'Người dùng không tồn tại hoặc phiên đăng nhập không hợp lệ'
      );
    }

    return {
      data: {
        language: user.language || 'vi',
        timezone: user.timezone || 'Asia/Ho_Chi_Minh',
        default_warehouse_id: user.default_warehouse_id,
        notification_preferences: user.notification_preferences || DEFAULT_NOTIFICATION_PREFERENCES,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * PATCH /api/v1/me/preferences
   * Update personal preferences (AC-PRO-01-06, AC-PRO-01-07, AC-PRO-01-08)
   */
  async updateMyPreferences(
    userId: string,
    dto: UpdatePreferencesDto,
    clientIp: string,
    correlationId: string
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'SESSION_INVALID',
        'Người dùng không tồn tại hoặc phiên đăng nhập không hợp lệ'
      );
    }

    const updates: any = {};

    if (dto.language !== undefined) {
      if (!SUPPORTED_LANGUAGES.has(dto.language)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_INPUT',
          'Ngôn ngữ không được hỗ trợ. Vui lòng chọn vi hoặc en'
        );
      }
      updates.language = dto.language;
    }

    if (dto.timezone !== undefined) {
      if (!isValidIanaTimezone(dto.timezone)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_INPUT',
          'Múi giờ không hợp lệ theo chuẩn IANA'
        );
      }
      updates.timezone = dto.timezone;
    }

    if (dto.default_warehouse_id !== undefined) {
      if (dto.default_warehouse_id === null || dto.default_warehouse_id === '') {
        updates.default_warehouse_id = null;
      } else {
        const scopes = user.warehouse_scopes || [];
        const hasWildcard = scopes.includes('*');
        if (!hasWildcard && !scopes.includes(dto.default_warehouse_id)) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'WAREHOUSE_SCOPE_UNAUTHORIZED',
            'Kho mặc định không thuộc phạm vi kho được phân quyền của bạn'
          );
        }
        updates.default_warehouse_id = dto.default_warehouse_id;
      }
    }

    if (dto.notification_preferences !== undefined) {
      const mergedPrefs = this.mergeAndValidateNotificationPreferences(
        user.notification_preferences,
        dto.notification_preferences
      );
      updates.notification_preferences = mergedPrefs;
    }

    const oldSnapshot = {
      language: user.language,
      timezone: user.timezone,
      default_warehouse_id: user.default_warehouse_id,
      notification_preferences: user.notification_preferences,
    };

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: updates,
      });

      const newSnapshot = {
        language: updated.language,
        timezone: updated.timezone,
        default_warehouse_id: updated.default_warehouse_id,
        notification_preferences: updated.notification_preferences,
      };

      await tx.auditLog.create({
        data: {
          merchant_id: updated.merchant_id,
          user_id: updated.id,
          actor: updated.full_name || updated.email || updated.id,
          action: 'PREFERENCES_UPDATED',
          entity_type: 'User',
          entity_id: updated.id,
          old_value: oldSnapshot,
          new_value: newSnapshot,
          ip_address: clientIp,
          reason: 'Cập nhật tùy chọn cá nhân',
        },
      });

      return updated;
    });

    return {
      data: {
        language: updatedUser.language || 'vi',
        timezone: updatedUser.timezone || 'Asia/Ho_Chi_Minh',
        default_warehouse_id: updatedUser.default_warehouse_id,
        notification_preferences:
          updatedUser.notification_preferences || DEFAULT_NOTIFICATION_PREFERENCES,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * Helper to merge and strictly validate notification preferences per BR-PRO-03 / NOTIFICATIONS-REPORTS.md
   */
  private mergeAndValidateNotificationPreferences(
    current: any,
    incoming: NotificationPreferencesDto
  ) {
    const base = current || DEFAULT_NOTIFICATION_PREFERENCES;
    const channels = {
      ...base.channels,
      ...(incoming.channels || {}),
    };

    const digest_window_minutes =
      incoming.digest_window_minutes !== undefined
        ? incoming.digest_window_minutes
        : base.digest_window_minutes || 15;

    const subscriptions = {
      ...base.subscriptions,
      ...(incoming.subscriptions || {}),
    };

    // BR-PRO-03 & AC-PRO-01-07: Critical alert inviolability
    if (incoming.subscriptions) {
      if (
        incoming.subscriptions.security_alerts === false ||
        incoming.subscriptions.create_unknown === false ||
        incoming.subscriptions.claim_deadline_warning === false
      ) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'CANNOT_DISABLE_CRITICAL_NOTIFICATIONS',
          'Không thể tắt cảnh báo bảo mật, sự cố tạo đơn và hạn chót khiếu nại (bắt buộc theo quy định an toàn vận hành)'
        );
      }
    }

    // Always guarantee critical alerts remain true
    subscriptions.security_alerts = true;
    subscriptions.create_unknown = true;
    subscriptions.claim_deadline_warning = true;

    return {
      channels,
      digest_window_minutes,
      subscriptions,
    };
  }
}
