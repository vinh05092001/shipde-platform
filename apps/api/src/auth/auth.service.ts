import {
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateProvisioningUri,
  encryptMfaSecret,
  decryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
} from './totp.util';
import { resolveMfaEncryptionKey, normalizeCorrelationId } from '@shipde/config';
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
import { RateLimitService } from './rate-limit.service';
import { hashPassword, verifyPassword } from './password.util';
import { resolveAccessTokenSecret, signAccessToken } from './token.util';
import { VERIFICATION_ADAPTER } from './auth.tokens';
import type { IVerificationDeliveryAdapter } from '@shipde/contracts';
import { formatStructuredLog, AppConfig } from '@shipde/config';
import { APP_CONFIG } from '../config.token';
import { RoleEnum } from '@prisma/client';
import { AdminCreateShopDto, AdminListShopsQuery, AdminCreatedShopResult } from './admin-shops.dto';

export type { AdminCreateShopDto, AdminListShopsQuery, AdminCreatedShopResult };

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

export interface MfaSetupDto {
  password?: string;
}

export interface MfaSetupVerifyDto {
  code?: string;
}

export interface MfaChallengeVerifyDto {
  challenge_id?: string;
  code?: string;
}

export interface MfaRecoveryVerifyDto {
  challenge_id?: string;
  recovery_code?: string;
}

