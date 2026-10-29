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

import { AuthModule } from './auth/auth.module';
import { SessionModule } from './session/session.module';
import { RbacModule } from './rbac/rbac.module';
import { InvitationsModule } from './invitations/invitations.module';
import { UsersModule } from './users/users.module';
import { ShopsModule } from './shops/shops.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { AttachmentsModule } from './attachments/attachments.module';

@Module({
  imports: [
    AuthModule,
    SessionModule,
    RbacModule,
    InvitationsModule,
    UsersModule,
    ShopsModule,
    WarehousesModule,
    AttachmentsModule,
  ],
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
