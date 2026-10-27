import { CanActivate, ExecutionContext, Injectable, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { CanonicalApiException } from './auth.service';

export function getExpectedAdminKey(): string | undefined {
  const key = process.env.ADMIN_API_KEY || process.env.ADMIN_KEY;
  if (typeof key === 'string' && key.trim().length > 0) {
    return key.trim();
  }
  return undefined;
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
  const expectedKey = getExpectedAdminKey();
  if (!expectedKey) {
    throw new CanonicalApiException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'Khóa quản trị viên chưa được cấu hình trên máy chủ',
      false,
      'Vui lòng cấu hình biến môi trường ADMIN_API_KEY hợp lệ'
    );
  }

  if (!key) {
    throw new CanonicalApiException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'Khóa quản trị viên (Admin API key) bị thiếu',
      false,
      'Vui lòng cung cấp khóa quản trị viên hợp lệ qua tiêu đề x-admin-key'
    );
  }

  const keyBuf = Buffer.from(key);
  const expectedBuf = Buffer.from(expectedKey);
  const isValid =
    keyBuf.length === expectedBuf.length && timingSafeEqual(keyBuf, expectedBuf);

  if (!isValid) {
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
