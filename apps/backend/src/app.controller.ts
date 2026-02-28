import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  health() {
    return {
      ok: true,
      message: 'Backend NestJS de codes-backend está respondiendo ✅',
    };
  }
}
