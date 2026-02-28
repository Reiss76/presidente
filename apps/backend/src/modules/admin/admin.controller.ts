import { Controller, ForbiddenException, Get, Headers } from '@nestjs/common';
import { AdminService } from './admin.service';

function resolveRole(headers: Record<string, string | string[] | undefined>): string {
  const keys = ['x-role', 'x_role', 'role', 'x-user-role', 'x_user_role'];
  for (const key of keys) {
    const cand = headers?.[key];
    if (Array.isArray(cand)) {
      if (cand.length) return String(cand[0] ?? '');
    } else if (typeof cand === 'string' && cand.trim() !== '') {
      return cand;
    }
  }
  return '';
}

@Controller('admin')
export class AdminController {
  constructor(private service: AdminService) {}

  @Get('dashboard')
  async dashboard(@Headers() headers: Record<string, string | string[] | undefined>) {
    const role = resolveRole(headers).trim().toLowerCase();
    if (role !== 'admin') {
      throw new ForbiddenException('Acceso solo para admin');
    }
    return this.service.dashboard();
  }
}
