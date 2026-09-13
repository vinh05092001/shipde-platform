import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export interface IssuedToken {
  /** Returned to the caller once and never stored. */
  token: string;
  /** Stored instead of the token, so a database leak yields nothing usable. */
  hash: string;
  expiresAt: Date;
}

/**
 * Single-use tokens for password reset, invitations and email verification.
 * Only the SHA-256 of the token is persisted; verification re-hashes the
 * presented value and compares in constant time.
 */
@Injectable()
export class TokenService {
  issue(ttlMinutes: number, bytes = 32): IssuedToken {
    const token = randomBytes(bytes).toString('base64url');
    return {
      token,
      hash: this.digest(token),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    };
  }

  digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  matches(presented: string, storedHash: string): boolean {
    const a = Buffer.from(this.digest(presented), 'hex');
    let b: Buffer;
    try {
      b = Buffer.from(storedHash || '', 'hex');
    } catch {
      return false;
    }
    if (a.length !== b.length || b.length === 0) return false;
    return timingSafeEqual(a, b);
  }

  isExpired(expiresAt: Date | null | undefined): boolean {
    return !expiresAt || expiresAt.getTime() <= Date.now();
  }

  /** Six-digit numeric code for OTP and MFA, drawn from a CSPRNG. */
  numericCode(digits = 6): string {
    const max = 10 ** digits;
    let value: number;
    // Rejection sampling keeps the distribution uniform.
    do {
      value = randomBytes(4).readUInt32BE(0);
    } while (value >= Math.floor(0xffffffff / max) * max);
    return String(value % max).padStart(digits, '0');
  }
}
