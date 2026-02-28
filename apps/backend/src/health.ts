import { buildHealthMeta } from '@presidente/shared';

export function buildBackendHealth() {
  return {
    ...buildHealthMeta('codes-backend'),
    message: 'Backend NestJS de codes-backend está respondiendo ✅',
  };
}
