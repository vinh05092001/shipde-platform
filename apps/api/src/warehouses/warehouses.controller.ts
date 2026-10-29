import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Res,
  HttpStatus,
  UseGuards,
  UseFilters,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './warehouses.dto';
import { SessionGuard } from '../session/session.guard';
import { RbacSeedGuard, PermissionsGuard, RequirePermissions } from '../rbac/rbac.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';

@Controller(['api/v1/warehouses', 'warehouses'])
@UseGuards(RbacSeedGuard, SessionGuard, PermissionsGuard)
@UseFilters(CanonicalExceptionFilter)
export class WarehousesController {
  constructor(
    @Inject(WarehousesService) private readonly warehousesService: WarehousesService,
    @Inject(RbacService) private readonly rbacService: RbacService
  ) {}

  private async resolveActor(req: any): Promise<ActorContext> {
    if (req.actorContext) {
      return req.actorContext;
    }
    const actor = await this.rbacService.resolveActorFromSession(req);
    req.actorContext = actor;
    return actor;
  }

  /**
   * GET /api/v1/warehouses (AC-WH-01-01, AC-WH-01-02)
   */
  @Get()
  async listWarehouses(@Req() req: Request, @Res() res: Response): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    const hasConfigPermission = await this.rbacService.actorHasPermissions(actor, [
      'iam:shop_config',
    ]);
    const result = await this.warehousesService.listWarehouses(
      actor.merchantId,
      actor,
      hasConfigPermission,
      correlationId
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * POST /api/v1/warehouses (AC-WH-01-06..11)
   */
  @Post()
  @RequirePermissions('iam:shop_config')
  async createWarehouse(
    @Body() dto: CreateWarehouseDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    const result = await this.warehousesService.createWarehouse(
      dto,
      actor.merchantId,
      actor,
      correlationId,
      clientIp
    );
    return res.status(HttpStatus.CREATED).json(result);
  }

  /**
   * GET /api/v1/warehouses/:id (AC-WH-01-03..05)
   */
  @Get(':id')
  async getWarehouseById(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    const hasConfigPermission = await this.rbacService.actorHasPermissions(actor, [
      'iam:shop_config',
    ]);
    const result = await this.warehousesService.getWarehouseById(
      id,
      actor.merchantId,
      actor,
      hasConfigPermission,
      correlationId
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * PATCH /api/v1/warehouses/:id (AC-WH-01-12)
   */
  @Patch(':id')
  @RequirePermissions('iam:shop_config')
  async updateWarehouseById(
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    const result = await this.warehousesService.updateWarehouse(
      id,
      dto,
      actor.merchantId,
      actor,
      correlationId,
      clientIp
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * POST /api/v1/warehouses/:id/default (AC-WH-01-13)
   */
  @Post(':id/default')
  @RequirePermissions('iam:shop_config')
  async setDefaultWarehouse(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    const result = await this.warehousesService.setDefaultWarehouse(
      id,
      actor.merchantId,
      actor,
      correlationId,
      clientIp
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * DELETE /api/v1/warehouses/:id (AC-WH-01-14)
   */
  @Delete(':id')
  @RequirePermissions('iam:shop_config')
  async deactivateWarehouse(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    const result = await this.warehousesService.deactivateWarehouse(
      id,
      actor.merchantId,
      actor,
      correlationId,
      clientIp
    );
    return res.status(HttpStatus.OK).json(result);
  }
}
