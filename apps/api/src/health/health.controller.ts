import { Controller, Get, Req, Res, Inject } from '@nestjs/common';
import { Request, Response } from 'express';
import { HealthService } from './health.service';
import { LivenessResponse, ReadinessResponse } from '@shipde/contracts';
import { normalizeCorrelationId } from '@shipde/config';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get('live')
  getLive(@Req() req: Request): LivenessResponse {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
      correlationId,
    };
  }

  @Get('ready')
  async getReady(@Req() req: Request, @Res() res: Response): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const { isReady, checks } = await this.healthService.checkReadiness();

    const responseBody: ReadinessResponse = {
      status: isReady ? 'ok' : 'error',
      service: 'api',
      timestamp: new Date().toISOString(),
      correlationId,
      checks,
    };

    const httpStatus = isReady ? 200 : 503;
    return res.status(httpStatus).json(responseBody);
  }
}
