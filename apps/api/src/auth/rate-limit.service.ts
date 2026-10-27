import { Injectable, Optional, Inject } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Exact slot consumed by an atomic consume call. Refunds must target this slot only so a
 * concurrent request's slot is never removed (FEAT-USR-01 SECURITY-NFR invitation rate limit).
 */
export interface AttemptReservation {
  key: string;
  member: string;
  timestamp: number;
  backend: 'redis' | 'memory';
}

/** Slots consumed by one invitation dispatch quota check; refunded at most once. */
export interface InvitationDispatchReservation {
  attempts: AttemptReservation[];
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: string;
  reservation?: InvitationDispatchReservation;
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

  /**
   * Check reset token verification limits (FEAT-AUTH-04):
   * - Maximum 5 failed attempts per 1-hour window per IP
   */
  async checkResetTokenLimit(ip: string): Promise<RateLimitResult> {
    const key = `ratelimit:reset:fail:${ip}`;
    const windowSeconds = 3600;
    const check = await this.getAttempts(key, windowSeconds);
    if (check.count >= 5) {
      return {
        allowed: false,
        retryAfterSeconds: check.retryAfterSeconds,
        reason: 'Quá nhiều lần thử mã không chính xác. Vui lòng thử lại sau.',
      };
    }
    return { allowed: true };
  }

  async recordResetTokenFailure(ip: string): Promise<number> {
    const key = `ratelimit:reset:fail:${ip}`;
    const windowSeconds = 3600;
    await this.recordAttemptKey(key, windowSeconds);
    const check = await this.getAttempts(key, windowSeconds);
    return check.count;
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

  // --- FEAT-AUTH-05: MFA challenge rate limits (BR-AUTH-16 / AC-AUTH-05-08 / AC-AUTH-05-24) ---

  /** MFA challenge IP gate: max 10 failed attempts per 15 minutes across any user. */
  async checkMfaIpLimit(ip: string): Promise<RateLimitResult> {
    const windowSeconds = 900;
    const check = await this.getAttempts(`ratelimit:mfa:ip:${ip}`, windowSeconds);
    if (check.count >= 10) {
      return {
        allowed: false,
        retryAfterSeconds: check.retryAfterSeconds,
        reason: 'Quá nhiều lần thử xác thực hai yếu tố từ địa chỉ IP này. Vui lòng thử lại sau.',
      };
    }
    return { allowed: true };
  }

  async recordMfaIpFailure(ip: string): Promise<void> {
    await this.recordAttemptKey(`ratelimit:mfa:ip:${ip}`, 900);
  }

  /** MFA challenge failure gate: max 5 failures per challenge / user in 15 minutes. */
  async checkMfaChallengeLimit(challengeHash: string): Promise<RateLimitResult> {
    const windowSeconds = 900;
    const check = await this.getAttempts(`ratelimit:mfa:challenge:${challengeHash}`, windowSeconds);
    if (check.count >= 5) {
      return {
        allowed: false,
        retryAfterSeconds: check.retryAfterSeconds,
        reason: 'Mã xác thực không chính xác hoặc đã vượt quá số lần thử cho phép.',
      };
    }
    return { allowed: true };
  }

  async recordMfaChallengeFailure(challengeHash: string): Promise<number> {
    await this.recordAttemptKey(`ratelimit:mfa:challenge:${challengeHash}`, 900);
    const check = await this.getAttempts(`ratelimit:mfa:challenge:${challengeHash}`, 900);
    return check.count;
  }

  async resetMfaChallengeFailures(challengeHash: string): Promise<void> {
    await this.resetKey(`ratelimit:mfa:challenge:${challengeHash}`);
  }

  // --- FEAT-USR-01: invitation rate limits (SECURITY-NFR / BR-INV-09) ---

  /**
   * Check invitation dispatch limits (create and resend) with atomic consume-before-dispatch:
   * - IP: max 20 dispatch requests per hour
   * - Recipient identifier (email or phone): max 5 per hour, tenant-scoped
   */
  async checkInvitationDispatchLimit(
    ip: string,
    identifier?: string,
    merchantId?: string
  ): Promise<RateLimitResult> {
    const windowSeconds = 3600;
    const safeIp = ip && ip.trim() ? ip.trim() : 'unknown';
    const ipKey = `ratelimit:invite:dispatch:ip:${safeIp}`;

    // 1. Atomic consume IP limit (20/hour)
    const ipConsume = await this.consumeAttemptKey(ipKey, 20, windowSeconds);
    if (!ipConsume.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: ipConsume.retryAfterSeconds,
        reason: 'Quá nhiều yêu cầu gửi lời mời từ địa chỉ IP này. Vui lòng thử lại sau.',
      };
    }
    const attempts: AttemptReservation[] = [];
    if (ipConsume.reservation) attempts.push(ipConsume.reservation);

    // 2. Atomic consume tenant-scoped recipient limit (5/hour per recipient in merchant)
    if (identifier) {
      const cleanId = identifier.toLowerCase().trim();
      const tenantPrefix = merchantId ? `merchant:${merchantId}:` : '';
      const recipientKey = `ratelimit:invite:dispatch:${tenantPrefix}recipient:${cleanId}`;
      const recipientConsume = await this.consumeAttemptKey(recipientKey, 5, windowSeconds);
      if (!recipientConsume.allowed) {
        // Revert only the IP slot just added if recipient quota was exceeded (Finding 4)
        await this.revertInvitationDispatchAttempt({ attempts });
        return {
          allowed: false,
          retryAfterSeconds: recipientConsume.retryAfterSeconds,
          reason:
            'Đã vượt quá số lần gửi lời mời cho người dùng này trong 1 giờ. Vui lòng thử lại sau.',
        };
      }
      if (recipientConsume.reservation) attempts.push(recipientConsume.reservation);
    }

    return { allowed: true, reservation: { attempts } };
  }

