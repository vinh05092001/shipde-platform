import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { CanonicalApiException } from '../auth/auth.service';

/**
 * RBAC-scoped canonical exception filter.
 * Preserves canonical error contract while mapping `fields` to `details`
 * exclusively for RBAC endpoints without mutating global CanonicalApiException.
 */
@Catch(CanonicalApiException)
export class RbacExceptionFilter implements ExceptionFilter {
  catch(exception: CanonicalApiException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const payload: any = exception.getResponse();

    if (exception.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', exception.retryAfterSeconds.toString());
    }

    if (payload && typeof payload === 'object' && payload.error) {
      const errorObj = { ...payload.error };
      if (errorObj.fields && errorObj.details === undefined) {
        errorObj.details = errorObj.fields;
      }
      return response.status(status).json({
        ...payload,
        error: errorObj,
      });
    }

    response.status(status).json(payload);
  }
}
