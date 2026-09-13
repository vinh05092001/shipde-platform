import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { validate } from '../common/validation';
import { DomainError } from '../common/errors';

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip;
}

/**
 * The caller identity is taken from the authenticated request. Until the
 * session guard lands (TASK-FOUND-05) it is read from a header, and a missing
 * one is refused rather than defaulted, so no endpoint can be reached anonymously.
 */
function callerId(req: Request): string {
  const header = req.headers['x-user-id'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw DomainError.unauthenticated('Thiếu định danh người dùng');
  return value;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MfaService) private readonly mfa: MfaService
  ) {}

  // FEAT-AUTH-01
  @Post('register')
  async register(@Body() body: unknown) {
    const v = validate(body);
    const input = {
      merchantName: v.string('merchantName', { min: 2, max: 255 }),
      merchantCode: v.string('merchantCode', { min: 2, max: 64 }),
      email: v.email(),
      phone: v.phone(),
      fullName: v.string('fullName', { min: 2, max: 255 }),
      password: v.password(),
      acceptedTerms: v.bool('acceptedTerms'),
    };
    v.throwIfInvalid();
    return this.auth.register(input);
  }

  @Post('verify')
  async verify(@Body() body: unknown) {
    const v = validate(body);
    const userId = v.uuid('userId');
    const code = v.string('code', { min: 6, max: 6 });
    v.throwIfInvalid();
    return this.auth.verifyContact(userId, code);
  }

  // FEAT-AUTH-03
  @Post('login')
  async login(@Body() body: unknown, @Req() req: Request) {
    const v = validate(body);
    const input = {
      email: v.email(),
      password: v.string('password', { min: 1, max: 200 }),
      merchantCode: v.string('merchantCode', { required: false, max: 64 }) || undefined,
      deviceId: v.string('deviceId', { min: 1, max: 255 }),
      deviceModel: v.string('deviceModel', { required: false, max: 255 }) || undefined,
      ip: clientIp(req),
    };
    v.throwIfInvalid();
    return this.auth.login(input);
  }

  // FEAT-AUTH-04
  @Post('password/forgot')
  async forgot(@Body() body: unknown, @Req() req: Request) {
    const v = validate(body);
    const email = v.email();
    v.throwIfInvalid();
    return this.auth.requestPasswordReset(email, clientIp(req));
  }

  @Post('password/reset')
  async reset(@Body() body: unknown) {
    const v = validate(body);
    const token = v.string('token', { min: 10, max: 200 });
    const password = v.password('newPassword');
    v.throwIfInvalid();
    return this.auth.resetPassword(token, password);
  }

  // FEAT-AUTH-05
  @Post('mfa/setup')
  async mfaSetup(@Body() body: unknown, @Req() req: Request) {
    const v = validate(body);
    const label = v.string('accountLabel', { min: 1, max: 255 });
    v.throwIfInvalid();
    return this.mfa.beginSetup(callerId(req), label);
  }

  @Post('mfa/confirm')
  async mfaConfirm(@Body() body: unknown, @Req() req: Request) {
    const v = validate(body);
    const code = v.string('code', { min: 6, max: 6 });
    v.throwIfInvalid();
    return this.mfa.confirmSetup(callerId(req), code);
  }

  @Post('mfa/verify')
  async mfaVerify(@Body() body: unknown) {
    const v = validate(body);
    const userId = v.uuid('userId');
    const code = v.string('code', { min: 6, max: 32 });
    v.throwIfInvalid();
    return this.mfa.verify(userId, code);
  }

  @Post('mfa/reset/:userId')
  async mfaAdminReset(@Param('userId') userId: string) {
    const v = validate({ userId });
    v.uuid('userId');
    v.throwIfInvalid();
    return this.mfa.adminReset(userId);
  }

  // FEAT-AUTH-06
  @Get('sessions')
  async sessions(@Req() req: Request) {
    return this.auth.listSessions(callerId(req));
  }

  @Delete('sessions/:id')
  async revokeSession(@Param('id') id: string, @Req() req: Request) {
    const v = validate({ id });
    v.uuid('id');
    v.throwIfInvalid();
    return this.auth.revokeSession(callerId(req), id);
  }

  @Post('sessions/revoke-all')
  async revokeAll(@Body() body: unknown, @Req() req: Request) {
    const v = validate(body);
    const except = v.string('exceptSessionId', { required: false, max: 36 }) || undefined;
    v.throwIfInvalid();
    return this.auth.revokeAllSessions(callerId(req), except);
  }
}
