import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { StorageService } from './storage/storage.service';
import { SmokeWorker } from './queue/smoke.worker';
import { OutboxDispatcher } from './dispatcher/outbox.dispatcher';
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
    OutboxDispatcher,
  ],
  exports: [PrismaService, RedisService, StorageService, SmokeWorker, OutboxDispatcher],
})
export class WorkerAppModule {}
