import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual, ScryptOptions } from 'crypto';

// promisify() drops scrypt's options overload, so wrap it directly.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derived) =>
      err ? reject(err) : resolve(derived)
    );
  });
}

const KEY_LEN = 64;
const SALT_LEN = 16;
// Deliberately above the Node default (16384): password hashing should be slow.
const COST = 32768;
// scrypt needs roughly 128 * N * r bytes; Node's default 32MB cap is below what
// N=32768 requires, so raise it explicitly or the call throws at runtime.
const MAX_MEM = 128 * 1024 * 1024;

/**
 * Password hashing over Node's own scrypt, so the API takes no third-party
 * crypto dependency. The stored format carries its own parameters, which lets
 * the cost be raised later without invalidating existing hashes.
 */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(SALT_LEN);
    const derived = await scryptAsync(plain, salt, KEY_LEN, { N: COST, maxmem: MAX_MEM });
    return ['scrypt', COST, salt.toString('base64'), derived.toString('base64')].join('$');
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    const parts = (stored || '').split('$');
    if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

    const cost = Number(parts[1]);
    if (!Number.isInteger(cost) || cost < 1024) return false;

    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(parts[2], 'base64');
      expected = Buffer.from(parts[3], 'base64');
    } catch {
      return false;
    }
    if (expected.length !== KEY_LEN) return false;

    const derived = await scryptAsync(plain, salt, KEY_LEN, { N: cost, maxmem: MAX_MEM });
    return timingSafeEqual(derived, expected);
  }

  /** True when a hash was produced under weaker parameters than we now use. */
  needsRehash(stored: string): boolean {
    const parts = (stored || '').split('$');
    if (parts.length !== 4 || parts[0] !== 'scrypt') return true;
    return Number(parts[1]) < COST;
  }
}
