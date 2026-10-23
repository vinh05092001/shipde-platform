import { createHmac, randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

// RFC 4648 Base32 alphabet
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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

export function base32Decode(input: string): Buffer {
  const cleanInput = input.toUpperCase().replace(/[=\s-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleanInput.length; i++) {
    const char = cleanInput[i];
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates a 20-byte (160-bit) cryptographically secure random Base32 secret.
 * Output length is 32 Base32 characters.
 */
export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  return base32Encode(bytes);
}

/**
 * Generates a standard 6-digit TOTP code for the given Base32 secret and timestamp (RFC 6238).
 * Period = 30 seconds, Algorithm = SHA1.
 */
export function generateTotpCode(secret: string, timestampMs: number = Date.now()): string {
  const key = base32Decode(secret);
  const epochSeconds = Math.floor(timestampMs / 1000);
  const timeStep = Math.floor(epochSeconds / 30);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(timeStep));

  const hmac = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;

  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binaryCode % 1000000;
  return otp.toString().padStart(6, '0');
}

export interface VerifyTotpResult {
  valid: boolean;
  acceptedStep?: bigint;
  error?: 'INVALID_CODE' | 'STEP_REPLAYED' | 'EXPIRED';
}

/**
 * Verifies a 6-digit TOTP code within an allowed window of [-1, 0, +1] 30s steps (RFC 6238).
 * Rejects any step <= lastAcceptedStep to prevent replay attacks (BR-AUTH-15, AC-AUTH-05-03).
 */
export function verifyTotpCode(
  code: string,
  secret: string,
  lastAcceptedStep: bigint | null = null,
  timestampMs: number = Date.now()
): VerifyTotpResult {
  const normalizedCode = code.trim();
  if (!/^\d{6}$/.test(normalizedCode)) {
    return { valid: false, error: 'INVALID_CODE' };
  }

  const key = base32Decode(secret);
  const epochSeconds = Math.floor(timestampMs / 1000);
  const currentStep = BigInt(Math.floor(epochSeconds / 30));

  // Check window: currentStep - 1, currentStep, currentStep + 1
  const candidateSteps = [currentStep, currentStep - 1n, currentStep + 1n];

  for (const step of candidateSteps) {
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigInt64BE(step);

    const hmac = createHmac('sha1', key).update(counterBuffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;

    const binaryCode =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    const candidateOtp = (binaryCode % 1000000).toString().padStart(6, '0');

    if (candidateOtp === normalizedCode) {
      if (lastAcceptedStep !== null && step <= lastAcceptedStep) {
        return { valid: false, error: 'STEP_REPLAYED' };
      }
      return { valid: true, acceptedStep: step };
    }
  }

  return { valid: false, error: 'INVALID_CODE' };
}

/**
 * Generates an otpauth:// provisioning URI for QR code generation (BR-AUTH-14).
 */
export function generateProvisioningUri(options: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = options.issuer || 'Ship Dễ';
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(options.accountName)}`;
  return `otpauth://totp/${label}?secret=${encodeURIComponent(options.secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Derives a 32-byte key from string or buffer for AES-256-GCM encryption.
 */
function deriveEncryptionKey(keyInput: string | Buffer): Buffer {
  if (Buffer.isBuffer(keyInput) && keyInput.length === 32) {
    return keyInput;
  }
  if (typeof keyInput === 'string' && /^[0-9a-fA-F]{64}$/.test(keyInput)) {
    return Buffer.from(keyInput, 'hex');
  }
  return createHash('sha256').update(keyInput).digest();
}

/**
 * Encrypts a plaintext secret using AES-256-GCM.
 * Output format: `v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`.
 */
export function encryptMfaSecret(plaintext: string, keyInput: string | Buffer): string {
  const key = deriveEncryptionKey(keyInput);
  const iv = randomBytes(12); // 96-bit IV standard for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

/**
 * Decrypts an AES-256-GCM encrypted secret.
 */
export function decryptMfaSecret(payload: string, keyInput: string | Buffer): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unsupported or malformed MFA secret ciphertext');
  }

  const [, ivHex, tagHex, ciphertextHex] = parts;
  const key = deriveEncryptionKey(keyInput);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Normalizes a recovery code by stripping whitespace, hyphens, and converting to uppercase.
 */
export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Computes a non-reversible SHA-256 verifier for a recovery code (BR-AUTH-17).
 */
export function hashRecoveryCode(code: string): string {
  const normalized = normalizeRecoveryCode(code);
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Generates exactly `count` (default 10) high-entropy single-use recovery codes.
 * Returns plaintext formatted as `XXXX-XXXX-XXXX-XXXX` (64 bits of entropy) and their irreversible SHA-256 hashes.
 */
export function generateRecoveryCodes(count: number = 10): {
  plaintext: string[];
  hashes: string[];
} {
  const plaintext: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < count; i++) {
    // 8 random bytes (64 bits) -> 16 hex characters formatted as 4-4-4-4
    const bytes = randomBytes(8).toString('hex').toUpperCase();
    const formatted = bytes.match(/.{4}/g)!.join('-');
    plaintext.push(formatted);
    hashes.push(hashRecoveryCode(formatted));
  }

  return { plaintext, hashes };
}
