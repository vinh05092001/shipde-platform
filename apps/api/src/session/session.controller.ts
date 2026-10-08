import {
  Controller,
  Inject,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Post,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { SessionService, RevokeAllDto } from './session.service';
import { normalizeCorrelationId } from '@shipde/config';
import { SessionGuard } from './session.guard';

/**
 * FEAT-AUTH-06 — Session management controller.
 */
@Controller('api/v1/sessions')
@UseGuards(SessionGuard)
export class SessionController {
  constructor(@Inject(SessionService) private readonly sessionService: SessionService) {}

  private extractIp(req: any): string {
    return (
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.ip ||
      req.socket?.remoteAddress ||
      '127.0.0.1'
    );
  }

  /** GET /api/v1/sessions — List active sessions for current user */
  @Get()
  async list(@Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    const currentSessionHash = req.sessionTokenHash as string | undefined;
    const correlationId = req.headers['x-correlation-id'] || normalizeCorrelationId();
    return this.sessionService.list(userId, merchantId, currentSessionHash, correlationId);
  }

  /** DELETE /api/v1/sessions/:sessionId — Revoke a single session */
  @Delete(':sessionId')
  @HttpCode(HttpStatus.OK)
  async revoke(@Param('sessionId') sessionId: string, @Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    const correlationId = req.headers['x-correlation-id'] || normalizeCorrelationId();
    const ip = this.extractIp(req);
    return this.sessionService.revoke(sessionId, userId, merchantId, correlationId, ip);
  }

  /** POST /api/v1/sessions/revoke-all — Revoke all sessions (logout everywhere) */
  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAll(@Body() dto: RevokeAllDto, @Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    const currentSessionId = req.sessionId as string | undefined;
    const correlationId = req.headers['x-correlation-id'] || normalizeCorrelationId();
    const ip = this.extractIp(req);
    return this.sessionService.revokeAll(
      userId,
      merchantId,
      currentSessionId,
      dto,
      correlationId,
      ip
    );
  }

  /** PATCH /api/v1/sessions/:sessionId/heartbeat — Update last activity */
  @Patch(':sessionId/heartbeat')
  async heartbeat(@Param('sessionId') sessionId: string, @Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    const currentSessionId = req.sessionId as string | undefined;
    return this.sessionService.heartbeat(sessionId, userId, merchantId, currentSessionId);
  }
}
