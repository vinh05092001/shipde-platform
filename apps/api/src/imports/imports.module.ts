import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SessionModule } from '../session/session.module';
import { RbacModule } from '../rbac/rbac.module';
import { APP_CONFIG } from '../config.token';
import { validateConfig } from '@shipde/config';

@Module({
  imports: [SessionModule, RbacModule],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    PrismaService,
    StorageService,
    {
      provide: APP_CONFIG,
      useFactory: () => validateConfig(),
    },
  ],
  exports: [ImportsService],
})
export class ImportsModule {}
