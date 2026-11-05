import { Module } from '@nestjs/common';
import { BulkController } from './bulk.controller';
import { BulkService } from './bulk.service';
import { PrismaService } from '../prisma/prisma.service';
import { RbacModule } from '../rbac/rbac.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [RbacModule, SessionModule],
  controllers: [BulkController],
  providers: [BulkService, PrismaService],
  exports: [BulkService],
})
export class BulkModule {}
