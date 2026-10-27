import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { PermissionsGuard } from './rbac.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [RbacController],
  providers: [RbacService, PermissionsGuard, PrismaService, Reflector],
  exports: [RbacService, PermissionsGuard],
})
export class RbacModule {}
