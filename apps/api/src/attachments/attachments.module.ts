import { Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionModule } from '../session/session.module';
import { RbacModule } from '../rbac/rbac.module';
import { validateConfig, AppConfig } from '@shipde/config';
import { APP_CONFIG } from '../config.token';

@Module({
  imports: [SessionModule, RbacModule],
  controllers: [AttachmentsController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => validateConfig(),
    },
    AttachmentsService,
    StorageService,
    PrismaService,
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
