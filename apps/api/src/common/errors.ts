import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Canonical domain error codes surfaced to API clients.
 * Kept stable: clients and the delivery register both key off these strings.
 */
export const DomainErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
} as const;

export type DomainErrorCode = (typeof DomainErrorCode)[keyof typeof DomainErrorCode];

const STATUS_BY_CODE: Record<DomainErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  PRECONDITION_FAILED: HttpStatus.PRECONDITION_FAILED,
};

export interface DomainErrorDetail {
  field?: string;
  message: string;
}

export class DomainError extends HttpException {
  readonly code: DomainErrorCode;
  readonly details: DomainErrorDetail[];

  constructor(code: DomainErrorCode, message: string, details: DomainErrorDetail[] = []) {
    super({ code, message, details }, STATUS_BY_CODE[code]);
    this.code = code;
    this.details = details;
  }

  static validation(message: string, details: DomainErrorDetail[] = []): DomainError {
    return new DomainError(DomainErrorCode.VALIDATION_FAILED, message, details);
  }

  static notFound(resource: string, id?: string): DomainError {
    const suffix = id ? ` '${id}'` : '';
    return new DomainError(DomainErrorCode.NOT_FOUND, `${resource}${suffix} not found`);
  }

  static conflict(message: string, details: DomainErrorDetail[] = []): DomainError {
    return new DomainError(DomainErrorCode.CONFLICT, message, details);
  }

  static unauthenticated(message = 'Authentication required'): DomainError {
    return new DomainError(DomainErrorCode.UNAUTHENTICATED, message);
  }

  static forbidden(message = 'Insufficient permissions'): DomainError {
    return new DomainError(DomainErrorCode.FORBIDDEN, message);
  }

  static rateLimited(message = 'Too many attempts'): DomainError {
    return new DomainError(DomainErrorCode.RATE_LIMITED, message);
  }

  static precondition(message: string): DomainError {
    return new DomainError(DomainErrorCode.PRECONDITION_FAILED, message);
  }
}
