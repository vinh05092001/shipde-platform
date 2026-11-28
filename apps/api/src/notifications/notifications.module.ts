import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionModule } from '../session/session.module';
import { validateConfig, AppConfig } from '@shipde/config';
import { APP_CONFIG } from '../config.token';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsProducer } from './notifications.producer';

@Module({
  imports: [SessionModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => validateConfig(),
    },
    PrismaService,
    NotificationsService,
    NotificationsProducer,
  ],
  exports: [NotificationsService, NotificationsProducer],
})
export class NotificationsModule {}
