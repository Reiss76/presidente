import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class GroupsService {
  constructor(private prisma: PrismaService) {}
  list() { 
    return this.prisma.group.findMany({ 
      where: { active: true },
      select: { id: true, name: true }
    }); 
  }
}
