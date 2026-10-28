import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [UsersController, MeController],
  providers: [PrismaService, UsersService, MeService],
  exports: [UsersService, MeService],
})
export class UsersModule {}
