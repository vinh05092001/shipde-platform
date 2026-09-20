import { Injectable, Inject } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password.util';
import { CanonicalApiException, CanonicalFieldError } from './auth.service';
import { RoleEnum } from '@prisma/client';
import { formatStructuredLog } from '@shipde/config';

export interface CreateShopDto {
  merchant_name: string;
  owner_full_name: string;
  owner_email?: string;
  owner_phone?: string;
  owner_password?: string;
}

export interface AdminShopListItem {
  id: string;
  name: string;
  code: string;
  status: string;
  created_at: string;
  owner: {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    status: string;
  };
}

@Injectable()
export class AdminAuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createShop(dto: CreateShopDto, clientIp: string, correlationId: string) {
    const fields: CanonicalFieldError[] = [];

    if (!dto.merchant_name || dto.merchant_name.trim().length < 2) {
      fields.push({
        field: 'merchant_name',
        code: 'REQUIRED',
        message: 'Tên cửa hàng phải có ít nhất 2 ký tự',
      });
    }

    const email = dto.owner_email ? dto.owner_email.trim().toLowerCase() : undefined;
    const phone = dto.owner_phone ? dto.owner_phone.trim() : undefined;

    if (!email && !phone) {
      fields.push({
        field: 'owner_email',
        code: 'REQUIRED',
        message: 'Phải cung cấp ít nhất email hoặc số điện thoại',
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fields.push({
        field: 'owner_email',
        code: 'INVALID_FORMAT',
        message: 'Định dạng email không hợp lệ',
      });
    }

    if (phone && !/^(0|\+84)[3|5|7|8|9][0-9]{8}$/.test(phone.replace(/\s+/g, ''))) {
      fields.push({
        field: 'owner_phone',
        code: 'INVALID_FORMAT',
        message: 'Số điện thoại không hợp lệ',
      });
    }

    if (!dto.owner_full_name || dto.owner_full_name.trim().length < 2) {
      fields.push({
        field: 'owner_full_name',
        code: 'REQUIRED',
        message: 'Họ và tên phải có ít nhất 2 ký tự',
      });
    }

    if (dto.owner_password && dto.owner_password.length > 0 && dto.owner_password.length < 8) {
      fields.push({
        field: 'owner_password',
        code: 'INVALID_FORMAT',
        message: 'Mật khẩu phải có ít nhất 8 ký tự',
      });
    }

    if (fields.length > 0) {
      throw new CanonicalApiException(
        400,
        'VALIDATION_ERROR',
        'Dữ liệu không hợp lệ',
        false,
        undefined,
        fields
      );
    }

    // BR-ADMIN-06/07: duplicate ACTIVE identifier check
    if (email) {
      const existing = await this.prisma.user.findFirst({
        where: { email, status: 'active' },
      });
      if (existing) {
        throw new CanonicalApiException(
          400,
          'VALIDATION_ERROR',
          'Email đã được sử dụng',
          false,
          undefined,
          [
            {
              field: 'owner_email',
              code: 'DUPLICATE',
              message: 'Email đã được sử dụng bởi tài khoản đang hoạt động',
            },
          ]
        );
      }
    }
    if (phone) {
      const existing = await this.prisma.user.findFirst({
        where: { phone, status: 'active' },
      });
      if (existing) {
        throw new CanonicalApiException(
          400,
          'VALIDATION_ERROR',
          'Số điện thoại đã được sử dụng',
          false,
          undefined,
          [
            {
              field: 'owner_phone',
              code: 'DUPLICATE',
              message: 'Số điện thoại đã được sử dụng bởi tài khoản đang hoạt động',
            },
          ]
        );
      }
    }

    // BR-ADMIN-08: generate temporary password if not provided
    let temporaryPassword: string | undefined;
    const passwordToUse =
      dto.owner_password && dto.owner_password.trim().length > 0
        ? dto.owner_password.trim()
        : (temporaryPassword = this.generateTemporaryPassword());

    // BR-ADMIN-16: hash password
    const passwordHash = await hashPassword(passwordToUse);

    // BR-ADMIN-11: merchant code
    const merchantCode = this.generateMerchantCode(dto.merchant_name.trim());
    const now = new Date();

    // BR-ADMIN-14: transaction atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      const merchant = await tx.merchant.create({
        data: { name: dto.merchant_name.trim(), code: merchantCode, status: 'active' },
      });
      const user = await tx.user.create({
        data: {
          merchant_id: merchant.id,
          email: email || null,
          phone: phone || null,
          full_name: dto.owner_full_name.trim(),
          password_hash: passwordHash,
          role: RoleEnum.OWNER,
          status: 'active',
          email_verified_at: email ? now : null,
          phone_verified_at: phone ? now : null,
          terms_accepted_at: now,
          terms_version: '2026.1',
          created_by: 'platform_admin',
          activated_at: now,
          created_by_ip: clientIp,
        },
      });
      return { merchant, user };
    });

    // BR-ADMIN-17: audit log
    await this.logAudit({
      merchantId: result.merchant.id,
      userId: result.user.id,
      actor: 'platform_admin',
      action: 'ADMIN_CREATE_SHOP',
      resource: `Merchant:${result.merchant.id}`,
      details: {
        merchant_name: result.merchant.name,
        merchant_code: result.merchant.code,
        owner_email: email || null,
        owner_phone: phone || null,
        correlation_id: correlationId,
      },
      ipAddress: clientIp,
      correlationId,
    });

    return {
      data: {
        merchant: {
          id: result.merchant.id,
          name: result.merchant.name,
          code: result.merchant.code,
          status: result.merchant.status,
          created_at: result.merchant.created_at.toISOString(),
        },
        user: {
          id: result.user.id,
          full_name: result.user.full_name,
          email: result.user.email,
          phone: result.user.phone,
          role: result.user.role,
          status: result.user.status,
        },
        ...(temporaryPassword ? { temporary_password: temporaryPassword } : {}),
      },
    };
  }

  async listShops(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [merchants, total] = await Promise.all([
      this.prisma.merchant.findMany({
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          users: {
            where: { role: RoleEnum.OWNER },
            take: 1,
            select: { id: true, full_name: true, email: true, phone: true, status: true },
          },
        },
      }),
      this.prisma.merchant.count(),
    ]);

    const data = merchants.map((m) => ({
      id: m.id,
      name: m.name,
      code: m.code,
      status: m.status,
      created_at: m.created_at.toISOString(),
      owner: m.users[0]
        ? {
            id: m.users[0].id,
            full_name: m.users[0].full_name,
            email: m.users[0].email,
            phone: m.users[0].phone,
            status: m.users[0].status,
          }
        : { id: '', full_name: '', email: null, phone: null, status: 'unknown' },
    }));

    return { data, meta: { total, page, limit } };
  }

  private generateTemporaryPassword(): string {
    return randomBytes(12).toString('base64url').substring(0, 16);
  }

  private generateMerchantCode(merchantName: string): string {
    const slug = merchantName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toUpperCase()
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 20);
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${slug || 'SHOP'}_${rand}`;
  }

  private async logAudit(meta: {
    merchantId?: string;
    userId?: string;
    actor: string;
    action: string;
    resource: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    correlationId?: string;
  }): Promise<void> {
    console.log(
      formatStructuredLog({
        level: 'info',
        service: 'api',
        message: `AUDIT: ${meta.action} on ${meta.resource} by ${meta.actor}`,
        metadata: { ...meta, timestamp: new Date().toISOString() },
      })
    );
    if (meta.merchantId) {
      try {
        await this.prisma.auditLog.create({
          data: {
            merchant_id: meta.merchantId,
            user_id: meta.userId || null,
            action: meta.action,
            entity_type: meta.resource.split(':')[0] || 'Admin',
            entity_id: meta.resource.split(':')[1] || meta.userId || 'system',
            new_value: meta.details ? JSON.parse(JSON.stringify(meta.details)) : null,
            ip_address: meta.ipAddress || null,
          },
        });
      } catch (err) {
        console.error('Failed to persist audit log:', err);
      }
    }
  }
}