  async recordInvitationDispatchAttempt(
    ip: string,
    identifier?: string,
    merchantId?: string
  ): Promise<void> {
    // No-op to avoid double counting since checkInvitationDispatchLimit atomically consumes quota upfront
  }

  /**
   * Refund exactly the slots captured by checkInvitationDispatchLimit (Round 6 Finding 2).
   * Never removes another request's slot; a reservation is refunded at most once.
   */
  async revertInvitationDispatchAttempt(
    reservation?: InvitationDispatchReservation
  ): Promise<void> {
    if (!reservation) return;
    // Detach slots before awaiting so a concurrent/double refund cannot remove them twice
    const attempts = reservation.attempts.splice(0, reservation.attempts.length);
    for (const attempt of attempts) {
      await this.revertAttemptKey(attempt.key, attempt.member, attempt.timestamp, attempt.backend);
    }
  }

  private async consumeAttemptKey(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{
    allowed: boolean;
    retryAfterSeconds?: number;
    count: number;
    member?: string;
    timestamp?: number;
    reservation?: AttemptReservation;
  }> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const member = `${now}:${Math.random().toString(36).substring(2, 8)}`;

    if (this.redisService) {
      try {
        const client = this.redisService.getClient();
        if (client.status === 'ready') {
          const clearBefore = now - windowMs;
          const lua = `
            local key = KEYS[1]
            local now = tonumber(ARGV[1])
            local clearBefore = tonumber(ARGV[2])
            local limit = tonumber(ARGV[3])
            local windowSeconds = tonumber(ARGV[4])
            local member = ARGV[5]

            redis.call('zremrangebyscore', key, '-inf', clearBefore)
            local count = redis.call('zcard', key)
            if count >= limit then
              local oldest = redis.call('zrange', key, 0, 0, 'WITHSCORES')
              local earliest = (oldest and oldest[2]) and oldest[2] or now
              return {0, count, earliest}
            end
            redis.call('zadd', key, now, member)
            redis.call('expire', key, windowSeconds + 60)
            return {1, count + 1, now}
          `;
          const res = (await client.eval(
            lua,
            1,
            key,
            now.toString(),
            clearBefore.toString(),
            limit.toString(),
            windowSeconds.toString(),
            member
          )) as [number, number, number];
          const allowed = res[0] === 1;
          const count = res[1];
          const earliest = Number(res[2]);
          const retryAfter = Math.max(1, Math.ceil((earliest + windowMs - now) / 1000));
          return {
            allowed,
            retryAfterSeconds: retryAfter,
            count,
            member,
            timestamp: now,
            reservation: allowed ? { key, member, timestamp: now, backend: 'redis' } : undefined,
          };
        } else {
          // Redis configured but client not ready: fail closed across instances (SECURITY-NFR / Round 8 Finding 4)
          return {
            allowed: false,
            retryAfterSeconds: 60,
            count: limit,
            reason: 'Dịch vụ kiểm soát tần suất gặp sự cố. Vui lòng thử lại sau.',
          };
        }
      } catch {
        // Redis error: fail closed across instances (SECURITY-NFR / Round 8 Finding 4)
        return {
          allowed: false,
          retryAfterSeconds: 60,
          count: limit,
          reason: 'Dịch vụ kiểm soát tần suất gặp sự cố. Vui lòng thử lại sau.',
        };
      }
    }

    // In-memory atomic check-and-consume
    const existing = this.memoryStore.get(key) || [];
    const valid = existing.filter((ts) => now - ts < windowMs);
    if (valid.length >= limit) {
      const earliest = valid[0];
      const retryAfter = Math.max(1, Math.ceil((earliest + windowMs - now) / 1000));
      this.memoryStore.set(key, valid);
      return { allowed: false, retryAfterSeconds: retryAfter, count: valid.length };
    }
    valid.push(now);
    this.memoryStore.set(key, valid);
    return {
      allowed: true,
      count: valid.length,
      member,
      timestamp: now,
      reservation: { key, member, timestamp: now, backend: 'memory' },
    };
  }

