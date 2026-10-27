import { CanActivate, ExecutionContext, Injectable, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { CanonicalApiException } from './auth.service';

export function getExpectedAdminKey(): string {
  return (
    process.env.ADMIN_API_KEY || process.env.ADMIN_KEY || 'shipde-admin-dev-secret-key-32-chars'
  );
}

export function extractAdminKey(req: Request): string | undefined {
  const xAdminKey = req.headers['x-admin-key'];
  if (typeof xAdminKey === 'string' && xAdminKey.trim()) {
    return xAdminKey.trim();
  }

  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }

  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  return undefined;
}

export function validateAdminKey(key: string | undefined): void {
  if (!key) {
    throw new CanonicalApiException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'Khóa quản trị viên (Admin API key) bị thiếu',
      false,
      'Vui lòng cung cấp khóa quản trị viên hợp lệ qua tiêu đề x-admin-key'
    );
  }

  const expectedKey = getExpectedAdminKey();
  if (key !== expectedKey) {
    throw new CanonicalApiException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'Khóa quản trị viên không hợp lệ',
      false,
      'Vui lòng kiểm tra lại khóa quản trị viên'
    );
  }
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = extractAdminKey(req);
    validateAdminKey(key);
    return true;
  }
}
