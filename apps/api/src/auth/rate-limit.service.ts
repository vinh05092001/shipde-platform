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
    const windowSeconds = 3600;

    // 1. Check IP limit (5 per hour)
    const ipKey = `ratelimit:reg:ip:${ip}`;
    const ipCheck = await this.getAttempts(ipKey, windowSeconds);
    if (ipCheck.count >= 5) {
      return {
        allowed: false,
        retryAfterSeconds: ipCheck.retryAfterSeconds,
        reason: 'Too many registration attempts from this IP address',
      };
    }

    // 2. Check email limit (3 per hour)
    if (email) {
      const emailKey = `ratelimit:reg:email:${email.toLowerCase().trim()}`;
      const emailCheck = await this.getAttempts(emailKey, windowSeconds);
      if (emailCheck.count >= 3) {
        return {
          allowed: false,
          retryAfterSeconds: emailCheck.retryAfterSeconds,
          reason: 'Too many registration attempts for this email',
        };
      }
    }

    // 3. Check phone limit (3 per hour)
    if (phone) {
      const phoneKey = `ratelimit:reg:phone:${phone.trim()}`;
      const phoneCheck = await this.getAttempts(phoneKey, windowSeconds);
      if (phoneCheck.count >= 3) {
        return {
          allowed: false,
          retryAfterSeconds: phoneCheck.retryAfterSeconds,
          reason: 'Too many registration attempts for this phone number',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record a registration attempt.
   * Can record IP-only upfront (to prevent enumeration probing) or full identifiers.
   */
  async recordRegistrationAttempt(ip?: string, email?: string, phone?: string): Promise<void> {
    const windowSeconds = 3600;
    if (ip) {
      await this.recordAttemptKey(`ratelimit:reg:ip:${ip}`, windowSeconds);
    }
    if (email) {
      await this.recordAttemptKey(
        `ratelimit:reg:email:${email.toLowerCase().trim()}`,
        windowSeconds
      );
    }
    if (phone) {
      await this.recordAttemptKey(`ratelimit:reg:phone:${phone.trim()}`, windowSeconds);
    }
  }

  /**
   * Check resend verification limits (BR-AUTH-08):
   * - 60 seconds cooldown per identifier and channel
   * - Maximum 5 resends per hour per identifier
   */
  async checkResendLimit(identifier: string, channel: string): Promise<RateLimitResult> {
    const cleanId = identifier.toLowerCase().trim();
    const cooldownKey = `ratelimit:resend:cooldown:${channel}:${cleanId}`;
    const hourlyKey = `ratelimit:resend:hourly:${channel}:${cleanId}`;

    // 1. Check 60s cooldown
    const cooldownSeconds = await this.getCooldown(cooldownKey);
    if (cooldownSeconds !== null && cooldownSeconds > 0) {
      return {
        allowed: false,
        retryAfterSeconds: cooldownSeconds,
        reason: `Please wait ${cooldownSeconds} seconds before requesting another code`,
      };
    }

    // 2. Check 5 resends per hour (BR-AUTH-08)
    const hourlyCheck = await this.getAttempts(hourlyKey, 3600);
    if (hourlyCheck.count >= 5) {
      return {
        allowed: false,
        retryAfterSeconds: hourlyCheck.retryAfterSeconds,
        reason: `Đã vượt quá số lần yêu cầu mã xác thực trong 1 giờ (tối đa 5 lần/giờ). Vui lòng thử lại sau ${hourlyCheck.retryAfterSeconds} giây.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check forgot password rate limits (FEAT-AUTH-04):
   * - IP: max 5 attempts per 3600 seconds
   * - Identifier (email or phone): max 3 attempts per 3600 seconds
   *
   * `subject` says which of the two this is. It used to be guessed from the
   * string — "IP addresses typically don't contain @ or ." — and every IPv4
   * address contains three dots, so every IP was given the stricter
   * identifier limit of 3 instead of the 5 AC-05 specifies. The caller
   * already knows which it is passing, so it says so.
   */
  async checkForgotPasswordLimit(
    identifier: string,
    subject: 'ip' | 'identifier' = 'identifier'
  ): Promise<RateLimitResult> {
    const windowSeconds = 3600;
    const key = `ratelimit:forgot:${identifier}`;

    const check = await this.getAttempts(key, windowSeconds);
    const maxAttempts = subject === 'ip' ? 5 : 3;

    if (check.count >= maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: check.retryAfterSeconds,
        reason: `Too many forgot password attempts for ${identifier}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a forgot password attempt.
   */
  async recordForgotPasswordAttempt(ip: string, identifier: string): Promise<void> {
    const windowSeconds = 3600;
    await this.recordAttemptKey(`ratelimit:forgot:${ip}`, windowSeconds);
    await this.recordAttemptKey(`ratelimit:forgot:${identifier}`, windowSeconds);
  }

  async recordResendAttempt(
    identifier: string,
    channel: string,
    cooldownSeconds = 60
  ): Promise<void> {
    const cleanId = identifier.toLowerCase().trim();
    const cooldownKey = `ratelimit:resend:cooldown:${channel}:${cleanId}`;
    const hourlyKey = `ratelimit:resend:hourly:${channel}:${cleanId}`;

    await this.setCooldown(cooldownKey, cooldownSeconds);
    await this.recordAttemptKey(hourlyKey, 3600);
  }

  /**
   * Check OTP brute-force limits for phone (BR-AUTH-06):
   * - Maximum 5 failed attempts per 15-minute OTP validity window
   */
  async checkOtpAttemptLimit(phone: string): Promise<RateLimitResult> {
    const key = `ratelimit:otp:fail:${phone.trim()}`;
    const windowSeconds = 900; // 15 minutes
    const check = await this.getAttempts(key, windowSeconds);
    if (check.count >= 5) {
      return {
        allowed: false,
        retryAfterSeconds: check.retryAfterSeconds,
        reason: 'Quá nhiều lần thử mã OTP không chính xác. Vui lòng yêu cầu mã xác thực mới.',
      };
    }
    return { allowed: true };
  }

  async recordOtpFailure(phone: string): Promise<number> {
    const key = `ratelimit:otp:fail:${phone.trim()}`;
    const windowSeconds = 900;
    await this.recordAttemptKey(key, windowSeconds);
    const check = await this.getAttempts(key, windowSeconds);
    return check.count;
  }

  async resetOtpAttempts(phone: string): Promise<void> {
    const key = `ratelimit:otp:fail:${phone.trim()}`;
    if (this.redisService) {
      try {
        const client = this.redisService.getClient();
        if (client.status === 'ready') {
          await client.del(key);
        }
      } catch {
        // ignore
      }
    }
    this.memoryStore.delete(key);
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers: Distributed Redis with In-Memory Safe Fallback
  // ---------------------------------------------------------------------------

  private async getAttempts(
    key: string,
    windowSeconds: number
  ): Promise<{ count: number; retryAfterSeconds: number }> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    if (this.redisService) {
      try {
        const client = this.redisService.getClient();
        if (client.status === 'ready') {
          const clearBefore = now - windowMs;
          const pipeline = client.pipeline();
          pipeline.zremrangebyscore(key, '-inf', clearBefore);
          pipeline.zcard(key);
          pipeline.zrange(key, 0, 0, 'WITHSCORES');
          const results = await pipeline.exec();
          if (results) {
            const count = (results[1][1] as number) || 0;
            const oldest = results[2][1] as string[];
            let retryAfter = 1;
            if (oldest && oldest.length >= 2) {
              const earliestTs = parseInt(oldest[1], 10);
              retryAfter = Math.ceil((earliestTs + windowMs - now) / 1000);
            }
            return { count, retryAfterSeconds: Math.max(1, retryAfter) };
          }
        }
      } catch {
        // Fallback to in-memory store
      }
    }

    // In-memory fallback with automatic eviction of expired entries
    const existing = this.memoryStore.get(key) || [];
    const valid = existing.filter((ts) => now - ts < windowMs);
    if (valid.length === 0) {
      this.memoryStore.delete(key);
      return { count: 0, retryAfterSeconds: 1 };
    }
    this.memoryStore.set(key, valid);
    const earliest = valid[0];
    const retryAfter = Math.ceil((earliest + windowMs - now) / 1000);
    return { count: valid.length, retryAfterSeconds: Math.max(1, retryAfter) };
  }

  private async recordAttemptKey(key: string, windowSeconds: number): Promise<void> {
    const now = Date.now();

    if (this.redisService) {
      try {
        const client = this.redisService.getClient();
        if (client.status === 'ready') {
          const member = `${now}:${Math.random().toString(36).substring(2, 8)}`;
          const pipeline = client.pipeline();
          pipeline.zadd(key, now, member);
          pipeline.expire(key, windowSeconds + 60);
          await pipeline.exec();
        }
      } catch {
        // Fallback
      }
    }

    // Record in-memory
    const existing = this.memoryStore.get(key) || [];
    existing.push(now);
    this.memoryStore.set(key, existing);
  }

  private async getCooldown(key: string): Promise<number | null> {
    if (this.redisService) {
      try {
        const client = this.redisService.getClient();
        if (client.status === 'ready') {
          const ttl = await client.ttl(key);
          if (ttl > 0) {
            return ttl;
          }
        }
      } catch {
        // Fallback
      }
    }

    const lockedUntil = this.cooldownStore.get(key);
    if (lockedUntil) {
      const now = Date.now();
      if (lockedUntil > now) {
        return Math.ceil((lockedUntil - now) / 1000);
      }
      this.cooldownStore.delete(key);
    }
    return null;
  }

  private async setCooldown(key: string, cooldownSeconds: number): Promise<void> {
    if (this.redisService) {
      try {
        const client = this.redisService.getClient();
        if (client.status === 'ready') {
          await client.set(key, '1', 'EX', cooldownSeconds);
        }
      } catch {
        // Fallback
      }
    }

    this.cooldownStore.set(key, Date.now() + cooldownSeconds * 1000);
  }

  // --- FEAT-AUTH-03: login rate limits (BR-AUTH-11 / CD-9) ---

  /** Password login IP gate: max 10 attempts per 15 minutes per IP. */
  async checkLoginIpLimit(ip: string): Promise<RateLimitResult> {
    const windowSeconds = 900;
    const check = await this.getAttempts(`ratelimit:login:ip:${ip}`, windowSeconds);
    if (check.count >= 10) {
      return {
        allowed: false,
        retryAfterSeconds: check.retryAfterSeconds,
        reason: 'Quá nhiều lần thử đăng nhập từ địa chỉ IP này',
      };
    }
    return { allowed: true };
  }

  async recordLoginIpAttempt(ip: string): Promise<void> {
    await this.recordAttemptKey(`ratelimit:login:ip:${ip}`, 900);
  }

  /** Password login identifier gate: max 5 failures per 15 minutes per identifier. */
  async checkLoginIdentifierFailureLimit(identifier: string): Promise<RateLimitResult> {
    const windowSeconds = 900;
    const cleanId = identifier.toLowerCase().trim();
    const check = await this.getAttempts(`ratelimit:login:fail:${cleanId}`, windowSeconds);
    if (check.count >= 5) {
      return {
        allowed: false,
        retryAfterSeconds: check.retryAfterSeconds,
        reason: 'Quá nhiều lần đăng nhập thất bại cho tài khoản này',
      };
    }
    return { allowed: true };
  }

  /** Records a failed login for the identifier and returns the failure count in the window. */
  async recordLoginIdentifierFailure(identifier: string): Promise<number> {
    const cleanId = identifier.toLowerCase().trim();
    await this.recordAttemptKey(`ratelimit:login:fail:${cleanId}`, 900);
    const check = await this.getAttempts(`ratelimit:login:fail:${cleanId}`, 900);
    return check.count;
  }

  /** A successful login resets the identifier failure counter (the IP counter is NOT reset). */
  async resetLoginIdentifierFailures(identifier: string): Promise<void> {
    await this.resetKey(`ratelimit:login:fail:${identifier.toLowerCase().trim()}`);
  }

  /** Login OTP requests per IP: max 10 per hour (BR-AUTH-12). */
  async checkLoginOtpIpLimit(ip: string): Promise<RateLimitResult> {
    const windowSeconds = 3600;
    const check = await this.getAttempts(`ratelimit:login:otpreq:ip:${ip}`, windowSeconds);
    if (check.count >= 10) {
      return {
        allowed: false,
        retryAfterSeconds: check.retryAfterSeconds,
        reason: 'Quá nhiều yêu cầu mã OTP từ địa chỉ IP này',
      };
    }
    return { allowed: true };
  }

  async recordLoginOtpIpAttempt(ip: string): Promise<void> {
    await this.recordAttemptKey(`ratelimit:login:otpreq:ip:${ip}`, 3600);
  }

  /** Login OTP requests per identifier: 60s cooldown + max 5 per hour (BR-AUTH-12). */
  async checkLoginOtpRequestLimit(identifier: string): Promise<RateLimitResult> {
    const cleanId = identifier.toLowerCase().trim();
    const cooldownKey = `ratelimit:login:otpreq:cooldown:${cleanId}`;
    const hourlyKey = `ratelimit:login:otpreq:id:${cleanId}`;

    const cooldownSeconds = await this.getCooldown(cooldownKey);
    if (cooldownSeconds !== null && cooldownSeconds > 0) {
      return {
        allowed: false,
        retryAfterSeconds: cooldownSeconds,
        reason: 'Vui lòng chờ trước khi yêu cầu mã OTP mới',
      };
    }

    const hourly = await this.getAttempts(hourlyKey, 3600);
    if (hourly.count >= 5) {
      return {
        allowed: false,
        retryAfterSeconds: hourly.retryAfterSeconds,
        reason: 'Quá nhiều yêu cầu mã OTP cho tài khoản này',
      };
    }

    return { allowed: true };
  }

  async recordLoginOtpRequest(identifier: string, cooldownSeconds = 60): Promise<void> {
    const cleanId = identifier.toLowerCase().trim();
    await this.setCooldown(`ratelimit:login:otpreq:cooldown:${cleanId}`, cooldownSeconds);
    await this.recordAttemptKey(`ratelimit:login:otpreq:id:${cleanId}`, 3600);
  }

  private async resetKey(key: string): Promise<void> {
    if (this.redisService) {
      try {
        const client = this.redisService.getClient();
        if (client.status === 'ready') {
          await client.del(key);
        }
      } catch {
        // Fallback to in-memory reset below
      }
    }
    this.memoryStore.delete(key);
  }

  clear(): void {
    this.memoryStore.clear();
    this.cooldownStore.clear();
  }
}
