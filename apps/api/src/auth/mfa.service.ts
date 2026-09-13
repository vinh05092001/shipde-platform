import { Injectable, Inject } from '@nestjs/common';
import { createHmac, createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DomainError } from '../common/errors';
import { TokenService } from './token.service';
import { APP_CONFIG } from '../config.token';
import type { AppConfig } from '@shipde/config';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
/** Accept the neighbouring steps so a slightly skewed clock still works. */
const TOTP_DRIFT_STEPS = 1;
const RECOVERY_CODE_COUNT = 10;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw DomainError.validation('Khoá MFA không hợp lệ');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * TOTP (RFC 6238) over Node crypto, so MFA adds no third-party dependency.
 * The shared secret is encrypted at rest with AES-256-GCM keyed from the
 * application secret, because a database dump alone must not yield working
 * second factors.
 */
@Injectable()
export class MfaService {
  private readonly key: Buffer;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(APP_CONFIG) config: AppConfig
  ) {
    const material = (config as unknown as Record<string, string>).S3_SECRET_KEY || 'shipde-dev';
    this.key = createHash('sha256').update('mfa:' + material).digest();
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(
      '.'
    );
  }

  private decrypt(stored: string): string {
    const [ivB64, tagB64, dataB64] = (stored || '').split('.');
    if (!ivB64 || !tagB64 || !dataB64) throw DomainError.precondition('Khoá MFA đã hỏng');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString(
      'utf8'
    );
  }

  private codeAt(secret: Buffer, counter: number): string {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac('sha1', secret).update(buf).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3];
    return String(binary % 1_000_000).padStart(6, '0');
  }

  private verifyTotp(secretB32: string, code: string): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    const secret = base32Decode(secretB32);
    const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
    for (let drift = -TOTP_DRIFT_STEPS; drift <= TOTP_DRIFT_STEPS; drift += 1) {
      if (this.codeAt(secret, step + drift) === code) return true;
    }
    return false;
  }

  // --- FEAT-AUTH-05: setup, verify, recovery, admin reset -------------------

  async beginSetup(userId: string, accountLabel: string) {
    const existing = await this.prisma.mfaCredential.findUnique({ where: { user_id: userId } });
    if (existing && existing.confirmed_at) {
      throw DomainError.conflict('MFA đã được bật cho tài khoản này');
    }

    const secret = base32Encode(randomBytes(20));
    const encrypted = this.encrypt(secret);

    await this.prisma.mfaCredential.upsert({
      where: { user_id: userId },
      create: { user_id: userId, secret_encrypted: encrypted },
      update: { secret_encrypted: encrypted, confirmed_at: null, recovery_hashes: [] },
    });

    const issuer = encodeURIComponent('Ship De');
    const label = encodeURIComponent(accountLabel);
    return {
      secret,
      otpauthUrl:
        'otpauth://totp/' + issuer + ':' + label + '?secret=' + secret + '&issuer=' + issuer + '&digits=6&period=' + TOTP_STEP_SECONDS,
    };
  }

  async confirmSetup(userId: string, code: string) {
    const record = await this.prisma.mfaCredential.findUnique({ where: { user_id: userId } });
    if (!record) throw DomainError.notFound('Thiết lập MFA');
    if (record.confirmed_at) throw DomainError.conflict('MFA đã được xác nhận trước đó');

    if (!this.verifyTotp(this.decrypt(record.secret_encrypted), code)) {
      throw DomainError.validation('Mã MFA không đúng');
    }

    // Recovery codes are shown once here and stored only as hashes.
    const plain: string[] = [];
    const hashes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
      const c = randomBytes(5).toString('hex');
      plain.push(c);
      hashes.push(this.tokens.digest(c));
    }

    await this.prisma.mfaCredential.update({
      where: { user_id: userId },
      data: { confirmed_at: new Date(), recovery_hashes: hashes },
    });
    return { enabled: true, recoveryCodes: plain };
  }

  async verify(userId: string, code: string) {
    const record = await this.prisma.mfaCredential.findUnique({ where: { user_id: userId } });
    if (!record || !record.confirmed_at) throw DomainError.precondition('MFA chưa được bật');

    if (this.verifyTotp(this.decrypt(record.secret_encrypted), code)) {
      await this.prisma.mfaCredential.update({
        where: { user_id: userId },
        data: { last_used_at: new Date() },
      });
      return { verified: true, usedRecoveryCode: false };
    }

    // Fall back to a recovery code, which is consumed on use.
    const digest = this.tokens.digest(code);
    const idx = record.recovery_hashes.indexOf(digest);
    if (idx === -1) throw DomainError.validation('Mã MFA không đúng');

    const remaining = record.recovery_hashes.filter((_, i) => i !== idx);
    await this.prisma.mfaCredential.update({
      where: { user_id: userId },
      data: { recovery_hashes: remaining, last_used_at: new Date() },
    });
    return { verified: true, usedRecoveryCode: true, recoveryCodesLeft: remaining.length };
  }

  /** Administrative reset: clears MFA so the user can enrol a new device. */
  async adminReset(userId: string) {
    const record = await this.prisma.mfaCredential.findUnique({ where: { user_id: userId } });
    if (!record) return { reset: false, reason: 'Tài khoản chưa bật MFA' };

    await this.prisma.mfaCredential.delete({ where: { user_id: userId } });
    await this.prisma.deviceSession.updateMany({
      where: { user_id: userId, is_revoked: false },
      data: { is_revoked: true },
    });
    return { reset: true };
  }
}
