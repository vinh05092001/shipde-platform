import { Request } from 'express';

export function extractClientIp(req: Request | any): string {
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}
