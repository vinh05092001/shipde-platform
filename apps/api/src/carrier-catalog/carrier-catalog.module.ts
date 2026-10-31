import { Module } from '@nestjs/common';
import { CarrierCatalogController } from './carrier-catalog.controller';
import { CarrierCatalogService } from './carrier-catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { RbacModule } from '../rbac/rbac.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [RbacModule, SessionModule],
  controllers: [CarrierCatalogController],
  providers: [CarrierCatalogService, PrismaService],
  exports: [CarrierCatalogService],
})
export class CarrierCatalogModule {}
