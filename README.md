# presidente (monorepo)

Monorepo unificado del proyecto con frontend y backend bajo un solo flujo de trabajo.

## Estructura

- `apps/frontend` → app Next.js
- `apps/backend` → API backend (NestJS)
- `packages` → código compartido (futuro)
- `docs` → documentación

## Requisitos

- Node.js 20+
- npm 10+

## Configuración

1. Instala dependencias:

```bash
npm install --workspaces
```

2. Crea tus variables de entorno desde el ejemplo raíz y las de cada app:

```bash
cp .env.dev.example .env
cp apps/frontend/.env.example apps/frontend/.env.local
```

> También tienes plantillas para otros entornos:
>
> - `.env.staging.example`
> - `.env.production.example`

> Ajusta valores según tu entorno local.

## Scripts principales

Desde la raíz del repo:

- `npm run dev:frontend` → levanta frontend
- `npm run dev:backend` → levanta backend en modo watch
- `npm run build` → build frontend + backend
- `npm run lint` → lint/type-check frontend + backend
- `npm run test` → comando base de tests (placeholder por ahora)

## CI

Se ejecuta en GitHub Actions (`.github/workflows/ci.yml`) para:

- instalación de dependencias
- lint
- build
- smoke test del endpoint `/health`

## Docker local

Levantar front + back juntos:

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8080/health

## Gobierno del repo

- PR template: `.github/pull_request_template.md`
- CODEOWNERS: `.github/CODEOWNERS`
- Release strategy: `docs/RELEASE.md`
- Branch protection checklist: `docs/BRANCH_PROTECTION_CHECKLIST.md`
