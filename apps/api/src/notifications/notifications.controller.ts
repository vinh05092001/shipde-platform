import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Inject,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { normalizeCorrelationId } from '@shipde/config';
import { RedeliverNotificationDeliveryRequest } from '@shipde/contracts';
import { SessionGuard } from '../session/session.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { extractClientIp } from '../utils/ip.util';
import { NotificationsService } from './notifications.service';

@Controller()
@UseGuards(SessionGuard)
@UseFilters(CanonicalExceptionFilter)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly notificationsService: NotificationsService
  ) {}

  @Get(['api/v1/notifications', 'notifications'])
  @HttpCode(HttpStatus.OK)
  async listNotifications(
    @Req() req: any,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('unread_only') unreadOnly?: string,
    @Query('severity') severity?: string,
    @Query('status') status?: string
  ) {
    const correlationId = req.correlationId || normalizeCorrelationId();
    const actorRole = req.userRole || req.jwtClaims?.role;
    return this.notificationsService.listNotifications(
      { userId: req.userId, merchantId: req.merchantId ?? null, role: actorRole },
      { cursor, limit, unread_only: unreadOnly, severity, status },
      correlationId
    );
  }

  @Get(['api/v1/notifications/unread-count', 'notifications/unread-count'])
  @HttpCode(HttpStatus.OK)
  async getUnreadCount(@Req() req: any) {
    const correlationId = req.correlationId || normalizeCorrelationId();
    return this.notificationsService.getUnreadCount(
      {
        userId: req.userId,
        merchantId: req.merchantId ?? null,
        role: req.userRole || req.jwtClaims?.role,
      },
      correlationId
    );
  }

  @Post(['api/v1/notifications/read-all', 'notifications/read-all'])
  @HttpCode(HttpStatus.OK)
  async markAllRead(@Req() req: any) {
    const correlationId = req.correlationId || normalizeCorrelationId();
    return this.notificationsService.markAllRead(
      {
        userId: req.userId,
        merchantId: req.merchantId ?? null,
        role: req.userRole || req.jwtClaims?.role,
      },
      correlationId
    );
  }

  @Post(['api/v1/notifications/:id/read', 'notifications/:id/read'])
  @HttpCode(HttpStatus.OK)
  async markRead(@Req() req: any, @Param('id') id: string) {
    const correlationId = req.correlationId || normalizeCorrelationId();
    return this.notificationsService.markRead(
      {
        userId: req.userId,
        merchantId: req.merchantId ?? null,
        role: req.userRole || req.jwtClaims?.role,
      },
      id,
      correlationId
    );
  }

  @Get(['api/v1/admin/notification-deliveries', 'admin/notification-deliveries'])
  @HttpCode(HttpStatus.OK)
  async listAdminDeliveries(
    @Req() req: any,
    @Query('state') state?: string,
    @Query('channel') channel?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    const correlationId = req.correlationId || normalizeCorrelationId();
    return this.notificationsService.listAdminRecoverableDeliveries(
      {
        userId: req.userId,
        merchantId: req.merchantId ?? null,
        role: req.userRole || req.jwtClaims?.role,
      },
      { state, channel, cursor, limit },
      correlationId
    );
  }

  @Post([
    'api/v1/admin/notification-deliveries/:deliveryId/redeliver',
    'admin/notification-deliveries/:deliveryId/redeliver',
  ])
  @HttpCode(HttpStatus.OK)
  async redeliver(
    @Req() req: any,
    @Param('deliveryId') deliveryId: string,
    @Body() body: RedeliverNotificationDeliveryRequest
  ) {
    const correlationId = req.correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    return this.notificationsService.redeliverNotificationDelivery(
      {
        userId: req.userId,
        merchantId: req.merchantId ?? null,
        role: req.userRole || req.jwtClaims?.role,
      },
      deliveryId,
      body,
      clientIp,
      correlationId
    );
  }
}
