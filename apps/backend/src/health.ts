export function buildBackendHealth() {
  return {
    ok: true,
    service: 'codes-backend',
    timestamp: new Date().toISOString(),
    message: 'Backend NestJS de codes-backend está respondiendo ✅',
  };
}
