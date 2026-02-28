import { Module } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { PrismaService } from '../../prisma.service';

@Module({ providers: [GroupsService, PrismaService], controllers: [GroupsController] })
export class GroupsModule {}
