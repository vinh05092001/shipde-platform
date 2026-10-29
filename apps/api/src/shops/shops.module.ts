import { Module } from '@nestjs/common';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';
import { PrismaService } from '../prisma/prisma.service';
import { RbacModule } from '../rbac/rbac.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [RbacModule, SessionModule],
  controllers: [ShopsController],
  providers: [ShopsService, PrismaService],
  exports: [ShopsService],
})
export class ShopsModule {}
