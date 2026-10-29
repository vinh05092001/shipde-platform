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
    let state = await this.prisma.onboardingState.findUnique({
      where: { merchant_id: merchantId },
    });

    if (!state) {
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
    }

    return state;
  }

  /**
   * Evaluate live aggregate completeness from database records
   */
  private async evaluateLiveCompleteness(merchantId: string, state: any): Promise<Set<string>> {
    const satisfied = new Set<string>(state.completed_steps || []);
    const skippedSet = new Set<string>(state.skipped_steps || []);

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        carrier_accounts: { select: { id: true }, take: 1 },
        users: { select: { id: true }, take: 2 },
        invitations: { select: { id: true }, take: 1 },
        orders: { select: { id: true }, take: 1 },
        shipments: { select: { id: true }, take: 1 },
      },
    });

    if (merchant) {
      // Step 1: SHOP_PROFILE is satisfied if merchant has legal_name and tax_code configured
      if (merchant.legal_name && merchant.tax_code) {
        satisfied.add(OnboardingStepId.SHOP_PROFILE);
      }

      // Step 2: WAREHOUSE is satisfied if warehouse payload is stored in step_data or marked completed
      const stepData = (state.step_data as Record<string, any>) || {};
      if (stepData.warehouse && stepData.warehouse.address) {
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
        if (stepData.operating_defaults || merchant.operating_notes) {
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
  private buildResponse(state: any, liveSatisfied: Set<string>): OnboardingStateResponseDto {
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
    };
  }

  /**
   * GET /api/v1/onboarding (AC-ONB-01-01, AC-ONB-01-15)
   */
  async getOnboardingState(
    merchantId: string,
    correlationId?: string,
    clientIp?: string
  ): Promise<{
    success: boolean;
    data: OnboardingStateResponseDto;
    meta: { correlation_id?: string };
  }> {
    const state = await this.getOrCreateState(merchantId, correlationId, clientIp);
    const liveSatisfied = await this.evaluateLiveCompleteness(merchantId, state);
    const responseDto = this.buildResponse(state, liveSatisfied);

    // Persist completed status if transition occurred
    if (
      responseDto.status === OnboardingOverallStatus.COMPLETED &&
      state.status === OnboardingOverallStatus.IN_PROGRESS
    ) {
      await this.prisma.onboardingState.update({
        where: { id: state.id },
        data: {
          status: OnboardingOverallStatus.COMPLETED,
          completed_at: new Date(),
        },
      });
    }

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

    const state = await this.getOrCreateState(merchantId, correlationId, clientIp);
    const liveSatisfied = await this.evaluateLiveCompleteness(merchantId, state);

    // Assert prerequisites are satisfied
    for (const prereqId of stepDef.prerequisites) {
      if (!liveSatisfied.has(prereqId)) {
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

    // Update state
    const currentCompleted = new Set<string>(state.completed_steps || []);
    currentCompleted.add(stepDef.id);
    const currentSkipped = new Set<string>(state.skipped_steps || []);
    currentSkipped.delete(stepDef.id);

    const stepData = (state.step_data as Record<string, any>) || {};
    if (dto?.data) {
      stepData[stepDef.id.toLowerCase()] = dto.data;
    }

    liveSatisfied.add(stepDef.id);
    const requiredSteps = ONBOARDING_STEPS_CATALOG.filter((s) => s.required);
    const allRequiredCompleted = requiredSteps.every((s) => liveSatisfied.has(s.id));

    const updatedState = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.onboardingState.update({
        where: { id: state.id },
        data: {
          completed_steps: Array.from(currentCompleted),
          skipped_steps: Array.from(currentSkipped),
          step_data: stepData,
          status: allRequiredCompleted
            ? OnboardingOverallStatus.COMPLETED
            : OnboardingOverallStatus.IN_PROGRESS,
          completed_at: allRequiredCompleted
            ? state.completed_at || new Date()
            : state.completed_at,
        },
      });

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: 'ONBOARDING_STEP_COMPLETED',
          entity_type: 'onboarding',
          entity_id: state.id,
          new_value: {
            step_id: stepDef.id,
            data: maskAuditPayload(dto?.data),
          },
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return updated;
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

    const state = await this.getOrCreateState(merchantId, correlationId, clientIp);
    const liveSatisfied = await this.evaluateLiveCompleteness(merchantId, state);

    const currentCompleted = new Set<string>(state.completed_steps || []);
    currentCompleted.delete(stepDef.id);
    const currentSkipped = new Set<string>(state.skipped_steps || []);
    currentSkipped.add(stepDef.id);
    liveSatisfied.delete(stepDef.id);

    const updatedState = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.onboardingState.update({
        where: { id: state.id },
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
          entity_id: state.id,
          new_value: { step_id: stepDef.id },
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return updated;
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
    const state = await this.getOrCreateState(merchantId, correlationId, clientIp);

    const updatedState = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.onboardingState.update({
        where: { id: state.id },
        data: {
          completed_steps: [],
          skipped_steps: [],
          step_data: Prisma.DbNull,
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
          entity_id: state.id,
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return updated;
    });

    const liveSatisfied = new Set<string>();
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
    const state = await this.getOrCreateState(merchantId, correlationId, clientIp);
    const liveSatisfied = await this.evaluateLiveCompleteness(merchantId, state);

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

    const updatedState = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.onboardingState.update({
        where: { id: state.id },
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
          entity_id: state.id,
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return updated;
    });

    const responseDto = this.buildResponse(updatedState, liveSatisfied);
    return {
      success: true,
      data: responseDto,
      meta: { correlation_id: correlationId },
    };
  }
}
