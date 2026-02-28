import { Controller, Get } from '@nestjs/common';
import { GroupsService } from './groups.service';

@Controller('codes/groups')
export class GroupsController {
  constructor(private service: GroupsService) {}
  @Get() list() { return this.service.list(); }
}
