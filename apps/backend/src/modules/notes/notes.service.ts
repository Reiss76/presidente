import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class NotesService {
  constructor(private prisma: PrismaService) {}
  list(codeId: bigint) { return this.prisma.note.findMany({ where: { code_id: codeId }, orderBy: { created_at: 'desc' } }); }
  add(codeId: bigint, content: string, author: string) { return this.prisma.note.create({ data: { code_id: codeId, content, author } }); }
}
