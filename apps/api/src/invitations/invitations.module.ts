import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [InvitationsController],
  providers: [PrismaService, InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
