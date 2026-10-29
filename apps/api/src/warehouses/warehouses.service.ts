import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  FormattedWarehouse,
  validateCreateWarehouseDto,
  validateUpdateWarehouseDto,
} from './warehouses.dto';
import { maskIdentifier } from '../invitations/invitations.service';
import { WarehouseAuditEvent } from '@shipde/contracts';

export const SENSITIVE_WAREHOUSE_AUDIT_FIELDS = new Set([
  'contact_phone',
  'contact_email',
  'return_contact_phone',
]);

export function maskWarehouseAuditValue(field: string, val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string' && SENSITIVE_WAREHOUSE_AUDIT_FIELDS.has(field)) {
    return maskIdentifier(val);
  }
  return val;
}

@Injectable()
export class WarehousesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private hashIp(ip: string): string {
    return createHash('sha256')
      .update(ip || '127.0.0.1')
      .digest('hex')
      .substring(0, 16);
  }

  public formatWarehouse(w: any): FormattedWarehouse {
    return {
      id: w.id,
      merchant_id: w.merchant_id,
      name: w.name,
      code: w.code,
      status: w.status,
      is_default: w.is_default,
      contact_name: w.contact_name,
      contact_phone: w.contact_phone,
      contact_email: w.contact_email ?? null,
      address_line: w.address_line,
      ward: w.ward ?? null,
      district: w.district,
      city: w.city,
      postal_code: w.postal_code ?? null,
      address_json: (w.address_json as Record<string, unknown>) || {},
      use_different_return_address: w.use_different_return_address,
      return_contact_name: w.return_contact_name ?? null,
      return_contact_phone: w.return_contact_phone ?? null,
      return_address_line: w.return_address_line ?? null,
      return_ward: w.return_ward ?? null,
      return_district: w.return_district ?? null,
      return_city: w.return_city ?? null,
      return_address_json: (w.return_address_json as Record<string, unknown>) ?? null,
      operating_hours: (w.operating_hours as Record<string, unknown>) ?? null,
      cutoff_time: w.cutoff_time ?? null,
      schedule_notes: w.schedule_notes ?? null,
      contacts_json: (w.contacts_json as Record<string, unknown> | unknown[]) ?? null,
      printer_paper_size: w.printer_paper_size || 'A6',
      printer_dpi: w.printer_dpi || 203,
      printer_name: w.printer_name ?? null,
      printer_auto_print: w.printer_auto_print ?? false,
      printer_config: (w.printer_config as Record<string, unknown>) ?? null,
      created_at: w.created_at instanceof Date ? w.created_at.toISOString() : w.created_at,
      updated_at: w.updated_at instanceof Date ? w.updated_at.toISOString() : w.updated_at,
    };
  }

  /**
   * Fetches the actor's live warehouse scopes from the database
   */
  public async getActorWarehouseScopes(actor: ActorContext): Promise<string[]> {
    if (actor.role === 'OWNER') {
      return ['*'];
    }
    if (!actor.userId) {
      return [];
    }
    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { role: true, warehouse_scopes: true },
    });
    if (user?.role === 'OWNER') {
      return ['*'];
    }
    return user?.warehouse_scopes || [];
  }

  /**
   * Evaluates if the actor is permitted to access a specific warehouse
   */
  public hasWarehouseAccess(scopes: string[], warehouse: { id: string; code: string }): boolean {
    if (scopes.includes('*')) {
      return true;
    }
    return scopes.includes(warehouse.id) || scopes.includes(warehouse.code);
  }

  /**
   * List authorized warehouses for merchant (AC-WH-01-01, AC-WH-01-02)
   */
  async listWarehouses(
    merchantId: string,
    actor: ActorContext,
    hasConfigPermission: boolean,
    correlationId: string
  ) {
    const isOwner = actor.role === 'OWNER';
    const scopes = await this.getActorWarehouseScopes(actor);
    const hasUniversalAccess = isOwner || hasConfigPermission || scopes.includes('*');

    let whereClause: any = {
      merchant_id: merchantId,
    };

    if (!hasUniversalAccess) {
      if (scopes.length === 0) {
        return {
          success: true,
          data: [],
          meta: { correlation_id: correlationId, total: 0 },
        };
      }
      whereClause = {
        merchant_id: merchantId,
        OR: [{ id: { in: scopes } }, { code: { in: scopes } }],
      };
    }

    const warehouses = await this.prisma.warehouse.findMany({
      where: whereClause,
      orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
    });

    const formatted = warehouses.map((w) => this.formatWarehouse(w));
    return {
      success: true,
      data: formatted,
      meta: {
        correlation_id: correlationId,
        total: formatted.length,
      },
    };
  }

  /**
   * Get warehouse by ID with scope and tenant boundary check (AC-WH-01-03..05)
   */
  async getWarehouseById(
    id: string,
    merchantId: string,
    actor: ActorContext,
    hasConfigPermission: boolean,
    correlationId: string
  ) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id,
        merchant_id: merchantId,
      },
    });

    if (!warehouse) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'WAREHOUSE_NOT_FOUND',
        'Kho hàng không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }

    const isOwner = actor.role === 'OWNER';
    const scopes = await this.getActorWarehouseScopes(actor);
    const hasUniversalAccess = isOwner || hasConfigPermission || scopes.includes('*');

    if (!hasUniversalAccess && !this.hasWarehouseAccess(scopes, warehouse)) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'WAREHOUSE_SCOPE_UNAUTHORIZED',
        'Người dùng không có quyền truy cập kho hàng được yêu cầu',
        false
      );
    }

    return {
      success: true,
      data: this.formatWarehouse(warehouse),
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * Create a new warehouse (AC-WH-01-06..11)
   */
  async createWarehouse(
    dto: CreateWarehouseDto,
    merchantId: string,
    actor: ActorContext,
    correlationId: string,
    clientIp: string
  ) {
    const fieldErrors = validateCreateWarehouseDto(dto);
    if (fieldErrors.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Thông tin kho hàng không hợp lệ',
        false,
        undefined,
        fieldErrors
      );
    }

    // Generate or normalize code
    let code = dto.code ? dto.code.trim().toUpperCase() : '';
    if (!code) {
      const slug = dto.name
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
        .substring(0, 10);
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      code = `WH-${slug || 'KHO'}-${randomSuffix}`;
    }

    // Check unique code in tenant
    const existingCode = await this.prisma.warehouse.findUnique({
      where: {
        merchant_id_code: {
          merchant_id: merchantId,
          code,
        },
      },
    });

    if (existingCode) {
      throw new CanonicalApiException(
        HttpStatus.CONFLICT,
        'WAREHOUSE_CODE_EXISTS',
        `Mã kho hàng '${code}' đã tồn tại trong cửa hàng`,
        false,
        undefined,
        [{ field: 'code', code: 'DUPLICATE', message: `Mã kho hàng '${code}' đã tồn tại` }]
      );
    }

    // Check if this is the first warehouse for this merchant
    const existingCount = await this.prisma.warehouse.count({
      where: { merchant_id: merchantId },
    });

    const isFirst = existingCount === 0;
    const isDefault = isFirst ? true : Boolean(dto.is_default);

    const addressJson = {
      contact_name: dto.contact_name.trim(),
      contact_phone: dto.contact_phone.trim(),
      contact_email: dto.contact_email?.trim() || null,
      address_line: dto.address_line.trim(),
      ward: dto.ward?.trim() || null,
      district: dto.district.trim(),
      city: dto.city.trim(),
      postal_code: dto.postal_code?.trim() || null,
    };

    const useDiffReturn = Boolean(dto.use_different_return_address);
    const returnAddressJson = useDiffReturn
      ? {
          return_contact_name: dto.return_contact_name?.trim() || null,
          return_contact_phone: dto.return_contact_phone?.trim() || null,
          return_address_line: dto.return_address_line?.trim() || null,
          return_ward: dto.return_ward?.trim() || null,
          return_district: dto.return_district?.trim() || null,
          return_city: dto.return_city?.trim() || null,
        }
      : null;

    const created = await this.prisma.$transaction(async (tx) => {
      if (isDefault && existingCount > 0) {
        await tx.warehouse.updateMany({
          where: { merchant_id: merchantId, is_default: true },
          data: { is_default: false },
        });
      }

      const record = await tx.warehouse.create({
        data: {
          merchant_id: merchantId,
          name: dto.name.trim(),
          code,
          status: 'active',
          is_default: isDefault,
          contact_name: dto.contact_name.trim(),
          contact_phone: dto.contact_phone.trim(),
          contact_email: dto.contact_email?.trim() || null,
          address_line: dto.address_line.trim(),
          ward: dto.ward?.trim() || null,
          district: dto.district.trim(),
          city: dto.city.trim(),
          postal_code: dto.postal_code?.trim() || null,
          address_json: addressJson as unknown as Prisma.InputJsonValue,
          use_different_return_address: useDiffReturn,
          return_contact_name: useDiffReturn ? dto.return_contact_name?.trim() || null : null,
          return_contact_phone: useDiffReturn ? dto.return_contact_phone?.trim() || null : null,
          return_address_line: useDiffReturn ? dto.return_address_line?.trim() || null : null,
          return_ward: useDiffReturn ? dto.return_ward?.trim() || null : null,
          return_district: useDiffReturn ? dto.return_district?.trim() || null : null,
          return_city: useDiffReturn ? dto.return_city?.trim() || null : null,
          return_address_json: returnAddressJson
            ? (returnAddressJson as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          operating_hours: dto.operating_hours
            ? (dto.operating_hours as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          cutoff_time: dto.cutoff_time?.trim() || null,
          schedule_notes: dto.schedule_notes?.trim() || null,
          contacts_json: dto.contacts_json
            ? (dto.contacts_json as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          printer_paper_size: dto.printer_paper_size || 'A6',
          printer_dpi: dto.printer_dpi || 203,
          printer_name: dto.printer_name?.trim() || null,
          printer_auto_print: dto.printer_auto_print ?? false,
          printer_config: dto.printer_config
            ? (dto.printer_config as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });

      // Audit trail
      const auditPayload: Record<string, unknown> = {
        name: record.name,
        code: record.code,
        status: record.status,
        is_default: record.is_default,
        contact_name: record.contact_name,
        contact_phone: maskWarehouseAuditValue('contact_phone', record.contact_phone),
        contact_email: maskWarehouseAuditValue('contact_email', record.contact_email),
        address_line: record.address_line,
        district: record.district,
        city: record.city,
      };

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: WarehouseAuditEvent.WAREHOUSE_CREATED,
          entity_type: 'warehouse',
          entity_id: record.id,
          old_value: Prisma.JsonNull,
          new_value: auditPayload as unknown as Prisma.InputJsonValue,
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return record;
    });

    return {
      success: true,
      data: this.formatWarehouse(created),
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * Update warehouse by ID (AC-WH-01-12)
   */
  async updateWarehouse(
    id: string,
    dto: UpdateWarehouseDto,
    merchantId: string,
    actor: ActorContext,
    correlationId: string,
    clientIp: string
  ) {
    const fieldErrors = validateUpdateWarehouseDto(dto);
    if (fieldErrors.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Thông tin cập nhật kho hàng không hợp lệ',
        false,
        undefined,
        fieldErrors
      );
    }

    const existing = await this.prisma.warehouse.findFirst({
      where: { id, merchant_id: merchantId },
    });

    if (!existing) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'WAREHOUSE_NOT_FOUND',
        'Kho hàng không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }

    // Code collision check
    let codeToUpdate: string | undefined = undefined;
    if (dto.code !== undefined && dto.code !== null) {
      const trimmedCode = dto.code.trim().toUpperCase();
      if (trimmedCode !== existing.code) {
        const duplicate = await this.prisma.warehouse.findUnique({
          where: {
            merchant_id_code: {
              merchant_id: merchantId,
              code: trimmedCode,
            },
          },
        });
        if (duplicate && duplicate.id !== id) {
          throw new CanonicalApiException(
            HttpStatus.CONFLICT,
            'WAREHOUSE_CODE_EXISTS',
            `Mã kho hàng '${trimmedCode}' đã tồn tại trong cửa hàng`,
            false,
            undefined,
            [
              {
                field: 'code',
                code: 'DUPLICATE',
                message: `Mã kho hàng '${trimmedCode}' đã tồn tại`,
              },
            ]
          );
        }
        codeToUpdate = trimmedCode;
      }
    }

    const dataToUpdate: any = {};
    if (dto.name !== undefined) dataToUpdate.name = dto.name.trim();
    if (codeToUpdate !== undefined) dataToUpdate.code = codeToUpdate;
    if (dto.status !== undefined) dataToUpdate.status = dto.status;
    if (dto.is_default !== undefined) dataToUpdate.is_default = dto.is_default;
    if (dto.contact_name !== undefined) dataToUpdate.contact_name = dto.contact_name.trim();
    if (dto.contact_phone !== undefined) dataToUpdate.contact_phone = dto.contact_phone.trim();
    if (dto.contact_email !== undefined)
      dataToUpdate.contact_email = dto.contact_email ? dto.contact_email.trim() : null;
    if (dto.address_line !== undefined) dataToUpdate.address_line = dto.address_line.trim();
    if (dto.ward !== undefined) dataToUpdate.ward = dto.ward ? dto.ward.trim() : null;
    if (dto.district !== undefined) dataToUpdate.district = dto.district.trim();
    if (dto.city !== undefined) dataToUpdate.city = dto.city.trim();
    if (dto.postal_code !== undefined)
      dataToUpdate.postal_code = dto.postal_code ? dto.postal_code.trim() : null;

    if (dto.use_different_return_address !== undefined) {
      dataToUpdate.use_different_return_address = dto.use_different_return_address;
    }
    if (dto.return_contact_name !== undefined) {
      dataToUpdate.return_contact_name = dto.return_contact_name
        ? dto.return_contact_name.trim()
        : null;
    }
    if (dto.return_contact_phone !== undefined) {
      dataToUpdate.return_contact_phone = dto.return_contact_phone
        ? dto.return_contact_phone.trim()
        : null;
    }
    if (dto.return_address_line !== undefined) {
      dataToUpdate.return_address_line = dto.return_address_line
        ? dto.return_address_line.trim()
        : null;
    }
    if (dto.return_ward !== undefined) {
      dataToUpdate.return_ward = dto.return_ward ? dto.return_ward.trim() : null;
    }
    if (dto.return_district !== undefined) {
      dataToUpdate.return_district = dto.return_district ? dto.return_district.trim() : null;
    }
    if (dto.return_city !== undefined) {
      dataToUpdate.return_city = dto.return_city ? dto.return_city.trim() : null;
    }

    if (dto.operating_hours !== undefined) {
      dataToUpdate.operating_hours = dto.operating_hours
        ? (dto.operating_hours as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }
    if (dto.cutoff_time !== undefined)
      dataToUpdate.cutoff_time = dto.cutoff_time ? dto.cutoff_time.trim() : null;
    if (dto.schedule_notes !== undefined)
      dataToUpdate.schedule_notes = dto.schedule_notes ? dto.schedule_notes.trim() : null;
    if (dto.contacts_json !== undefined) {
      dataToUpdate.contacts_json = dto.contacts_json
        ? (dto.contacts_json as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }
    if (dto.printer_paper_size !== undefined)
      dataToUpdate.printer_paper_size = dto.printer_paper_size;
    if (dto.printer_dpi !== undefined) dataToUpdate.printer_dpi = dto.printer_dpi;
    if (dto.printer_name !== undefined)
      dataToUpdate.printer_name = dto.printer_name ? dto.printer_name.trim() : null;
    if (dto.printer_auto_print !== undefined)
      dataToUpdate.printer_auto_print = dto.printer_auto_print;
    if (dto.printer_config !== undefined) {
      dataToUpdate.printer_config = dto.printer_config
        ? (dto.printer_config as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }

    // Refresh address_json
    const updatedContactName = dataToUpdate.contact_name ?? existing.contact_name;
    const updatedContactPhone = dataToUpdate.contact_phone ?? existing.contact_phone;
    const updatedContactEmail =
      dataToUpdate.contact_email !== undefined
        ? dataToUpdate.contact_email
        : existing.contact_email;
    const updatedAddressLine = dataToUpdate.address_line ?? existing.address_line;
    const updatedWard = dataToUpdate.ward !== undefined ? dataToUpdate.ward : existing.ward;
    const updatedDistrict = dataToUpdate.district ?? existing.district;
    const updatedCity = dataToUpdate.city ?? existing.city;
    const updatedPostalCode =
      dataToUpdate.postal_code !== undefined ? dataToUpdate.postal_code : existing.postal_code;

    dataToUpdate.address_json = {
      contact_name: updatedContactName,
      contact_phone: updatedContactPhone,
      contact_email: updatedContactEmail,
      address_line: updatedAddressLine,
      ward: updatedWard,
      district: updatedDistrict,
      city: updatedCity,
      postal_code: updatedPostalCode,
    } as unknown as Prisma.InputJsonValue;

    const isDifferentReturn =
      dataToUpdate.use_different_return_address ?? existing.use_different_return_address;
    if (isDifferentReturn) {
      dataToUpdate.return_address_json = {
        return_contact_name: dataToUpdate.return_contact_name ?? existing.return_contact_name,
        return_contact_phone: dataToUpdate.return_contact_phone ?? existing.return_contact_phone,
        return_address_line: dataToUpdate.return_address_line ?? existing.return_address_line,
        return_ward: dataToUpdate.return_ward ?? existing.return_ward,
        return_district: dataToUpdate.return_district ?? existing.return_district,
        return_city: dataToUpdate.return_city ?? existing.return_city,
      } as unknown as Prisma.InputJsonValue;
    } else if (dto.use_different_return_address === false) {
      dataToUpdate.return_address_json = Prisma.JsonNull;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dataToUpdate.is_default === true) {
        await tx.warehouse.updateMany({
          where: { merchant_id: merchantId, is_default: true, id: { not: id } },
          data: { is_default: false },
        });
      }

      const result = await tx.warehouse.update({
        where: { id },
        data: dataToUpdate,
      });

      // Build before/after diff for audit
      const updatedFields = Object.keys(dataToUpdate);
      const beforeDiff: Record<string, any> = {};
      const afterDiff: Record<string, any> = {};

      for (const field of updatedFields) {
        beforeDiff[field] = maskWarehouseAuditValue(field, (existing as any)[field]);
        afterDiff[field] = maskWarehouseAuditValue(field, (result as any)[field]);
      }

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: WarehouseAuditEvent.WAREHOUSE_UPDATED,
          entity_type: 'warehouse',
          entity_id: id,
          old_value: beforeDiff as unknown as Prisma.InputJsonValue,
          new_value: afterDiff as unknown as Prisma.InputJsonValue,
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return result;
    });

    return {
      success: true,
      data: this.formatWarehouse(updated),
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * Set warehouse as default pickup warehouse (AC-WH-01-13)
   */
  async setDefaultWarehouse(
    id: string,
    merchantId: string,
    actor: ActorContext,
    correlationId: string,
    clientIp: string
  ) {
    const existing = await this.prisma.warehouse.findFirst({
      where: { id, merchant_id: merchantId },
    });

    if (!existing) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'WAREHOUSE_NOT_FOUND',
        'Kho hàng không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Unset previous defaults
      await tx.warehouse.updateMany({
        where: { merchant_id: merchantId, is_default: true, id: { not: id } },
        data: { is_default: false },
      });

      const res = await tx.warehouse.update({
        where: { id },
        data: { is_default: true },
      });

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: WarehouseAuditEvent.WAREHOUSE_SET_DEFAULT,
          entity_type: 'warehouse',
          entity_id: id,
          old_value: { is_default: existing.is_default } as unknown as Prisma.InputJsonValue,
          new_value: { is_default: true } as unknown as Prisma.InputJsonValue,
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return res;
    });

    return {
      success: true,
      data: this.formatWarehouse(updated),
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * Deactivate warehouse (soft-delete) (AC-WH-01-14)
   */
  async deactivateWarehouse(
    id: string,
    merchantId: string,
    actor: ActorContext,
    correlationId: string,
    clientIp: string
  ) {
    const existing = await this.prisma.warehouse.findFirst({
      where: { id, merchant_id: merchantId },
    });

    if (!existing) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'WAREHOUSE_NOT_FOUND',
        'Kho hàng không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.warehouse.update({
        where: { id },
        data: { status: 'inactive' },
      });

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: WarehouseAuditEvent.WAREHOUSE_DEACTIVATED,
          entity_type: 'warehouse',
          entity_id: id,
          old_value: { status: existing.status } as unknown as Prisma.InputJsonValue,
          new_value: { status: 'inactive' } as unknown as Prisma.InputJsonValue,
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return res;
    });

    return {
      success: true,
      data: this.formatWarehouse(updated),
      meta: { correlation_id: correlationId },
    };
  }
}
