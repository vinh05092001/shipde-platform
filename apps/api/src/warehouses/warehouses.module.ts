import { Module } from '@nestjs/common';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionModule } from '../session/session.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [SessionModule, RbacModule],
  controllers: [WarehousesController],
  providers: [WarehousesService, PrismaService],
  exports: [WarehousesService],
})
export class WarehousesModule {}
