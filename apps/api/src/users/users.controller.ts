import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Inject,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService, AdminResetMfaDto, CheckScopeDto } from './users.service';
import { SessionGuard } from '../session/session.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';

@Controller(['api/v1/users', 'users'])
@UseGuards(SessionGuard)
@UseFilters(CanonicalExceptionFilter)
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  /**
   * POST /users/check-scope (and /api/v1/users/check-scope)
   * Verify scope authorization for current user (AC-USR-01, AC-USR-01-17).
   */
  @Post('check-scope')
  @HttpCode(HttpStatus.OK)
  async checkScope(@Body() dto: CheckScopeDto, @Req() req: any) {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;

    return this.usersService.checkScopeAccess(userId, merchantId, dto, correlationId);
  }

  /**
   * POST /users/:user_id/mfa/reset
   * Admin reset of target user's lost MFA factor (API-AUTH-MFA-ADMIN-RESET, FEAT-AUTH-05).
   */
  @Post(':user_id/mfa/reset')
  @HttpCode(HttpStatus.OK)
  async adminResetMfa(
    @Param('user_id') targetUserId: string,
    @Body() dto: AdminResetMfaDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() req: any
  ) {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);

    const actor = {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
      role: req.userRole || req.jwtClaims?.role,
      authAssurance: req.authAssurance || req.jwtClaims?.auth_assurance,
      mfaVerifiedAt: req.mfaVerifiedAt || req.jwtClaims?.mfa_verified_at,
    };

    return this.usersService.adminResetMfa(
      targetUserId,
      dto,
      actor,
      idempotencyKey,
      clientIp,
      correlationId
    );
  }
}