export interface MfaRegenerateRecoveryCodesDto {
  password?: string;
  code?: string;
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
    public readonly extra?: Record<string, unknown>
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
          ...(extra || {}),
        },
      },
      statusCode
    );
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateLimitService) private readonly rateLimitService: RateLimitService,
    @Optional()
    @Inject(VERIFICATION_ADAPTER)
    private readonly deliveryAdapter?: IVerificationDeliveryAdapter,
    @Optional()
    @Inject(APP_CONFIG)
    private readonly config?: AppConfig
  ) {}

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

    // FEAT-AUTH-05: Check MFA factor enrollment (AC-AUTH-05-06, AC-AUTH-05-12)
    const activeFactor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: tokenRecord.user.id, status: 'ACTIVE' },
    });

    if (activeFactor) {
      const rawChallenge = 'mfa_ch_' + randomBytes(32).toString('hex');
      const challengeHash = createHash('sha256').update(rawChallenge).digest('hex');
      const challengeTtlSeconds = 300;

      await this.prisma.mfaChallenge.create({
        data: {
          challenge_hash: challengeHash,
          user_id: tokenRecord.user.id,
          merchant_id: tokenRecord.user.merchant_id,
          login_transaction_ref: correlationId,
          purpose: 'MFA_LOGIN',
          expires_at: new Date(Date.now() + challengeTtlSeconds * 1000),
          correlation_id: correlationId,
        },
      });

      return {
        data: {
          status: 'MFA_REQUIRED' as const,
          challenge_id: rawChallenge,
          expires_in: challengeTtlSeconds,
        },
        meta: { correlation_id: correlationId },
      };
    }

    if (tokenRecord.user.role === RoleEnum.OWNER) {
      const setupTtlSeconds = 600;
      const secret = resolveAccessTokenSecret(this.config?.AUTH_TOKEN_SECRET);
      const { token: setupToken } = signAccessToken(
        {
          sub: tokenRecord.user.id,
          sid: 'mfa-setup-session',
          mid: tokenRecord.user.merchant_id,
          role: tokenRecord.user.role,
          st: tokenRecord.user.status,
          scope: 'setup',
        },
        secret,
        setupTtlSeconds
      );

      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'MFA_ENROLLMENT_REQUIRED',
        'Tài khoản Chủ shop (Owner) bắt buộc phải hoàn thành thiết lập xác thực hai yếu tố (MFA)',
        false,
        'Vui lòng hoàn thành thiết lập MFA bằng mã token được cấp',
        undefined,
        undefined,
        {
          setup_token: setupToken,
          access_token: setupToken,
          expires_in: setupTtlSeconds,
        }
      );
    }

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

    // FEAT-AUTH-05: Check MFA factor enrollment (AC-AUTH-05-05, AC-AUTH-05-12)
    const activeFactor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: user.id, status: 'ACTIVE' },
    });

    if (activeFactor) {
      const rawChallenge = 'mfa_ch_' + randomBytes(32).toString('hex');
      const challengeHash = createHash('sha256').update(rawChallenge).digest('hex');
      const challengeTtlSeconds = 300;

      await this.prisma.mfaChallenge.create({
        data: {
          challenge_hash: challengeHash,
          user_id: user.id,
          merchant_id: user.merchant_id,
          login_transaction_ref: correlationId,
          purpose: 'MFA_LOGIN',
          expires_at: new Date(Date.now() + challengeTtlSeconds * 1000),
          correlation_id: correlationId,
        },
      });

      return {
        data: {
          status: 'MFA_REQUIRED' as const,
          challenge_id: rawChallenge,
          expires_in: challengeTtlSeconds,
        },
        meta: { correlation_id: correlationId },
      };
    }

    if (user.role === RoleEnum.OWNER) {
      const setupTtlSeconds = 600;
      const secret = resolveAccessTokenSecret(this.config?.AUTH_TOKEN_SECRET);
      const { token: setupToken } = signAccessToken(
        {
          sub: user.id,
          sid: 'mfa-setup-session',
          mid: user.merchant_id,
          role: user.role,
          st: user.status,
          scope: 'setup',
        },
        secret,
        setupTtlSeconds
      );

      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'MFA_ENROLLMENT_REQUIRED',
        'Tài khoản Chủ shop (Owner) bắt buộc phải hoàn thành thiết lập xác thực hai yếu tố (MFA)',
        false,
        'Vui lòng hoàn thành thiết lập MFA bằng mã token được cấp',
        undefined,
        undefined,
        {
          setup_token: setupToken,
          access_token: setupToken,
          expires_in: setupTtlSeconds,
        }
      );
    }

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
    auditAction: 'AUTH_LOGIN_SUCCESS' | 'AUTH_LOGIN_OTP_SUCCESS' | 'AUTH_MFA_CHALLENGE_SUCCEEDED',
    authAssurance: 'PASSWORD' | 'MFA' = 'PASSWORD',
    mfaVerifiedAt: Date | null = null
  ) {
    const ttlSeconds = this.config?.AUTH_TOKEN_TTL_SECONDS ?? 43200;
    const merchant = user.merchant;

    const sessionId = randomUUID();
    const secret = resolveAccessTokenSecret(this.config?.AUTH_TOKEN_SECRET);
    const { token } = signAccessToken(
      {
        sub: user.id,
        sid: sessionId,
        mid: user.merchant_id,
        role: user.role,
        st: user.status,
        auth_assurance: authAssurance,
        mfa_verified_at: mfaVerifiedAt ? mfaVerifiedAt.toISOString() : undefined,
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
        auth_assurance: authAssurance,
        mfa_verified_at: mfaVerifiedAt,
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
      details: { session_id: session.id, role: user.role, auth_assurance: authAssurance },
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
          auth_assurance: authAssurance,
          mfa_verified_at: mfaVerifiedAt ? mfaVerifiedAt.toISOString() : null,
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

  /**
   * GET /auth/mfa/status (API-AUTH-MFA-STATUS, FEAT-AUTH-05)
   */
  async getMfaStatus(userId: string, merchantId: string, role?: string, correlationId?: string) {
    const factor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: userId, status: { in: ['ACTIVE', 'PENDING', 'RESET'] } },
      orderBy: { created_at: 'desc' },
    });

    let effectiveStatus: 'NOT_ENROLLED' | 'PENDING' | 'ACTIVE' | 'RESET' = 'NOT_ENROLLED';
    if (factor) {
      if (factor.status === 'ACTIVE') {
        effectiveStatus = 'ACTIVE';
      } else if (factor.status === 'PENDING') {
        if (factor.setup_expires_at && factor.setup_expires_at < new Date()) {
          effectiveStatus = 'NOT_ENROLLED';
        } else {
          effectiveStatus = 'PENDING';
        }
      } else if (factor.status === 'RESET') {
        effectiveStatus = 'RESET';
      }
    }

    let recoveryCodesRemaining = 0;
    if (effectiveStatus === 'ACTIVE' && factor) {
      recoveryCodesRemaining = await this.prisma.mfaRecoveryCode.count({
        where: { factor_id: factor.id, consumed_at: null },
      });
    }

    const isRequired = role === RoleEnum.OWNER || role === 'OWNER';

    return {
      data: {
        status: effectiveStatus,
        required: isRequired,
        recovery_codes_remaining: recoveryCodesRemaining,
        mfa_verified_at: factor?.activated_at ? factor.activated_at.toISOString() : null,
      },
      meta: { correlation_id: correlationId || normalizeCorrelationId() },
    };
  }

  /**
   * POST /auth/mfa/setup (API-AUTH-MFA-SETUP, FEAT-AUTH-05, BR-AUTH-14, AC-AUTH-05-01)
   */
  async startMfaSetup(
    userId: string,
    merchantId: string,
    dto: MfaSetupDto,
    clientIp: string,
    correlationId: string
  ) {
    if (!dto.password) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Mật khẩu là bắt buộc để bắt đầu thiết lập MFA',
        false,
        'Vui lòng nhập mật khẩu đăng nhập'
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Người dùng không tồn tại'
      );
    }

    const passwordMatches = await verifyPassword(dto.password, user.password_hash).catch(
      () => false
    );
    if (!passwordMatches) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Mật khẩu xác thực không chính xác',
        false
      );
    }

    const activeFactor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: userId, status: 'ACTIVE' },
    });
    if (activeFactor) {
      throw new CanonicalApiException(
        HttpStatus.CONFLICT,
        'MFA_ALREADY_ENABLED',
        'Tài khoản đã có phương thức xác thực hai yếu tố đang hoạt động',
        false
      );
    }

    await this.prisma.mfaFactor.deleteMany({
      where: { user_id: userId, status: 'PENDING' },
    });

    const secret = generateTotpSecret();
    const encryptionKey = resolveMfaEncryptionKey(this.config?.MFA_ENCRYPTION_KEY);
    const encryptedSecret = encryptMfaSecret(secret, encryptionKey);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.prisma.mfaFactor.create({
      data: {
        user_id: userId,
        merchant_id: merchantId,
        type: 'TOTP',
        status: 'PENDING',
        secret_ciphertext: encryptedSecret,
        key_version: 1,
        setup_expires_at: expiresAt,
        created_by: userId,
      },
    });

    await this.logAudit({
      merchantId,
      userId,
      actor: `user:${userId}`,
      action: 'AUTH_MFA_SETUP_STARTED',
      resource: `user:${userId}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: { expires_at: expiresAt.toISOString() },
    });

    const accountIdentifier = user.email || user.phone || user.id;
    const uri = generateProvisioningUri({
      secret,
      accountName: accountIdentifier,
      issuer: 'Ship Dễ',
    });

    return {
      data: {
        secret_key: secret,
        provisioning_uri: uri,
        expires_at: expiresAt.toISOString(),
        expires_in_seconds: 600,
      },
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * POST /auth/mfa/setup/verify (API-AUTH-MFA-SETUP-VERIFY, FEAT-AUTH-05, BR-AUTH-15, AC-AUTH-05-02..04)
   */
  async verifyMfaSetup(
    userId: string,
    merchantId: string,
    dto: MfaSetupVerifyDto,
    clientIp: string,
    correlationId: string
  ) {
    if (!dto.code || !/^\d{6}$/.test(dto.code.trim())) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Mã xác thực gồm 6 chữ số',
        false,
        undefined,
        [{ field: 'code', code: 'INVALID_FORMAT', message: 'Mã xác thực phải gồm 6 chữ số' }]
      );
    }

    const factor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: userId, status: 'PENDING' },
      orderBy: { created_at: 'desc' },
      include: { user: { include: { merchant: true } } },
    });

    if (!factor) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CHALLENGE_INVALID',
        'Không tìm thấy phiên thiết lập MFA đang chờ'
      );
    }

    if (factor.setup_expires_at && factor.setup_expires_at < new Date()) {
      await this.logAudit({
        merchantId,
        userId,
        actor: `user:${userId}`,
        action: 'AUTH_MFA_SETUP_EXPIRED',
        resource: `user:${userId}`,
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { expired_at: factor.setup_expires_at.toISOString() },
      });
      throw new CanonicalApiException(
        HttpStatus.GONE,
        'MFA_SETUP_EXPIRED',
        'Phiên thiết lập MFA đã hết hạn (10 phút). Vui lòng bắt đầu lại.',
        false,
        'Vui lòng bắt đầu lại thiết lập xác thực hai yếu tố'
      );
    }

    const encryptionKey = resolveMfaEncryptionKey(this.config?.MFA_ENCRYPTION_KEY);
    const secret = decryptMfaSecret(factor.secret_ciphertext, encryptionKey);
    const verifyResult = verifyTotpCode(dto.code, secret, factor.last_accepted_step);

    if (!verifyResult.valid) {
      if (verifyResult.error === 'STEP_REPLAYED') {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'MFA_CODE_INVALID',
          'Mã xác thực đã được sử dụng. Vui lòng chờ mã mới từ ứng dụng.',
          false
        );
      }
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CODE_INVALID',
        'Mã xác thực không chính xác',
        false
      );
    }

    const { plaintext: recoveryCodes, hashes: recoveryHashes } = generateRecoveryCodes(10);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const activeCheck = await tx.mfaFactor.findFirst({
        where: { user_id: userId, status: 'ACTIVE' },
      });
      if (activeCheck) {
        throw new CanonicalApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'Tài khoản đã có phương thức xác thực MFA đang hoạt động'
        );
      }

      const updateResult = await tx.mfaFactor.updateMany({
        where: { id: factor.id, status: 'PENDING' },
        data: {
          status: 'ACTIVE',
          activated_at: now,
          last_accepted_step: verifyResult.acceptedStep,
          updated_by: userId,
        },
      });

      if (updateResult.count === 0) {
        throw new CanonicalApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'Phiên thiết lập đã thay đổi hoặc đang được xử lý'
        );
      }

      await tx.mfaRecoveryCode.createMany({
        data: recoveryHashes.map((h) => ({
          factor_id: factor.id,
          code_hash: h,
        })),
      });
    });

    await this.logAudit({
      merchantId,
      userId,
      actor: `user:${userId}`,
      action: 'AUTH_MFA_SETUP_COMPLETED',
      resource: `user:${userId}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: { factor_id: factor.id },
    });

    const user = factor.user;
    const sessionRes = await this.createLoginSessionAndResponse(
      user,
      false,
      clientIp,
      correlationId,
      'AUTH_LOGIN_SUCCESS',
      'MFA',
      now
    );

    return {
      data: {
        status: 'AUTHENTICATED' as const,
        recovery_codes: recoveryCodes,
        access_token: sessionRes.data.access_token,
        expires_in: sessionRes.data.expires_in,
        user: sessionRes.data.user,
        merchant: sessionRes.data.merchant,
      },
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * POST /auth/mfa/challenge/verify (API-AUTH-MFA-CHALLENGE-VERIFY, FEAT-AUTH-05, BR-AUTH-16, AC-AUTH-05-07..08, AC-AUTH-05-16, AC-AUTH-05-24)
   */
  async verifyMfaChallenge(dto: MfaChallengeVerifyDto, clientIp: string, correlationId: string) {
    const ipCheck = await this.rateLimitService.checkMfaIpLimit(clientIp);
    if (!ipCheck.allowed) {
      await this.logAudit({
        actor: this.hashIp(clientIp),
        action: 'AUTH_MFA_RATE_LIMITED',
        resource: 'auth/mfa/challenge/verify',
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { scope: 'ip' },
      });
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        ipCheck.reason || 'Quá nhiều lần thử xác thực hai yếu tố từ IP này.',
        true,
        'Vui lòng thử lại sau',
        undefined,
        ipCheck.retryAfterSeconds
      );
    }

    if (!dto.challenge_id || !dto.code || !/^\d{6}$/.test(dto.code.trim())) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Mã thử thách và mã xác thực 6 chữ số là bắt buộc'
      );
    }

    const challengeHash = createHash('sha256').update(dto.challenge_id).digest('hex');

    const challengeLimitCheck = await this.rateLimitService.checkMfaChallengeLimit(challengeHash);
    if (!challengeLimitCheck.allowed) {
      await this.rateLimitService.recordMfaIpFailure(clientIp);
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        challengeLimitCheck.reason || 'Đã vượt quá số lần thử cho phép.',
        true,
        'Vui lòng thử lại sau',
        undefined,
        challengeLimitCheck.retryAfterSeconds
      );
    }

    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { challenge_hash: challengeHash },
      include: { user: { include: { merchant: true } } },
    });

    const now = new Date();
    if (
      !challenge ||
      challenge.consumed_at !== null ||
      challenge.invalidated_at !== null ||
      challenge.expires_at < now ||
      challenge.failed_attempts >= 5
    ) {
      await this.rateLimitService.recordMfaIpFailure(clientIp);
      await this.rateLimitService.recordMfaChallengeFailure(challengeHash);
      if (challenge) {
        await this.logAudit({
          merchantId: challenge.merchant_id,
          userId: challenge.user_id,
          actor: `user:${challenge.user_id}`,
          action: 'AUTH_MFA_CHALLENGE_FAILED',
          resource: `user:${challenge.user_id}`,
          correlationId,
          ipAddress: this.hashIp(clientIp),
          details: { reason: 'challenge_expired_or_invalid' },
        });
      }
      throw new CanonicalApiException(
        HttpStatus.GONE,
        'MFA_CHALLENGE_EXPIRED',
        'Mã thử thách xác thực đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.'
      );
    }

    if (challenge.user.status !== 'active') {
      await this.rateLimitService.recordMfaIpFailure(clientIp);
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'MFA_CHALLENGE_INVALID',
        'Tài khoản không ở trạng thái hợp lệ để đăng nhập'
      );
    }

    const factor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: challenge.user_id, status: 'ACTIVE' },
    });

    if (!factor) {
      await this.rateLimitService.recordMfaIpFailure(clientIp);
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CHALLENGE_INVALID',
        'Không tìm thấy phương thức xác thực hai yếu tố hợp lệ'
      );
    }

    const encryptionKey = resolveMfaEncryptionKey(this.config?.MFA_ENCRYPTION_KEY);
    const secret = decryptMfaSecret(factor.secret_ciphertext, encryptionKey);
    const verifyResult = verifyTotpCode(dto.code, secret, factor.last_accepted_step);

    if (!verifyResult.valid) {
      await this.prisma.mfaChallenge.update({
        where: { id: challenge.id },
        data: { failed_attempts: { increment: 1 } },
      });
      await this.rateLimitService.recordMfaIpFailure(clientIp);
      await this.rateLimitService.recordMfaChallengeFailure(challengeHash);

      await this.logAudit({
        merchantId: challenge.merchant_id,
        userId: challenge.user_id,
        actor: `user:${challenge.user_id}`,
        action: 'AUTH_MFA_CHALLENGE_FAILED',
        resource: `user:${challenge.user_id}`,
        correlationId,
        ipAddress: this.hashIp(clientIp),
        details: { reason: verifyResult.error || 'invalid_totp' },
      });

      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CODE_INVALID',
        'Mã xác thực không chính xác'
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.mfaChallenge.update({
        where: { id: challenge.id },
        data: { consumed_at: now },
      });
      await tx.mfaFactor.update({
        where: { id: factor.id },
        data: { last_accepted_step: verifyResult.acceptedStep },
      });
    });

    await this.rateLimitService.resetMfaChallengeFailures(challengeHash);

    return this.createLoginSessionAndResponse(
      challenge.user,
      false,
      clientIp,
      correlationId,
      'AUTH_MFA_CHALLENGE_SUCCEEDED',
      'MFA',
      now
    );
  }

  /**
   * POST /auth/mfa/recovery/verify (API-AUTH-MFA-RECOVERY-VERIFY, FEAT-AUTH-05, BR-AUTH-17, AC-AUTH-05-09..10, AC-AUTH-05-23)
   */
  async verifyMfaRecovery(dto: MfaRecoveryVerifyDto, clientIp: string, correlationId: string) {
    const ipCheck = await this.rateLimitService.checkMfaIpLimit(clientIp);
    if (!ipCheck.allowed) {
      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        ipCheck.reason || 'Quá nhiều lần thử từ IP này.',
        true,
        undefined,
        undefined,
        ipCheck.retryAfterSeconds
      );
    }

    if (!dto.challenge_id || !dto.recovery_code) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Mã thử thách và mã dự phòng là bắt buộc'
      );
    }

    const challengeHash = createHash('sha256').update(dto.challenge_id).digest('hex');
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { challenge_hash: challengeHash },
      include: { user: { include: { merchant: true } } },
    });

    const now = new Date();
    if (
      !challenge ||
      challenge.consumed_at !== null ||
      challenge.invalidated_at !== null ||
      challenge.expires_at < now ||
      challenge.failed_attempts >= 5
    ) {
      await this.rateLimitService.recordMfaIpFailure(clientIp);
      throw new CanonicalApiException(
        HttpStatus.GONE,
        'MFA_CHALLENGE_EXPIRED',
        'Mã thử thách xác thực đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.'
      );
    }

    if (challenge.user.status !== 'active') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'MFA_CHALLENGE_INVALID',
        'Tài khoản không ở trạng thái hợp lệ để đăng nhập'
      );
    }

    const factor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: challenge.user_id, status: 'ACTIVE' },
    });

    if (!factor) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CHALLENGE_INVALID',
        'Không tìm thấy phương thức xác thực hai yếu tố hợp lệ'
      );
    }

    const hashedInput = hashRecoveryCode(dto.recovery_code);

    let remainingCount = 0;
    await this.prisma.$transaction(async (tx) => {
      const codeRecord = await tx.mfaRecoveryCode.findFirst({
        where: {
          factor_id: factor.id,
          code_hash: hashedInput,
          consumed_at: null,
        },
      });

      if (!codeRecord) {
        await tx.mfaChallenge.update({
          where: { id: challenge.id },
          data: { failed_attempts: { increment: 1 } },
        });
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'MFA_RECOVERY_CODE_INVALID',
          'Mã dự phòng không chính xác hoặc đã được sử dụng'
        );
      }

      const updateResult = await tx.mfaRecoveryCode.updateMany({
        where: { id: codeRecord.id, consumed_at: null },
        data: {
          consumed_at: now,
          consumed_correlation_id: correlationId,
        },
      });

      if (updateResult.count === 0) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'MFA_RECOVERY_CODE_INVALID',
          'Mã dự phòng không chính xác hoặc đã được sử dụng'
        );
      }

      await tx.mfaChallenge.update({
        where: { id: challenge.id },
        data: { consumed_at: now },
      });

      remainingCount = await tx.mfaRecoveryCode.count({
        where: { factor_id: factor.id, consumed_at: null },
      });
    });

    await this.logAudit({
      merchantId: challenge.merchant_id,
      userId: challenge.user_id,
      actor: `user:${challenge.user_id}`,
      action: 'AUTH_MFA_RECOVERY_USED',
      resource: `user:${challenge.user_id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: { remaining_codes: remainingCount },
    });

    const sessionRes = await this.createLoginSessionAndResponse(
      challenge.user,
      false,
      clientIp,
      correlationId,
      'AUTH_MFA_CHALLENGE_SUCCEEDED',
      'MFA',
      now
    );

    return {
      data: {
        status: 'AUTHENTICATED' as const,
        access_token: sessionRes.data.access_token,
        expires_in: sessionRes.data.expires_in,
        recovery_codes_remaining: remainingCount,
        user: sessionRes.data.user,
        merchant: sessionRes.data.merchant,
      },
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * POST /auth/mfa/recovery-codes/regenerate (API-AUTH-MFA-RECOVERY-REGENERATE, FEAT-AUTH-05, BR-AUTH-17, AC-AUTH-05-11)
   */
  async regenerateRecoveryCodes(
    userId: string,
    merchantId: string,
    dto: MfaRegenerateRecoveryCodesDto,
    clientIp: string,
    correlationId: string
  ) {
    if (!dto.password || !dto.code || !/^\d{6}$/.test(dto.code.trim())) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Mật khẩu và mã xác thực 6 chữ số là bắt buộc để tạo lại mã dự phòng'
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Người dùng không tồn tại'
      );
    }

    const passwordMatches = await verifyPassword(dto.password, user.password_hash).catch(
      () => false
    );
    if (!passwordMatches) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Mật khẩu xác thực không chính xác'
      );
    }

    const factor = await this.prisma.mfaFactor.findFirst({
      where: { user_id: userId, status: 'ACTIVE' },
    });
    if (!factor) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CHALLENGE_INVALID',
        'Tài khoản chưa kích hoạt xác thực hai yếu tố'
      );
    }

    const encryptionKey = resolveMfaEncryptionKey(this.config?.MFA_ENCRYPTION_KEY);
    const secret = decryptMfaSecret(factor.secret_ciphertext, encryptionKey);
    const verifyResult = verifyTotpCode(dto.code, secret, factor.last_accepted_step);
    if (!verifyResult.valid) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MFA_CODE_INVALID',
        'Mã xác thực không chính xác'
      );
    }

    const { plaintext: newPlaintextCodes, hashes: newHashes } = generateRecoveryCodes(10);

    await this.prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({
        where: { factor_id: factor.id },
      });

      await tx.mfaRecoveryCode.createMany({
        data: newHashes.map((h) => ({
          factor_id: factor.id,
          code_hash: h,
        })),
      });

      await tx.mfaFactor.update({
        where: { id: factor.id },
        data: { last_accepted_step: verifyResult.acceptedStep },
      });
    });

    await this.logAudit({
      merchantId,
      userId,
      actor: `user:${userId}`,
      action: 'AUTH_MFA_RECOVERY_REGENERATED',
      resource: `user:${userId}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: { new_codes_count: 10 },
    });

    return {
      data: {
        recovery_codes: newPlaintextCodes,
      },
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * Generates a strong temporary password (>= 12 characters) using CSPRNG with rejection sampling
   * and Fisher-Yates shuffle (Finding 6).
   */
  public generateTemporaryPassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const special = '!@#$%^&*';

    const getChars = (set: string, count: number) => {
      let res = '';
      for (let i = 0; i < count; i++) {
        res += set[randomInt(set.length)];
      }
      return res;
    };

    const combined = [
      getChars(upper, 3),
      getChars(lower, 4),
      getChars(digits, 3),
      getChars(special, 2),
    ].join('');

    // Uniform Fisher-Yates shuffle using cryptographically secure random integers (CSPRNG)
    const arr = combined.split('');
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.join('');
  }

  /**
   * FEAT-AUTH-02: Admin-created shop account (AC-ADMIN-01..13)
   * Platform operator provisions initial shop owner accounts without exposing public self-registration.
   */
  async adminCreateShop(
    dto: AdminCreateShopDto,
    clientIp: string,
    correlationId: string,
    actor = 'admin:key'
  ): Promise<{
    success: boolean;
    data: AdminCreatedShopResult;
    meta: { correlation_id: string };
  }> {
    const fields: CanonicalFieldError[] = [];

    // 1. Merchant name validation (AC-ADMIN-13)
    if (!dto.merchant_name || dto.merchant_name.trim().length < 2) {
      fields.push({
        field: 'merchant_name',
        code: 'REQUIRED',
        message: 'Tên cửa hàng phải có ít nhất 2 ký tự',
      });
    } else if (dto.merchant_name.trim().length > 255) {
      fields.push({
        field: 'merchant_name',
        code: 'MAX_LENGTH',
        message: 'Tên cửa hàng không được vượt quá 255 ký tự',
      });
    }

    const email = dto.email ? dto.email.trim().toLowerCase() : undefined;

    // 2. Canonical phone validation & normalization (AC-ADMIN-11, Finding 5)
    let canonicalPhone: string | undefined;
    if (dto.phone !== undefined && dto.phone !== null) {
      const rawPhone = String(dto.phone).trim();
      if (rawPhone.length > 0) {
        // Reject non-numeric characters (excluding leading '+' and common whitespace/dash separators)
        if (/[^0-9+\s.-]/.test(rawPhone)) {
          fields.push({
            field: 'phone',
            code: 'INVALID_FORMAT',
            message: 'Số điện thoại không hợp lệ theo định dạng Việt Nam',
          });
        } else {
          const cleanDigits = rawPhone.replace(/[\s.-]/g, '');
          let normalized = cleanDigits;
          if (cleanDigits.startsWith('+84')) {
            normalized = `0${cleanDigits.slice(3)}`;
          } else if (cleanDigits.startsWith('84') && cleanDigits.length === 11) {
            normalized = `0${cleanDigits.slice(2)}`;
          }

          // Strict Vietnamese mobile pattern: starts with 0, followed by 3, 5, 7, 8, 9, then 8 digits
          if (!/^0[35789][0-9]{8}$/.test(normalized)) {
            fields.push({
              field: 'phone',
              code: 'INVALID_FORMAT',
              message: 'Số điện thoại không hợp lệ theo định dạng Việt Nam',
            });
          } else {
            canonicalPhone = normalized;
          }
        }
      }
    }
    const phone = canonicalPhone;

    // Contact identifiers requirement (AC-ADMIN-09, AC-ADMIN-10)
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

    // 3. Password validation (AC-ADMIN-07, AC-ADMIN-12)
    const customPassword =
      dto.password !== undefined && dto.password !== null && dto.password !== ''
        ? dto.password
        : undefined;

    if (customPassword && customPassword.length < 8) {
      fields.push({
        field: 'password',
        code: 'TOO_SHORT',
        message: 'Mật khẩu phải có độ dài tối thiểu 8 ký tự',
      });
    }

    if (fields.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Dữ liệu đăng ký cửa hàng không hợp lệ',
        false,
        'Vui lòng sửa các trường bị lỗi và thử lại',
        fields
      );
    }

    const passwordIsTemporary = !customPassword;

    // 4. Duplicate identifier check & Idempotent setup retry (AC-ADMIN-08, Finding 4)
    const existingUsers = await this.prisma.user.findMany({
      where: {
        OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      },
      include: {
        merchant: true,
      },
    });

    if (existingUsers.length > 0) {
      const match = existingUsers[0];
      const isSameMerchantRetry =
        existingUsers.length === 1 &&
        match.merchant &&
        match.merchant.name.trim().toLowerCase() === dto.merchant_name.trim().toLowerCase() &&
        match.role === RoleEnum.OWNER;

      if (isSameMerchantRetry) {
        // Canonical retry that resends the one-time setup without creating a second shop
        if (passwordIsTemporary) {
          const rawRetrySetupToken = randomBytes(32).toString('hex');
          const hashedToken = this.hashSecret(rawRetrySetupToken);
          const ttlSeconds = this.config?.PASSWORD_RESET_TTL_SECONDS || 3600 * 24;
          const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
          const channel = email ? 'email' : 'phone';
          const identifier = (email || phone)!;

          await this.prisma.passwordResetToken.create({
            data: {
              user_id: match.id,
              token: hashedToken,
              channel,
              identifier,
              expires_at: expiresAt,
            },
          });

          if (this.deliveryAdapter) {
            const baseUrl = this.config?.FRONTEND_URL || 'http://localhost:3000';
            try {
              await this.deliveryAdapter.sendVerification({
                channel,
                recipient: identifier,
                purpose: 'password_reset',
                link: `${baseUrl}/reset-password?token=${rawRetrySetupToken}`,
              });
            } catch {
              throw new CanonicalApiException(
                HttpStatus.SERVICE_UNAVAILABLE,
                'DELIVERY_FAILED',
                'Không thể gửi liên kết thiết lập tài khoản qua email/số điện thoại',
                true,
                'Vui lòng thử lại sau'
              );
            }
          }
        }

        await this.logAudit({
          merchantId: match.merchant.id,
          userId: match.id,
          actor: actor || 'admin:key',
          action: 'ADMIN_RETRY_SHOP_SETUP',
          resource: `merchant:${match.merchant.id}`,
          correlationId,
          ipAddress: this.hashIp(clientIp),
          details: {
            merchant_code: match.merchant.code,
            password_is_temporary: passwordIsTemporary,
            is_retry: true,
          },
        });

        return {
          success: true,
          data: {
            merchant: {
              id: match.merchant.id,
              name: match.merchant.name,
              code: match.merchant.code,
              status: match.merchant.status,
              created_at: match.merchant.created_at,
            },
            user: {
              id: match.id,
              merchant_id: match.merchant_id,
              full_name: match.full_name,
              email: match.email,
              phone: match.phone,
              role: match.role,
              status: match.status,
              email_verified_at: match.email_verified_at
                ? typeof match.email_verified_at === 'string'
                  ? match.email_verified_at
                  : match.email_verified_at.toISOString()
                : null,
              phone_verified_at: match.phone_verified_at
                ? typeof match.phone_verified_at === 'string'
                  ? match.phone_verified_at
                  : match.phone_verified_at.toISOString()
                : null,
            },
            password_is_temporary: passwordIsTemporary,
          },
          meta: {
            correlation_id: correlationId,
          },
        };
      }

      const conflictField = match.email && match.email === email ? 'email' : 'phone';
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Email hoặc số điện thoại đã tồn tại trên hệ thống',
        false,
        'Vui lòng sử dụng thông tin khác hoặc liên hệ bộ phận hỗ trợ',
        [
          {
            field: conflictField,
            code: 'DUPLICATE',
            message: `${conflictField === 'email' ? 'Email' : 'Số điện thoại'} đã tồn tại trên hệ thống`,
          },
        ]
      );
    }

    // 5. Password generation & hashing
    const finalPassword = customPassword || this.generateTemporaryPassword();
    const passwordHash = await hashPassword(finalPassword);
    const rawSetupToken = passwordIsTemporary ? randomBytes(32).toString('hex') : undefined;

    const fullName = dto.full_name?.trim() || dto.merchant_name.trim();
    let merchant: any = null;
    let user: any = null;
    let lastError: unknown = null;

    // 6. Atomic creation with collision retry for merchant code (AC-ADMIN-03, 04, 05, 06)
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

          const now = new Date();
          const newUser = await tx.user.create({
            data: {
              merchant_id: newMerchant.id,
              full_name: fullName,
              email: email || null,
              phone: phone || null,
              password_hash: passwordHash,
              role: RoleEnum.OWNER,
              status: 'active',
              email_verified_at: email ? now : null,
              phone_verified_at: phone ? now : null,
              terms_accepted_at: now,
              terms_version: 'v1.0',
            },
          });

          if (passwordIsTemporary && rawSetupToken) {
            const hashedToken = this.hashSecret(rawSetupToken);
            const ttlSeconds = this.config?.PASSWORD_RESET_TTL_SECONDS || 3600 * 24;
            const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
            const channel = email ? 'email' : 'phone';
            const identifier = (email || phone)!;

            await tx.passwordResetToken.create({
              data: {
                user_id: newUser.id,
                token: hashedToken,
                channel,
                identifier,
                expires_at: expiresAt,
              },
            });

            // Deliver setup verification atomically with transaction outcome (Finding 4)
            if (this.deliveryAdapter) {
              const baseUrl = this.config?.FRONTEND_URL || 'http://localhost:3000';
              try {
                await this.deliveryAdapter.sendVerification({
                  channel,
                  recipient: identifier,
                  purpose: 'password_reset',
                  link: `${baseUrl}/reset-password?token=${rawSetupToken}`,
                });
              } catch (deliverErr: any) {
                throw new CanonicalApiException(
                  HttpStatus.SERVICE_UNAVAILABLE,
                  'DELIVERY_FAILED',
                  'Không thể gửi liên kết thiết lập tài khoản qua email/số điện thoại',
                  true,
                  'Vui lòng thử lại sau',
                  [
                    {
                      field: channel,
                      code: 'DELIVERY_FAILED',
                      message: 'Gửi thông báo thiết lập thất bại',
                    },
                  ]
                );
              }
            }
          }

          return { merchant: newMerchant, user: newUser };
        });

        merchant = created.merchant;
        user = created.user;
        break;
      } catch (err: unknown) {
        lastError = err;
        if (err instanceof CanonicalApiException) {
          throw err;
        }
        if (this.isUniqueConstraintViolation(err)) {
          const target = (err as { meta?: { target?: string[] | string } })?.meta?.target;
          const isMerchantCodeCollision =
            (Array.isArray(target) && target.includes('code')) ||
            (typeof target === 'string' && target.includes('merchants_code_key'));

          if (isMerchantCodeCollision) {
            continue;
          }

          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_ERROR',
            'Email hoặc số điện thoại đã tồn tại trên hệ thống',
            false,
            'Vui lòng sử dụng thông tin khác',
            [
              {
                field: email ? 'email' : 'phone',
                code: 'DUPLICATE',
                message: `${email ? 'Email' : 'Số điện thoại'} đã tồn tại trên hệ thống`,
              },
            ]
          );
        }
        throw err;
      }
    }

    if (!merchant || !user) {
      if (lastError instanceof CanonicalApiException) {
        throw lastError;
      }
      throw new CanonicalApiException(
        HttpStatus.CONFLICT,
        'MERCHANT_CODE_COLLISION',
        'Không thể tạo mã cửa hàng duy nhất sau nhiều lần thử',
        true,
        'Vui lòng thử lại với tên cửa hàng khác'
      );
    }

    // 7. Audit log (No PII)
    await this.logAudit({
      merchantId: merchant.id,
      userId: user.id,
      actor: actor || 'admin:key',
      action: 'ADMIN_CREATE_SHOP',
      resource: `merchant:${merchant.id}`,
      correlationId,
      ipAddress: this.hashIp(clientIp),
      details: {
        merchant_code: merchant.code,
        password_is_temporary: passwordIsTemporary,
        has_email: Boolean(email),
        has_phone: Boolean(phone),
      },
    });

    return {
      success: true,
      data: {
        merchant: {
          id: merchant.id,
          name: merchant.name,
          code: merchant.code,
          status: merchant.status,
          created_at: merchant.created_at,
        },
        user: {
          id: user.id,
          merchant_id: user.merchant_id,
          full_name: user.full_name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          email_verified_at: user.email_verified_at,
          phone_verified_at: user.phone_verified_at,
        },
        password_is_temporary: passwordIsTemporary,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * FEAT-AUTH-02: Admin list shops
   */
  async adminListShops(
    query: AdminListShopsQuery,
    correlationId: string
  ): Promise<{
    success: boolean;
    data: { shops: any[]; total: number };
    meta: { correlation_id: string };
  }> {
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const search = query.search?.trim();

    const where: any = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, merchants] = await Promise.all([
      this.prisma.merchant.count({ where }),
      this.prisma.merchant.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { created_at: 'desc' },
        include: {
          users: {
            where: { role: RoleEnum.OWNER },
            take: 1,
            select: {
              id: true,
              full_name: true,
              email: true,
              phone: true,
              status: true,
            },
          },
          _count: {
            select: { users: true },
          },
        },
      }),
    ]);

    const formattedShops = merchants.map((m) => {
      const owner = m.users[0] || null;
      return {
        id: m.id,
        name: m.name,
        code: m.code,
        status: m.status,
        created_at: m.created_at,
        user_count: m._count.users,
        owner: owner
          ? {
              id: owner.id,
              full_name: owner.full_name,
              email: owner.email,
              phone: owner.phone,
            }
          : null,
      };
    });

    return {
      success: true,
      data: {
        shops: formattedShops,
        total,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }
}
