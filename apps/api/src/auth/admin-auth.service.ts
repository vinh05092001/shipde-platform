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
        message: '\u1ed0n c\u1eeda h\u00e0ng ph\u1ea3i c\u00f3 \u00edt nh\u1ea5t 2 k\u00fd t\u1ef1',
      });
    }

    // BR-ADMIN-02: Upper bound 255 characters
    if (dto.merchant_name && dto.merchant_name.trim().length > 255) {
      fields.push({
        field: 'merchant_name',
        code: 'MAX_LENGTH_EXCEEDED',
        message: 'T\u00ean c\u1eeda h\u00e0ng kh\u00f4ng \u0111\u01b0\u1ee3c v\u01b0\u1ee3t qu\u00e1 255 k\u00fd t\u1ef1',
      });
    }

    const email = dto.owner_email ? dto.owner_email.trim().toLowerCase() : undefined;
    const phone = dto.owner_phone ? dto.owner_phone.trim() : undefined;

    if (!email && !phone) {
      fields.push({
        field: 'owner_email',
        code: 'REQUIRED',
        message: 'Ph\u1ea3i cung c\u1ea5p \u00edt nh\u1ea5t email ho\u1eb7c s\u1ed1 \u0111i\u1ec7n tho\u1ea1i',
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fields.push({
        field: 'owner_email',
        code: 'INVALID_FORMAT',
        message: '\u0110\u1ecbnh d\u1ea1ng email kh\u00f4ng h\u1ee3p l\u1ec7',
      });
    }

    if (phone && !/^(0|\\+84)[3|5|7|8|9][0-9]{8}$/.test(phone.replace(/\s+/g, ''))) {
      fields.push({
        field: 'owner_phone',
        code: 'INVALID_FORMAT',
        message: 'S\u1ed1 \u0111i\u1ec7n tho\u1ea1i kh\u00f4ng h\u1ee3p l\u1ec7',
      });
    }

    if (!dto.owner_full_name || dto.owner_full_name.trim().length < 2) {
      fields.push({
        field: 'owner_full_name',
        code: 'REQUIRED',
        message: 'H\u1ecd v\u00e0 t\u00ean ph\u1ea3i c\u00f3 \u00edt nh\u1ea5t 2 k\u00fd t\u1ef1',
      });
    }

    if (dto.owner_password && dto.owner_password.length > 0 && dto.owner_password.length < 8) {
      fields.push({
        field: 'owner_password',
        code: 'INVALID_FORMAT',
        message: 'M\u1eadt kh\u1ea9u ph\u1ea3i c\u00f3 \u00edt nh\u1ea5t 8 k\u00fd t\u1ef1',
      });
    }

    if (fields.length > 0) {
      throw new CanonicalApiException(
        400,
        'VALIDATION_ERROR',
        'D\u1eef li\u1ec7u kh\u00f4ng h\u1ee3p l\u1ec7',
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
          'Email \u0111\u00e3 \u0111\u01b0\u1ee3c s\u1eed d\u1ee5ng',
          false,
          undefined,
          [
            {
              field: 'owner_email',
              code: 'DUPLICATE',
              message: 'Email \u0111\u00e3 \u0111\u01b0\u1ee3c s\u1eed d\u1ee5ng b\u1edfi t\u00e0i kho\u1ea3n \u0111ang ho\u1ea1t \u0111\u1ed9ng',
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
          'S\u1ed1 \u0111i\u1ec7n tho\u1ea1i \u0111\u00e3 \u0111\u01b0\u1ee3c s\u1eed d\u1ee5ng',
          false,
          undefined,
          [
            {
              field: 'owner_phone',
              code: 'DUPLICATE',
              message: 'S\u1ed1 \u0111i\u1ec7n tho\u1ea1i \u0111\u00e3 \u0111\u01b0\u1ee3c s\u1eed d\u1ee5ng b\u1edfi t\u00e0i kho\u1ea3n \u0111ang ho\u1ea1t \u0111\u1ed9ng',
            },
          ]
        );
      }
    }

    // Generate merchant code
    const code = this.generateMerchantCode(dto.merchant_name.trim());

    // Generate temporary password if not provided
    let temporaryPassword: string | undefined = undefined;
    if (!dto.owner_password) {
      temporaryPassword = this.generateTemporaryPassword();
    }

    // BR-ADMIN-20: Admin-created account immediately ACTIVE, no verification required
    // Hash password if provided or generated
    const hashedPassword = dto.owner_password
      ? await hashPassword(dto.owner_password)
      : await hashPassword(temporaryPassword!);

    // BR-ADMIN-08/09: Single transaction atomicity for merchant + user creation
    const result = await this.prisma.\(async (tx) => {
      // Create merchant
      const merchant = await tx.merchant.create({
        data: {
          name: dto.merchant_name.trim(),
          code,
          status: 'active',
          created_by_operator: true,
        },
      });

      // Create owner user
      const now = new Date();
      const user = await tx.user.create({
        data: {
          merchant_id: merchant.id,
          role: RoleEnum.OWNER,
          full_name: dto.owner_full_name.trim(),
          email,
          phone,
          password: hashedPassword,
          status: 'active',
          is_verified: true,
          email_verified_at: email ? now : null,
          phone_verified_at: phone ? now : null,
          created_at: now,
          last_login_at: now,
        },
      });

      return { merchant, user };
    });

    // BR-ADMIN-17: Audit log recorded
    await this.logAudit({
      merchantId: result.merchant.id,
      userId: result.user.id,
      actor: 'OPERATOR',
      action: 'ADMIN_CREATE_SHOP',
      resource: 'MERCHANT:' + result.merchant.id,
      details: {
        merchant_name: result.merchant.name,
        merchant_code: result.merchant.code,
        owner_full_name: result.user.full_name,
        owner_email: result.user.email,
        owner_phone: result.user.phone,
        ip_address: clientIp,
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
      .replace(/[\\u0300-\\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toUpperCase()
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 20);
    const rand = Math.floor(1000 + Math.random() * 9000);
    return ${slug || 'SHOP'}_\;
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
        message: AUDIT: \ on \ by \,
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
