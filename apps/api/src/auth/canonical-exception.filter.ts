import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { CanonicalApiException } from './auth.service';

@Catch(CanonicalApiException)
export class CanonicalExceptionFilter implements ExceptionFilter {
  catch(exception: CanonicalApiException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (exception.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', exception.retryAfterSeconds.toString());
    }

    response.status(status).json(payload);
  }
}
