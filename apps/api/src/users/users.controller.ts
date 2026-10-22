import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Inject,
  UseFilters,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { extractClientIp } from '../utils/ip.util';
import { AuthService, MfaResetDto, CanonicalApiException } from '../auth/auth.service';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { normalizeCorrelationId } from '@shipde/config';

@Controller('users')
@UseFilters(CanonicalExceptionFilter)
export class UsersController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post(':user_id/mfa/reset')
  @HttpCode(HttpStatus.OK)
  async resetMfa(
    @Param('user_id') targetUserId: string,
    @Body() dto: MfaResetDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const actor = await this.authService.resolveActorFromHeader(req.headers['authorization']);
    if (actor.scope === 'mfa_setup') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Token tạm thời không có quyền thực hiện thao tác này'
      );
    }
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const idempotencyKey = (req.headers['idempotency-key'] || req.headers['Idempotency-Key']) as
      string | undefined;

    const result = await this.authService.resetUserMfa(
      actor.userId,
      actor.assurance,
      targetUserId,
      dto,
      idempotencyKey,
      clientIp,
      correlationId
    );
    return res.status(HttpStatus.OK).json(result);
  }
}
