import { Controller, Get } from '@nestjs/common';
import { buildBackendHealth } from './health';

@Controller()
export class AppController {
  @Get()
  rootHealth() {
    return buildBackendHealth();
  }

  @Get('health')
  health() {
    return buildBackendHealth();
  }
}
