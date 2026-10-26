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
import { UsersService, AdminResetMfaDto } from './users.service';
import { SessionGuard } from '../session/session.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';

@Controller('users')
@UseGuards(SessionGuard)
@UseFilters(CanonicalExceptionFilter)
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

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
