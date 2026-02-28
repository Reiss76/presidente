import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { NotesService } from './notes.service';

@Controller('codes/:id/notes')
export class NotesController {
  constructor(private service: NotesService) {}
  @Get()
  list(@Param('id') id: string) { return this.service.list(BigInt(id)); }
  @Post()
  add(@Param('id') id: string, @Body('content') content: string, @Body('author') author: string) {
    return this.service.add(BigInt(id), content || '', author || 'admin');
  }
}
