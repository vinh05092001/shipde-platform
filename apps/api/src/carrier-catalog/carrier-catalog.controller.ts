import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  HttpStatus,
  UseGuards,
  UseFilters,
  Inject,
} from '@nestjs/common';
import { Request } from 'express';
import { CarrierCatalogService } from './carrier-catalog.service';
import { SessionGuard } from '../session/session.guard';
import { RbacSeedGuard, PermissionsGuard, RequirePermissions } from '../rbac/rbac.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { CanonicalApiException } from '../auth/auth.service';
import {
  CarrierListResponse,
  CarrierDetailResponseEnvelope,
  CanonicalStatusListResponse,
  FeeComponentListResponse,
  CompatibilityMappingListResponse,
} from './carrier-catalog.dto';

@Controller(['api/v1/carrier-catalog', 'carrier-catalog'])
@UseGuards(RbacSeedGuard, SessionGuard, PermissionsGuard)
@UseFilters(CanonicalExceptionFilter)
@RequirePermissions('iam:carrier_catalog:read')
export class CarrierCatalogController {
  constructor(
    @Inject(CarrierCatalogService) private readonly catalogService: CarrierCatalogService,
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

  private assertTenantMembership(actor: ActorContext): void {
    if (!actor || !actor.merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu phiên làm việc của cửa hàng'
      );
    }
  }

  @Get('carriers')
  async listCarriers(
    @Req() req: Request,
    @Query('is_active') isActiveRaw?: string
  ): Promise<CarrierListResponse> {
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    let isActive: boolean | undefined = undefined;
    if (isActiveRaw !== undefined) {
      if (isActiveRaw === 'true' || isActiveRaw === '1') {
        isActive = true;
      } else if (isActiveRaw === 'false' || isActiveRaw === '0') {
        isActive = false;
      }
    }

    return this.catalogService.listCarriers(isActive);
  }

  @Get('carriers/:code')
  async getCarrierDetail(
    @Req() req: Request,
    @Param('code') code: string
  ): Promise<CarrierDetailResponseEnvelope> {
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    return this.catalogService.getCarrierDetail(code);
  }

  @Get('statuses')
  async listStatuses(@Req() req: Request): Promise<CanonicalStatusListResponse> {
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    return this.catalogService.listStatuses();
  }

  @Get('fee-components')
  async listFeeComponents(@Req() req: Request): Promise<FeeComponentListResponse> {
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    return this.catalogService.listFeeComponents();
  }

  @Get('compatibility')
  async listCompatibility(
    @Req() req: Request,
    @Query('domain') domain?: string,
    @Query('carrier_code') carrierCode?: string,
    @Query('raw_key') rawKey?: string
  ): Promise<CompatibilityMappingListResponse> {
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    return this.catalogService.listCompatibility(domain, carrierCode, rawKey);
  }
}
