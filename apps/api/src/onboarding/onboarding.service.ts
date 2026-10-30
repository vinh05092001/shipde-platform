import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';
import {
  OnboardingStepId,
  OnboardingStepStatus,
  OnboardingOverallStatus,
  OnboardingStepDto,
  OnboardingStateResponseDto,
  CompleteStepDto,
  ONBOARDING_STEPS_CATALOG,
  VALID_STEP_IDS,
  validateStepData,
  StepDefinition,
} from './onboarding.dto';
import { WarehousesService } from '../warehouses/warehouses.service';
import { maskIdentifier } from '../invitations/invitations.service';

export const SENSITIVE_ONBOARDING_FIELDS = new Set([
  'phone',
  'secret',
  'token',
  'apiKey',
  'password',
]);

export function maskAuditPayload(
  data: Record<string, any> | null | undefined
): Record<string, any> | null {
  if (!data || typeof data !== 'object') return null;
  const masked: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      masked[key] = value;
    } else if (typeof value === 'string' && SENSITIVE_ONBOARDING_FIELDS.has(key)) {
      masked[key] = maskIdentifier(value);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskAuditPayload(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

@Injectable()
export class OnboardingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // All progress readers/writers take the same tenant row lock. Warehouse writes
  // and audits join this transaction rather than committing independently.
  private async lockState(tx: Prisma.TransactionClient, merchantId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM onboarding_states WHERE merchant_id = ${merchantId}::uuid FOR UPDATE`;
  }

  private warehouseService(tx: Prisma.TransactionClient): WarehousesService {
    return new WarehousesService({
      user: tx.user,
      warehouse: tx.warehouse,
      $transaction: async <T>(fn: (client: Prisma.TransactionClient) => Promise<T>) => fn(tx),
    } as unknown as PrismaService);
  }

  private hashIp(ip: string): string {
    return createHash('sha256')
      .update(ip || '127.0.0.1')
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Find or initialize the onboarding state for a tenant
   */
  async getOrCreateState(
    merchantId: string,
    correlationId?: string,
    clientIp?: string
  ): Promise<any> {
    if (!merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    let state = await this.prisma.onboardingState.findUnique({
      where: { merchant_id: merchantId },
    });

    if (!state) {
      try {
        state = await this.prisma.onboardingState.create({
          data: {
            merchant_id: merchantId,
            status: OnboardingOverallStatus.IN_PROGRESS,
            current_step: OnboardingStepId.SHOP_PROFILE,
            completed_steps: [],
            skipped_steps: [],
          },
        });

        if (correlationId) {
          await this.prisma.auditLog.create({
            data: {
              merchant_id: merchantId,
              user_id: null,
              actor: 'SYSTEM',
              action: 'ONBOARDING_INITIALIZED',
              entity_type: 'onboarding',
              entity_id: state.id,
              reason: `correlation_id:${correlationId}`,
              ip_address: clientIp ? this.hashIp(clientIp) : null,
            },
          });
        }
      } catch (err: any) {
        if (err?.code === 'P2002') {
          state = await this.prisma.onboardingState.findUnique({
            where: { merchant_id: merchantId },
          });
        } else {
          throw err;
        }
      }
    }

    return state;
  }

  /**
   * Evaluate live aggregate completeness from database records
   */
  private async evaluateLiveCompleteness(
    merchantId: string,
    state: any,
    db: Prisma.TransactionClient = this.prisma
  ): Promise<Set<string>> {
    const satisfied = new Set<string>(state?.completed_steps || []);
    const skippedSet = new Set<string>(state?.skipped_steps || []);

    const sinceReset = state.reset_at ? { created_at: { gt: state.reset_at } } : {};
    const merchant = await db.merchant.findUnique({
      where: { id: merchantId },
      include: {
        carrier_accounts: { where: sinceReset, select: { id: true }, take: 1 },
        warehouses: { where: sinceReset, select: { id: true }, take: 1 },
        users: { where: sinceReset, select: { id: true }, take: 2 },
        invitations: { where: sinceReset, select: { id: true }, take: 1 },
        orders: { where: sinceReset, select: { id: true }, take: 1 },
        shipments: { where: sinceReset, select: { id: true }, take: 1 },
      },
    });

    if (merchant) {
      // Step 1: SHOP_PROFILE is satisfied if merchant has legal_name and tax_code configured
      if (
        merchant.legal_name &&
        merchant.tax_code &&
        (!state.reset_at || merchant.updated_at > state.reset_at)
      ) {
        satisfied.add(OnboardingStepId.SHOP_PROFILE);
      }

      // Step 2: WAREHOUSE requires a persisted warehouse outcome
      const stepData = (state?.step_data as Record<string, any>) || {};
      if (merchant.warehouses && merchant.warehouses.length > 0) {
        satisfied.add(OnboardingStepId.WAREHOUSE);
      }

      // Step 3: INVITE_USERS is satisfied if >1 users exist or invitations exist, unless skipped
      if (!skippedSet.has(OnboardingStepId.INVITE_USERS)) {
        if (merchant.users.length > 1 || merchant.invitations.length > 0) {
          satisfied.add(OnboardingStepId.INVITE_USERS);
        }
      }

      // Step 4: CARRIER_ACCOUNT is satisfied if at least 1 carrier account is connected
      if (merchant.carrier_accounts.length > 0) {
        satisfied.add(OnboardingStepId.CARRIER_ACCOUNT);
      }

      // Step 5: OPERATING_DEFAULTS satisfied if operating_notes or defaults configured or step_data stored, unless skipped
      if (!skippedSet.has(OnboardingStepId.OPERATING_DEFAULTS)) {
        if (
          stepData.operating_defaults ||
          (merchant.operating_notes && (!state.reset_at || merchant.updated_at > state.reset_at))
        ) {
          satisfied.add(OnboardingStepId.OPERATING_DEFAULTS);
        }
      }

      // Step 6: TEST_ORDER satisfied if order or shipment exists
      if (merchant.orders.length > 0 || merchant.shipments.length > 0) {
        satisfied.add(OnboardingStepId.TEST_ORDER);
      }
    }

    return satisfied;
  }

  /**
   * Build complete OnboardingStateResponseDto
   */
  private buildResponse(
    state: any,
    liveSatisfied: Set<string>,
    canEdit: boolean = true
  ): OnboardingStateResponseDto {
    const skippedSet = new Set<string>(state.skipped_steps || []);
    const stepData = (state.step_data as Record<string, any>) || {};

    const stepsDto: OnboardingStepDto[] = [];
    let completedRequiredCount = 0;
    const requiredSteps = ONBOARDING_STEPS_CATALOG.filter((s) => s.required);
    const totalRequiredSteps = requiredSteps.length;

    let computedCurrentStep: OnboardingStepId = OnboardingStepId.SHOP_PROFILE;
    let foundCurrent = false;

    for (const stepDef of ONBOARDING_STEPS_CATALOG) {
      const isCompleted = liveSatisfied.has(stepDef.id);
      const isSkipped = skippedSet.has(stepDef.id);

      if (stepDef.required && isCompleted) {
        completedRequiredCount++;
      }

      // Evaluate prerequisites
      const blockingReasons: string[] = [];
      let isBlocking = false;

      for (const prereqId of stepDef.prerequisites) {
        if (!liveSatisfied.has(prereqId)) {
          isBlocking = true;
          const prereqDef = ONBOARDING_STEPS_CATALOG.find((s) => s.id === prereqId);
          blockingReasons.push(
            `Cần hoàn thành bước "${prereqDef?.title || prereqId}" trước khi thực hiện bước này`
          );
        }
      }

      let status: OnboardingStepStatus = OnboardingStepStatus.PENDING;
      if (isCompleted) {
        status = OnboardingStepStatus.COMPLETED;
      } else if (isSkipped && !stepDef.required) {
        status = OnboardingStepStatus.SKIPPED;
      } else if (isBlocking) {
        status = OnboardingStepStatus.BLOCKED;
      } else {
        if (!foundCurrent) {
          computedCurrentStep = stepDef.id;
          status = OnboardingStepStatus.IN_PROGRESS;
          foundCurrent = true;
        } else {
          status = OnboardingStepStatus.PENDING;
        }
      }

      stepsDto.push({
        id: stepDef.id,
        order: stepDef.order,
        title: stepDef.title,
        description: stepDef.description,
        required: stepDef.required,
        status,
        is_blocking: isBlocking,
        blocking_reasons: blockingReasons,
        completed_at: isCompleted
          ? state.completed_at
            ? new Date(state.completed_at).toISOString()
            : new Date().toISOString()
          : null,
        data: stepData[stepDef.id.toLowerCase()] ?? null,
      });
    }

    const progressPercentage = Math.round((completedRequiredCount / totalRequiredSteps) * 100);

    let overallStatus: OnboardingOverallStatus = state.status as OnboardingOverallStatus;
    if (state.status !== OnboardingOverallStatus.DISMISSED) {
      if (completedRequiredCount === totalRequiredSteps) {
        overallStatus = OnboardingOverallStatus.COMPLETED;
      } else {
        overallStatus = OnboardingOverallStatus.IN_PROGRESS;
      }
    }

    return {
      merchant_id: state.merchant_id,
      status: overallStatus,
      current_step: computedCurrentStep,
      progress_percentage: progressPercentage,
      completed_count: liveSatisfied.size,
      total_required_steps: totalRequiredSteps,
      completed_required_steps: completedRequiredCount,
      steps: stepsDto,
      completed_at: state.completed_at ? new Date(state.completed_at).toISOString() : null,
      updated_at: new Date(state.updated_at || Date.now()).toISOString(),
      can_edit: canEdit,
    };
  }

  /**
   * GET /api/v1/onboarding (AC-ONB-01-01, AC-ONB-01-15)
   */
  async getOnboardingState(
    merchantId: string,
    correlationId?: string,
    clientIp?: string,
    canEdit: boolean = true
  ): Promise<{
    success: boolean;
    data: OnboardingStateResponseDto;
    meta: { correlation_id?: string };
  }> {
    await this.getOrCreateState(merchantId, correlationId, clientIp);
    const responseDto = await this.prisma.$transaction(async (tx) => {
      await this.lockState(tx, merchantId);
      const current = await tx.onboardingState.findUniqueOrThrow({
        where: { merchant_id: merchantId },
      });
      const liveSatisfied = await this.evaluateLiveCompleteness(merchantId, current, tx);
      const response = this.buildResponse(current, liveSatisfied, canEdit);
      if (
        response.status === OnboardingOverallStatus.COMPLETED &&
        current.status === OnboardingOverallStatus.IN_PROGRESS
      ) {
        const updated = await tx.onboardingState.update({
          where: { merchant_id: merchantId },
          data: { status: OnboardingOverallStatus.COMPLETED, completed_at: new Date() },
        });
        return this.buildResponse(updated, liveSatisfied, canEdit);
      }
      return response;
    });

    return {
      success: true,
      data: responseDto,
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * POST /api/v1/onboarding/steps/:stepId/complete (AC-ONB-01-02..04, AC-ONB-01-07, AC-ONB-01-14)
   */
  async completeStep(
    merchantId: string,
    stepId: string,
    dto: CompleteStepDto,
    actor: ActorContext,
    correlationId: string,
    clientIp: string
  ): Promise<{
    success: boolean;
    data: OnboardingStateResponseDto;
    meta: { correlation_id: string };
  }> {
    if (!merchantId || actor.merchantId !== merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    if (!VALID_STEP_IDS.includes(stepId)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'STEP_NOT_FOUND',
        `Bước thiết lập "${stepId}" không tồn tại`,
        false,
        'Vui lòng chọn bước hợp lệ trong danh mục quy trình'
      );
    }

    const stepDef = ONBOARDING_STEPS_CATALOG.find((s) => s.id === stepId)!;

    // Validate step data payload
    const validationErrors = validateStepData(stepDef.id, dto?.data);
    if (validationErrors.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Dữ liệu bước thiết lập không hợp lệ',
        false,
        'Vui lòng kiểm tra lại các trường thông tin bị lỗi',
        validationErrors
      );
    }

    await this.getOrCreateState(merchantId, correlationId, clientIp);
    // Normalize warehouse payload if nested
    const normalizedData =
      dto?.data && dto.data.warehouse && typeof dto.data.warehouse === 'object'
        ? (dto.data.warehouse as Record<string, any>)
        : dto?.data;

    const { updatedState, liveSatisfied } = await this.prisma.$transaction(async (tx) => {
      await this.lockState(tx, merchantId);
      const currentState = await tx.onboardingState.findUnique({
        where: { merchant_id: merchantId },
      });
      if (!currentState) {
        throw new CanonicalApiException(
          HttpStatus.NOT_FOUND,
          'ONBOARDING_NOT_FOUND',
          'Không tìm thấy dữ liệu thiết lập ban đầu'
        );
      }

      const liveSatisfiedPre = await this.evaluateLiveCompleteness(merchantId, currentState, tx);

      // Assert prerequisites are satisfied
      for (const prereqId of stepDef.prerequisites) {
        if (!liveSatisfiedPre.has(prereqId)) {
          const prereqDef = ONBOARDING_STEPS_CATALOG.find((s) => s.id === prereqId);
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'STEP_BLOCKED',
            `Bước "${stepDef.title}" đang bị khóa`,
            false,
            `Bạn cần hoàn thành bước "${prereqDef?.title || prereqId}" trước`,
            [
              {
                field: 'stepId',
                code: 'PREREQUISITE_NOT_MET',
                message: `Yêu cầu hoàn thành bước ${prereqId}`,
              },
            ]
          );
        }
      }

      let persistedData = normalizedData;
      if (stepDef.id === OnboardingStepId.WAREHOUSE) {
        const warehouses = this.warehouseService(tx);
        const previousId = (currentState.step_data as Record<string, any> | null)?.warehouse
          ?.warehouse_id;
        const input = normalizedData
          ? {
              name: normalizedData.name,
              contact_name: normalizedData.name,
              contact_phone: normalizedData.phone,
              address_line: normalizedData.address,
              city: normalizedData.city || normalizedData.province,
              district: normalizedData.district,
              ward: normalizedData.ward,
              is_default: normalizedData.is_default,
            }
          : undefined;
        let warehouse;
        if (previousId) {
          warehouse = input
            ? (
                await warehouses.updateWarehouse(
                  previousId,
                  input,
                  merchantId,
                  actor,
                  correlationId,
                  clientIp
                )
              ).data
            : (
                await warehouses.getWarehouseById(
                  previousId,
                  merchantId,
                  actor,
                  true,
                  correlationId
                )
              ).data;
        } else if (input) {
          warehouse = (
            await warehouses.createWarehouse(input, merchantId, actor, correlationId, clientIp)
          ).data;
        } else {
          const existing = await tx.warehouse.findFirst({
            where: { merchant_id: merchantId, status: 'active' },
          });
          if (!existing) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'VALIDATION_ERROR',
              'Vui lòng tạo kho hàng trước khi hoàn thành bước này'
            );
          }
          warehouse = (
            await warehouses.getWarehouseById(existing.id, merchantId, actor, true, correlationId)
          ).data;
        }
        persistedData = {
          warehouse_id: warehouse.id,
          name: warehouse.name,
          phone: warehouse.contact_phone,
          address: warehouse.address_line,
          city: warehouse.city,
          district: warehouse.district,
        };
      }

      const currentCompleted = new Set<string>(currentState.completed_steps || []);
      currentCompleted.add(stepDef.id);
      const currentSkipped = new Set<string>(currentState.skipped_steps || []);
      currentSkipped.delete(stepDef.id);

      const stepData = (currentState.step_data as Record<string, any>) || {};
      if (persistedData) {
        stepData[stepDef.id.toLowerCase()] = persistedData;
      }

      const tempState = {
        ...currentState,
        completed_steps: Array.from(currentCompleted),
        skipped_steps: Array.from(currentSkipped),
        step_data: stepData,
      };

      const evaluatedLive = await this.evaluateLiveCompleteness(merchantId, tempState, tx);
      evaluatedLive.add(stepDef.id);
      const requiredSteps = ONBOARDING_STEPS_CATALOG.filter((s) => s.required);
      const allRequiredCompleted = requiredSteps.every((s) => evaluatedLive.has(s.id));

      const updated = await tx.onboardingState.update({
        where: { id: currentState.id },
        data: {
          completed_steps: Array.from(currentCompleted),
          skipped_steps: Array.from(currentSkipped),
          step_data: stepData,
          status: allRequiredCompleted
            ? OnboardingOverallStatus.COMPLETED
            : OnboardingOverallStatus.IN_PROGRESS,
          completed_at: allRequiredCompleted
            ? currentState.completed_at || new Date()
            : currentState.completed_at,
        },
      });

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: 'ONBOARDING_STEP_COMPLETED',
          entity_type: 'onboarding',
          entity_id: currentState.id,
          new_value: {
            step_id: stepDef.id,
            data:
              stepDef.id === OnboardingStepId.WAREHOUSE
                ? { warehouse_id: persistedData?.warehouse_id }
                : maskAuditPayload(normalizedData),
          },
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return { updatedState: updated, liveSatisfied: evaluatedLive };
    });

    const responseDto = this.buildResponse(updatedState, liveSatisfied);
    return {
      success: true,
      data: responseDto,
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * POST /api/v1/onboarding/steps/:stepId/skip (AC-ONB-01-05, AC-ONB-01-06)
   */
  async skipStep(
    merchantId: string,
    stepId: string,
    actor: ActorContext,
    correlationId: string,
    clientIp: string
  ): Promise<{
    success: boolean;
    data: OnboardingStateResponseDto;
    meta: { correlation_id: string };
  }> {
    if (!merchantId || actor.merchantId !== merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    if (!VALID_STEP_IDS.includes(stepId)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'STEP_NOT_FOUND',
        `Bước thiết lập "${stepId}" không tồn tại`,
        false,
        'Vui lòng chọn bước hợp lệ trong danh mục quy trình'
      );
    }

    const stepDef = ONBOARDING_STEPS_CATALOG.find((s) => s.id === stepId)!;

    if (stepDef.required) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'CANNOT_SKIP_REQUIRED_STEP',
        `Không thể bỏ qua bước bắt buộc "${stepDef.title}"`,
        false,
        'Bước này là điều kiện bắt buộc để khởi tạo tài khoản và kích hoạt giao vận'
      );
    }

    await this.getOrCreateState(merchantId, correlationId, clientIp);

    const { updatedState, liveSatisfied } = await this.prisma.$transaction(async (tx) => {
      await this.lockState(tx, merchantId);
      const currentState = await tx.onboardingState.findUnique({
        where: { merchant_id: merchantId },
      });
      if (!currentState) {
        throw new CanonicalApiException(
          HttpStatus.NOT_FOUND,
          'ONBOARDING_NOT_FOUND',
          'Không tìm thấy dữ liệu thiết lập ban đầu'
        );
      }

      const currentCompleted = new Set<string>(currentState.completed_steps || []);
      currentCompleted.delete(stepDef.id);
      const currentSkipped = new Set<string>(currentState.skipped_steps || []);
      currentSkipped.add(stepDef.id);

      const updated = await tx.onboardingState.update({
        where: { id: currentState.id },
        data: {
          completed_steps: Array.from(currentCompleted),
          skipped_steps: Array.from(currentSkipped),
        },
      });

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: 'ONBOARDING_STEP_SKIPPED',
          entity_type: 'onboarding',
          entity_id: currentState.id,
          new_value: { step_id: stepDef.id },
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      const evaluatedLive = await this.evaluateLiveCompleteness(merchantId, updated, tx);
      evaluatedLive.delete(stepDef.id);
      return { updatedState: updated, liveSatisfied: evaluatedLive };
    });

    const responseDto = this.buildResponse(updatedState, liveSatisfied);
    return {
      success: true,
      data: responseDto,
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * POST /api/v1/onboarding/reset (AC-ONB-01-10)
   */
  async resetOnboarding(
    merchantId: string,
    actor: ActorContext,
    correlationId: string,
    clientIp: string
  ): Promise<{
    success: boolean;
    data: OnboardingStateResponseDto;
    meta: { correlation_id: string };
  }> {
    if (!merchantId || actor.merchantId !== merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    await this.getOrCreateState(merchantId, correlationId, clientIp);

    const { updatedState, liveSatisfied } = await this.prisma.$transaction(async (tx) => {
      await this.lockState(tx, merchantId);
      const currentState = await tx.onboardingState.findUnique({
        where: { merchant_id: merchantId },
      });
      if (!currentState) {
        throw new CanonicalApiException(
          HttpStatus.NOT_FOUND,
          'ONBOARDING_NOT_FOUND',
          'Không tìm thấy dữ liệu thiết lập ban đầu'
        );
      }

      const updated = await tx.onboardingState.update({
        where: { id: currentState.id },
        data: {
          completed_steps: [],
          skipped_steps: [],
          step_data: Prisma.DbNull,
          reset_at: new Date(),
          status: OnboardingOverallStatus.IN_PROGRESS,
          completed_at: null,
          current_step: OnboardingStepId.SHOP_PROFILE,
        },
      });

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: 'ONBOARDING_RESET',
          entity_type: 'onboarding',
          entity_id: currentState.id,
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return {
        updatedState: updated,
        liveSatisfied: await this.evaluateLiveCompleteness(merchantId, updated, tx),
      };
    });

    const responseDto = this.buildResponse(updatedState, liveSatisfied);
    return {
      success: true,
      data: responseDto,
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * POST /api/v1/onboarding/dismiss (AC-ONB-01-08, AC-ONB-01-09)
   */
  async dismissOnboarding(
    merchantId: string,
    actor: ActorContext,
    correlationId: string,
    clientIp: string
  ): Promise<{
    success: boolean;
    data: OnboardingStateResponseDto;
    meta: { correlation_id: string };
  }> {
    if (!merchantId || actor.merchantId !== merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    await this.getOrCreateState(merchantId, correlationId, clientIp);
    const { updatedState, liveSatisfied } = await this.prisma.$transaction(async (tx) => {
      await this.lockState(tx, merchantId);
      const currentState = await tx.onboardingState.findUnique({
        where: { merchant_id: merchantId },
      });
      if (!currentState) {
        throw new CanonicalApiException(
          HttpStatus.NOT_FOUND,
          'ONBOARDING_NOT_FOUND',
          'Không tìm thấy dữ liệu thiết lập ban đầu'
        );
      }

      const liveSatisfied = await this.evaluateLiveCompleteness(merchantId, currentState, tx);

      const requiredSteps = ONBOARDING_STEPS_CATALOG.filter((s) => s.required);
      const incompleteRequired = requiredSteps.filter((s) => !liveSatisfied.has(s.id));

      if (incompleteRequired.length > 0) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'ONBOARDING_INCOMPLETE',
          'Chưa thể đóng hướng dẫn thiết lập',
          false,
          'Bạn cần hoàn thành các bước bắt buộc trước khi đóng hướng dẫn',
          incompleteRequired.map((s) => ({
            field: s.id,
            code: 'REQUIRED_STEP_INCOMPLETE',
            message: `Bước "${s.title}" chưa được hoàn thành`,
          }))
        );
      }

      const updated = await tx.onboardingState.update({
        where: { id: currentState.id },
        data: {
          status: OnboardingOverallStatus.DISMISSED,
        },
      });

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: 'ONBOARDING_DISMISSED',
          entity_type: 'onboarding',
          entity_id: currentState.id,
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return {
        updatedState: updated,
        liveSatisfied: await this.evaluateLiveCompleteness(merchantId, updated, tx),
      };
    });

    const responseDto = this.buildResponse(updatedState, liveSatisfied);
    return {
      success: true,
      data: responseDto,
      meta: { correlation_id: correlationId },
    };
  }
}
