import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseFilters,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { CanonicalExceptionFilter } from './canonical-exception.filter';
import { AdminCreateShopDto, AdminListShopsQuery } from './admin-shops.dto';
import { extractClientIp } from '../utils/ip.util';
import { normalizeCorrelationId } from '@shipde/config';

@Controller('admin/shops')
@UseGuards(AdminAuthGuard)
@UseFilters(CanonicalExceptionFilter)
export class AdminShopsController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createShop(
    @Body() dto: AdminCreateShopDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const result = await this.authService.adminCreateShop(dto, clientIp, correlationId);
    return res.status(HttpStatus.CREATED).json(result);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listShops(
    @Query() query: AdminListShopsQuery,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const result = await this.authService.adminListShops(query, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }
}
