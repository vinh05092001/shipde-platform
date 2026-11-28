import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { StorageService } from './storage/storage.service';
import { SmokeWorker } from './queue/smoke.worker';
import { OutboxDispatcher } from './dispatcher/outbox.dispatcher';
import { NotificationEmailTransport } from './notifications/notification-email.transport';
import { NotificationProcessor } from './notifications/notification.processor';
import { NotificationsWorker } from './notifications/notifications.worker';
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
    SmokeWorker,
    NotificationEmailTransport,
    NotificationProcessor,
    NotificationsWorker,
    OutboxDispatcher,
  ],
  exports: [
    PrismaService,
    RedisService,
    StorageService,
    SmokeWorker,
    NotificationProcessor,
    NotificationsWorker,
    OutboxDispatcher,
  ],
})
export class WorkerAppModule {}
