import {
  Injectable,
  Inject,
  BadRequestException,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { randomBytes, createHash, randomInt, randomUUID, createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RateLimitService } from './rate-limit.service';
import { hashPassword, verifyPassword } from './password.util';
import { resolveAccessTokenSecret, signAccessToken, verifyAccessToken } from './token.util';
import { VERIFICATION_ADAPTER } from './auth.tokens';
import type { IVerificationDeliveryAdapter } from '@shipde/contracts';
import { formatStructuredLog, AppConfig } from '@shipde/config';
import { APP_CONFIG } from '../config.token';
import { RoleEnum } from '@prisma/client';
import {
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  generateRecoveryCodes,
  verifyRecoveryCode,
  generateMfaChallengeToken,
  hashMfaChallengeToken,
} from './totp.util';

export interface RegisterDto {
  merchant_name: string;
  full_name: string;
  email?: string;
  phone?: string;
  password: string;
  terms_accepted: boolean;
  terms_version: string;
}

export interface VerifyEmailDto {
  token: string;
}

export interface VerifyPhoneDto {
  phone: string;
  otp: string;
}

export interface ResendVerificationDto {
  identifier: string;
  channel: 'email' | 'phone';
}

export interface ForgotPasswordDto {
  identifier: string;
  channel?: 'email' | 'phone';
}

export interface VerifyResetTokenDto {
  token: string;
}

export interface ResetPasswordDto {
  token: string;
  password: string;
  password_confirm: string;
}

export interface LoginDto {
  identifier: string;
  password: string;
  remember_device?: boolean;
}

export interface LoginOtpRequestDto {
  identifier: string;
}

export interface LoginOtpVerifyDto {
  identifier: string;
  otp: string;
}

export interface MfaSetupVerifyDto {
  code: string;
}

export interface MfaChallengeVerifyDto {
  challenge_id: string;
  code: string;
}

export interface MfaRecoveryVerifyDto {
  challenge_id: string;
  recovery_code: string;
}

export interface MfaResetDto {
  reason: string;
}

/** Max failed OTP verify attempts per identifier before the token is consumed (BR-AUTH-12). */
const OTP_MAX_VERIFY_ATTEMPTS = 5;

export interface CanonicalFieldError {
  field: string;
  code: string;
  message: string;
}

export class CanonicalApiException extends HttpException {
  constructor(
    statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly next_action?: string,
    public readonly fields?: CanonicalFieldError[],
    public readonly retryAfterSeconds?: number,
    public readonly data?: Record<string, unknown>
  ) {
    super(
      {
        error: {
          code,
          message,
          retryable,
          next_action,
          fields,
          ...(retryAfterSeconds !== undefined && { cooldown_seconds: retryAfterSeconds }),
          ...(data ? data : {}),
        },
      },
      statusCode
    );
  }
}

@Injectable()
export class AuthService {
  private readonly idempotencyMemoryFallback = new Map<
    string,
    { targetUserId: string; reasonHash: string; response: any }
  >();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateLimitService) private readonly rateLimitService: RateLimitService,
    @Optional()
    @Inject(VERIFICATION_ADAPTER)
    private readonly deliveryAdapter?: IVerificationDeliveryAdapter,
    @Optional()
    @Inject(APP_CONFIG)
    private readonly config?: AppConfig,
    @Optional()
    @Inject(RedisService)
    private readonly redisService?: RedisService
  ) {}

  async resolveActorFromHeader(authHeader?: string): Promise<{
    userId: string;
    merchantId: string;
    role: string;
    scope?: string;
    assurance: string;
  }> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Vui lòng đăng nhập để tiếp tục'
      );
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Phiên đăng nhập không hợp lệ'
      );
    }

    if (token.startsWith('v1.')) {
      try {
        const secret = resolveAccessTokenSecret(this.config?.AUTH_TOKEN_SECRET);
        const claims = verifyAccessToken(token, secret);
        return {
          userId: claims.sub,
          merchantId: claims.mid,
          role: claims.role,
          scope: claims.scope,
          assurance: claims.mfa_verified ? 'MFA' : 'PASSWORD',
        };
      } catch {
        throw new CanonicalApiException(
          HttpStatus.UNAUTHORIZED,
          'UNAUTHENTICATED',
          'Phiên đăng nhập đã hết hạn hoặc không hợp lệ'
        );
      }
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await this.prisma.deviceSession.findFirst({
      where: {
        session_token_hash: tokenHash,
        status: 'ACTIVE',
        expires_at: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!session || !session.user) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Phiên đăng nhập đã hết hạn hoặc bị thu hồi'
      );
    }

    return {
      userId: session.user_id,
      merchantId: session.merchant_id,
      role: session.user.role,
      scope: undefined,
      assurance: session.auth_assurance || 'PASSWORD',
    };
  }

  /**
   * Register a new merchant shop and owner user (FEAT-AUTH-01 / BR-AUTH-01..10)
   */
  async register(dto: RegisterDto, clientIp: string, correlationId: string) {
    const fields: CanonicalFieldError[] = [];

    // 1. Basic field validation (BR-AUTH-01)
    if (!dto.merchant_name || dto.merchant_name.trim().length < 2) {
      fields.push({
        field: 'merchant_name',
        code: 'REQUIRED',
        message: 'Tên cửa hàng phải có ít nhất 2 ký tự',
      });
    }

    if (!dto.full_name || dto.full_name.trim().length < 2) {
      fields.push({
        field: 'full_name',
        code: 'REQUIRED',
        message: 'Họ và tên người đại diện phải có ít nhất 2 ký tự',
      });
    }

    const email = dto.email ? dto.email.trim().toLowerCase() : undefined;
    const phone = dto.phone ? dto.phone.trim() : undefined;

    if (!email && !phone) {
      fields.push({
        field: 'email',
        code: 'REQUIRED',
        message: 'Phải cung cấp ít nhất email hoặc số điện thoại',
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fields.push({
        field: 'email',
        code: 'INVALID_FORMAT',
        message: 'Định dạng email không hợp lệ',
      });
    }

    if (phone && !/^(0|\+84)[3|5|7|8|9][0-9]{8}$/.test(phone.replace(/\s+/g, ''))) {
      fields.push({
        field: 'phone',
        code: 'INVALID_FORMAT',
        message: 'Số điện thoại không hợp lệ theo định dạng Việt Nam',
      });
    }

    // Minimum password policy (BR-AUTH-05: >= 8 chars)
    if (!dto.password || dto.password.length < 8) {
      fields.push({
        field: 'password',
        code: 'TOO_SHORT',
        message: 'Mật khẩu phải có độ dài tối thiểu 8 ký tự',
      });
    }

    // Terms acceptance check (BR-AUTH-04)
    if (dto.terms_accepted !== true || !dto.terms_version) {
      fields.push({
        field: 'terms_accepted',
        code: 'TERMS_NOT_ACCEPTED',
        message: 'Bạn phải đồng ý với Điều khoản dịch vụ và Chính sách bảo mật',
      });
    }

    if (fields.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Dữ liệu đăng ký không hợp lệ',
        false,
        'Vui lòng sửa các trường bị lỗi và thử lại',
        fields
      );
    }

    // 2. Anti-abuse Rate Limiting (BR-AUTH-07)
    const rateLimitCheck = await this.rateLimitService.checkRegistrationLimit(
      clientIp,
      email,
      phone
    );

    if (!rateLimitCheck.allowed) {
      await this.logAudit({
        actor: this.hashIp(clientIp),
        action: 'AUTH_REGISTER_RATE_LIMITED',
        resource: 'auth/register',
        correlationId,
        ipAddress: this.hashIp(clientIp),
      });

      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        rateLimitCheck.reason || 'Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau.',
        true,
        `Vui lòng chờ ${rateLimitCheck.retryAfterSeconds || 3600} giây trước khi thử lại`,
        undefined,
        rateLimitCheck.retryAfterSeconds
      );
    }

    // Record IP registration attempt upfront to bound enumeration probing (BR-AUTH-07)
    await this.rateLimitService.recordRegistrationAttempt(clientIp, undefined, undefined);

    // 3. Global Uniqueness Check (BR-AUTH-03)
    const existingUsers = await this.prisma.user.findMany({
      where: {
        OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      },
      include: {
        merchant: true,
      },
    });

    const conflictResponse = await this.resolveExistingAccountConflict(
      existingUsers,
      email,
      phone,
      clientIp,
      correlationId
    );
    if (conflictResponse) {
      return conflictResponse;
    }

    // 5. Atomic Creation of Merchant and User with Merchant Code Collision Retry (BR-AUTH-01, BR-AUTH-02, BR-AUTH-10)
    const passwordHash = await hashPassword(dto.password);
    let merchant: { id: string } | null = null;
    let user: {
      id: string;
      merchant_id: string;
      email: string | null;
      phone: string | null;
    } | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const merchantCode = this.generateMerchantCode(dto.merchant_name);
        const created = await this.prisma.$transaction(async (tx) => {
          const newMerchant = await tx.merchant.create({
            data: {
              name: dto.merchant_name.trim(),
              code: merchantCode,
              status: 'active',
            },
          });

          const newUser = await tx.user.create({
            data: {
              merchant_id: newMerchant.id,
              full_name: dto.full_name.trim(),
              email: email || null,
              phone: phone || null,
              password_hash: passwordHash,
              role: RoleEnum.OWNER,
              status: 'pending_verification',
              terms_accepted_at: new Date(),
              terms_version: dto.terms_version,
            },
          });

          return { merchant: newMerchant, user: newUser };
        });

        merchant = created.merchant;
        user = created.user;
        break;
      } catch (err: unknown) {
        lastError = err;
        if (this.isUniqueConstraintViolation(err)) {
          const target = (err as { meta?: { target?: string[] | string } })?.meta?.target;
          const isMerchantCodeCollision =
            (Array.isArray(target) && target.includes('code')) ||
            (typeof target === 'string' && target.includes('merchants_code_key'));

          if (isMerchantCodeCollision) {
            // Slug + random code collided on merchant. Retry with fresh random code!
            continue;
          }

          // User identifier concurrency race (BR-AUTH-10)
          const raced = await this.prisma.user.findMany({
            where: {
              OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
            },
          });
          const racedResponse = await this.resolveExistingAccountConflict(
            raced,
            email,
            phone,
            clientIp,
            correlationId
          );
          if (racedResponse) {
            return racedResponse;
          }
        }
        throw err;
      }
    }

    if (!merchant || !user) {
      throw (
        lastError ||
        new Error('Failed to create merchant and owner account due to unresolvable code collision.')
      );
    }

    // Record rate limit attempt for identifiers on successful creation
    await this.rateLimitService.recordRegistrationAttempt(undefined, email, phone);

    // Issue tokens and dispatch
    await this.issueAndSendVerification(user, email, phone, correlationId);

    // Audit log (BR-AUTH-09)
    await this.logAudit({
      merchantId: merchant.id,
      userId: user.id,
      actor: this.hashIp(clientIp),
      action: 'AUTH_REGISTER_SUCCESS',
      resource: `user:${user.id}`,
      details: {
        email: user.email ? this.hashIdentifierForAudit(user.email) : undefined,
        phone: user.phone ? this.hashIdentifierForAudit(user.phone) : undefined,
      },
      correlationId,
      ipAddress: this.hashIp(clientIp),
    });

    return {
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        status: 'PENDING_VERIFICATION' as const,
        email: user.email || undefined,
        phone: user.phone || undefined,
        message: 'Đăng ký thành công. Vui lòng xác thực tài khoản qua email hoặc số điện thoại.',
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * Verify Email Link Token (BR-AUTH-02, BR-AUTH-06)
   */
  async verifyEmail(dto: VerifyEmailDto, correlationId: string) {
    if (!dto.token || dto.token.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Mã token xác thực không được để trống',
        false
      );
    }

    const rawToken = dto.token.trim();
    const hashedToken = this.hashSecret(rawToken);

    // Look up by raw token or hashed digest (backward compatible with seed fixtures).
    // FEAT-AUTH-03 (BR-AUTH-12): only VERIFICATION-purpose tokens may activate an
    // account; a LOGIN OTP can never be used here and vice versa.
    const tokenRecord = await this.prisma.verificationToken.findFirst({
      where: {
        token: { in: [rawToken, hashedToken] },
        channel: 'email',
        purpose: 'VERIFICATION',
      },
      include: {
        user: true,
      },
    });

    if (!tokenRecord) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_TOKEN',
        'Mã xác thực không hợp lệ hoặc không tồn tại',
        false,
        'Vui lòng kiểm tra lại liên kết hoặc yêu cầu gửi lại mã xác thực'
      );
    }

    if (tokenRecord.consumed_at !== null) {
      throw new CanonicalApiException(
        HttpStatus.GONE,
        'TOKEN_ALREADY_CONSUMED',
        'Mã xác thực này đã được sử dụng trước đó',
        false,
        'Vui lòng đăng nhập hoặc yêu cầu mã xác thực mới nếu chưa kích hoạt'
      );
    }

    if (tokenRecord.expires_at < new Date()) {
      throw new CanonicalApiException(
        HttpStatus.GONE,
        'TOKEN_EXPIRED',
        'Mã xác thực đã hết hạn',
        false,
        'Vui lòng yêu cầu gửi lại mã xác thực mới'
      );
    }

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      await tx.verificationToken.update({
        where: { id: tokenRecord.id },
        data: { consumed_at: new Date() },
      });

      return tx.user.update({
        where: { id: tokenRecord.user_id },
        data: {
          email_verified_at: new Date(),
          status: 'active',
        },
      });
    });

    await this.logAudit({
      merchantId: updatedUser.merchant_id,
      userId: updatedUser.id,
      actor: `user:${updatedUser.id}`,
      action: 'AUTH_VERIFY_EMAIL_SUCCESS',
      resource: `user:${updatedUser.id}`,
      correlationId,
    });

    return {
      data: {
        user_id: updatedUser.id,
        merchant_id: updatedUser.merchant_id,
        status:
          updatedUser.status === 'active' ? ('ACTIVE' as const) : ('PENDING_VERIFICATION' as const),
        channel: 'email' as const,
        verified: true,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * Verify Phone OTP with Bounded Attempts (BR-AUTH-02, BR-AUTH-06)
   */
  async verifyPhone(dto: VerifyPhoneDto, correlationId: string) {
    if (!dto.phone || !dto.otp) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Số điện thoại và mã OTP không được để trống',
        false
      );
    }

    const phone = dto.phone.trim();
    const rawOtp = dto.otp.trim();

    // Check brute-force attempt limits (max 5 failed attempts per window)
    const otpLimit = await this.rateLimitService.checkOtpAttemptLimit(phone);
    if (!otpLimit.allowed) {
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        otpLimit.reason || 'Quá nhiều lần thử mã OTP không chính xác. Vui lòng yêu cầu mã mới.',
        true,
        `Vui lòng chờ ${otpLimit.retryAfterSeconds || 900} giây`,
        undefined,
        otpLimit.retryAfterSeconds
      );
    }

    // Look up latest verification token for this phone.
    // FEAT-AUTH-03 (BR-AUTH-12): only VERIFICATION-purpose tokens may verify a
    // channel; a LOGIN OTP can never satisfy account verification.
    const tokenRecord = await this.prisma.verificationToken.findFirst({
      where: {
        identifier: phone,
        channel: 'phone',
        purpose: 'VERIFICATION',
      },
      orderBy: {
        created_at: 'desc',
      },
      include: {
        user: true,
      },
    });

    if (!tokenRecord) {
      await this.rateLimitService.recordOtpFailure(phone);
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_OTP',
        'Mã OTP không chính xác hoặc không tồn tại',
        false,
        'Vui lòng kiểm tra lại mã OTP vừa nhận qua SMS'
      );
    }

    if (tokenRecord.consumed_at !== null) {
      throw new CanonicalApiException(
        HttpStatus.GONE,
        'OTP_ALREADY_CONSUMED',
        'Mã OTP này đã được sử dụng',
        false,
        'Vui lòng yêu cầu gửi mã OTP mới'
      );
    }

    if (tokenRecord.expires_at < new Date()) {
      throw new CanonicalApiException(
        HttpStatus.GONE,
        'OTP_EXPIRED',
        'Mã OTP đã hết hạn',
        false,
        'Vui lòng yêu cầu gửi mã OTP mới'
      );
    }

    // Validate OTP match (supports both SHA-256 hashed and plaintext legacy seeds)
    const hashedOtp = this.hashSecret(rawOtp);
    const isMatch = tokenRecord.otp === rawOtp || tokenRecord.otp === hashedOtp;

    if (!isMatch) {
      const failCount = await this.rateLimitService.recordOtpFailure(phone);
      if (failCount >= 5) {
        // Invalidate token on 5th failed attempt to prevent further brute force
        await this.prisma.verificationToken.update({
          where: { id: tokenRecord.id },
          data: { consumed_at: new Date() },
        });
        throw new CanonicalApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          'OTP_MAX_ATTEMPTS_EXCEEDED',
          'Đã vượt quá 5 lần nhập sai mã OTP. Mã OTP đã bị hủy, vui lòng yêu cầu mã mới.',
          false,
          'Vui lòng yêu cầu gửi lại mã xác thực mới'
        );
      }
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_OTP',
        `Mã OTP không chính xác (còn ${5 - failCount} lần thử)`,
        false,
        'Vui lòng kiểm tra lại mã OTP vừa nhận qua SMS'
      );
    }

    // Success! Reset OTP attempt counters
    await this.rateLimitService.resetOtpAttempts(phone);

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      await tx.verificationToken.update({
        where: { id: tokenRecord.id },
        data: { consumed_at: new Date() },
      });

      return tx.user.update({
        where: { id: tokenRecord.user_id },
        data: {
          phone_verified_at: new Date(),
          status: 'active',
        },
      });
    });

    await this.logAudit({
      merchantId: updatedUser.merchant_id,
      userId: updatedUser.id,
      actor: `user:${updatedUser.id}`,
      action: 'AUTH_VERIFY_PHONE_SUCCESS',
      resource: `user:${updatedUser.id}`,
      correlationId,
    });

    return {
      data: {
        user_id: updatedUser.id,
        merchant_id: updatedUser.merchant_id,
        status:
          updatedUser.status === 'active' ? ('ACTIVE' as const) : ('PENDING_VERIFICATION' as const),
        channel: 'phone' as const,
        verified: true,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * Resend Verification Code with Anti-Enumeration and Channel Validation (BR-AUTH-08)
   */
  async resendVerification(dto: ResendVerificationDto, clientIp: string, correlationId: string) {
    if (!dto.identifier || !dto.channel) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Thông tin người nhận và kênh xác thực không được để trống',
        false
      );
    }

    const identifier = dto.identifier.trim();
    const channel = dto.channel;

    // Resend Rate Limiting (BR-AUTH-08: 60s cooldown and 5/hour cap)
    const rateCheck = await this.rateLimitService.checkResendLimit(identifier, channel);
    if (!rateCheck.allowed) {
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        rateCheck.reason || 'Vui lòng chờ trước khi yêu cầu gửi lại mã',
        true,
        `Vui lòng chờ ${rateCheck.retryAfterSeconds || 60} giây`,
        undefined,
        rateCheck.retryAfterSeconds
      );
    }

    // Find pending user matching identifier and requested channel
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(channel === 'email' ? [{ email: identifier.toLowerCase() }] : []),
          ...(channel === 'phone' ? [{ phone: identifier }] : []),
        ],
        status: 'pending_verification',
      },
    });

    if (!user) {
      // Check if user exists under the other channel (channel mismatch)
      const userOtherChannel = await this.prisma.user.findFirst({
        where: {
          OR: [{ email: identifier.toLowerCase() }, { phone: identifier }],
          status: 'pending_verification',
        },
      });

      if (userOtherChannel) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'CHANNEL_MISMATCH',
          `Kênh xác thực '${channel}' không khớp với phương thức đăng ký của tài khoản. Vui lòng chọn kênh phù hợp.`,
          false
        );
      }

      // If user does not exist at all: apply cooldown to prevent spam, and return generic 200 to prevent account enumeration
      await this.rateLimitService.recordResendAttempt(identifier, channel, 60);
      return {
        data: {
          status: 'SENT' as const,
          channel,
          cooldown_seconds: 60,
        },
        meta: {
          correlation_id: correlationId,
        },
      };
    }

    // Record resend attempt (cooldown + hourly counter)
    await this.rateLimitService.recordResendAttempt(identifier, channel, 60);

    // Issue and dispatch new token (storing SHA-256 digest in DB)
    if (channel === 'email' && user.email) {
      const emailToken = randomBytes(32).toString('hex');
      const hashedToken = this.hashSecret(emailToken);
      await this.prisma.verificationToken.create({
        data: {
          user_id: user.id,
          token: hashedToken,
          channel: 'email',
          identifier: user.email,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      if (this.deliveryAdapter) {
        await this.deliveryAdapter.sendVerification({
          channel: 'email',
          recipient: user.email,
          token: emailToken,
        });
      }
    } else if (channel === 'phone' && user.phone) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const hashedOtp = this.hashSecret(otp);
      const phoneToken = randomBytes(16).toString('hex');
      const hashedToken = this.hashSecret(phoneToken);

      await this.prisma.verificationToken.create({
        data: {
          user_id: user.id,
          token: hashedToken,
          channel: 'phone',
          identifier: user.phone,
          otp: hashedOtp,
          expires_at: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      if (this.deliveryAdapter) {
        await this.deliveryAdapter.sendVerification({
          channel: 'phone',
          recipient: user.phone,
          otp,
          token: phoneToken,
        });
      }
    }

    await this.logAudit({
      merchantId: user.merchant_id,
      userId: user.id,
      actor: this.hashIp(clientIp),
      action: 'AUTH_RESEND_VERIFICATION',
      resource: `user:${user.id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
    });

    return {
      data: {
        status: 'SENT' as const,
        channel,
        cooldown_seconds: 60,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * FEAT-AUTH-04: Forgot Password - Request Password Reset Token
   * Anti-enumeration: always returns 200 SENT regardless of account existence
   * Rate limited: 5 requests/hour per IP, 3 requests/hour per identifier
   */
  async forgotPassword(dto: ForgotPasswordDto, clientIp: string, correlationId: string) {
    const identifier = dto.identifier?.trim();
    if (!identifier) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Email hoặc số điện thoại không được để trống',
        false,
        undefined,
        [
          {
            field: 'identifier',
            code: 'REQUIRED',
            message: 'Vui lòng nhập email hoặc số điện thoại',
          },
        ]
      );
    }

    const isEmail = identifier.includes('@');
    const channel = dto.channel || (isEmail ? 'email' : 'phone');
    const normalizedIdentifier = isEmail
      ? identifier.toLowerCase()
      : identifier.replace(/\s+/g, '');

    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedIdentifier)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Định dạng email không hợp lệ',
        false,
        undefined,
        [{ field: 'identifier', code: 'INVALID_FORMAT', message: 'Định dạng email không hợp lệ' }]
      );
    }
    if (channel === 'phone' && !/^(0|\+84)[3|5|7|8|9][0-9]{8}$/.test(normalizedIdentifier)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Số điện thoại không hợp lệ (định dạng Việt Nam: 0xxxxxxxxx hoặc +84xxxxxxxxx)',
        false,
        undefined,
        [{ field: 'identifier', code: 'INVALID_FORMAT', message: 'Số điện thoại không hợp lệ' }]
      );
    }

    const ipRateCheck = await this.rateLimitService.checkForgotPasswordLimit(clientIp, 'ip');
    if (!ipRateCheck.allowed) {
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        `Quá nhiều yêu cầu. Vui lòng thử lại sau ${ipRateCheck.retryAfterSeconds} giây.`,
        true,
        `Thử lại sau ${ipRateCheck.retryAfterSeconds} giây`,
        undefined,
        ipRateCheck.retryAfterSeconds
      );
    }

    const identifierRateCheck = await this.rateLimitService.checkForgotPasswordLimit(
      normalizedIdentifier,
      'identifier'
    );
    if (!identifierRateCheck.allowed) {
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        `Quá nhiều yêu cầu cho tài khoản này. Vui lòng thử lại sau ${identifierRateCheck.retryAfterSeconds} giây.`,
        true,
        `Thử lại sau ${identifierRateCheck.retryAfterSeconds} giây`,
        undefined,
        identifierRateCheck.retryAfterSeconds
      );
    }

    await this.rateLimitService.recordForgotPasswordAttempt(clientIp, normalizedIdentifier);

    const user = await this.prisma.user.findFirst({
      where:
        channel === 'email' ? { email: normalizedIdentifier } : { phone: normalizedIdentifier },
    });

    const genericResponse = {
      data: {
        status: 'SENT' as const,
        message: 'Nếu tài khoản tồn tại và đã xác thực, liên kết đặt lại mật khẩu đã được gửi.',
        channel,
      },
      meta: { correlation_id: correlationId },
    };

    const hashedIdentifierRef = this.hashIdentifierForAudit(normalizedIdentifier);

    if (!user) {
      await this.logAudit({
        actor: this.hashIp(clientIp),
        action: 'AUTH_FORGOT_PASSWORD_NO_USER',
        resource: `identifier:${hashedIdentifierRef}`,
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { identifier: hashedIdentifierRef, channel, reason: 'user_not_found' },
      });
      return genericResponse;
    }

    if (user.status !== 'active') {
      await this.logAudit({
        merchantId: user.merchant_id,
        userId: user.id,
        actor: this.hashIp(clientIp),
        action: 'AUTH_FORGOT_PASSWORD_BLOCKED',
        resource: `user:${user.id}`,
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { reason: user.status },
      });
      return genericResponse;
    }

    const isVerified =
      channel === 'email' ? user.email_verified_at !== null : user.phone_verified_at !== null;

    if (!isVerified) {
      await this.logAudit({
        merchantId: user.merchant_id,
        userId: user.id,
        actor: this.hashIp(clientIp),
        action: 'AUTH_FORGOT_PASSWORD_UNVERIFIED',
        resource: `user:${user.id}`,
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { identifier: hashedIdentifierRef, channel, reason: 'contact_not_verified' },
      });
      return genericResponse;
    }

    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = this.hashSecret(rawToken);
    const ttlSeconds = this.config?.PASSWORD_RESET_TTL_SECONDS || 3600;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token: hashedToken,
        channel,
        identifier: normalizedIdentifier,
        expires_at: expiresAt,
      },
    });

    if (this.deliveryAdapter) {
      const baseUrl = this.config?.FRONTEND_URL || 'http://localhost:3000';
      await this.deliveryAdapter.sendVerification({
        channel,
        recipient: normalizedIdentifier,
        purpose: 'password_reset',
        link: `${baseUrl}/reset-password?token=${rawToken}`,
      });
    }

    await this.logAudit({
      merchantId: user.merchant_id,
      userId: user.id,
      actor: this.hashIp(clientIp),
      action: 'AUTH_FORGOT_PASSWORD_TOKEN_ISSUED',
      resource: `user:${user.id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: { channel, expires_at: expiresAt.toISOString() },
    });

    return genericResponse;
  }

  /**
   * FEAT-AUTH-04: Verify Reset Token
   * Validates token exists, not expired, not consumed
   * Returns identifier and channel for UI confirmation
   */
  async verifyResetToken(dto: VerifyResetTokenDto, clientIp: string, correlationId: string) {
    const rawToken = dto.token?.trim();
    if (!rawToken) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Token không được để trống',
        false,
        undefined,
        [{ field: 'token', code: 'REQUIRED', message: 'Token không được để trống' }]
      );
    }

    const resetLimit = await this.rateLimitService.checkResetTokenLimit(clientIp);
    if (!resetLimit.allowed) {
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        resetLimit.reason || 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
        true,
        `Thử lại sau ${resetLimit.retryAfterSeconds} giây`,
        undefined,
        resetLimit.retryAfterSeconds
      );
    }

    const hashedToken = this.hashSecret(rawToken);
    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { token: hashedToken },
      include: { user: true },
    });

    if (!tokenRecord) {
      await this.rateLimitService.recordResetTokenFailure(clientIp);
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_TOKEN',
        'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
        false,
        'Vui lòng yêu cầu liên kết đặt lại mật khẩu mới'
      );
    }

    if (tokenRecord.user.status !== 'active') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Tài khoản bị khóa, không thể đặt lại mật khẩu.',
        false,
        'Vui lòng liên hệ bộ phận CSKH để được hỗ trợ'
      );
    }

    if (tokenRecord.consumed_at) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'TOKEN_ALREADY_USED',
        'Liên kết đặt lại mật khẩu này đã được sử dụng',
        false,
        'Vui lòng yêu cầu liên kết đặt lại mật khẩu mới'
      );
    }

    if (new Date() > tokenRecord.expires_at) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'TOKEN_EXPIRED',
        'Liên kết đặt lại mật khẩu đã hết hạn (hiệu lực 1 giờ)',
        false,
        'Vui lòng yêu cầu liên kết đặt lại mật khẩu mới'
      );
    }

    return {
      data: {
        valid: true,
        identifier: tokenRecord.identifier,
        channel: tokenRecord.channel,
      },
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * FEAT-AUTH-04: Reset Password with Token
   * Validates token, updates password, consumes token, revokes all sessions
   */
  async resetPassword(dto: ResetPasswordDto, clientIp: string, correlationId: string) {
    const fields: CanonicalFieldError[] = [];
    const rawToken = dto.token?.trim();
    const password = dto.password;
    const passwordConfirm = dto.password_confirm;

    if (!rawToken) {
      fields.push({ field: 'token', code: 'REQUIRED', message: 'Token không được để trống' });
    }
    if (!password) {
      fields.push({
        field: 'password',
        code: 'REQUIRED',
        message: 'Mật khẩu mới không được để trống',
      });
    }
    if (!passwordConfirm) {
      fields.push({
        field: 'password_confirm',
        code: 'REQUIRED',
        message: 'Xác nhận mật khẩu không được để trống',
      });
    }
    if (password && password !== passwordConfirm) {
      fields.push({
        field: 'password_confirm',
        code: 'MISMATCH',
        message: 'Mật khẩu xác nhận không khớp',
      });
    }
    if (password && password.length < 8) {
      fields.push({
        field: 'password',
        code: 'WEAK_PASSWORD',
        message: 'Mật khẩu phải có ít nhất 8 ký tự',
      });
    }
    if (password && !/[A-Z]/.test(password)) {
      fields.push({
        field: 'password',
        code: 'WEAK_PASSWORD',
        message: 'Mật khẩu phải chứa ít nhất 1 chữ hoa',
      });
    }
    if (password && !/[a-z]/.test(password)) {
      fields.push({
        field: 'password',
        code: 'WEAK_PASSWORD',
        message: 'Mật khẩu phải chứa ít nhất 1 chữ thường',
      });
    }
    if (password && !/[0-9]/.test(password)) {
      fields.push({
        field: 'password',
        code: 'WEAK_PASSWORD',
        message: 'Mật khẩu phải chứa ít nhất 1 số',
      });
    }
    if (password && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      fields.push({
        field: 'password',
        code: 'WEAK_PASSWORD',
        message: 'Mật khẩu phải chứa ít nhất 1 ký tự đặc biệt',
      });
    }

    if (fields.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Dữ liệu không hợp lệ',
        false,
        undefined,
        fields
      );
    }

    const hashedToken = this.hashSecret(rawToken!);

    const resetLimit = await this.rateLimitService.checkResetTokenLimit(clientIp);
    if (!resetLimit.allowed) {
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        resetLimit.reason || 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
        true,
        `Thử lại sau ${resetLimit.retryAfterSeconds} giây`,
        undefined,
        resetLimit.retryAfterSeconds
      );
    }

    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { token: hashedToken },
      include: { user: true },
    });

    if (!tokenRecord) {
      await this.rateLimitService.recordResetTokenFailure(clientIp);
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_TOKEN',
        'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
        false,
        'Vui lòng yêu cầu liên kết đặt lại mật khẩu mới'
      );
    }

    if (tokenRecord.user.status !== 'active') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Tài khoản bị khóa, không thể đặt lại mật khẩu.',
        false,
        'Vui lòng liên hệ bộ phận CSKH để được hỗ trợ'
      );
    }

    if (tokenRecord.consumed_at) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'TOKEN_ALREADY_USED',
        'Liên kết đặt lại mật khẩu này đã được sử dụng',
        false,
        'Vui lòng yêu cầu liên kết đặt lại mật khẩu mới'
      );
    }

    if (new Date() > tokenRecord.expires_at) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'TOKEN_EXPIRED',
        'Liên kết đặt lại mật khẩu đã hết hạn (hiệu lực 1 giờ)',
        false,
        'Vui lòng yêu cầu liên kết đặt lại mật khẩu mới'
      );
    }

    const newPasswordHash = await hashPassword(password!);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: tokenRecord.user_id },
        data: { password_hash: newPasswordHash, updated_at: new Date() },
      });

      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: tokenRecord.id, consumed_at: null },
        data: { consumed_at: new Date() },
      });

      if (count === 0) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'TOKEN_ALREADY_USED',
          'Liên kết đặt lại mật khẩu này đã được sử dụng',
          false,
          'Vui lòng yêu cầu liên kết đặt lại mật khẩu mới'
        );
      }

      await tx.deviceSession.updateMany({
        where: { user_id: tokenRecord.user_id, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          is_revoked: true,
          revoked_at: new Date(),
          revoked_by: tokenRecord.user_id,
          revoke_reason: 'Password reset',
        },
      });
    });

    await this.logAudit({
      merchantId: tokenRecord.user.merchant_id,
      userId: tokenRecord.user_id,
      actor: this.hashIp(clientIp),
      action: 'AUTH_PASSWORD_RESET_TOKEN_CONSUMED',
      resource: `user:${tokenRecord.user_id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: { channel: tokenRecord.channel },
    });

    await this.logAudit({
      merchantId: tokenRecord.user.merchant_id,
      userId: tokenRecord.user_id,
      actor: this.hashIp(clientIp),
      action: 'AUTH_PASSWORD_CHANGED',
      resource: `user:${tokenRecord.user_id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
    });

    await this.logAudit({
      merchantId: tokenRecord.user.merchant_id,
      userId: tokenRecord.user_id,
      actor: this.hashIp(clientIp),
      action: 'AUTH_PASSWORD_RESET_SESSIONS_REVOKED',
      resource: `user:${tokenRecord.user_id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: { sessions_revoked: true },
    });

    return {
      data: {
        message: 'Mật khẩu đã được đặt lại thành công. Tất cả phiên đăng nhập khác đã bị thu hồi.',
      },
      meta: { correlation_id: correlationId },
    };
  }

  /**

   * Request a login OTP (FEAT-AUTH-03 / SCR-AUTH-01 "if configured" / BR-AUTH-12).
   * Gated by AUTH_LOGIN_OTP_ENABLED; generic OTP_SENT response (CD-4..5, CD-7).
   */
  async requestLoginOtp(dto: LoginOtpRequestDto, clientIp: string, correlationId: string) {
    if (this.config && !this.config.AUTH_LOGIN_OTP_ENABLED) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'AUTH_OTP_LOGIN_DISABLED',
        'Đăng nhập bằng mã OTP chưa được bật cho hệ thống.',
        false,
        'Vui lòng đăng nhập bằng mật khẩu'
      );
    }

    if (!dto.identifier || dto.identifier.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Email hoặc số điện thoại không được để trống',
        false,
        undefined,
        [
          {
            field: 'identifier',
            code: 'REQUIRED',
            message: 'Email hoặc số điện thoại không được để trống',
          },
        ]
      );
    }

    const normalized = this.normalizeIdentifier(dto.identifier);
    if (!normalized) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Định dạng email hoặc số điện thoại không hợp lệ',
        false,
        undefined,
        [
          {
            field: 'identifier',
            code: 'INVALID_FORMAT',
            message: 'Email hoặc số điện thoại không đúng định dạng Việt Nam',
          },
        ]
      );
    }

    // BR-AUTH-12 limits: IP max 10/hour; identifier 60s cooldown + max 5/hour (recorded upfront)
    const ipCheck = await this.rateLimitService.checkLoginOtpIpLimit(clientIp);
    if (!ipCheck.allowed) {
      await this.logAudit({
        actor: this.hashIp(clientIp),
        action: 'AUTH_LOGIN_OTP_RATE_LIMITED',
        resource: 'auth/login',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { scope: 'ip' },
      });
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        ipCheck.reason || 'Quá nhiều yêu cầu mã OTP. Vui lòng thử lại sau.',
        true,
        `Vui lòng chờ ${ipCheck.retryAfterSeconds || 3600} giây trước khi thử lại`,
        undefined,
        ipCheck.retryAfterSeconds
      );
    }
    const idCheck = await this.rateLimitService.checkLoginOtpRequestLimit(normalized.stored);
    if (!idCheck.allowed) {
      await this.logAudit({
        actor: this.hashIp(clientIp),
        action: 'AUTH_LOGIN_OTP_RATE_LIMITED',
        resource: 'auth/login',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { scope: 'identifier' },
      });
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        idCheck.reason || 'Quá nhiều yêu cầu mã OTP cho tài khoản này.',
        true,
        `Vui lòng chờ ${idCheck.retryAfterSeconds || 60} giây trước khi thử lại`,
        undefined,
        idCheck.retryAfterSeconds
      );
    }
    await this.rateLimitService.recordLoginOtpIpAttempt(clientIp);
    await this.rateLimitService.recordLoginOtpRequest(normalized.stored, 60);

    const channel: 'email' | 'phone' = normalized.email ? 'email' : 'phone';
    const user = await this.prisma.user.findFirst({
      where: normalized.email ? { email: normalized.email } : { phone: normalized.phone },
    });

    const genericResponse = {
      data: {
        status: 'OTP_SENT' as const,
        channel,
        recipient_masked: this.maskIdentifier(normalized.stored),
        cooldown_seconds: 60,
        expires_in_seconds: 300,
        message: 'Nếu tài khoản tồn tại, mã OTP đăng nhập đã được gửi đến bạn.',
      },
      meta: {
        correlation_id: correlationId,
      },
    };

    // Verified-channel-only delivery (CD-5): unknown identifier or unverified channel
    // receives the identical generic response with no delivery.
    const channelVerified =
      !!user &&
      ((channel === 'email' && !!user.email_verified_at) ||
        (channel === 'phone' && !!user.phone_verified_at));

    if (!user || !channelVerified) {
      await this.logAudit({
        merchantId: user?.merchant_id,
        userId: user?.id,
        actor: this.hashIp(clientIp),
        action: 'AUTH_LOGIN_OTP_REQUESTED',
        resource: 'auth/login',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: {
          delivered: false,
          reason: user ? 'channel_unverified' : 'unknown_identifier',
        },
      });
      return genericResponse;
    }

    const rawOtp = randomInt(100000, 1000000).toString();
    const hashedOtp = this.hashSecret(rawOtp);
    const tokenValue = this.hashSecret(randomBytes(32).toString('hex'));

    await this.prisma.verificationToken.create({
      data: {
        user_id: user.id,
        token: tokenValue,
        channel,
        identifier: normalized.stored,
        otp: hashedOtp,
        purpose: 'LOGIN',
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    if (this.deliveryAdapter) {
      await this.deliveryAdapter.sendVerification({
        channel,
        recipient: (channel === 'email' ? user.email : user.phone) as string,
        otp: rawOtp,
      });
    }

    await this.logAudit({
      merchantId: user.merchant_id,
      userId: user.id,
      actor: this.hashIp(clientIp),
      action: 'AUTH_LOGIN_OTP_REQUESTED',
      resource: `user:${user.id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: { delivered: true, channel },
    });

    return genericResponse;
  }

  private maskIdentifier(identifier: string): string {
    if (identifier.includes('@')) {
      const [local, domain] = identifier.split('@');
      const visible = local.slice(0, 1);
      return `${visible}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
    }
    if (identifier.length <= 4) return '*'.repeat(identifier.length);
    return `${identifier.slice(0, 4)}${'*'.repeat(Math.max(3, identifier.length - 8))}${identifier.slice(-4)}`;
  }

  /**
   * Verify a login OTP and issue a session (FEAT-AUTH-03 / SCR-AUTH-01 / BR-AUTH-12).
   * Error semantics follow FEAT-AUTH-01: OTP_ALREADY_CONSUMED / OTP_EXPIRED (410),
   * INVALID_OTP (400), OTP_MAX_ATTEMPTS_EXCEEDED (429). Status is re-checked at verify.
   */
  async verifyLoginOtp(dto: LoginOtpVerifyDto, clientIp: string, correlationId: string) {
    if (this.config && !this.config.AUTH_LOGIN_OTP_ENABLED) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'AUTH_OTP_LOGIN_DISABLED',
        'Đăng nhập bằng mã OTP chưa được bật cho hệ thống.',
        false,
        'Vui lòng đăng nhập bằng mật khẩu'
      );
    }

    const fields: CanonicalFieldError[] = [];
    if (!dto.identifier || dto.identifier.trim().length === 0) {
      fields.push({
        field: 'identifier',
        code: 'REQUIRED',
        message: 'Email hoặc số điện thoại không được để trống',
      });
    }
    if (!dto.otp || dto.otp.trim().length === 0) {
      fields.push({ field: 'otp', code: 'REQUIRED', message: 'Mã OTP không được để trống' });
    }
    if (fields.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Thông tin xác thực OTP không hợp lệ',
        false,
        'Vui lòng kiểm tra lại thông tin',
        fields
      );
    }

    const normalized = this.normalizeIdentifier(dto.identifier);
    if (!normalized) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Định dạng email hoặc số điện thoại không hợp lệ',
        false,
        undefined,
        [
          {
            field: 'identifier',
            code: 'INVALID_FORMAT',
            message: 'Email hoặc số điện thoại không đúng định dạng Việt Nam',
          },
        ]
      );
    }
    const channel: 'email' | 'phone' = normalized.email ? 'email' : 'phone';

    const otpLimit = await this.rateLimitService.checkOtpAttemptLimit(normalized.stored);
    if (!otpLimit.allowed) {
      await this.logAudit({
        actor: this.hashIp(clientIp),
        action: 'AUTH_LOGIN_OTP_RATE_LIMITED',
        resource: 'auth/login',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { scope: 'otp_attempts' },
      });
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        otpLimit.reason || 'Quá nhiều lần thử mã OTP. Vui lòng thử lại sau.',
        true,
        `Vui lòng chờ ${otpLimit.retryAfterSeconds || 900} giây trước khi thử lại`,
        undefined,
        otpLimit.retryAfterSeconds
      );
    }

    const tokenRecord = await this.prisma.verificationToken.findFirst({
      where: { identifier: normalized.stored, channel, purpose: 'LOGIN' },
      orderBy: { created_at: 'desc' },
      include: { user: { include: { merchant: true } } },
    });

    if (!tokenRecord) {
      await this.rateLimitService.recordOtpFailure(normalized.stored);
      await this.logAudit({
        actor: this.hashIp(clientIp),
        action: 'AUTH_LOGIN_OTP_FAILED',
        resource: 'auth/login',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { reason: 'unknown_or_invalid' },
      });
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_OTP',
        'Mã OTP không chính xác hoặc không tồn tại',
        false,
        'Vui lòng kiểm tra lại mã OTP hoặc yêu cầu gửi mã mới'
      );
    }

    if (tokenRecord.consumed_at) {
      await this.logAudit({
        merchantId: tokenRecord.user.merchant_id,
        userId: tokenRecord.user.id,
        actor: this.hashIp(clientIp),
        action: 'AUTH_LOGIN_OTP_FAILED',
        resource: 'auth/login',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { reason: 'already_consumed' },
      });
      throw new CanonicalApiException(
        HttpStatus.GONE,
        'OTP_ALREADY_CONSUMED',
        'Mã OTP đã được sử dụng',
        false,
        'Vui lòng yêu cầu gửi mã OTP mới nếu bạn chưa đăng nhập thành công'
      );
    }

    if (tokenRecord.expires_at.getTime() <= Date.now()) {
      await this.logAudit({
        merchantId: tokenRecord.user.merchant_id,
        userId: tokenRecord.user.id,
        actor: this.hashIp(clientIp),
        action: 'AUTH_LOGIN_OTP_FAILED',
        resource: 'auth/login',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { reason: 'expired' },
      });
      throw new CanonicalApiException(
        HttpStatus.GONE,
        'OTP_EXPIRED',
        'Mã OTP đã hết hạn',
        false,
        'Vui lòng yêu cầu gửi mã OTP mới'
      );
    }

    const hashedOtp = this.hashSecret(dto.otp.trim());
    if (tokenRecord.otp !== hashedOtp) {
      const failCount = await this.rateLimitService.recordOtpFailure(normalized.stored);
      if (failCount >= OTP_MAX_VERIFY_ATTEMPTS) {
        await this.prisma.verificationToken.update({
          where: { id: tokenRecord.id },
          data: { consumed_at: new Date() },
        });
        await this.logAudit({
          merchantId: tokenRecord.user.merchant_id,
          userId: tokenRecord.user.id,
          actor: this.hashIp(clientIp),
          action: 'AUTH_LOGIN_OTP_FAILED',
          resource: 'auth/login',
          correlationId,
          ipAddress: this.hashIp(clientIp),
          details: { reason: 'max_attempts_exceeded' },
        });
        throw new CanonicalApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          'OTP_MAX_ATTEMPTS_EXCEEDED',
          'Bạn đã nhập sai mã OTP quá số lần cho phép',
          false,
          'Vui lòng yêu cầu gửi mã OTP mới'
        );
      }
      await this.logAudit({
        merchantId: tokenRecord.user.merchant_id,
        userId: tokenRecord.user.id,
        actor: this.hashIp(clientIp),
        action: 'AUTH_LOGIN_OTP_FAILED',
        resource: 'auth/login',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { reason: 'invalid_otp' },
      });
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_OTP',
        'Mã OTP không chính xác',
        false,
        `Vui lòng kiểm tra lại mã OTP (còn ${OTP_MAX_VERIFY_ATTEMPTS - failCount} lần thử)`
      );
    }

    // Atomic consume before any session issuance; blocked statuses consume the OTP
    // because channel possession was proven, but no session is created (CD-6).
    await this.prisma.verificationToken.update({
      where: { id: tokenRecord.id },
      data: { consumed_at: new Date() },
    });

    await this.assertStatusAllowsLogin(tokenRecord.user, clientIp, correlationId);

    await this.rateLimitService.resetOtpAttempts(normalized.stored);

    return this.createLoginSessionAndResponse(
      tokenRecord.user,
      false,
      clientIp,
      correlationId,
      'AUTH_LOGIN_OTP_SUCCESS'
    );
  }

  /**
   * Password login (FEAT-AUTH-03 / UC-AUTH-01 / BR-AUTH-11..13).
   * Identical `INVALID_CREDENTIALS` response for unknown identifier and wrong password (CD-7).
   */
  async login(dto: LoginDto, clientIp: string, correlationId: string) {
    const fields: CanonicalFieldError[] = [];
    if (!dto.identifier || dto.identifier.trim().length === 0) {
      fields.push({
        field: 'identifier',
        code: 'REQUIRED',
        message: 'Email hoặc số điện thoại không được để trống',
      });
    }
    if (!dto.password) {
      fields.push({ field: 'password', code: 'REQUIRED', message: 'Mật khẩu không được để trống' });
    }
    if (fields.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Thông tin đăng nhập không hợp lệ',
        false,
        'Vui lòng kiểm tra lại thông tin đăng nhập',
        fields
      );
    }

    const normalized = this.normalizeIdentifier(dto.identifier);
    if (!normalized) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Định dạng email hoặc số điện thoại không hợp lệ',
        false,
        undefined,
        [
          {
            field: 'identifier',
            code: 'INVALID_FORMAT',
            message: 'Email hoặc số điện thoại không đúng định dạng Việt Nam',
          },
        ]
      );
    }

    // BR-AUTH-11: IP gate (max 10 attempts / 15 minutes), recorded upfront
    const ipCheck = await this.rateLimitService.checkLoginIpLimit(clientIp);
    if (!ipCheck.allowed) {
      await this.logAudit({
        actor: this.hashIp(clientIp),
        action: 'AUTH_LOGIN_RATE_LIMITED',
        resource: 'auth/login',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { scope: 'ip' },
      });
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        ipCheck.reason || 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau.',
        true,
        `Vui lòng chờ ${ipCheck.retryAfterSeconds || 900} giây trước khi thử lại`,
        undefined,
        ipCheck.retryAfterSeconds
      );
    }
    await this.rateLimitService.recordLoginIpAttempt(clientIp);

    // BR-AUTH-11: identifier failure gate (max 5 failures / 15 minutes)
    const identifierCheck = await this.rateLimitService.checkLoginIdentifierFailureLimit(
      normalized.stored
    );
    if (!identifierCheck.allowed) {
      await this.logAudit({
        actor: this.hashIp(clientIp),
        action: 'AUTH_LOGIN_RATE_LIMITED',
        resource: 'auth/login',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { scope: 'identifier' },
      });
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        identifierCheck.reason || 'Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau.',
        true,
        `Vui lòng chờ ${identifierCheck.retryAfterSeconds || 900} giây trước khi thử lại`,
        undefined,
        identifierCheck.retryAfterSeconds
      );
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(normalized.email ? [{ email: normalized.email }] : []),
          ...(normalized.phone ? [{ phone: normalized.phone }] : []),
        ],
      },
      include: { merchant: true },
    });

    const passwordMatches = user
      ? await verifyPassword(dto.password, user.password_hash).catch(() => false)
      : false;

    if (!user || !passwordMatches) {
      await this.rateLimitService.recordLoginIdentifierFailure(normalized.stored);
      await this.logAudit({
        merchantId: user?.merchant_id,
        userId: user?.id,
        actor: this.hashIp(clientIp),
        action: 'AUTH_LOGIN_FAILED',
        resource: 'auth/login',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { reason: 'invalid_credentials' },
      });
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Email/số điện thoại hoặc mật khẩu không chính xác',
        false,
        'Vui lòng thử lại hoặc đặt lại mật khẩu nếu bạn đã quên'
      );
    }

    await this.assertStatusAllowsLogin(user, clientIp, correlationId);

    // Success resets the identifier failure counter only (the IP counter is not reset, CD-9)
    await this.rateLimitService.resetLoginIdentifierFailures(normalized.stored);

    return this.createLoginSessionAndResponse(
      user,
      dto.remember_device === true,
      clientIp,
      correlationId,
      'AUTH_LOGIN_SUCCESS'
    );
  }

  /**

   * BR-AUTH-03 / BR-AUTH-10: resolve duplicate / pending account conflicts
   */
  private async resolveExistingAccountConflict(
    existingUsers: Array<{
      id: string;
      merchant_id: string;
      email: string | null;
      phone: string | null;
      status: string;
      email_verified_at: Date | null;
      phone_verified_at: Date | null;
    }>,
    email: string | undefined,
    phone: string | undefined,
    clientIp: string,
    correlationId: string
  ): Promise<{ data: Record<string, unknown>; meta: Record<string, unknown> } | null> {
    const activeConflict = existingUsers.find(
      (u) => u.status === 'active' || u.email_verified_at !== null || u.phone_verified_at !== null
    );

    if (activeConflict) {
      const conflictField = email && activeConflict.email === email ? 'email' : 'phone';
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `${conflictField === 'email' ? 'Email' : 'Số điện thoại'} đã được đăng ký trên hệ thống`,
        false,
        'Vui lòng đăng nhập hoặc sử dụng thông tin liên lạc khác',
        [
          {
            field: conflictField,
            code: 'DUPLICATE',
            message: `${conflictField === 'email' ? 'Email' : 'Số điện thoại'} đã được đăng ký`,
          },
        ]
      );
    }

    const pendingAccount = existingUsers.find((u) => u.status === 'pending_verification');

    if (pendingAccount) {
      await this.rateLimitService.recordRegistrationAttempt(
        undefined,
        pendingAccount.email || undefined,
        pendingAccount.phone || undefined
      );

      await this.issueAndSendVerification(
        pendingAccount,
        pendingAccount.email || undefined,
        pendingAccount.phone || undefined,
        correlationId
      );

      await this.logAudit({
        merchantId: pendingAccount.merchant_id,
        userId: pendingAccount.id,
        actor: this.hashIp(clientIp),
        action: 'AUTH_REGISTER_PENDING_RETRY',
        resource: `user:${pendingAccount.id}`,
        correlationId,
        ipAddress: this.hashIp(clientIp),
      });

      return {
        data: {
          user_id: pendingAccount.id,
          merchant_id: pendingAccount.merchant_id,
          status: 'PENDING_VERIFICATION' as const,
          email: pendingAccount.email || undefined,
          phone: pendingAccount.phone || undefined,
          message: 'Tài khoản đang chờ xác thực. Mã xác thực mới đã được gửi.',
        },
        meta: {
          correlation_id: correlationId,
        },
      };
    }

    return null;
  }

  /**
   * Distinct, spec-mandated 403 outcomes for non-active statuses (BR-AUTH-13 / CD-6).
   * Every blocked attempt is audited without credentials.
   */
  private async assertStatusAllowsLogin(
    user: { id: string; merchant_id: string; status: string },
    clientIp: string,
    correlationId: string
  ): Promise<void> {
    if (user.status === 'active') return;

    const blockedByStatus: Record<string, { code: string; message: string; next_action: string }> =
      {
        pending_verification: {
          code: 'AUTH_PENDING_VERIFICATION',
          message:
            'Tài khoản chưa được xác thực. Vui lòng xác thực qua liên kết email hoặc mã OTP đã gửi.',
          next_action: 'Mở liên kết xác thực trong email hoặc yêu cầu gửi lại mã xác thực',
        },
        suspended: {
          code: 'AUTH_ACCOUNT_SUSPENDED',
          message: 'Tài khoản đã bị tạm ngưng. Vui lòng liên hệ bộ phận hỗ trợ Ship Dễ.',
          next_action: 'Liên hệ CSKH Ship Dễ để được hỗ trợ kích hoạt lại tài khoản',
        },
        disabled: {
          code: 'AUTH_ACCOUNT_DISABLED',
          message: 'Tài khoản đã bị vô hiệu hóa.',
          next_action: 'Liên hệ chủ cửa hàng hoặc CSKH Ship Dễ để biết thêm chi tiết',
        },
        invited: {
          code: 'AUTH_INVITATION_PENDING',
          message: 'Lời mời tham gia cửa hàng chưa được chấp nhận.',
          next_action: 'Làm theo hướng dẫn trong lời mời để kích hoạt tài khoản',
        },
      };

    const blocked = blockedByStatus[user.status];
    if (!blocked) return;

    await this.logAudit({
      merchantId: user.merchant_id,
      userId: user.id,
      actor: `user:${user.id}`,
      action: 'AUTH_LOGIN_BLOCKED_STATUS',
      resource: `user:${user.id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: { status: user.status },
    });

    throw new CanonicalApiException(
      HttpStatus.FORBIDDEN,
      blocked.code,
      blocked.message,
      false,
      blocked.next_action
    );
  }

  /**
   * Normalizes a login identifier to its canonical stored form.
   * Email is lowercased; Vietnamese phone accepts 0/+84/84 prefixes and stores the 0-prefixed form.
   */
  private normalizeIdentifier(raw: string): {
    email?: string;
    phone?: string;
    stored: string;
  } | null {
    const trimmed = raw.trim();
    if (trimmed.includes('@')) {
      const email = trimmed.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
      return { email, stored: email };
    }

    const digits = trimmed.replace(/[\s.\-()]/g, '');
    let phone: string;
    if (digits.startsWith('+84')) {
      phone = `0${digits.slice(3)}`;
    } else if (digits.startsWith('84') && digits.length === 11) {
      phone = `0${digits.slice(2)}`;
    } else {
      phone = digits;
    }
    if (!/^0[3|5|7|8|9][0-9]{8}$/.test(phone)) return null;
    return { phone, stored: phone };
  }

  /**
   * Creates the device session row, signs the access token, audits and returns the
   * canonical AUTHENTICATED response (CD-1..2).
   */
  private async createLoginSessionAndResponse(
    user: {
      id: string;
      merchant_id: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      role: RoleEnum;
      status: string;
      email_verified_at: Date | null;
      phone_verified_at: Date | null;
      created_at: Date;
      merchant: {
        id: string;
        name: string;
        code: string;
        status: string;
        created_at: Date;
      };
    },
    rememberDevice: boolean,
    clientIp: string,
    correlationId: string,
    auditAction: 'AUTH_LOGIN_SUCCESS' | 'AUTH_LOGIN_OTP_SUCCESS'
  ) {
    const activeMfa = await this.prisma.mfaFactor.findFirst({
      where: { user_id: user.id, status: 'ACTIVE' },
    });
    if (activeMfa) {
      const { token: challengeToken, hash: challengeHash } = generateMfaChallengeToken();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await this.prisma.mfaChallenge.create({
        data: {
          challenge_hash: challengeHash,
          user_id: user.id,
          merchant_id: user.merchant_id,
          purpose: 'LOGIN',
          expires_at: expiresAt,
        },
      });

      return {
        data: {
          status: 'MFA_REQUIRED' as const,
          challenge_id: challengeToken,
          expires_in: 300,
        },
        meta: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
        },
      };
    }

    if (user.role === 'OWNER') {
      const secret = resolveAccessTokenSecret(this.config?.AUTH_TOKEN_SECRET);
      const { token: setupToken } = signAccessToken(
        {
          sub: user.id,
          sid: randomUUID(),
          mid: user.merchant_id,
          role: user.role,
          st: user.status,
          scope: 'mfa_setup',
        },
        secret,
        600
      );

      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'MFA_ENROLLMENT_REQUIRED',
        'Tài khoản Chủ shop (Owner) bắt buộc phải kích hoạt bảo mật 2 bước (MFA)',
        false,
        'Vui lòng hoàn tất kích hoạt xác thực 2 bước để tiếp tục sử dụng hệ thống',
        undefined,
        undefined,
        {
          access_token: setupToken,
          expires_in: 600,
        }
      );
    }

    const ttlSeconds = this.config?.AUTH_TOKEN_TTL_SECONDS ?? 43200;
    const merchant = user.merchant;

    // FEAT-AUTH-06 made merchant_id, session_token_hash and expires_at required
    // on DeviceSession, and this login path still created a row without them.
    //
    // The hash has to be the hash of the token the client will actually present,
    // or the row can never be matched and the session is unusable while still
    // reading as ACTIVE. The token needs the session id to sign, and the id used
    // to come from the insert — so the id is minted here instead, the token is
    // signed against it, and the row is written once with a hash that matches.
    const sessionId = randomUUID();
    const secret = resolveAccessTokenSecret(this.config?.AUTH_TOKEN_SECRET);
    const { token } = signAccessToken(
      {
        sub: user.id,
        sid: sessionId,
        mid: user.merchant_id,
        role: user.role,
        st: user.status,
      },
      secret,
      ttlSeconds
    );

    const session = await this.prisma.deviceSession.create({
      data: {
        id: sessionId,
        user_id: user.id,
        merchant_id: user.merchant_id,
        session_token_hash: createHash('sha256').update(token).digest('hex'),
        device_id: rememberDevice ? 'web-remember' : 'web-session',
        last_active_at: new Date(),
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        ip_address: this.hashIp(clientIp),
      },
    });

    await this.logAudit({
      merchantId: user.merchant_id,
      userId: user.id,
      actor: `user:${user.id}`,
      action: auditAction,
      resource: `user:${user.id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: { session_id: session.id, role: user.role },
    });

    return {
      data: {
        status: 'AUTHENTICATED' as const,
        access_token: token,
        expires_in: ttlSeconds,
        user: {
          id: user.id,
          merchant_id: user.merchant_id,
          full_name: user.full_name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status.toUpperCase(),
          email_verified_at: user.email_verified_at ? user.email_verified_at.toISOString() : null,
          phone_verified_at: user.phone_verified_at ? user.phone_verified_at.toISOString() : null,
          created_at: user.created_at.toISOString(),
        },
        merchant: {
          id: merchant.id,
          name: merchant.name,
          business_code: merchant.code,
          status: merchant.status,
          created_at: merchant.created_at.toISOString(),
        },
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  private isUniqueConstraintViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
  }

  private async issueAndSendVerification(
    user: { id: string; email: string | null; phone: string | null },
    email?: string,
    phone?: string,
    correlationId?: string
  ): Promise<void> {
    if (email) {
      const rawEmailToken = randomBytes(32).toString('hex');
      const hashedToken = this.hashSecret(rawEmailToken);
      await this.prisma.verificationToken.create({
        data: {
          user_id: user.id,
          token: hashedToken,
          channel: 'email',
          identifier: email,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      if (this.deliveryAdapter) {
        await this.deliveryAdapter.sendVerification({
          channel: 'email',
          recipient: email,
          token: rawEmailToken,
        });
      }
    }

    if (phone) {
      const rawOtp = Math.floor(100000 + Math.random() * 900000).toString();
      const hashedOtp = this.hashSecret(rawOtp);
      const rawPhoneToken = randomBytes(16).toString('hex');
      const hashedToken = this.hashSecret(rawPhoneToken);

      await this.prisma.verificationToken.create({
        data: {
          user_id: user.id,
          token: hashedToken,
          channel: 'phone',
          identifier: phone,
          otp: hashedOtp,
          expires_at: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      if (this.deliveryAdapter) {
        await this.deliveryAdapter.sendVerification({
          channel: 'phone',
          recipient: phone,
          otp: rawOtp,
          token: rawPhoneToken,
        });
      }
    }
  }

  private generateMerchantCode(merchantName: string): string {
    const slug = merchantName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toUpperCase()
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 20);
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${slug || 'SHOP'}_${rand}`;
  }

  private hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  private hashIdentifierForAudit(identifier: string): string {
    const key =
      this.config?.AUDIT_IDENTIFIER_HMAC_KEY || 'default-dev-audit-hmac-key-override-32-chars';
    return createHmac('sha256', key).update(identifier).digest('hex').substring(0, 16);
  }

  // --------------------------------------------------------------------------
  // FEAT-AUTH-05: Two-Factor Authentication (MFA)
  // --------------------------------------------------------------------------

  async getMfaStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'USER_NOT_FOUND',
        'Không tìm thấy người dùng'
      );
    }
    const factor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: userId, status: { in: ['ACTIVE', 'PENDING'] } },
      orderBy: { created_at: 'desc' },
      include: { recovery_codes: true },
    });
    const status = factor ? factor.status : 'NOT_ENROLLED';
    const remainingCodes =
      factor?.status === 'ACTIVE'
        ? factor.recovery_codes.filter((c) => c.consumed_at === null).length
        : 0;

    return {
      data: {
        status,
        required: user.role === 'OWNER',
        recovery_codes_remaining: remainingCodes,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  }

  async setupMfa(userId: string, clientIp: string, correlationId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { merchant: true },
    });
    if (!user || user.status !== 'active') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_NOT_ACTIVE',
        'Tài khoản không ở trạng thái hoạt động'
      );
    }

    const secret = generateTotpSecret();
    const label = encodeURIComponent(user.email || user.phone || user.id);
    const otpauth_url = `otpauth://totp/Ship%20D%E1%BB%85:${label}?secret=${secret}&issuer=Ship%20D%E1%BB%85&algorithm=SHA1&digits=6&period=30`;
    const encryptedSecret = encryptSecret(secret);

    // Delete or invalidate older PENDING factors
    await this.prisma.mfaFactor.deleteMany({
      where: { user_id: userId, status: 'PENDING' },
    });

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await this.prisma.mfaFactor.create({
      data: {
        user_id: user.id,
        merchant_id: user.merchant_id,
        type: 'TOTP',
        encrypted_secret: encryptedSecret,
        key_version: 1,
        status: 'PENDING',
        expires_at: expiresAt,
      },
    });

    await this.logAudit({
      merchantId: user.merchant_id,
      userId: user.id,
      actor: `user:${user.id}`,
      action: 'AUTH_MFA_SETUP_STARTED',
      resource: `user:${user.id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
    });

    return {
      data: {
        secret,
        otpauth_url,
        expires_in: 600,
      },
      meta: {
        timestamp: new Date().toISOString(),
        correlation_id: correlationId,
      },
    };
  }

  async verifyMfaSetup(
    userId: string,
    dto: MfaSetupVerifyDto,
    clientIp: string,
    correlationId: string
  ) {
    if (!dto.code || !/^\d{6}$/.test(dto.code.trim())) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CODE_INVALID',
        'Mã xác thực TOTP không đúng định dạng 6 chữ số'
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { merchant: true },
    });
    if (!user || user.status !== 'active') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_NOT_ACTIVE',
        'Tài khoản không hoạt động'
      );
    }

    const pendingFactor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: userId, status: 'PENDING' },
      orderBy: { created_at: 'desc' },
    });

    if (!pendingFactor || (pendingFactor.expires_at && pendingFactor.expires_at < new Date())) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_SETUP_EXPIRED',
        'Phiên thiết lập MFA đã hết hạn hoặc không tồn tại. Vui lòng bắt đầu lại.'
      );
    }

    // Check race condition (AC-AUTH-05-04): ensure no active factor already exists
    const existingActive = await this.prisma.mfaFactor.findFirst({
      where: { user_id: userId, status: 'ACTIVE' },
    });
    if (existingActive) {
      throw new CanonicalApiException(
        HttpStatus.CONFLICT,
        'MFA_ALREADY_ENABLED',
        'Bảo mật 2 bước đã được kích hoạt trước đó'
      );
    }

    const plainSecret = decryptSecret(pendingFactor.encrypted_secret);
    const verification = verifyTotp(plainSecret, dto.code, {
      lastAcceptedStep: pendingFactor.last_accepted_step,
    });
    if (!verification.valid) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CODE_INVALID',
        'Mã xác thực TOTP không chính xác hoặc đã hết hạn'
      );
    }

    // Generate 10 recovery codes
    const recoveryCodes = generateRecoveryCodes(10);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const raceCheck = await tx.mfaFactor.findFirst({
        where: { user_id: userId, status: 'ACTIVE' },
      });
      if (raceCheck) {
        throw new CanonicalApiException(
          HttpStatus.CONFLICT,
          'MFA_ALREADY_ENABLED',
          'Bảo mật 2 bước đã được kích hoạt'
        );
      }

      await tx.mfaFactor.update({
        where: { id: pendingFactor.id },
        data: {
          status: 'ACTIVE',
          activated_at: now,
          last_accepted_step: verification.step,
        },
      });

      for (const hashed of recoveryCodes.hashed) {
        await tx.mfaRecoveryCode.create({
          data: {
            factor_id: pendingFactor.id,
            code_hash: hashed,
          },
        });
      }
    });

    await this.logAudit({
      merchantId: user.merchant_id,
      userId: user.id,
      actor: `user:${user.id}`,
      action: 'AUTH_MFA_SETUP_COMPLETED',
      resource: `user:${user.id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
    });

    const sessionId = randomUUID();
    const secret = resolveAccessTokenSecret(this.config?.AUTH_TOKEN_SECRET);
    const ttlSeconds = this.config?.AUTH_TOKEN_TTL_SECONDS ?? 43200;
    const { token } = signAccessToken(
      {
        sub: user.id,
        sid: sessionId,
        mid: user.merchant_id,
        role: user.role,
        st: user.status,
        mfa_verified: true,
      },
      secret,
      ttlSeconds
    );

    await this.prisma.deviceSession.create({
      data: {
        id: sessionId,
        user_id: user.id,
        merchant_id: user.merchant_id,
        session_token_hash: createHash('sha256').update(token).digest('hex'),
        device_id: 'web-session',
        last_active_at: now,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        ip_address: this.hashIp(clientIp),
        mfa_verified_at: now,
        auth_assurance: 'MFA',
      },
    });

    return {
      data: {
        status: 'AUTHENTICATED' as const,
        access_token: token,
        recovery_codes: recoveryCodes.plaintext,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          full_name: user.full_name,
          role: user.role,
          status: user.status,
          email_verified_at: user.email_verified_at,
          phone_verified_at: user.phone_verified_at,
          created_at: user.created_at,
        },
        merchant: {
          id: user.merchant.id,
          name: user.merchant.name,
          code: user.merchant.code,
          status: user.merchant.status,
          created_at: user.merchant.created_at,
        },
      },
      meta: {
        timestamp: now.toISOString(),
        correlation_id: correlationId,
      },
    };
  }

  async verifyMfaChallenge(dto: MfaChallengeVerifyDto, clientIp: string, correlationId: string) {
    if (!dto.challenge_id || !dto.code) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'challenge_id và code là bắt buộc'
      );
    }

    const ipCheck = await this.rateLimitService.checkMfaIpLimit(clientIp);
    if (!ipCheck.allowed) {
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Địa chỉ IP này đã thử xác thực sai quá nhiều lần. Vui lòng chờ trước khi thử lại.',
        true,
        'Vui lòng chờ thử lại',
        undefined,
        ipCheck.retryAfterSeconds || 900
      );
    }

    const challengeHash = hashMfaChallengeToken(dto.challenge_id);
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { challenge_hash: challengeHash },
      include: { user: { include: { merchant: true } } },
    });

    if (
      !challenge ||
      challenge.consumed_at ||
      challenge.invalidated_at ||
      challenge.expires_at < new Date()
    ) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CHALLENGE_EXPIRED',
        'Thử thách xác thực MFA đã hết hạn hoặc không hợp lệ'
      );
    }

    if (challenge.failed_attempts >= 5) {
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Đã nhập sai mã xác thực quá 5 lần. Thử thách này đã bị hủy.',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    const user = challenge.user;
    if (user.status !== 'active') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_NOT_ACTIVE',
        'Tài khoản không ở trạng thái hoạt động'
      );
    }

    const activeFactor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: user.id, status: 'ACTIVE' },
    });
    if (!activeFactor) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'MFA_FACTOR_NOT_FOUND',
        'Không tìm thấy cấu hình bảo mật MFA của người dùng'
      );
    }

    const plainSecret = decryptSecret(activeFactor.encrypted_secret);
    const verification = verifyTotp(plainSecret, dto.code, {
      lastAcceptedStep: activeFactor.last_accepted_step,
    });

    if (!verification.valid) {
      await this.prisma.mfaChallenge.update({
        where: { id: challenge.id },
        data: { failed_attempts: { increment: 1 } },
      });
      await this.rateLimitService.recordMfaIpFailure(clientIp);

      await this.logAudit({
        merchantId: user.merchant_id,
        userId: user.id,
        actor: `user:${user.id}`,
        action: 'AUTH_MFA_CHALLENGE_FAILED',
        resource: `challenge:${challenge.id}`,
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { reason: verification.error },
      });

      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CODE_INVALID',
        'Mã xác thực không chính xác'
      );
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.mfaChallenge.update({
        where: { id: challenge.id },
        data: { consumed_at: now },
      }),
      this.prisma.mfaFactor.update({
        where: { id: activeFactor.id },
        data: { last_accepted_step: verification.step },
      }),
    ]);

    await this.logAudit({
      merchantId: user.merchant_id,
      userId: user.id,
      actor: `user:${user.id}`,
      action: 'AUTH_MFA_CHALLENGE_SUCCEEDED',
      resource: `challenge:${challenge.id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
    });

    return this.createMfaAuthenticatedSessionResponse(user, clientIp, correlationId, now);
  }

  async verifyMfaRecovery(dto: MfaRecoveryVerifyDto, clientIp: string, correlationId: string) {
    if (!dto.challenge_id || !dto.recovery_code) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'challenge_id và recovery_code là bắt buộc'
      );
    }

    const challengeHash = hashMfaChallengeToken(dto.challenge_id);
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { challenge_hash: challengeHash },
      include: { user: { include: { merchant: true } } },
    });

    if (
      !challenge ||
      challenge.consumed_at ||
      challenge.invalidated_at ||
      challenge.expires_at < new Date()
    ) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CHALLENGE_EXPIRED',
        'Thử thách xác thực MFA đã hết hạn hoặc không hợp lệ'
      );
    }

    if (challenge.failed_attempts >= 5) {
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Đã nhập sai quá 5 lần. Thử thách này đã bị hủy.',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    const user = challenge.user;
    if (user.status !== 'active') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_NOT_ACTIVE',
        'Tài khoản không hoạt động'
      );
    }

    const activeFactor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: user.id, status: 'ACTIVE' },
      include: { recovery_codes: true },
    });
    if (!activeFactor) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'MFA_FACTOR_NOT_FOUND',
        'Không tìm thấy cấu hình bảo mật MFA'
      );
    }

    const unusedCodes = activeFactor.recovery_codes.filter((c) => c.consumed_at === null);
    const matched = unusedCodes.find((c) => verifyRecoveryCode(dto.recovery_code, c.code_hash));

    if (!matched) {
      await this.prisma.mfaChallenge.update({
        where: { id: challenge.id },
        data: { failed_attempts: { increment: 1 } },
      });
      await this.rateLimitService.recordMfaIpFailure(clientIp);

      await this.logAudit({
        merchantId: user.merchant_id,
        userId: user.id,
        actor: `user:${user.id}`,
        action: 'AUTH_MFA_CHALLENGE_FAILED',
        resource: `challenge:${challenge.id}`,
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { reason: 'invalid_recovery_code' },
      });

      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_RECOVERY_CODE_INVALID',
        'Mã khôi phục không hợp lệ hoặc đã được sử dụng'
      );
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.update({
        where: { id: matched.id },
        data: { consumed_at: now, consumed_by: `user:${user.id}` },
      }),
      this.prisma.mfaChallenge.update({
        where: { id: challenge.id },
        data: { consumed_at: now },
      }),
    ]);

    const remainingCount = unusedCodes.length - 1;

    await this.logAudit({
      merchantId: user.merchant_id,
      userId: user.id,
      actor: `user:${user.id}`,
      action: 'AUTH_MFA_RECOVERY_USED',
      resource: `recovery_code:${matched.id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: { remaining: remainingCount },
    });

    const sessionRes = await this.createMfaAuthenticatedSessionResponse(
      user,
      clientIp,
      correlationId,
      now
    );
    return {
      data: {
        ...sessionRes.data,
        recovery_codes_remaining: remainingCount,
      },
      meta: sessionRes.meta,
    };
  }

  async regenerateRecoveryCodes(userId: string, clientIp: string, correlationId: string) {
    const factor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: userId, status: 'ACTIVE' },
    });
    if (!factor) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_NOT_ACTIVE',
        'Chưa kích hoạt bảo mật 2 bước'
      );
    }

    const newCodes = generateRecoveryCodes(10);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({
        where: { factor_id: factor.id },
      });

      for (const hashed of newCodes.hashed) {
        await tx.mfaRecoveryCode.create({
          data: {
            factor_id: factor.id,
            code_hash: hashed,
          },
        });
      }
    });

    await this.logAudit({
      merchantId: factor.merchant_id,
      userId,
      actor: `user:${userId}`,
      action: 'AUTH_MFA_RECOVERY_REGENERATED',
      resource: `factor:${factor.id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
    });

    return {
      data: {
        recovery_codes: newCodes.plaintext,
      },
      meta: {
        timestamp: now.toISOString(),
        correlation_id: correlationId,
      },
    };
  }

  async resetUserMfa(
    actorUserId: string,
    actorAssurance: string,
    targetUserId: string,
    dto: MfaResetDto,
    idempotencyKey: string | undefined,
    clientIp: string,
    correlationId: string
  ) {
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Lý do reset MFA là bắt buộc'
      );
    }

    if (actorUserId === targetUserId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Không được phép tự reset MFA của chính mình'
      );
    }

    if (actorAssurance !== 'MFA') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu phiên đăng nhập xác thực 2 bước (MFA) để thực hiện thao tác này'
      );
    }

    const actor = await this.prisma.user.findUnique({ where: { id: actorUserId } });
    if (!actor || actor.role !== RoleEnum.OWNER) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Chỉ Chủ shop (Owner) mới có quyền reset MFA cho thành viên khác'
      );
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target || target.merchant_id !== actor.merchant_id) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Không tìm thấy người dùng hoặc người dùng thuộc shop khác'
      );
    }

    const targetFactor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: targetUserId, status: { in: ['ACTIVE', 'PENDING'] } },
    });
    if (!targetFactor) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_NOT_CONFIGURED',
        'Người dùng mục tiêu chưa thiết lập MFA'
      );
    }

    const reasonHash = createHash('sha256').update(dto.reason.trim()).digest('hex');

    if (idempotencyKey) {
      const cacheKey = `idempotency:mfa_reset:${actor.merchant_id}:${idempotencyKey}`;
      let cached: { targetUserId: string; reasonHash: string; response: any } | null = null;
      if (this.redisService?.getClient()) {
        try {
          const val = await this.redisService.getClient().get(cacheKey);
          if (val) cached = JSON.parse(val);
        } catch {}
      }
      if (!cached) {
        cached = this.idempotencyMemoryFallback.get(cacheKey) || null;
      }

      if (cached) {
        if (cached.targetUserId === targetUserId && cached.reasonHash === reasonHash) {
          return cached.response;
        }
        throw new CanonicalApiException(
          HttpStatus.CONFLICT,
          'IDEMPOTENCY_CONFLICT',
          'Khóa Idempotency-Key đã được sử dụng với tham số yêu cầu khác'
        );
      }
    }

    const now = new Date();
    let revokedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.mfaFactor.update({
        where: { id: targetFactor.id },
        data: {
          status: 'RESET',
          reset_at: now,
          reset_by: `user:${actorUserId}`,
          reset_reason: dto.reason.trim(),
        },
      });

      await tx.mfaRecoveryCode.deleteMany({
        where: { factor_id: targetFactor.id },
      });

      await tx.mfaChallenge.updateMany({
        where: { user_id: targetUserId, consumed_at: null },
        data: { invalidated_at: now },
      });

      const revokeRes = await tx.deviceSession.updateMany({
        where: { user_id: targetUserId, is_revoked: false },
        data: {
          is_revoked: true,
          status: 'REVOKED',
          revoked_at: now,
          revoked_by: `user:${actorUserId}`,
          revoke_reason: `MFA reset: ${dto.reason.trim()}`,
        },
      });
      revokedCount = revokeRes.count;
    });

    await this.logAudit({
      merchantId: actor.merchant_id,
      userId: targetUserId,
      actor: `user:${actorUserId}`,
      action: 'AUTH_MFA_ADMIN_RESET',
      resource: `user:${targetUserId}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: {
        reason: dto.reason.trim(),
        sessions_revoked: revokedCount,
        idempotency_key: idempotencyKey,
      },
    });

    const response = {
      data: {
        success: true,
        user_id: targetUserId,
        sessions_revoked: revokedCount,
        reset_at: now.toISOString(),
      },
      meta: {
        timestamp: now.toISOString(),
        correlation_id: correlationId,
      },
    };

    if (idempotencyKey) {
      const cacheKey = `idempotency:mfa_reset:${actor.merchant_id}:${idempotencyKey}`;
      const record = { targetUserId, reasonHash, response };
      this.idempotencyMemoryFallback.set(cacheKey, record);
      if (this.redisService?.getClient()) {
        try {
          await this.redisService.getClient().set(cacheKey, JSON.stringify(record), 'EX', 86400);
        } catch {}
      }
    }

    return response;
  }

  private async createMfaAuthenticatedSessionResponse(
    user: any,
    clientIp: string,
    correlationId: string,
    now: Date
  ) {
    const sessionId = randomUUID();
    const secret = resolveAccessTokenSecret(this.config?.AUTH_TOKEN_SECRET);
    const ttlSeconds = this.config?.AUTH_TOKEN_TTL_SECONDS ?? 43200;
    const { token } = signAccessToken(
      {
        sub: user.id,
        sid: sessionId,
        mid: user.merchant_id,
        role: user.role,
        st: user.status,
        mfa_verified: true,
      },
      secret,
      ttlSeconds
    );

    await this.prisma.deviceSession.create({
      data: {
        id: sessionId,
        user_id: user.id,
        merchant_id: user.merchant_id,
        session_token_hash: createHash('sha256').update(token).digest('hex'),
        device_id: 'web-session',
        last_active_at: now,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        ip_address: this.hashIp(clientIp),
        mfa_verified_at: now,
        auth_assurance: 'MFA',
      },
    });

    return {
      data: {
        status: 'AUTHENTICATED' as const,
        access_token: token,
        expires_in: ttlSeconds,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          full_name: user.full_name,
          role: user.role,
          status: user.status,
          email_verified_at: user.email_verified_at ? user.email_verified_at.toISOString() : null,
          phone_verified_at: user.phone_verified_at ? user.phone_verified_at.toISOString() : null,
          created_at: user.created_at.toISOString(),
        },
        merchant: {
          id: user.merchant.id,
          name: user.merchant.name,
          code: user.merchant.code,
          status: user.merchant.status,
          created_at: user.merchant.created_at.toISOString(),
        },
      },
      meta: {
        timestamp: now.toISOString(),
        correlation_id: correlationId,
      },
    };
  }

  private hashIp(ip: string): string {
    return createHash('sha256').update(ip).digest('hex').substring(0, 16);
  }

  private async logAudit(meta: {
    merchantId?: string;
    userId?: string;
    actor: string;
    action: string;
    resource: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    correlationId?: string;
  }): Promise<void> {
    console.log(
      formatStructuredLog({
        level: 'info',
        service: 'api',
        message: `AUDIT: ${meta.action} on ${meta.resource} by ${meta.actor}`,
        metadata: {
          ...meta,
          timestamp: new Date().toISOString(),
        },
      })
    );

    if (meta.merchantId) {
      try {
        await this.prisma.auditLog.create({
          data: {
            merchant_id: meta.merchantId,
            user_id: meta.userId || null,
            action: meta.action,
            entity_type: meta.resource.split(':')[0] || 'Auth',
            entity_id: meta.resource.split(':')[1] || meta.userId || 'system',
            new_value: meta.details ? JSON.parse(JSON.stringify(meta.details)) : null,
            ip_address: meta.ipAddress || null,
          },
        });
      } catch (err) {
        console.error('Failed to persist audit log to database:', err);
      }
    }
  }
}
