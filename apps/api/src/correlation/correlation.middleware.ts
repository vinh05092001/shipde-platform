import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from '@shipde/config';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const rawHeader = req.headers[CORRELATION_ID_HEADER];
    const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const correlationId = normalizeCorrelationId(candidate);

    (req as any).correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}
