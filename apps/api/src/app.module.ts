import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { StorageService } from './storage/storage.service';
import { OutboxService } from './outbox/outbox.service';
import { CorrelationMiddleware } from './correlation/correlation.middleware';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { MfaService } from './auth/mfa.service';
import { PasswordService } from './auth/password.service';
import { TokenService } from './auth/token.service';
import { validateConfig, AppConfig } from '@shipde/config';
import { APP_CONFIG } from './config.token';

@Module({
  controllers: [HealthController, AuthController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => validateConfig(),
    },
    PrismaService,
    RedisService,
    StorageService,
    HealthService,
    OutboxService,
  ],
  exports: [PrismaService, RedisService, StorageService, OutboxService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
