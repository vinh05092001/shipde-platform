import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Inject,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import {
  UsersService,
  AdminResetMfaDto,
  CheckScopeDto,
  UpdateUserScopesDto,
} from './users.service';
import {
  ListUsersQueryDto,
  UpdateUserDto,
  SuspendUserDto,
  ActivateUserDto,
  DeactivateUserDto,
} from './users.dto';
import { SessionGuard } from '../session/session.guard';
import { PermissionsGuard, RequirePermissions } from '../rbac/rbac.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';

@Controller(['api/v1/users', 'users'])
@UseGuards(SessionGuard, PermissionsGuard)
@UseFilters(CanonicalExceptionFilter)
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  private extractCorrelationId(req: any): string {
    return (
      req?.correlationId ||
      (Array.isArray(req?.headers?.['x-correlation-id'])
        ? req.headers['x-correlation-id'][0]
        : req?.headers?.['x-correlation-id']) ||
      normalizeCorrelationId()
    );
  }

  /**
   * GET /api/v1/users (and /users)
   * List users in caller's merchant tenant with scopes (AC-USR-02-01, AC-RBAC-02-01).
   */
  @Get()
  @RequirePermissions('iam:manage_users')
  @HttpCode(HttpStatus.OK)
  async listUsers(@Query() query: ListUsersQueryDto, @Req() req: any) {
    const correlationId = this.extractCorrelationId(req);
    const merchantId = req.merchantId as string;
    return this.usersService.listUsers(merchantId, query, correlationId);
  }

  /**
   * GET /users/:id/scopes (and /api/v1/users/:id/scopes)
   * Get specific user's assigned scopes (API-USR-GET-SCOPES, FEAT-RBAC-02).
   */
  @Get(':id/scopes')
  @RequirePermissions('iam:manage_users')
  async getUserScopes(@Param('id') userId: string, @Req() req: any) {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const merchantId = req.merchantId as string;
    return this.usersService.getUserScopes(userId, merchantId, correlationId);
  }

  /**
   * PATCH /users/:id/scopes (and /api/v1/users/:id/scopes)
   * Update scope assignments for a user (API-USR-UPDATE-SCOPES, FEAT-RBAC-02).
   */
  @Patch(':id/scopes')
  @RequirePermissions('iam:manage_users')
  async updateUserScopes(
    @Param('id') userId: string,
    @Body() dto: UpdateUserScopesDto,
    @Req() req: any
  ) {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const merchantId = req.merchantId as string;
    const clientIp = extractClientIp(req);
    const actor = {
      userId: req.userId as string,
      merchantId,
      role: req.userRole || req.jwtClaims?.role,
    };

    return this.usersService.updateUserScopes(
      userId,
      merchantId,
      dto,
      actor,
      correlationId,
      clientIp
    );
  }

  /**
   * POST /users/check-scope (and /api/v1/users/check-scope)
   * Verify scope authorization for current user (AC-USR-01, AC-USR-01-17, AC-RBAC-02-09..16).
   */
  @Post('check-scope')
  @HttpCode(HttpStatus.OK)
  async checkScope(@Body() dto: CheckScopeDto, @Req() req: any) {
    const correlationId = this.extractCorrelationId(req);
    const userId = req.userId as string;
    const merchantId = req.merchantId as string;

    return this.usersService.checkScopeAccess(userId, merchantId, dto, correlationId);
  }

  /**
   * GET /api/v1/users/:id (and /users/:id)
   * Retrieve single user details in caller's merchant tenant (AC-USR-02-02, AC-USR-02-15).
   */
  @Get(':id')
  @RequirePermissions('iam:manage_users')
  @HttpCode(HttpStatus.OK)
  async getUser(@Param('id') targetUserId: string, @Req() req: any) {
    const correlationId = this.extractCorrelationId(req);
    const merchantId = req.merchantId as string;
    return this.usersService.getUser(targetUserId, merchantId, correlationId);
  }

  /**
   * PATCH /api/v1/users/:id (and /users/:id)
   * Update user full name, role, store scopes, and warehouse scopes (AC-USR-02-03, AC-USR-02-14).
   */
  @Patch(':id')
  @RequirePermissions('iam:manage_users')
  @HttpCode(HttpStatus.OK)
  async updateUser(@Param('id') targetUserId: string, @Body() dto: UpdateUserDto, @Req() req: any) {
    const correlationId = this.extractCorrelationId(req);
    const clientIp = extractClientIp(req);
    const actor = {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
      role: req.actorContext?.role || req.userRole || req.jwtClaims?.role,
    };
    return this.usersService.updateUser(targetUserId, dto, actor, clientIp, correlationId);
  }

  /**
   * POST /api/v1/users/:id/suspend (and /users/:id/suspend)
   * Suspend active user and revoke active device sessions (AC-USR-02-04, AC-USR-02-10..13).
   */
  @Post(':id/suspend')
  @RequirePermissions('iam:manage_users')
  @HttpCode(HttpStatus.OK)
  async suspendUser(
    @Param('id') targetUserId: string,
    @Body() dto: SuspendUserDto,
    @Req() req: any
  ) {
    const correlationId = this.extractCorrelationId(req);
    const clientIp = extractClientIp(req);
    const actor = {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
      role: req.actorContext?.role || req.userRole || req.jwtClaims?.role,
    };
    return this.usersService.suspendUser(targetUserId, dto, actor, clientIp, correlationId);
  }

  /**
   * POST /api/v1/users/:id/activate (and /users/:id/activate)
   * Reinstate suspended user to active status (AC-USR-02-07).
   */
  @Post(':id/activate')
  @RequirePermissions('iam:manage_users')
  @HttpCode(HttpStatus.OK)
  async activateUser(
    @Param('id') targetUserId: string,
    @Body() dto: ActivateUserDto,
    @Req() req: any
  ) {
    const correlationId = this.extractCorrelationId(req);
    const clientIp = extractClientIp(req);
    const actor = {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
      role: req.actorContext?.role || req.userRole || req.jwtClaims?.role,
    };
    return this.usersService.activateUser(targetUserId, dto, actor, clientIp, correlationId);
  }

  /**
   * POST /api/v1/users/:id/deactivate (and /users/:id/deactivate)
   * Permanently deactivate user and revoke sessions (AC-USR-02-08, AC-USR-02-09).
   */
  @Post(':id/deactivate')
  @RequirePermissions('iam:manage_users')
  @HttpCode(HttpStatus.OK)
  async deactivateUser(
    @Param('id') targetUserId: string,
    @Body() dto: DeactivateUserDto,
    @Req() req: any
  ) {
    const correlationId = this.extractCorrelationId(req);
    const clientIp = extractClientIp(req);
    const actor = {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
      role: req.actorContext?.role || req.userRole || req.jwtClaims?.role,
    };
    return this.usersService.deactivateUser(targetUserId, dto, actor, clientIp, correlationId);
  }

  /**
   * POST /users/:user_id/mfa/reset
   * Admin reset of target user's lost MFA factor (API-AUTH-MFA-ADMIN-RESET, FEAT-AUTH-05).
   */
  @Post(':user_id/mfa/reset')
  @HttpCode(HttpStatus.OK)
  async adminResetMfa(
    @Param('user_id') targetUserId: string,
    @Body() dto: AdminResetMfaDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() req: any
  ) {
    const correlationId = this.extractCorrelationId(req);
    const clientIp = extractClientIp(req);

    const actor = {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
      role: req.userRole || req.jwtClaims?.role,
      authAssurance: req.authAssurance || req.jwtClaims?.auth_assurance,
      mfaVerifiedAt: req.mfaVerifiedAt || req.jwtClaims?.mfa_verified_at,
    };

    return this.usersService.adminResetMfa(
      targetUserId,
      dto,
      actor,
      idempotencyKey,
      clientIp,
      correlationId
    );
  }
}
