import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { SessionGuard } from './session.guard';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [SessionController],
  providers: [PrismaService, SessionService, SessionGuard],
  exports: [SessionService],
})
export class SessionModule {}
