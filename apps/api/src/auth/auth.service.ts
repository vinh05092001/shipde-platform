import { Injectable, Inject } from '@nestjs/common';
import { RoleEnum, VerificationChannelEnum } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainError } from '../common/errors';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

export interface RegisterInput {
  merchantName: string;
  merchantCode: string;
  email: string;
  phone: string;
  fullName: string;
  password: string;
  acceptedTerms: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
  merchantCode?: string;
  deviceId: string;
  deviceModel?: string;
  ip?: string;
}

/** Failed logins tolerated inside LOCKOUT_WINDOW_MIN before refusing outright. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MIN = 15;
const VERIFICATION_TTL_MIN = 30;
const RESET_TTL_MIN = 60;
const MAX_VERIFY_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService
  ) {}

  // --- FEAT-AUTH-01: self-registration -------------------------------------

  async register(input: RegisterInput) {
    if (!input.acceptedTerms) {
      throw DomainError.validation('Phải chấp nhận điều khoản sử dụng', [
        { field: 'acceptedTerms', message: 'Bắt buộc' },
      ]);
    }

    const existingMerchant = await this.prisma.merchant.findUnique({
      where: { code: input.merchantCode },
    });
    if (existingMerchant) {
      throw DomainError.conflict('Mã cửa hàng đã được sử dụng', [
        { field: 'merchantCode', message: 'Đã tồn tại' },
      ]);
    }

    // Anti-abuse: one unverified registration per contact at a time.
    const pending = await this.prisma.user.findFirst({
      where: { email: input.email, status: 'pending_verification' },
    });
    if (pending) {
      throw DomainError.conflict(
        'Email này đang có một đăng ký chờ xác thực. Hãy kiểm tra hộp thư hoặc yêu cầu gửi lại mã.'
      );
    }

    const passwordHash = await this.passwords.hash(input.password);

    const created = await this.prisma.$transaction(async (tx) => {
      const merchant = await tx.merchant.create({
        data: { name: input.merchantName, code: input.merchantCode, status: 'pending' },
      });
      const user = await tx.user.create({
        data: {
          merchant_id: merchant.id,
          email: input.email,
          phone: input.phone,
          full_name: input.fullName,
          password_hash: passwordHash,
          role: RoleEnum.OWNER,
          status: 'pending_verification',
        },
      });
      return { merchant, user };
    });

    const verification = await this.issueVerification(
      created.user.id,
      VerificationChannelEnum.EMAIL,
      input.email
    );

    return {
      merchantId: created.merchant.id,
      userId: created.user.id,
      status: created.user.status,
      // Delivery is the notification worker's job. Only the expiry is surfaced
      // here; the code itself never leaves issueVerification.
      verification: { channel: 'EMAIL', expiresAt: verification.expiresAt },
    };
  }

  private async issueVerification(
    userId: string,
    channel: VerificationChannelEnum,
    destination: string
  ) {
    const issued = this.tokens.issue(VERIFICATION_TTL_MIN);
    const code = this.tokens.numericCode();
    const codeHash = this.tokens.digest(code);

    await this.prisma.verificationToken.create({
      data: {
        user_id: userId,
        channel,
        destination,
        token_hash: codeHash,
        expires_at: issued.expiresAt,
      },
    });
    return { code, expiresAt: issued.expiresAt };
  }

  // --- FEAT-AUTH-02 support: verify a contact channel ----------------------

  async verifyContact(userId: string, code: string) {
    const record = await this.prisma.verificationToken.findFirst({
      where: { user_id: userId, consumed_at: null },
      orderBy: { created_at: 'desc' },
    });
    if (!record) throw DomainError.notFound('Mã xác thực');

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      throw DomainError.rateLimited('Đã nhập sai quá nhiều lần, hãy yêu cầu mã mới');
    }
    if (this.tokens.isExpired(record.expires_at)) {
      throw DomainError.precondition('Mã xác thực đã hết hạn');
    }
    if (!this.tokens.matches(code, record.token_hash)) {
      await this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw DomainError.validation('Mã xác thực không đúng');
    }

    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { consumed_at: new Date() },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { status: 'active' } }),
    ]);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await this.prisma.merchant.update({
        where: { id: user.merchant_id },
        data: { status: 'active' },
      });
    }
    return { verified: true };
  }

  // --- FEAT-AUTH-03: login --------------------------------------------------

  async login(input: LoginInput) {
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MIN * 60_000);
    const failures = await this.prisma.loginAttempt.count({
      where: { email: input.email, succeeded: false, created_at: { gte: since } },
    });
    if (failures >= MAX_FAILED_ATTEMPTS) {
      throw DomainError.rateLimited(
        'Tài khoản tạm khoá ' + LOCKOUT_WINDOW_MIN + ' phút do đăng nhập sai quá nhiều lần'
      );
    }

    const user = await this.prisma.user.findFirst({
      where: {
        email: input.email,
        ...(input.merchantCode ? { merchant: { code: input.merchantCode } } : {}),
      },
      include: { merchant: true, mfa_credential: true },
    });

    // A missing user and a wrong password must be indistinguishable, so the
    // same generic failure is recorded and returned for both.
    const ok = user ? await this.passwords.verify(input.password, user.password_hash) : false;
    if (!user || !ok) {
      await this.recordAttempt(input, false, user ? 'bad_password' : 'unknown_user');
      throw DomainError.unauthenticated('Email hoặc mật khẩu không đúng');
    }

    if (user.status === 'pending_verification') {
      await this.recordAttempt(input, false, 'unverified');
      throw DomainError.precondition(
        'Tài khoản chưa xác thực. Hãy xác thực email trước khi đăng nhập.'
      );
    }
    if (user.status !== 'active') {
      await this.recordAttempt(input, false, 'disabled');
      throw DomainError.forbidden('Tài khoản đã bị vô hiệu hoá');
    }

    // A confirmed MFA credential means the password alone does not open a session.
    if (user.mfa_credential && user.mfa_credential.confirmed_at) {
      await this.recordAttempt(input, true, 'mfa_required');
      return { mfaRequired: true, userId: user.id };
    }

    const session = await this.openSession(user.id, input);
    await this.recordAttempt(input, true, null);

    if (this.passwords.needsRehash(user.password_hash)) {
      const rehashed = await this.passwords.hash(input.password);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { password_hash: rehashed },
      });
    }

    return {
      mfaRequired: false,
      userId: user.id,
      merchantId: user.merchant_id,
      role: user.role,
      sessionId: session.id,
    };
  }

  private recordAttempt(input: LoginInput, succeeded: boolean, reason: string | null) {
    return this.prisma.loginAttempt.create({
      data: { email: input.email, ip: input.ip ?? null, succeeded, reason },
    });
  }

  private openSession(userId: string, input: LoginInput) {
    return this.prisma.deviceSession.create({
      data: {
        user_id: userId,
        device_id: input.deviceId,
        device_model: input.deviceModel ?? null,
      },
    });
  }

  // --- FEAT-AUTH-04: password recovery -------------------------------------

  async requestPasswordReset(email: string, ip?: string) {
    const user = await this.prisma.user.findFirst({ where: { email } });
    // Always report success: revealing which emails exist is an enumeration hole.
    if (!user) return { requested: true };

    const issued = this.tokens.issue(RESET_TTL_MIN);
    await this.prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token_hash: issued.hash,
        requested_ip: ip ?? null,
        expires_at: issued.expiresAt,
      },
    });
    return { requested: true, expiresAt: issued.expiresAt };
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token_hash: this.tokens.digest(token) },
    });
    if (!record || record.consumed_at) {
      throw DomainError.validation('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã dùng');
    }
    if (this.tokens.isExpired(record.expires_at)) {
      throw DomainError.precondition('Liên kết đặt lại mật khẩu đã hết hạn');
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { consumed_at: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.user_id },
        data: { password_hash: passwordHash },
      }),
      // Recovery implies the old credential may be compromised: cut every session.
      this.prisma.deviceSession.updateMany({
        where: { user_id: record.user_id, is_revoked: false },
        data: { is_revoked: true },
      }),
    ]);
    return { reset: true };
  }

  // --- FEAT-AUTH-06: session management ------------------------------------

  async listSessions(userId: string) {
    const sessions = await this.prisma.deviceSession.findMany({
      where: { user_id: userId },
      orderBy: { last_active_at: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceId: s.device_id,
      deviceModel: s.device_model,
      revoked: s.is_revoked,
      createdAt: s.created_at,
      lastActiveAt: s.last_active_at,
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.deviceSession.findFirst({
      where: { id: sessionId, user_id: userId },
    });
    if (!session) throw DomainError.notFound('Phiên đăng nhập', sessionId);
    if (session.is_revoked) return { revoked: true, alreadyRevoked: true };

    await this.prisma.deviceSession.update({
      where: { id: sessionId },
      data: { is_revoked: true },
    });
    return { revoked: true, alreadyRevoked: false };
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string) {
    const result = await this.prisma.deviceSession.updateMany({
      where: {
        user_id: userId,
        is_revoked: false,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { is_revoked: true },
    });
    return { revokedCount: result.count };
  }
}
