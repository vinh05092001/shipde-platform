import { Injectable, Inject, Optional, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CanonicalApiException } from '../auth/auth.service';
import { hashPassword } from '../auth/password.util';
import { RoleEnum, InvitationStatusEnum } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
import { VERIFICATION_ADAPTER } from '../auth/auth.tokens';
import type { IVerificationDeliveryAdapter } from '@shipde/contracts';
import { SendInvitationRequest, AcceptInvitationRequest, InvitationItem } from '@shipde/contracts';
import { RateLimitService } from '../auth/rate-limit.service';

export function maskIdentifier(identifier?: string | null): string {
  if (!identifier) return '';
  if (identifier.includes('@')) {
    const [name, domain] = identifier.split('@');
    if (!name || !domain) return '***';
    if (name.length <= 2) {
      return `${name[0]}*@${domain}`;
    }
    return `${name[0]}${'*'.repeat(Math.min(name.length - 2, 4))}${name[name.length - 1]}@${domain}`;
  }
  if (identifier.length >= 7) {
    const start = identifier.slice(0, 3);
    const end = identifier.slice(-3);
    return `${start}****${end}`;
  }
  return '***';
}

export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!password || password.length < 8) {
    errors.push('Mật khẩu phải có độ dài tối thiểu 8 ký tự');
  }
  if (password && !/[A-Z]/.test(password)) {
    errors.push('Mật khẩu phải chứa ít nhất 1 chữ hoa');
  }
  if (password && !/[a-z]/.test(password)) {
    errors.push('Mật khẩu phải chứa ít nhất 1 chữ thường');
  }
  if (password && !/[0-9]/.test(password)) {
    errors.push('Mật khẩu phải chứa ít nhất 1 chữ số');
  }
  if (password && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Mật khẩu phải chứa ít nhất 1 ký tự đặc biệt');
  }
  return { valid: errors.length === 0, errors };
}

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(VERIFICATION_ADAPTER)
    private readonly deliveryAdapter?: IVerificationDeliveryAdapter,
    @Optional()
    @Inject(RateLimitService)
    private readonly rateLimitService?: RateLimitService
  ) {}

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private async resolveActorUser(actor: {
    userId: string;
    merchantId: string;
    role?: string;
    store_scopes?: string[];
    warehouse_scopes?: string[];
  }): Promise<{
    id: string;
    role: RoleEnum | string;
    store_scopes: string[];
    warehouse_scopes: string[];
  } | null> {
    if (actor.userId) {
      const user = await this.prisma.user.findFirst({
        where: { id: actor.userId, merchant_id: actor.merchantId },
        select: { id: true, role: true, store_scopes: true, warehouse_scopes: true, status: true },
      });
      if (user && user.role) {
        return {
          id: user.id,
          role: user.role,
          store_scopes: user.store_scopes || [],
          warehouse_scopes: user.warehouse_scopes || [],
        };
      }
    }
    if (actor.role) {
      return {
        id: actor.userId || 'mock-actor-id',
        role: actor.role,
        store_scopes: actor.store_scopes || [],
        warehouse_scopes: actor.warehouse_scopes || [],
      };
    }
    return null;
  }

  private async resolveActorRole(actor: {
    userId: string;
    merchantId: string;
    role?: string;
  }): Promise<RoleEnum | string | undefined> {
    const actorUser = await this.resolveActorUser(actor);
    return actorUser?.role;
  }

  /**
   * Send a new team member invitation (POST /api/v1/invitations)
   * BR-INV-01, BR-INV-02, BR-INV-03, BR-INV-08, BR-INV-09.
   */
  async createInvitation(
    dto: SendInvitationRequest,
    actor: { userId: string; merchantId: string; role?: string },
    clientIp: string,
    correlationId: string,
    baseUrl = 'http://localhost:3000'
  ) {
    const email = dto.email ? dto.email.trim().toLowerCase() : undefined;
    const phone = dto.phone ? dto.phone.trim().replace(/[\s-]/g, '') : undefined;
    const recipient = email || phone;

    // Rate limiting: Anti-abuse dispatch limit (SECURITY-NFR)
    if (this.rateLimitService) {
      const rateLimit = await this.rateLimitService.checkInvitationDispatchLimit(
        clientIp,
        recipient
      );
      if (!rateLimit.allowed) {
        throw new CanonicalApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          'RATE_LIMITED',
          rateLimit.reason || 'Quá nhiều yêu cầu gửi lời mời. Vui lòng thử lại sau.',
          false,
          undefined,
          undefined,
          rateLimit.retryAfterSeconds
        );
      }
      await this.rateLimitService.recordInvitationDispatchAttempt(clientIp, recipient);
    }

    // 1. Validation: At least one recipient identifier required (AC-USR-01-07)
    if (!email && !phone) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Vui lòng cung cấp email hoặc số điện thoại người nhận',
        false,
        undefined,
        [
          {
            field: 'identifier',
            code: 'REQUIRED',
            message: 'Vui lòng cung cấp email hoặc số điện thoại',
          },
        ]
      );
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Địa chỉ email không đúng định dạng',
        false,
        undefined,
        [{ field: 'email', code: 'INVALID_FORMAT', message: 'Địa chỉ email không hợp lệ' }]
      );
    }

    if (phone && !/^(?:\+84|0)(?:3|5|7|8|9)\d{8}$/.test(phone)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Số điện thoại không đúng định dạng Việt Nam',
        false,
        undefined,
        [{ field: 'phone', code: 'INVALID_FORMAT', message: 'Số điện thoại không hợp lệ' }]
      );
    }

    // Role validation
    const validRoles = [RoleEnum.OWNER, RoleEnum.OPS_CSKH, RoleEnum.WAREHOUSE, RoleEnum.ACCOUNTANT];
    if (!dto.role || !validRoles.includes(dto.role as RoleEnum)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Vai trò được chỉ định không hợp lệ',
        false,
        undefined,
        [{ field: 'role', code: 'INVALID_ROLE', message: 'Vai trò là bắt buộc và phải hợp lệ' }]
      );
    }

    // 2. Authorization: Caller must have "Manage users/roles" permission (AC-USR-01-04)
    const actorUser = await this.resolveActorUser(actor);
    if (!actorUser) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền quản lý người dùng và vai trò',
        false
      );
    }
    const isOwner = actorUser.role === RoleEnum.OWNER || actorUser.role === 'OWNER';
    const isOps = actorUser.role === RoleEnum.OPS_CSKH || actorUser.role === 'OPS_CSKH';
    if (!isOwner && !isOps) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền quản lý người dùng và vai trò',
        false
      );
    }

    // 3. Privilege Ceiling (BR-INV-01, AC-USR-01-03)
    if (!isOwner) {
      if (dto.role === RoleEnum.OWNER) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Vượt quá hạn mức phân quyền: Bạn không có quyền mời người dùng với vai trò Chủ cửa hàng (OWNER)',
          false
        );
      }

      // Non-owner cannot grant roles they do not hold (e.g. OPS_CSKH cannot invite ACCOUNTANT or WAREHOUSE)
      if (dto.role !== actorUser.role) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          `Vượt quá hạn mức phân quyền: Bạn không thể phân quyền vai trò ${dto.role} vượt quá quyền hạn của mình`,
          false
        );
      }

      // Non-owner cannot grant store scopes outside their own scope
      if (dto.store_scopes && dto.store_scopes.length > 0) {
        const actorStores = new Set(actorUser.store_scopes);
        if (!actorStores.has('*')) {
          const unauthorizedStores = dto.store_scopes.filter((s) => !actorStores.has(s));
          if (unauthorizedStores.length > 0) {
            throw new CanonicalApiException(
              HttpStatus.FORBIDDEN,
              'FORBIDDEN',
              `Vượt quá hạn mức phân quyền: Chi nhánh không thuộc phạm vi quản lý (${unauthorizedStores.join(', ')})`,
              false
            );
          }
        }
      }

      // Non-owner cannot grant warehouse scopes outside their own scope
      if (dto.warehouse_scopes && dto.warehouse_scopes.length > 0) {
        const actorWarehouses = new Set(actorUser.warehouse_scopes);
        if (!actorWarehouses.has('*')) {
          const unauthorizedWarehouses = dto.warehouse_scopes.filter((w) => !actorWarehouses.has(w));
          if (unauthorizedWarehouses.length > 0) {
            throw new CanonicalApiException(
              HttpStatus.FORBIDDEN,
              'FORBIDDEN',
              `Vượt quá hạn mức phân quyền: Kho hàng không thuộc phạm vi quản lý (${unauthorizedWarehouses.join(', ')})`,
              false
            );
          }
        }
      }
    }

    // 4. Duplicate checks (BR-INV-08)
    // 4a. Check active user with same email or phone in merchant (AC-USR-01-05)
    const existingUser = await this.prisma.user.findFirst({
      where: {
        merchant_id: actor.merchantId,
        OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      },
    });

    if (existingUser) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'USER_ALREADY_EXISTS',
        'Người dùng với thông tin định danh này đã tồn tại trong cửa hàng',
        false
      );
    }

    // 4b. Check unexpired pending invitation in merchant (AC-USR-01-06)
    const pendingInvite = await this.prisma.invitation.findFirst({
      where: {
        merchant_id: actor.merchantId,
        status: InvitationStatusEnum.PENDING,
        expires_at: { gt: new Date() },
        OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      },
    });

    if (pendingInvite) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVITATION_ALREADY_PENDING',
        'Đã có lời mời đang chờ xử lý cho người dùng này. Vui lòng sử dụng tính năng gửi lại nếu cần.',
        false,
        'Vui lòng sử dụng tính năng gửi lại lời mời'
      );
    }

    // 5. Generate secure 32-byte token and SHA-256 hash (BR-INV-02)
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    // 6. Expiry: 7 days (168 hours) from now (BR-INV-03)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // 7. Persist invitation and immutable audit log in single database transaction (BR-INV-04, BR-INV-09)
    let invitation: any;
    try {
      invitation = await this.prisma.$transaction(async (tx) => {
        const inv = await tx.invitation.create({
          data: {
            merchant_id: actor.merchantId,
            email: email || null,
            phone: phone || null,
            role: dto.role as RoleEnum,
            store_scopes: dto.store_scopes || [],
            warehouse_scopes: dto.warehouse_scopes || [],
            token_hash: tokenHash,
            status: InvitationStatusEnum.PENDING,
            invited_by_user_id: actor.userId,
            expires_at: expiresAt,
          },
        });

        // 8. Immutable Audit Trail (BR-INV-09, AC-USR-01-01, AC-USR-01-18)
        // Committed atomically with the invitation record; never log raw token or password
        await tx.auditLog.create({
          data: {
            merchant_id: actor.merchantId,
            user_id: actor.userId,
            action: 'INVITATION_SENT',
            entity_type: 'Invitation',
            entity_id: inv.id,
            ip_address: clientIp,
            new_value: {
              invitation_id: inv.id,
              role: inv.role,
              store_scopes: inv.store_scopes,
              warehouse_scopes: inv.warehouse_scopes,
              expires_at: inv.expires_at.toISOString(),
              target_identifier_masked: maskIdentifier(email || phone),
              correlation_id: correlationId,
            },
          },
        });

        return inv;
      });
    } catch (err: any) {
      if (err?.code === 'P2002' || err?.message?.includes('invitations_merchant_pending')) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'INVITATION_ALREADY_PENDING',
          'Đã có lời mời đang chờ xử lý cho người dùng này. Vui lòng sử dụng tính năng gửi lại nếu cần.',
          false,
          'Vui lòng sử dụng tính năng gửi lại lời mời'
        );
      }
      throw err;
    }

    const invitationUrl = `${baseUrl}/invite/accept?token=${rawToken}`;

    // Dispatch verification via configured delivery adapter if registered
    if (this.deliveryAdapter) {
      await this.deliveryAdapter.sendVerification({
        channel: email ? 'email' : 'phone',
        recipient: (email || phone) as string,
        token: rawToken,
        purpose: 'invitation',
        link: invitationUrl,
      });
    }

    return {
      data: {
        id: invitation.id,
        merchant_id: invitation.merchant_id,
        email: invitation.email,
        phone: invitation.phone,
        role: invitation.role,
        store_scopes: invitation.store_scopes,
        warehouse_scopes: invitation.warehouse_scopes,
        status: invitation.status,
        expires_at: invitation.expires_at.toISOString(),
        created_at: invitation.created_at.toISOString(),
        consumed_at: invitation.consumed_at ? invitation.consumed_at.toISOString() : null,
        invited_by_user_id: invitation.invited_by_user_id,
        invitation_url: invitationUrl,
        token: rawToken, // Provided in dispatch response only (BR-INV-02)
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * List invitations for caller's merchant tenant (GET /api/v1/invitations)
   * Scoped to merchant; raw tokens strictly omitted (AC-USR-01-08).
   */
  async listInvitations(
    actor: { userId: string; merchantId: string; role?: string },
    filter: { status?: string; page?: number; limit?: number },
    correlationId: string
  ) {
    const actorRole = await this.resolveActorRole(actor);
    const isOwner = actorRole === RoleEnum.OWNER || actorRole === 'OWNER';
    const isOps = actorRole === RoleEnum.OPS_CSKH || actorRole === 'OPS_CSKH';
    if (!isOwner && !isOps) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền quản lý người dùng và vai trò',
        false
      );
    }

    const page = Math.max(1, filter.page || 1);
    const limit = Math.min(100, Math.max(1, filter.limit || 20));
    const skip = (page - 1) * limit;

    const now = new Date();

    // Persist expired status for time-elapsed pending invitations in caller's merchant (Finding 8)
    await this.prisma.invitation.updateMany({
      where: {
        merchant_id: actor.merchantId,
        status: InvitationStatusEnum.PENDING,
        expires_at: { lt: now },
      },
      data: {
        status: InvitationStatusEnum.EXPIRED,
      },
    });

    const where: any = {
      merchant_id: actor.merchantId,
    };

    if (filter.status === 'EXPIRED' || filter.status === InvitationStatusEnum.EXPIRED) {
      where.OR = [
        { status: InvitationStatusEnum.EXPIRED },
        { status: InvitationStatusEnum.PENDING, expires_at: { lt: now } },
      ];
    } else if (filter.status === 'PENDING' || filter.status === InvitationStatusEnum.PENDING) {
      where.status = InvitationStatusEnum.PENDING;
      where.expires_at = { gte: now };
    } else if (filter.status && filter.status !== 'ALL') {
      where.status = filter.status as InvitationStatusEnum;
    }

    const [total, records] = await Promise.all([
      this.prisma.invitation.count({ where }),
      this.prisma.invitation.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const items: InvitationItem[] = records.map((rec) => {
      let displayStatus = rec.status;
      if (rec.status === InvitationStatusEnum.PENDING && rec.expires_at < now) {
        displayStatus = InvitationStatusEnum.EXPIRED;
      }
      return {
        id: rec.id,
        merchant_id: rec.merchant_id,
        email: rec.email,
        phone: rec.phone,
        role: rec.role,
        store_scopes: rec.store_scopes,
        warehouse_scopes: rec.warehouse_scopes,
        status: displayStatus,
        invited_by_user_id: rec.invited_by_user_id,
        expires_at: rec.expires_at.toISOString(),
        consumed_at: rec.consumed_at ? rec.consumed_at.toISOString() : null,
        created_at: rec.created_at.toISOString(),
      };
    });

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        correlation_id: correlationId,
      },
    };
  }

  /**
   * Resend an invitation (POST /api/v1/invitations/:id/resend)
   * Regenerates token, extends expiry 7 days, transitions EXPIRED -> PENDING (AC-USR-01-09).
   */
  async resendInvitation(
    invitationId: string,
    actor: { userId: string; merchantId: string; role?: string },
    clientIp: string,
    correlationId: string,
    baseUrl = 'http://localhost:3000'
  ) {
    const actorRole = await this.resolveActorRole(actor);
    const isOwner = actorRole === RoleEnum.OWNER || actorRole === 'OWNER';
    const isOps = actorRole === RoleEnum.OPS_CSKH || actorRole === 'OPS_CSKH';
    if (!isOwner && !isOps) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền quản lý người dùng và vai trò',
        false
      );
    }

    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'INVITATION_NOT_FOUND',
        'Không tìm thấy lời mời',
        false
      );
    }

    // Cross-tenant check (BR-INV-07, AC-USR-01-11)
    if (invitation.merchant_id !== actor.merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền truy cập lời mời của cửa hàng khác',
        false
      );
    }

    // Privilege Ceiling (BR-INV-01)
    if (!isOwner && invitation.role === RoleEnum.OWNER) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Vượt quá hạn mức phân quyền: Bạn không thể gửi lại lời mời của Chủ cửa hàng',
        false
      );
    }

    if (invitation.status === InvitationStatusEnum.ACCEPTED || invitation.consumed_at) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVITATION_ALREADY_USED',
        'Lời mời đã được chấp nhận trước đó',
        false
      );
    }

    if (invitation.status === InvitationStatusEnum.CANCELLED) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_STATE',
        'Không thể gửi lại lời mời đã bị hủy',
        false
      );
    }

    // Rate limiting: Anti-abuse dispatch limit (SECURITY-NFR)
    if (this.rateLimitService) {
      const recipient = invitation.email || invitation.phone || undefined;
      const rateLimit = await this.rateLimitService.checkInvitationDispatchLimit(
        clientIp,
        recipient
      );
      if (!rateLimit.allowed) {
        throw new CanonicalApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          'RATE_LIMITED',
          rateLimit.reason || 'Quá nhiều yêu cầu gửi lại lời mời. Vui lòng thử lại sau.',
          false,
          undefined,
          undefined,
          rateLimit.retryAfterSeconds
        );
      }
      await this.rateLimitService.recordInvitationDispatchAttempt(clientIp, recipient);
    }

    // Regenerate 32-byte token and reset expiry 7 days
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Conditional atomic updateMany + audit log in single transaction (BR-INV-04, BR-INV-05, BR-INV-09)
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.invitation.updateMany({
        where: {
          id: invitationId,
          merchant_id: actor.merchantId,
          status: { in: [InvitationStatusEnum.PENDING, InvitationStatusEnum.EXPIRED] },
          consumed_at: null,
        },
        data: {
          token_hash: tokenHash,
          status: InvitationStatusEnum.PENDING,
          expires_at: expiresAt,
          updated_at: new Date(),
        },
      });

      if (result.count === 0) {
        const current = await tx.invitation.findUnique({ where: { id: invitationId } });
        if (!current || current.merchant_id !== actor.merchantId) {
          throw new CanonicalApiException(
            HttpStatus.NOT_FOUND,
            'INVITATION_NOT_FOUND',
            'Không tìm thấy lời mời',
            false
          );
        }
        if (current.status === InvitationStatusEnum.ACCEPTED || current.consumed_at) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'INVITATION_ALREADY_USED',
            'Lời mời đã được chấp nhận trước đó',
            false
          );
        }
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_STATE',
          'Không thể gửi lại lời mời ở trạng thái hiện tại',
          false
        );
      }

      const inv = (await tx.invitation.findUnique({
        where: { id: invitationId },
      }))!;

      // Audit log (BR-INV-09, AC-USR-01-09) committed atomically with state change
      await tx.auditLog.create({
        data: {
          merchant_id: actor.merchantId,
          user_id: actor.userId,
          action: 'INVITATION_RESENT',
          entity_type: 'Invitation',
          entity_id: inv.id,
          ip_address: clientIp,
          new_value: {
            invitation_id: inv.id,
            role: inv.role,
            status: inv.status,
            expires_at: inv.expires_at.toISOString(),
            correlation_id: correlationId,
          },
        },
      });

      return inv;
    });

    const invitationUrl = `${baseUrl}/invite/accept?token=${rawToken}`;

    // Dispatch verification via configured delivery adapter if registered
    if (this.deliveryAdapter) {
      await this.deliveryAdapter.sendVerification({
        channel: updated.email ? 'email' : 'phone',
        recipient: (updated.email || updated.phone) as string,
        token: rawToken,
        purpose: 'invitation',
        link: invitationUrl,
      });
    }

    return {
      data: {
        id: updated.id,
        status: updated.status,
        expires_at: updated.expires_at.toISOString(),
        token: rawToken,
        invitation_url: invitationUrl,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * Cancel a pending invitation (POST /api/v1/invitations/:id/cancel)
   * PENDING -> CANCELLED (AC-USR-01-10).
   */
  async cancelInvitation(
    invitationId: string,
    actor: { userId: string; merchantId: string; role?: string },
    clientIp: string,
    correlationId: string
  ) {
    const actorRole = await this.resolveActorRole(actor);
    const isOwner = actorRole === RoleEnum.OWNER || actorRole === 'OWNER';
    const isOps = actorRole === RoleEnum.OPS_CSKH || actorRole === 'OPS_CSKH';
    if (!isOwner && !isOps) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền quản lý người dùng và vai trò',
        false
      );
    }

    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'INVITATION_NOT_FOUND',
        'Không tìm thấy lời mời',
        false
      );
    }

    // Cross-tenant check (BR-INV-07, AC-USR-01-11)
    if (invitation.merchant_id !== actor.merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền truy cập lời mời của cửa hàng khác',
        false
      );
    }

    // Privilege Ceiling (BR-INV-01)
    if (!isOwner && invitation.role === RoleEnum.OWNER) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Vượt quá hạn mức phân quyền: Bạn không thể hủy lời mời của Chủ cửa hàng',
        false
      );
    }

    if (invitation.status === InvitationStatusEnum.ACCEPTED || invitation.consumed_at) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVITATION_ALREADY_USED',
        'Lời mời đã được chấp nhận trước đó và không thể hủy',
        false
      );
    }

    // Invalidate token hash on cancellation to prevent verification or acceptance
    const cancelledTokenHash = createHash('sha256')
      .update(`cancelled:${invitationId}:${Date.now()}:${randomBytes(16).toString('hex')}`)
      .digest('hex');

    // Conditional atomic updateMany + audit log in single transaction (BR-INV-04, BR-INV-05, BR-INV-09, AC-USR-01-10)
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.invitation.updateMany({
        where: {
          id: invitationId,
          merchant_id: actor.merchantId,
          status: InvitationStatusEnum.PENDING,
          consumed_at: null,
        },
        data: {
          status: InvitationStatusEnum.CANCELLED,
          token_hash: cancelledTokenHash,
          updated_at: new Date(),
        },
      });

      if (result.count === 0) {
        const current = await tx.invitation.findUnique({ where: { id: invitationId } });
        if (!current || current.merchant_id !== actor.merchantId) {
          throw new CanonicalApiException(
            HttpStatus.NOT_FOUND,
            'INVITATION_NOT_FOUND',
            'Không tìm thấy lời mời',
            false
          );
        }
        if (current.status === InvitationStatusEnum.ACCEPTED || current.consumed_at) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'INVITATION_ALREADY_USED',
            'Lời mời đã được chấp nhận trước đó và không thể hủy',
            false
          );
        }
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_STATE',
          'Chỉ có thể hủy lời mời đang ở trạng thái PENDING',
          false
        );
      }

      const inv = (await tx.invitation.findUnique({
        where: { id: invitationId },
      }))!;

      // Audit log (BR-INV-09, AC-USR-01-10) committed atomically with state change
      await tx.auditLog.create({
        data: {
          merchant_id: actor.merchantId,
          user_id: actor.userId,
          action: 'INVITATION_CANCELLED',
          entity_type: 'Invitation',
          entity_id: inv.id,
          ip_address: clientIp,
          new_value: {
            invitation_id: inv.id,
            status: inv.status,
            correlation_id: correlationId,
          },
        },
      });

      return inv;
    });

    return {
      data: {
        id: updated.id,
        status: updated.status,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * Public verification of invitation token (GET /api/v1/invitations/verify?token=...)
   * BR-INV-06: Non-enumeration on public endpoints returns identical 404 for invalid,
   * expired, cancelled, or nonexistent tokens (AC-USR-01-12, AC-USR-01-13).
   */
  async verifyInvitation(rawToken: string, correlationId: string, clientIp?: string) {
    // Rate limiting: Anti-enumeration verification limit (SECURITY-NFR)
    if (this.rateLimitService && clientIp) {
      const rateLimit = await this.rateLimitService.checkInvitationVerifyLimit(clientIp);
      if (!rateLimit.allowed) {
        throw new CanonicalApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          'RATE_LIMITED',
          rateLimit.reason || 'Quá nhiều yêu cầu kiểm tra lời mời từ địa chỉ IP này. Vui lòng thử lại sau.',
          false,
          undefined,
          undefined,
          rateLimit.retryAfterSeconds
        );
      }
      await this.rateLimitService.recordInvitationVerifyAttempt(clientIp);
    }
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'INVITATION_NOT_FOUND',
        'Liên kết lời mời không hợp lệ hoặc đã hết hạn',
        false
      );
    }

    const tokenHash = this.hashToken(rawToken.trim());
    const invitation = await this.prisma.invitation.findUnique({
      where: { token_hash: tokenHash },
      include: { merchant: true },
    });

    // Non-enumeration: 404 for not found, cancelled, consumed, or expired (BR-INV-06)
    if (
      !invitation ||
      invitation.status === InvitationStatusEnum.CANCELLED ||
      invitation.status === InvitationStatusEnum.ACCEPTED ||
      invitation.consumed_at !== null ||
      invitation.expires_at < new Date()
    ) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'INVITATION_NOT_FOUND',
        'Liên kết lời mời không hợp lệ hoặc đã hết hạn',
        false
      );
    }

    const rawIdentifier = invitation.email || invitation.phone || '';
    const masked = maskIdentifier(rawIdentifier);

    return {
      data: {
        valid: true,
        tenant_name: invitation.merchant.name,
        role: invitation.role,
        identifier: masked,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * Public acceptance of invitation (POST /api/v1/invitations/accept)
   * BR-INV-04, BR-INV-05, BR-INV-09, AC-USR-01-14, AC-USR-01-15, AC-USR-01-16.
   */
  async acceptInvitation(dto: AcceptInvitationRequest, clientIp: string, correlationId: string) {
    // 0. Rate limiting: Anti-brute-force acceptance gate (SECURITY-NFR)
    if (this.rateLimitService) {
      const tokenHash = dto.token ? this.hashToken(dto.token.trim()) : undefined;
      const rateLimit = await this.rateLimitService.checkInvitationAcceptLimit(clientIp, tokenHash);
      if (!rateLimit.allowed) {
        throw new CanonicalApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          'RATE_LIMITED',
          rateLimit.reason || 'Quá nhiều yêu cầu chấp nhận lời mời từ địa chỉ IP này. Vui lòng thử lại sau.',
          false,
          undefined,
          undefined,
          rateLimit.retryAfterSeconds
        );
      }
      await this.rateLimitService.recordInvitationAcceptAttempt(clientIp, tokenHash);
    }
    // 1. Validate token
    if (!dto.token || typeof dto.token !== 'string' || dto.token.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Mã token lời mời là bắt buộc',
        false,
        undefined,
        [{ field: 'token', code: 'REQUIRED', message: 'Token là bắt buộc' }]
      );
    }

    // 2. Validate full name (AC-USR-01-07)
    if (!dto.full_name || dto.full_name.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Họ và tên không được để trống',
        false,
        undefined,
        [{ field: 'full_name', code: 'REQUIRED', message: 'Vui lòng nhập họ và tên' }]
      );
    }

    // 3. Validate password strength (AC-USR-01-16)
    const strength = validatePasswordStrength(dto.password);
    if (!strength.valid) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Mật khẩu không đáp ứng tiêu chuẩn bảo mật',
        false,
        undefined,
        strength.errors.map((msg) => ({ field: 'password', code: 'WEAK_PASSWORD', message: msg }))
      );
    }

    if (dto.password_confirm && dto.password !== dto.password_confirm) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Mật khẩu xác nhận không khớp',
        false,
        undefined,
        [{ field: 'password_confirm', code: 'MISMATCH', message: 'Mật khẩu xác nhận không khớp' }]
      );
    }

    const tokenHash = this.hashToken(dto.token.trim());
    const invitation = await this.prisma.invitation.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!invitation || invitation.status === InvitationStatusEnum.CANCELLED) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'INVITATION_NOT_FOUND',
        'Lời mời không tồn tại hoặc đã bị hủy',
        false
      );
    }

    // Replay protection (BR-INV-05, AC-USR-01-15)
    if (invitation.status === InvitationStatusEnum.ACCEPTED || invitation.consumed_at) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVITATION_ALREADY_USED',
        'Lời mời này đã được chấp nhận trước đó. Vui lòng đăng nhập.',
        false
      );
    }

    // Expiry check (BR-INV-03)
    if (invitation.status === InvitationStatusEnum.EXPIRED || invitation.expires_at < new Date()) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVITATION_EXPIRED',
        'Lời mời đã hết hạn. Vui lòng liên hệ quản trị viên để nhận lời mời mới.',
        false
      );
    }

    // 4. Atomic Acceptance Transaction (BR-INV-04)
    const now = new Date();
    const hashedPassword = await hashPassword(dto.password);

    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic concurrency guard
      const updateCount = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          status: InvitationStatusEnum.PENDING,
        },
        data: {
          status: InvitationStatusEnum.ACCEPTED,
          consumed_at: now,
          updated_at: now,
        },
      });

      if (updateCount.count === 0) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'INVITATION_ALREADY_USED',
          'Lời mời đã được chấp nhận bởi một yêu cầu khác',
          false
        );
      }

      // Check existing user conflict in merchant
      const duplicateUser = await tx.user.findFirst({
        where: {
          merchant_id: invitation.merchant_id,
          OR: [
            ...(invitation.email ? [{ email: invitation.email }] : []),
            ...(invitation.phone ? [{ phone: invitation.phone }] : []),
          ],
        },
      });

      if (duplicateUser) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'USER_ALREADY_EXISTS',
          'Người dùng với thông tin này đã được kích hoạt trong cửa hàng',
          false
        );
      }

      // Create User with ACTIVE status and assigned scopes
      const newUser = await tx.user.create({
        data: {
          merchant_id: invitation.merchant_id,
          email: invitation.email || null,
          phone: invitation.phone || null,
          full_name: dto.full_name.trim(),
          password_hash: hashedPassword,
          role: invitation.role,
          store_scopes: invitation.store_scopes,
          warehouse_scopes: invitation.warehouse_scopes,
          status: 'active',
          email_verified_at: invitation.email ? now : null,
          phone_verified_at: invitation.phone ? now : null,
          terms_accepted_at: now,
          terms_version: 'v1.0',
        },
      });

      // Immutable audit log (BR-INV-09, AC-USR-01-14, AC-USR-01-18)
      // Zero passwords or raw tokens
      await tx.auditLog.create({
        data: {
          merchant_id: invitation.merchant_id,
          user_id: newUser.id,
          action: 'INVITATION_ACCEPTED',
          entity_type: 'Invitation',
          entity_id: invitation.id,
          ip_address: clientIp,
          new_value: {
            invitation_id: invitation.id,
            user_id: newUser.id,
            role: newUser.role,
            store_scopes: newUser.store_scopes,
            warehouse_scopes: newUser.warehouse_scopes,
            correlation_id: correlationId,
          },
        },
      });

      return newUser;
    });

    return {
      data: {
        user_id: result.id,
        email: result.email,
        phone: result.phone,
        full_name: result.full_name,
        role: result.role,
        status: 'ACTIVE',
        message: 'Tài khoản của bạn đã được kích hoạt thành công',
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }
}
