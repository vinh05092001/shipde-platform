import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { SessionService, CreateSessionDto, RevokeAllDto } from './session.service';
import { normalizeCorrelationId } from '@shipde/config';
import { SessionGuard } from './session.guard';

/**
 * FEAT-AUTH-06 — Session management controller.
 *
 * BR-SESS-02: All routes tenant-scoped via SessionGuard.
 * BR-SESS-04: Heartbeat scoped to current session only.
 * BR-SESS-05: Idempotent revocation.
 * BR-SESS-08: Revoke-all ("logout everywhere").
 */
@UseGuards(SessionGuard)
@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  /** POST /sessions — Create session (at login) */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateSessionDto, @Req() req: any) {
    const merchantId = req.merchantId as string;
    const correlationId = req.headers['x-correlation-id'] || normalizeCorrelationId();
    return this.sessionService.create(dto, merchantId, correlationId);
  }

  /** GET /sessions — List active sessions for current user */
  @Get()
  async list(@Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    const currentSessionHash = req.sessionTokenHash as string | undefined;
    return this.sessionService.list(userId, merchantId, currentSessionHash);
  }

  /** DELETE /sessions/:id — Revoke a single session */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async revoke(@Param('id') id: string, @Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    const correlationId = req.headers['x-correlation-id'] || normalizeCorrelationId();
    return this.sessionService.revoke(id, userId, merchantId, correlationId);
  }

  /** POST /sessions/revoke-all — Revoke all sessions (logout everywhere) */
  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAll(@Body() dto: RevokeAllDto, @Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    const currentSessionId = req.sessionId as string | undefined;
    const correlationId = req.headers['x-correlation-id'] || normalizeCorrelationId();
    return this.sessionService.revokeAll(userId, merchantId, currentSessionId, dto, correlationId);
  }

  /** PATCH /sessions/:id/heartbeat — Update last activity */
  @Patch(':id/heartbeat')
  async heartbeat(@Param('id') id: string, @Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    return this.sessionService.heartbeat(id, userId, merchantId);
  }
}
