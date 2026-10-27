import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AdminShopsController } from './admin-shops.controller';
import { AuthService } from './auth.service';
import { RateLimitService } from './rate-limit.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { VERIFICATION_ADAPTER } from './auth.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { DefaultVerificationAdapter } from './default-verification-adapter';
import { UsersModule } from '../users/users.module';
import { SessionModule } from '../session/session.module';

import { validateConfig, AppConfig } from '@shipde/config';
import { APP_CONFIG } from '../config.token';

@Module({
  imports: [UsersModule, SessionModule],
  controllers: [AuthController, AdminShopsController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => validateConfig(),
    },
    PrismaService,
    RedisService,
    RateLimitService,
    AuthService,
    AdminAuthGuard,
    DefaultVerificationAdapter,
    {
      provide: VERIFICATION_ADAPTER,
      useClass: DefaultVerificationAdapter,
    },
  ],
  exports: [AuthService, RateLimitService, VERIFICATION_ADAPTER, AdminAuthGuard],
})
export class AuthModule {}
