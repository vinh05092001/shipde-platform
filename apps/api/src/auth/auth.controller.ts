import { Controller, Post, Body, Req, Res, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  AuthService,
  RegisterDto,
  VerifyEmailDto,
  VerifyPhoneDto,
  ResendVerificationDto,
  ForgotPasswordDto,
  VerifyResetTokenDto,
  ResetPasswordDto,
  LoginDto,
  LoginOtpRequestDto,
  LoginOtpVerifyDto,
} from './auth.service';
import { normalizeCorrelationId } from '@shipde/config';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = this.extractClientIp(req);

    const result = await this.authService.register(dto, clientIp, correlationId);
    return res.status(HttpStatus.CREATED).json(result);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const result = await this.authService.verifyEmail(dto, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  @Post('verify-phone')
  @HttpCode(HttpStatus.OK)
  async verifyPhone(
    @Body() dto: VerifyPhoneDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const result = await this.authService.verifyPhone(dto, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  @Post('verify/resend')
  @HttpCode(HttpStatus.OK)
  async resendVerification(
    @Body() dto: ResendVerificationDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = this.extractClientIp(req);
    const result = await this.authService.resendVerification(dto, clientIp, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = this.extractClientIp(req);
    const result = await this.authService.forgotPassword(dto, clientIp, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  @Post('verify-reset-token')
  @HttpCode(HttpStatus.OK)
  async verifyResetToken(
    @Body() dto: VerifyResetTokenDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const result = await this.authService.verifyResetToken(dto, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = this.extractClientIp(req);
    const result = await this.authService.resetPassword(dto, clientIp, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * FEAT-AUTH-03: password login. 200 AUTHENTICATED, or canonical
   * 400/401/403/429 errors (INVALID_CREDENTIALS, status gates, RATE_LIMITED).
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res() res: Response): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = this.extractClientIp(req);
    const result = await this.authService.login(dto, clientIp, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * FEAT-AUTH-03: request a login OTP (gated by AUTH_LOGIN_OTP_ENABLED).
   * Generic OTP_SENT response; anti-enumeration semantics.
   */
  @Post('login/otp/request')
  @HttpCode(HttpStatus.OK)
  async requestLoginOtp(
    @Body() dto: LoginOtpRequestDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = this.extractClientIp(req);
    const result = await this.authService.requestLoginOtp(dto, clientIp, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * FEAT-AUTH-03: verify a login OTP and issue a session.
   * Canonical errors: OTP_ALREADY_CONSUMED / OTP_EXPIRED (410), INVALID_OTP (400),
   * OTP_MAX_ATTEMPTS_EXCEEDED (429), status gates (403).
   */
  @Post('login/otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyLoginOtp(
    @Body() dto: LoginOtpVerifyDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = this.extractClientIp(req);
    const result = await this.authService.verifyLoginOtp(dto, clientIp, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  private extractClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      if (first && first.trim().length > 0) return first.trim();
    }
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
  }
}
