import {
  Injectable,
  Inject,
  BadRequestException,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from './rate-limit.service';
import { hashPassword } from './password.util';
import { VERIFICATION_ADAPTER } from './auth.tokens';
import type { IVerificationDeliveryAdapter } from '@shipde/contracts';
import { formatStructuredLog } from '@shipde/config';
import { RoleEnum } from '@prisma/client';

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
    public readonly fields?: CanonicalFieldError[]
  ) {
    super(
      {
        error: {
          code,
          message,
          retryable,
          next_action,
          fields,
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
    private readonly deliveryAdapter?: IVerificationDeliveryAdapter
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
        `Vui lòng chờ ${rateLimitCheck.retryAfterSeconds || 3600} giây trước khi thử lại`
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
      details: { email: user.email, phone: user.phone },
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

    // Look up by raw token or hashed digest (backward compatible with seed fixtures)
    const tokenRecord = await this.prisma.verificationToken.findFirst({
      where: {
        token: { in: [rawToken, hashedToken] },
        channel: 'email',
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
        `Vui lòng chờ ${otpLimit.retryAfterSeconds || 900} giây`
      );
    }

    // Look up latest verification token for this phone
    const tokenRecord = await this.prisma.verificationToken.findFirst({
      where: {
        identifier: phone,
        channel: 'phone',
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
        `Vui lòng chờ ${rateCheck.retryAfterSeconds || 60} giây`
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
