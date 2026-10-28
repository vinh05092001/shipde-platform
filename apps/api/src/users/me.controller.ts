import {
  Controller,
  Get,
  Patch,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Inject,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { MeService } from './me.service';
import { UpdateMeDto, UpdatePreferencesDto } from './me.dto';
import { SessionGuard } from '../session/session.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';

@Controller(['api/v1/me', 'me'])
@UseGuards(SessionGuard)
@UseFilters(CanonicalExceptionFilter)
export class MeController {
  constructor(@Inject(MeService) private readonly meService: MeService) {}

  /**
   * GET /api/v1/me & /me
   * Retrieve current user profile and preferences (AC-PRO-01-01)
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getMe(@Req() req: any) {
    const correlationId = req.correlationId || normalizeCorrelationId();
    const userId = req.userId as string;

    return this.meService.getMe(userId, correlationId);
  }

  /**
   * PATCH /api/v1/me & /me
   * Update personal profile and/or preferences (AC-PRO-01-02 to AC-PRO-01-08)
   */
  @Patch()
  @HttpCode(HttpStatus.OK)
  async updateMe(@Body() dto: UpdateMeDto, @Req() req: any) {
    const correlationId = req.correlationId || normalizeCorrelationId();
    const userId = req.userId as string;
    const clientIp = extractClientIp(req);

    return this.meService.updateMe(userId, dto, clientIp, correlationId);
  }

  /**
   * GET /api/v1/me/preferences & /me/preferences
   * Retrieve current user personal preferences (AC-PRO-01-06)
   */
  @Get('preferences')
  @HttpCode(HttpStatus.OK)
  async getMyPreferences(@Req() req: any) {
    const correlationId = req.correlationId || normalizeCorrelationId();
    const userId = req.userId as string;

    return this.meService.getMyPreferences(userId, correlationId);
  }

  /**
   * PATCH /api/v1/me/preferences & /me/preferences
   * Update personal preferences (AC-PRO-01-06, AC-PRO-01-07, AC-PRO-01-08)
   */
  @Patch('preferences')
  @HttpCode(HttpStatus.OK)
  async updateMyPreferences(@Body() dto: UpdatePreferencesDto, @Req() req: any) {
    const correlationId = req.correlationId || normalizeCorrelationId();
    const userId = req.userId as string;
    const clientIp = extractClientIp(req);

    return this.meService.updateMyPreferences(userId, dto, clientIp, correlationId);
  }
}
