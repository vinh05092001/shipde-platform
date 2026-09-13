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
import type { IVerificationDeliveryAdapter } from '@shipde/testkit';
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
      this.logAudit({
        actor: this.hashIp(clientIp),
        action: 'AUTH_REGISTER_RATE_LIMITED',
        resource: 'auth/register',
        correlationId,
      });

      throw new CanonicalApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        rateLimitCheck.reason || 'Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau.',
        true,
        `Vui lòng chờ ${rateLimitCheck.retryAfterSeconds || 3600} giây trước khi thử lại`
      );
    }

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
      clientIp,
      correlationId
    );
    if (conflictResponse) {
      return conflictResponse;
    }

    // 5. Atomic Creation of Merchant and User (BR-AUTH-01, BR-AUTH-02)
    const passwordHash = await hashPassword(dto.password);
    const merchantCode = this.generateMerchantCode(dto.merchant_name);

    let merchant: { id: string };
    let user: { id: string; email: string | null; phone: string | null };
    try {
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
    } catch (err: unknown) {
      // BR-AUTH-10: two concurrent submissions of the same not-yet-verified identifier
      // must not create two Merchant/User pairs. The pre-check above cannot see an
      // in-flight, uncommitted transaction from a sibling request, so the platform-wide
      // unique constraint on email/phone is the final authority: a P2002 violation here
      // means the sibling request won the race, and this request must fall back to the
      // same "existing account" branch instead of surfacing a raw 500.
      if (this.isUniqueConstraintViolation(err)) {
        const raced = await this.prisma.user.findMany({
          where: {
            OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
          },
        });
        const racedResponse = await this.resolveExistingAccountConflict(
          raced,
          email,
          clientIp,
          correlationId
        );
        if (racedResponse) {
          return racedResponse;
        }
      }
      throw err;
    }

    // Record rate limit attempt
    await this.rateLimitService.recordRegistrationAttempt(clientIp, email, phone);

    // Issue tokens and dispatch
    await this.issueAndSendVerification(user, email, phone, correlationId);

    // Audit log (BR-AUTH-09)
    this.logAudit({
      actor: this.hashIp(clientIp),
      action: 'AUTH_REGISTER_SUCCESS',
      resource: `user:${user.id}`,
      correlationId,
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

    const tokenRecord = await this.prisma.verificationToken.findFirst({
      where: {
        token: dto.token.trim(),
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

    this.logAudit({
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
   * Verify Phone OTP (BR-AUTH-02, BR-AUTH-06)
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
    const otp = dto.otp.trim();

    const tokenRecord = await this.prisma.verificationToken.findFirst({
      where: {
        identifier: phone,
        channel: 'phone',
        otp,
      },
      orderBy: {
        created_at: 'desc',
      },
      include: {
        user: true,
      },
    });

    if (!tokenRecord) {
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

    this.logAudit({
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
   * Resend Verification Code (BR-AUTH-08)
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

    // Resend Rate Limiting (BR-AUTH-08)
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

    // Find pending user
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { phone: identifier }],
        status: 'pending_verification',
      },
    });

    if (!user) {
      // Return 400 with actionable error
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'USER_NOT_FOUND',
        'Không tìm thấy tài khoản đang chờ xác thực với thông tin cung cấp',
        false,
        'Vui lòng kiểm tra lại email/số điện thoại hoặc đăng ký tài khoản mới'
      );
    }

    await this.rateLimitService.recordResendAttempt(identifier, channel, 60);

    // Issue and dispatch new token
    if (channel === 'email' && user.email) {
      const emailToken = randomBytes(32).toString('hex');
      await this.prisma.verificationToken.create({
        data: {
          user_id: user.id,
          token: emailToken,
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
      const phoneToken = randomBytes(16).toString('hex');
      await this.prisma.verificationToken.create({
        data: {
          user_id: user.id,
          token: phoneToken,
          channel: 'phone',
          identifier: user.phone,
          otp,
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

    this.logAudit({
      actor: this.hashIp(clientIp),
      action: 'AUTH_RESEND_VERIFICATION',
      resource: `user:${user.id}`,
      correlationId,
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
   * BR-AUTH-03 / BR-AUTH-10: given the set of existing users matching the submitted
   * email/phone, either reject as a duplicate (already-verified match), re-issue a
   * verification to the still-pending match, or return null to signal "no conflict,
   * proceed to create". Shared by the pre-check and the post-race-loss recovery path.
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
        clientIp,
        pendingAccount.email || undefined,
        pendingAccount.phone || undefined
      );

      await this.issueAndSendVerification(
        pendingAccount,
        pendingAccount.email || undefined,
        pendingAccount.phone || undefined,
        correlationId
      );

      this.logAudit({
        actor: this.hashIp(clientIp),
        action: 'AUTH_REGISTER_PENDING_RETRY',
        resource: `user:${pendingAccount.id}`,
        correlationId,
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
      const emailToken = randomBytes(32).toString('hex');
      await this.prisma.verificationToken.create({
        data: {
          user_id: user.id,
          token: emailToken,
          channel: 'email',
          identifier: email,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      if (this.deliveryAdapter) {
        await this.deliveryAdapter.sendVerification({
          channel: 'email',
          recipient: email,
          token: emailToken,
        });
      }
    }

    if (phone) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const phoneToken = randomBytes(16).toString('hex');
      await this.prisma.verificationToken.create({
        data: {
          user_id: user.id,
          token: phoneToken,
          channel: 'phone',
          identifier: phone,
          otp,
          expires_at: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      if (this.deliveryAdapter) {
        await this.deliveryAdapter.sendVerification({
          channel: 'phone',
          recipient: phone,
          otp,
          token: phoneToken,
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

  private hashIp(ip: string): string {
    return createHash('sha256').update(ip).digest('hex').substring(0, 16);
  }

  private logAudit(meta: {
    actor: string;
    action: string;
    resource: string;
    correlationId?: string;
  }): void {
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
  }
}
