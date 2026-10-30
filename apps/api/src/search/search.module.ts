import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma/prisma.service';
import { RbacModule } from '../rbac/rbac.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule, RbacModule],
  controllers: [SearchController],
  providers: [SearchService, PrismaService],
  exports: [SearchService],
})
export class SearchModule {}
