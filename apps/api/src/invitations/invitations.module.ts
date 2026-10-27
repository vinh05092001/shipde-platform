import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionModule } from '../session/session.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SessionModule, AuthModule],
  controllers: [InvitationsController],
  providers: [PrismaService, InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}

