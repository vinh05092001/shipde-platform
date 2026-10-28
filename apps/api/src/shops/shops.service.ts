import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';
import {
  UpdateShopProfileDto,
  FormattedShopProfile,
  validateUpdateShopProfileDto,
} from './shops.dto';
import { maskIdentifier } from '../invitations/invitations.service';

export const SENSITIVE_AUDIT_FIELDS = new Set([
  'bank_account_number',
  'bank_account_name',
  'contact_phone',
  'contact_email',
  'billing_email',
]);

export function maskAuditValue(field: string, val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string' && SENSITIVE_AUDIT_FIELDS.has(field)) {
    return maskIdentifier(val);
  }
  return val;
}

@Injectable()
export class ShopsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private hashIp(ip: string): string {
    return createHash('sha256')
      .update(ip || '127.0.0.1')
      .digest('hex')
      .substring(0, 16);
  }

  private formatProfile(merchant: any): FormattedShopProfile {
    return {
      id: merchant.id,
      name: merchant.name,
      code: merchant.code,
      status: merchant.status,
      legal_name: merchant.legal_name ?? null,
      tax_code: merchant.tax_code ?? null,
      contact_email: merchant.contact_email ?? null,
      contact_phone: merchant.contact_phone ?? null,
      legal_address: merchant.legal_address ?? null,
      billing_email: merchant.billing_email ?? null,
      billing_address: merchant.billing_address ?? null,
      bank_name: merchant.bank_name ?? null,
      bank_account_number: merchant.bank_account_number ?? null,
      bank_account_name: merchant.bank_account_name ?? null,
      bank_branch: merchant.bank_branch ?? null,
      timezone: merchant.timezone || 'Asia/Ho_Chi_Minh',
      currency: merchant.currency || 'VND',
      default_fee_payer: (merchant.default_fee_payer as 'SHOP' | 'RECIPIENT') || 'SHOP',
      default_weight_unit: (merchant.default_weight_unit as 'g' | 'kg') || 'g',
      auto_routing_enabled: Boolean(merchant.auto_routing_enabled),
      operating_notes: merchant.operating_notes ?? null,
      created_at: merchant.created_at
        ? new Date(merchant.created_at).toISOString()
        : new Date().toISOString(),
      updated_at: merchant.updated_at
        ? new Date(merchant.updated_at).toISOString()
        : new Date().toISOString(),
    };
  }

  /**
   * GET /api/v1/shops/profile (AC-ORG-01-01)
   * Retrieves current authenticated merchant's shop profile.
   */
  async getShopProfile(
    merchantId: string,
    correlationId: string
  ): Promise<{
    success: boolean;
    data: FormattedShopProfile;
    meta: { correlation_id: string };
  }> {
    if (!merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'SHOP_NOT_FOUND',
        'Không tìm thấy thông tin cửa hàng',
        false,
        'Cửa hàng không tồn tại hoặc đã bị xóa'
      );
    }

    return {
      success: true,
      data: this.formatProfile(merchant),
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * PATCH /api/v1/shops/profile (AC-ORG-01-02..08)
   * Updates current authenticated merchant's shop profile.
   */
  async updateShopProfile(
    merchantId: string,
    actor: ActorContext,
    dto: UpdateShopProfileDto,
    clientIp: string,
    correlationId: string
  ): Promise<{
    success: boolean;
    data: FormattedShopProfile;
    meta: { correlation_id: string };
  }> {
    if (!merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    // 1. Validation check
    const validationErrors = validateUpdateShopProfileDto(dto);
    if (validationErrors.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Dữ liệu hồ sơ shop không hợp lệ',
        false,
        'Vui lòng kiểm tra lại các trường thông tin bị lỗi',
        validationErrors
      );
    }

    // 2. Fetch existing merchant for before snapshot
    const existing = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!existing) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'SHOP_NOT_FOUND',
        'Không tìm thấy thông tin cửa hàng',
        false,
        'Cửa hàng không tồn tại hoặc đã bị xóa'
      );
    }

    // 3. Prepare update payload
    const dataToUpdate: any = {};
    if (dto.name !== undefined) dataToUpdate.name = dto.name.trim();
    if (dto.legal_name !== undefined)
      dataToUpdate.legal_name = dto.legal_name ? dto.legal_name.trim() : null;
    if (dto.tax_code !== undefined)
      dataToUpdate.tax_code = dto.tax_code ? dto.tax_code.trim() : null;
    if (dto.contact_email !== undefined)
      dataToUpdate.contact_email = dto.contact_email
        ? dto.contact_email.trim().toLowerCase()
        : null;
    if (dto.contact_phone !== undefined)
      dataToUpdate.contact_phone = dto.contact_phone ? dto.contact_phone.trim() : null;
    if (dto.legal_address !== undefined)
      dataToUpdate.legal_address = dto.legal_address ? dto.legal_address.trim() : null;
    if (dto.billing_email !== undefined)
      dataToUpdate.billing_email = dto.billing_email
        ? dto.billing_email.trim().toLowerCase()
        : null;
    if (dto.billing_address !== undefined)
      dataToUpdate.billing_address = dto.billing_address ? dto.billing_address.trim() : null;
    if (dto.bank_name !== undefined)
      dataToUpdate.bank_name = dto.bank_name ? dto.bank_name.trim() : null;
    if (dto.bank_account_number !== undefined)
      dataToUpdate.bank_account_number = dto.bank_account_number
        ? dto.bank_account_number.trim()
        : null;
    if (dto.bank_account_name !== undefined)
      dataToUpdate.bank_account_name = dto.bank_account_name
        ? dto.bank_account_name.trim().toUpperCase()
        : null;
    if (dto.bank_branch !== undefined)
      dataToUpdate.bank_branch = dto.bank_branch ? dto.bank_branch.trim() : null;
    if (dto.timezone !== undefined) dataToUpdate.timezone = dto.timezone.trim();
    if (dto.currency !== undefined) dataToUpdate.currency = dto.currency.trim();
    if (dto.default_fee_payer !== undefined) dataToUpdate.default_fee_payer = dto.default_fee_payer;
    if (dto.default_weight_unit !== undefined)
      dataToUpdate.default_weight_unit = dto.default_weight_unit;
    if (dto.auto_routing_enabled !== undefined)
      dataToUpdate.auto_routing_enabled = Boolean(dto.auto_routing_enabled);
    if (dto.operating_notes !== undefined)
      dataToUpdate.operating_notes = dto.operating_notes ? dto.operating_notes.trim() : null;

    // 4. Execute update & audit logging in transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.merchant.update({
        where: { id: merchantId },
        data: dataToUpdate,
      });

      // Build before/after change diff for audit
      const updatedFields = Object.keys(dataToUpdate);
      const beforeDiff: Record<string, any> = {};
      const afterDiff: Record<string, any> = {};

      for (const field of updatedFields) {
        beforeDiff[field] = maskAuditValue(field, (existing as any)[field]);
        afterDiff[field] = maskAuditValue(field, (result as any)[field]);
      }

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: 'SHOP_PROFILE_UPDATED',
          entity_type: 'merchant',
          entity_id: merchantId,
          old_value: beforeDiff,
          new_value: afterDiff,
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return result;
    });

    return {
      success: true,
      data: this.formatProfile(updated),
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * GET /api/v1/shops (AC-ORG-01-12)
   * Lists authorized shops in scope for the session.
   */
  async listShops(
    merchantId: string,
    correlationId: string
  ): Promise<{
    success: boolean;
    data: { shops: FormattedShopProfile[] };
    meta: { correlation_id: string };
  }> {
    const profile = await this.getShopProfile(merchantId, correlationId);
    return {
      success: true,
      data: {
        shops: [profile.data],
      },
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * GET /api/v1/shops/:id (AC-ORG-01-10)
   * Strictly scopes to caller's merchant. Cross-tenant access is rejected with 403 FORBIDDEN.
   */
  async getShopById(
    targetId: string,
    actor: ActorContext,
    correlationId: string
  ): Promise<{
    success: boolean;
    data: FormattedShopProfile;
    meta: { correlation_id: string };
  }> {
    if (targetId !== actor.merchantId && targetId !== 'profile' && targetId !== 'me') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền truy cập hồ sơ của shop khác',
        false,
        'Thao tác bị từ chối do vi phạm phạm vi gian hàng'
      );
    }

    return this.getShopProfile(actor.merchantId, correlationId);
  }

  /**
   * PATCH /api/v1/shops/:id (AC-ORG-01-10)
   * Strictly scopes to caller's merchant. Cross-tenant update is rejected with 403 FORBIDDEN.
   */
  async updateShopById(
    targetId: string,
    actor: ActorContext,
    dto: UpdateShopProfileDto,
    clientIp: string,
    correlationId: string
  ): Promise<{
    success: boolean;
    data: FormattedShopProfile;
    meta: { correlation_id: string };
  }> {
    if (targetId !== actor.merchantId && targetId !== 'profile' && targetId !== 'me') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền cập nhật hồ sơ của shop khác',
        false,
        'Thao tác bị từ chối do vi phạm phạm vi gian hàng'
      );
    }

    return this.updateShopProfile(actor.merchantId, actor, dto, clientIp, correlationId);
  }
}
