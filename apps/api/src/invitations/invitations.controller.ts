import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Header,
  Inject,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { Request } from 'express';
import { InvitationsService } from './invitations.service';
import { SessionGuard } from '../session/session.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';
import { SendInvitationRequest, AcceptInvitationRequest } from '@shipde/contracts';
import { resolveFrontendBaseUrl, sanitizeCorrelationId } from './invitation-url.util';

export { resolveFrontendBaseUrl, sanitizeCorrelationId };

@Controller(['api/v1/invitations', 'invitations'])
@UseFilters(CanonicalExceptionFilter)
export class InvitationsController {
  constructor(
    @Inject(InvitationsService) private readonly invitationsService: InvitationsService
  ) {}

  private extractCorrelationId(req: any): string {
    const rawCandidate =
      req?.correlationId ||
      (Array.isArray(req?.headers?.['x-correlation-id'])
        ? req.headers['x-correlation-id'][0]
        : req?.headers?.['x-correlation-id']);
    return sanitizeCorrelationId(rawCandidate);
  }

  /**
   * POST /api/v1/invitations — Send team member invitation (API-USR-INVITE-SEND)
   */
  @Post()
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.CREATED)
  async createInvitation(@Body() dto: SendInvitationRequest, @Req() req: any) {
    const correlationId = this.extractCorrelationId(req);
    const clientIp = extractClientIp(req);
    // Backend is authoritative: do not trust stale token claims; service resolves live role & scopes from DB
    const actor = {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
    };
    const baseUrl = resolveFrontendBaseUrl(req.headers?.['origin'] as string | undefined);

    return this.invitationsService.createInvitation(dto, actor, clientIp, correlationId, baseUrl);
  }

  /**
   * GET /api/v1/invitations — List invitations for merchant (API-USR-INVITE-LIST)
   */
  @Get()
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.OK)
  async listInvitations(
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: any
  ) {
    const correlationId = this.extractCorrelationId(req);
    const actor = {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
    };

    return this.invitationsService.listInvitations(
      actor,
      {
        status,
        // Raw strings: the service strictly validates and rejects non-integers with 400
        page,
        limit,
      },
      correlationId
    );
  }

  /**
   * POST /api/v1/invitations/:id/resend — Resend invitation (API-USR-INVITE-RESEND)
   */
  @Post(':id/resend')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.OK)
  async resendInvitation(@Param('id') id: string, @Req() req: any) {
    const correlationId = this.extractCorrelationId(req);
    const clientIp = extractClientIp(req);
    const actor = {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
    };
    const baseUrl = resolveFrontendBaseUrl(req.headers?.['origin'] as string | undefined);

    return this.invitationsService.resendInvitation(id, actor, clientIp, correlationId, baseUrl);
  }

  /**
   * POST /api/v1/invitations/:id/cancel — Cancel invitation (API-USR-INVITE-CANCEL)
   */
  @Post(':id/cancel')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.OK)
  async cancelInvitation(@Param('id') id: string, @Req() req: any) {
    const correlationId = this.extractCorrelationId(req);
    const clientIp = extractClientIp(req);
    const actor = {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
    };

    return this.invitationsService.cancelInvitation(id, actor, clientIp, correlationId);
  }

  /**
   * POST /api/v1/invitations/verify — Public token verification (API-USR-INVITE-VERIFY)
   * The bearer token is accepted only in the JSON body, never in the URL, so access logs,
   * proxies and Referer never retain the plaintext secret (SECURITY-NFR / AC-USR-01-18).
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async verifyInvitation(@Body() body: { token?: unknown } | undefined, @Req() req: any) {
    const correlationId = this.extractCorrelationId(req);
    const clientIp = extractClientIp(req);
    const token = typeof body?.token === 'string' ? body.token : '';
    return this.invitationsService.verifyInvitation(token, correlationId, clientIp);
  }

  /**
   * POST /api/v1/invitations/accept — Public acceptance & account activation (API-USR-INVITE-ACCEPT)
   */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async acceptInvitation(@Body() dto: AcceptInvitationRequest, @Req() req: any) {
    const correlationId = this.extractCorrelationId(req);
    const clientIp = extractClientIp(req);
    return this.invitationsService.acceptInvitation(dto, clientIp, correlationId);
  }
}
