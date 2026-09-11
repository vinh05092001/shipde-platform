import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RateLimitService } from './rate-limit.service';
import { VERIFICATION_ADAPTER } from './auth.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { globalMockVerificationAdapter } from '@shipde/testkit';

import { validateConfig, AppConfig } from '@shipde/config';
import { APP_CONFIG } from '../config.token';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => validateConfig(),
    },
    PrismaService,
    RedisService,
    RateLimitService,
    AuthService,
    {
      provide: VERIFICATION_ADAPTER,
      useValue: globalMockVerificationAdapter,
    },
  ],
  exports: [AuthService, RateLimitService, VERIFICATION_ADAPTER],
})
export class AuthModule {}
