import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Inject,
  UseGuards,
  Query,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminAuthService, CreateShopDto } from './admin-auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { normalizeCorrelationId } from '@shipde/config';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminAuthController {
  constructor(
    @Inject(AdminAuthService)
    private readonly adminAuthService: AdminAuthService
  ) {}

  @Post('shops')
  @HttpCode(HttpStatus.CREATED)
  async createShop(
    @Body() dto: CreateShopDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = this.extractClientIp(req);
    const result = await this.adminAuthService.createShop(dto, clientIp, correlationId);
    return res.status(HttpStatus.CREATED).json(result);
  }

  @Get('shops')
  @HttpCode(HttpStatus.OK)
  async listShops(@Query('page') page: string, @Query('limit') limit: string) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    return this.adminAuthService.listShops(pageNum, limitNum);
  }

  private extractClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      if (first && first.trim().length > 0) return first.trim();
    }
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
  }
}
