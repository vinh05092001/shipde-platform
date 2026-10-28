import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { PermissionsGuard, RbacSeedGuard } from './rbac.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SessionModule } from '../session/session.module';
import { APP_CONFIG } from '../config.token';
import { validateConfig, AppConfig } from '@shipde/config';

@Module({
  imports: [SessionModule],
  controllers: [RbacController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => validateConfig(),
    },
    RbacService,
    PermissionsGuard,
    RbacSeedGuard,
    PrismaService,
    Reflector,
  ],
  exports: [RbacService, PermissionsGuard, RbacSeedGuard],
})
export class RbacModule {}