  /**
   * Remove exactly one previously consumed slot. Without a captured member/timestamp nothing is
   * removed: refunding "the latest" slot could drop a concurrent request's slot (Round 6 Finding 2).
   */
  private async revertAttemptKey(
    key: string,
    member?: string,
    timestamp?: number,
    backend?: 'redis' | 'memory'
  ): Promise<void> {
    if (!member && timestamp === undefined) return;
    if (backend !== 'redis' && timestamp !== undefined) {
      // In-memory slots are stored as timestamps; equal timestamps are interchangeable slots
      const existing = this.memoryStore.get(key);
      const idx = existing ? existing.lastIndexOf(timestamp) : -1;
      if (existing && idx !== -1) {
        existing.splice(idx, 1);
        if (existing.length === 0) {
          this.memoryStore.delete(key);
        } else {
          this.memoryStore.set(key, existing);
        }
      }
    }
    if (backend !== 'memory' && member && this.redisService) {
      try {
        const client = this.redisService.getClient();
        if (client.status === 'ready') {
          await client.zrem(key, member);
        }
      } catch {
        // Fallback ignore
      }
    }
  }

  /**
   * Check invitation verification check limits:
   * - IP: max 30 verification checks per 15 minutes (atomic consume upfront to prevent race conditions)
   */
  async checkInvitationVerifyLimit(ip: string): Promise<RateLimitResult> {
    const windowSeconds = 900;
    const safeIp = ip && ip.trim() ? ip.trim() : 'unknown';
    const key = `ratelimit:invite:verify:ip:${safeIp}`;
    const ipConsume = await this.consumeAttemptKey(key, 30, windowSeconds);
    if (!ipConsume.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: ipConsume.retryAfterSeconds,
        reason: 'Quá nhiều yêu cầu kiểm tra lời mời từ địa chỉ IP này. Vui lòng thử lại sau.',
      };
    }
    return { allowed: true };
  }

  async recordInvitationVerifyAttempt(ip: string): Promise<void> {
    // No-op to avoid double counting since checkInvitationVerifyLimit atomically consumes quota upfront (Finding 4)
  }

  /**
   * Check invitation acceptance rate limits:
   * - IP: max 10 accept attempts per 15 minutes (atomic consume)
   * - Token: max 5 accept attempts per 15 minutes (atomic consume)
   */
  async checkInvitationAcceptLimit(ip: string, tokenHash?: string): Promise<RateLimitResult> {
    const windowSeconds = 900;
    const safeIp = ip && ip.trim() ? ip.trim() : 'unknown';
    const ipKey = `ratelimit:invite:accept:ip:${safeIp}`;
    const ipConsume = await this.consumeAttemptKey(ipKey, 10, windowSeconds);
    if (!ipConsume.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: ipConsume.retryAfterSeconds,
        reason: 'Quá nhiều yêu cầu chấp nhận lời mời từ địa chỉ IP này. Vui lòng thử lại sau.',
      };
    }

    if (tokenHash) {
      const tokenKey = `ratelimit:invite:accept:token:${tokenHash}`;
      const tokenConsume = await this.consumeAttemptKey(tokenKey, 5, windowSeconds);
      if (!tokenConsume.allowed) {
        // Revert only the IP attempt just added (Finding 4)
        await this.revertAttemptKey(
          ipKey,
          ipConsume.member,
          ipConsume.timestamp,
          ipConsume.reservation?.backend
        );
        return {
          allowed: false,
          retryAfterSeconds: tokenConsume.retryAfterSeconds,
          reason: 'Quá nhiều lần thử kích hoạt lời mời này. Vui lòng thử lại sau.',
        };
      }
    }

    return { allowed: true };
  }

  async recordInvitationAcceptAttempt(ip: string, tokenHash?: string): Promise<void> {
    // No-op to avoid double counting since checkInvitationAcceptLimit atomically consumes quota upfront (Finding 4)
  }

  clear(): void {
    this.memoryStore.clear();
    this.cooldownStore.clear();
  }
}
