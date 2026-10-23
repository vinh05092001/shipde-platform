import { createHmac, randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

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

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

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

export function encryptMfaSecret(plaintext: string, keyInput: string | Buffer): string {
  let key: Buffer;
  if (Buffer.isBuffer(keyInput) && keyInput.length === 32) {
    key = keyInput;
  } else if (typeof keyInput === 'string' && /^[0-9a-fA-F]{64}$/.test(keyInput)) {
    key = Buffer.from(keyInput, 'hex');
  } else {
    key = createHash('sha256').update(keyInput).digest();
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function hashRecoveryCode(code: string): string {
  const normalized = normalizeRecoveryCode(code);
  return createHash('sha256').update(normalized).digest('hex');
}
