import * as crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Base32 encode a buffer into an RFC 4648 string (no padding).
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Base32 decode an RFC 4648 string into a Buffer.
 */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generate a new cryptographically secure 20-byte TOTP secret in Base32.
 */
export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

/**
 * Calculate HOTP value for a given counter (RFC 4226).
 */
export function generateHotp(secretBuffer: Buffer, counter: bigint, digits = 6): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(counter, 0);

  const hmac = crypto.createHmac('sha1', secretBuffer);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const strCode = (code % Math.pow(10, digits)).toString();
  return strCode.padStart(digits, '0');
}

/**
 * Generate TOTP for a given timestamp (default: now, 30s period, 6 digits).
 */
export function generateTotp(
  base32Secret: string,
  optionsOrTimestamp?:
    number | { timestamp?: number; timestampMs?: number; periodSeconds?: number },
  periodSeconds = 30
): string {
  let ts = Date.now();
  let period = periodSeconds;
  if (typeof optionsOrTimestamp === 'number') {
    ts = optionsOrTimestamp;
  } else if (typeof optionsOrTimestamp === 'object' && optionsOrTimestamp !== null) {
    ts = optionsOrTimestamp.timestamp ?? optionsOrTimestamp.timestampMs ?? Date.now();
    period = optionsOrTimestamp.periodSeconds ?? periodSeconds;
  }
  const secretBuffer = base32Decode(base32Secret);
  const counter = BigInt(Math.floor(ts / 1000 / period));
  return generateHotp(secretBuffer, counter, 6);
}

/**
 * Verify TOTP within standard window [-1, 0, +1] steps.
 * Rejects replay if step <= lastAcceptedStep.
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  options: {
    timestamp?: number;
    timestampMs?: number;
    periodSeconds?: number;
    lastAcceptedStep?: bigint | null;
    window?: number; // default: 1
  } = {}
): { valid: boolean; step?: bigint; error?: string } {
  if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return { valid: false, error: 'INVALID_FORMAT' };
  }

  const now = options.timestampMs ?? options.timestamp ?? Date.now();
  const period = options.periodSeconds ?? 30;
  const currentStep = BigInt(Math.floor(now / 1000 / period));
  const secretBuffer = base32Decode(base32Secret);
  const window = options.window ?? 1;

  for (let offset = -window; offset <= window; offset++) {
    const step = currentStep + BigInt(offset);
    const expected = generateHotp(secretBuffer, step, 6);
    if (crypto.timingSafeEqual(Buffer.from(code.trim()), Buffer.from(expected))) {
      if (options.lastAcceptedStep !== null && options.lastAcceptedStep !== undefined) {
        if (step <= options.lastAcceptedStep) {
          return { valid: false, error: 'REPLAYED_STEP' };
        }
      }
      return { valid: true, step };
    }
  }

  return { valid: false, error: 'CODE_MISMATCH' };
}

/**
 * AES-256-GCM encryption for storing secrets at rest.
 */
function getEncryptionKey(): Buffer {
  const configured =
    process.env.MFA_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'shipde-mfa-default-encryption-secret-key-32';
  return crypto.createHash('sha256').update(configured).digest();
}

export function encryptSecret(plainSecret: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

export function decryptSecret(encryptedJson: string): string {
  const { iv, tag, data } = JSON.parse(encryptedJson);
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Generate 10 high-entropy recovery codes.
 * Returns plaintext list and their verifiers (SHA-256 hashes).
 */
export function generateRecoveryCodes(count = 10): { plaintext: string[]; hashed: string[] } {
  const plaintext: string[] = [];
  const hashed: string[] = [];

  for (let i = 0; i < count; i++) {
    const part1 = crypto.randomBytes(3).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(3).toString('hex').toUpperCase();
    const code = `${part1}-${part2}`;
    plaintext.push(code);
    hashed.push(hashRecoveryCode(code));
  }

  return { plaintext, hashed };
}

export function hashRecoveryCode(code: string): string {
  const normalized = code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function verifyRecoveryCode(input: string, storedHash: string): boolean {
  const inputHash = hashRecoveryCode(input);
  return crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(storedHash));
}

/**
 * Generate an opaque challenge token and its stored hash.
 */
export function generateMfaChallengeToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashMfaChallengeToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}
