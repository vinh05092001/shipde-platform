import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionModule } from '../session/session.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [SessionModule, RbacModule],
  controllers: [ExportsController],
  providers: [ExportsService, PrismaService],
  exports: [ExportsService],
})
export class ExportsModule {}
