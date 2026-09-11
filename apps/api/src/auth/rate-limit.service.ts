import { Injectable, Optional, Inject } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: string;
}

@Injectable()
export class RateLimitService {
  private readonly memoryStore = new Map<string, number[]>();
  private readonly cooldownStore = new Map<string, number>();

  constructor(@Optional() @Inject(RedisService) private readonly redisService?: RedisService) {}

  /**
   * Check registration limits (BR-AUTH-07):
   * - IP: max 5 attempts per 3600 seconds
   * - Identifier (email or phone): max 3 attempts per 3600 seconds
   */
  async checkRegistrationLimit(
    ip: string,
    email?: string,
    phone?: string
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = 3600 * 1000;

    // 1. Check IP limit (5 per hour)
    const ipKey = `ratelimit:reg:ip:${ip}`;
    const ipAttempts = this.getRecentAttempts(ipKey, windowMs, now);
    if (ipAttempts.length >= 5) {
      const earliest = ipAttempts[0];
      const retryAfterSeconds = Math.ceil((earliest + windowMs - now) / 1000);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
        reason: 'Too many registration attempts from this IP address',
      };
    }

    // 2. Check email limit (3 per hour)
    if (email) {
      const emailKey = `ratelimit:reg:email:${email.toLowerCase().trim()}`;
      const emailAttempts = this.getRecentAttempts(emailKey, windowMs, now);
      if (emailAttempts.length >= 3) {
        const earliest = emailAttempts[0];
        const retryAfterSeconds = Math.ceil((earliest + windowMs - now) / 1000);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, retryAfterSeconds),
          reason: 'Too many registration attempts for this email',
        };
      }
    }

    // 3. Check phone limit (3 per hour)
    if (phone) {
      const phoneKey = `ratelimit:reg:phone:${phone.trim()}`;
      const phoneAttempts = this.getRecentAttempts(phoneKey, windowMs, now);
      if (phoneAttempts.length >= 3) {
        const earliest = phoneAttempts[0];
        const retryAfterSeconds = Math.ceil((earliest + windowMs - now) / 1000);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, retryAfterSeconds),
          reason: 'Too many registration attempts for this phone number',
        };
      }
    }

    return { allowed: true };
  }

  async recordRegistrationAttempt(ip: string, email?: string, phone?: string): Promise<void> {
    const now = Date.now();
    this.recordAttempt(`ratelimit:reg:ip:${ip}`, now);
    if (email) {
      this.recordAttempt(`ratelimit:reg:email:${email.toLowerCase().trim()}`, now);
    }
    if (phone) {
      this.recordAttempt(`ratelimit:reg:phone:${phone.trim()}`, now);
    }
  }

  /**
   * Check resend cooldown limit (BR-AUTH-08):
   * - 60 seconds cooldown per identifier and channel
   */
  async checkResendLimit(identifier: string, channel: string): Promise<RateLimitResult> {
    const now = Date.now();
    const key = `ratelimit:resend:${channel}:${identifier.toLowerCase().trim()}`;
    const lockedUntil = this.cooldownStore.get(key);

    if (lockedUntil && lockedUntil > now) {
      const retryAfterSeconds = Math.ceil((lockedUntil - now) / 1000);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
        reason: `Please wait ${retryAfterSeconds} seconds before requesting another code`,
      };
    }

    return { allowed: true };
  }

  async recordResendAttempt(
    identifier: string,
    channel: string,
    cooldownSeconds = 60
  ): Promise<void> {
    const key = `ratelimit:resend:${channel}:${identifier.toLowerCase().trim()}`;
    this.cooldownStore.set(key, Date.now() + cooldownSeconds * 1000);
  }

  private getRecentAttempts(key: string, windowMs: number, now: number): number[] {
    const existing = this.memoryStore.get(key) || [];
    const valid = existing.filter((ts) => now - ts < windowMs);
    this.memoryStore.set(key, valid);
    return valid;
  }

  private recordAttempt(key: string, now: number): void {
    const existing = this.memoryStore.get(key) || [];
    existing.push(now);
    this.memoryStore.set(key, existing);
  }

  clear(): void {
    this.memoryStore.clear();
    this.cooldownStore.clear();
  }
}
