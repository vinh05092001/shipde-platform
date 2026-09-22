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
 *
 * Routes follow the /api/v1/sessions prefix as specified in FEAT-AUTH-06.md.
 * POST /api/v1/sessions is excluded from SessionGuard to allow login session creation.
 */
@Controller('api/v1/sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  /** POST /api/v1/sessions — Create session (at login) — PUBLIC (no guard) */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateSessionDto, @Req() req: any) {
    const merchantId = req.merchantId as string;
    const correlationId = req.headers['x-correlation-id'] || normalizeCorrelationId();
    return this.sessionService.create(dto, merchantId, correlationId);
  }

  /** GET /api/v1/sessions — List active sessions for current user */
  @UseGuards(SessionGuard)
  @Get()
  async list(@Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    const currentSessionHash = req.sessionTokenHash as string | undefined;
    return this.sessionService.list(userId, merchantId, currentSessionHash);
  }

  /** DELETE /api/v1/sessions/:sessionId — Revoke a single session */
  @UseGuards(SessionGuard)
  @Delete(':sessionId')
  @HttpCode(HttpStatus.OK)
  async revoke(@Param('sessionId') sessionId: string, @Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    const correlationId = req.headers['x-correlation-id'] || normalizeCorrelationId();
    return this.sessionService.revoke(sessionId, userId, merchantId, correlationId);
  }

  /** POST /api/v1/sessions/revoke-all — Revoke all sessions (logout everywhere) */
  @UseGuards(SessionGuard)
  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAll(@Body() dto: RevokeAllDto, @Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    const currentSessionId = req.sessionId as string | undefined;
    const correlationId = req.headers['x-correlation-id'] || normalizeCorrelationId();
    return this.sessionService.revokeAll(userId, merchantId, currentSessionId, dto, correlationId);
  }

  /** PATCH /api/v1/sessions/:sessionId/heartbeat — Update last activity */
  @UseGuards(SessionGuard)
  @Patch(':sessionId/heartbeat')
  async heartbeat(@Param('sessionId') sessionId: string, @Req() req: any) {
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;
    return this.sessionService.heartbeat(sessionId, userId, merchantId);
  }
}
