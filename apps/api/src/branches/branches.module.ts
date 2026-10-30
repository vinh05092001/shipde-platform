import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { PrismaService } from '../prisma/prisma.service';
import { RbacModule } from '../rbac/rbac.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [RbacModule, SessionModule],
  controllers: [BranchesController],
  providers: [BranchesService, PrismaService],
  exports: [BranchesService],
})
export class BranchesModule {}
