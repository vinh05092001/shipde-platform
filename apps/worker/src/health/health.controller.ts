import { Controller, Get, Req, Res, Inject } from '@nestjs/common';
import { Request, Response } from 'express';
import { HealthService } from './health.service';
import { LivenessResponse, ReadinessResponse } from '@shipde/contracts';
import { normalizeCorrelationId, CORRELATION_ID_HEADER } from '@shipde/config';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get('live')
  getLive(@Req() req: Request, @Res() res: Response): Response {
    const rawHeader = req.headers[CORRELATION_ID_HEADER];
    const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const correlationId = normalizeCorrelationId(candidate);

    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    const body: LivenessResponse = {
      status: 'ok',
      service: 'worker',
      timestamp: new Date().toISOString(),
      correlationId,
    };
    return res.status(200).json(body);
  }

  @Get('ready')
  async getReady(@Req() req: Request, @Res() res: Response): Promise<Response> {
    const rawHeader = req.headers[CORRELATION_ID_HEADER];
    const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const correlationId = normalizeCorrelationId(candidate);

    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    const { isReady, checks } = await this.healthService.checkReadiness();

    const responseBody: ReadinessResponse = {
      status: isReady ? 'ok' : 'error',
      service: 'worker',
      timestamp: new Date().toISOString(),
      correlationId,
      checks,
    };

    const httpStatus = isReady ? 200 : 503;
    return res.status(httpStatus).json(responseBody);
  }
}
