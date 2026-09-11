import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { StorageService } from './storage/storage.service';
import { OutboxService } from './outbox/outbox.service';
import { CorrelationMiddleware } from './correlation/correlation.middleware';
import { validateConfig, AppConfig } from '@shipde/config';
import { APP_CONFIG } from './config.token';

@Module({
  controllers: [HealthController],
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
