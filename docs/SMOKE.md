# Smoke de Producción

Script rápido para validar que producción sigue viva después de cada deploy.

## Ejecutar

```bash
npm run smoke:prod
```

## Variables opcionales

```bash
BACKEND_URL=https://codes-backend-production.up.railway.app \
FRONTEND_URL=https://www.cosmosx.tech \
BACKUP_URL=https://backup.cosmosx.tech \
npm run smoke:prod
```

## Qué valida

- `GET /health` del backend = 200
- `GET /login` en dominio principal = 200
- `GET /login` en backup = 200
- endpoint de catálogos sin 5xx
- `POST /auth/login` con credenciales inválidas sin 5xx
